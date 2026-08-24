/* Scramble-text reveal — the ScrambleTextPlugin effect, without the dependency.
   Applies to any element carrying data-scramble.

   Anton is proportional, so swapping in random glyphs changes the pixel width of
   the line even when the character count is identical — enough to force an extra
   wrap on narrow screens. Every animating character therefore gets a fixed-width
   cell sized to its final glyph, which keeps the line width constant throughout. */
(() => {
  "use strict";

  // '%' is omitted: at ~2.2x the mean advance it bulges visibly out of its cell.
  const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#&/*<>";
  const STAGGER = 26; // ms between each character settling
  const TICK = 45; // ms between glyph swaps
  const TAIL = 240; // ms of scrambling before the first character settles

  const prefersReduced = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  const randomGlyph = () => CHARS[(Math.random() * CHARS.length) | 0];

  /* Measures glyph advance widths in the element's own rendered font. */
  function glyphMeasurer(el) {
    const cs = getComputedStyle(el);
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const uppercased = cs.textTransform === "uppercase";
    return (ch) => ctx.measureText(uppercased ? ch.toUpperCase() : ch).width;
  }

  function scramble(el, delay) {
    const finalText = el.textContent.replace(/\s+/g, " ").trim();
    const chars = Array.from(finalText);

    // Spaces and punctuation hold their place; only letters and digits cycle.
    const animates = chars.map((c) => /[\p{L}\p{N}]/u.test(c));
    const settleAt = chars.map((_, i) => delay + TAIL + i * STAGGER);
    const total = settleAt[settleAt.length - 1] + TICK;

    const widthOf = glyphMeasurer(el);

    // The accessible copy stays in the DOM; the animated copy is hidden from AT
    // so screen readers never announce the garbled intermediate states.
    el.textContent = "";
    const sr = document.createElement("span");
    sr.className = "sr-only";
    sr.textContent = finalText;
    const visual = document.createElement("span");
    visual.setAttribute("aria-hidden", "true");

    const cells = chars.map((c, i) => {
      if (!animates[i]) return null;
      const cell = document.createElement("span");
      cell.className = "scramble-cell";
      cell.style.width = widthOf(c).toFixed(2) + "px";
      cell.textContent = c;
      return cell;
    });

    chars.forEach((c, i) =>
      visual.append(cells[i] || document.createTextNode(c))
    );
    el.append(sr, visual);

    let start = null;
    let lastTick = -Infinity;

    const frame = (now) => {
      if (start === null) start = now;
      const t = now - start;

      if (t - lastTick >= TICK) {
        lastTick = t;
        for (let i = 0; i < cells.length; i++) {
          if (!cells[i]) continue;
          cells[i].textContent = t >= settleAt[i] ? chars[i] : randomGlyph();
        }
      }

      if (t < total) {
        requestAnimationFrame(frame);
      } else {
        // Drop the cells so the settled headline renders as ordinary text,
        // kerning and all.
        visual.textContent = finalText;
      }
    };

    requestAnimationFrame(frame);
  }

  const targets = Array.from(document.querySelectorAll("[data-scramble]"));
  if (!targets.length || prefersReduced) return;

  // Targets chain into one continuous sweep rather than each restarting at
  // zero. Counted across the document in source order rather than per parent:
  // a line split around an inline image puts its halves under a different
  // parent from the line below, which would otherwise reset the sweep midway.
  const offsets = new Map();
  let charsSoFar = 0;
  targets.forEach((el) => {
    offsets.set(el, charsSoFar * STAGGER);
    charsSoFar += el.textContent.trim().length;
  });

  // Wait for the webfont, otherwise the swap from fallback to Anton resizes the
  // text mid-animation and every measured cell is wrong.
  // The last character of the last target settles at (N-1) * STAGGER + TAIL,
  // and the loop runs one TICK past it. Published as a custom property so the
  // headline's marker stroke can draw itself over exactly that span instead of
  // guessing at a duration that would drift the moment the copy changes.
  const finishMs = Math.max(0, charsSoFar - 1) * STAGGER + TAIL + TICK;

  const ready = document.fonts ? document.fonts.ready : Promise.resolve();
  ready.then(() => {
    document.documentElement.style.setProperty("--scramble-ms", finishMs + "ms");
    // Gates the draw-on. Without it — no JS, or reduced motion, where this
    // module returns early — the stroke is simply there, already drawn.
    document.documentElement.classList.add("is-scrambling");
    targets.forEach((el) => scramble(el, offsets.get(el)));
  });
})();

/* Stat counters — count up once, when the block first scrolls into view. */
(() => {
  "use strict";

  const DURATION = 1600;
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  const numbers = Array.from(document.querySelectorAll("[data-count-to]"));
  if (!numbers.length) return;

  const section = numbers[0].closest(".stats") || numbers[0].parentElement;

  const prefersReduced = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  // The markup already holds the final values, so without JS — or without
  // motion — the correct numbers are simply left on screen.
  if (prefersReduced || !("IntersectionObserver" in window)) return;

  // A target may carry decimals — 4.8 out of 5 — so it is read as a float and
  // rendered to whatever precision the attribute was written with. An integer
  // target still counts in whole numbers, exactly as before.
  function readTarget(el) {
    const raw = el.dataset.countTo;
    const value = parseFloat(raw);
    if (!Number.isFinite(value)) return null;
    const dot = raw.indexOf(".");
    const decimals = dot === -1 ? 0 : raw.length - dot - 1;
    return { value, decimals, fmt: (n) => n.toFixed(decimals) };
  }

  function run() {
    numbers.forEach((el) => {
      const spec = readTarget(el);
      if (!spec) return;

      let start = null;
      const frame = (now) => {
        if (start === null) start = now;
        const t = Math.min(1, (now - start) / DURATION);
        el.textContent = spec.fmt(easeOut(t) * spec.value);
        if (t < 1) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  }

  const ready = document.fonts ? document.fonts.ready : Promise.resolve();
  ready.then(() => {
    // Pin the width before zeroing the digits so counting can't reflow the row.
    // It has to cover the widest value on the way up, not just the final one:
    // Anton's "1" is a third narrower than its other digits, so a target of 1
    // renders a wider "0" en route.
    numbers.forEach((el) => {
      const spec = readTarget(el);
      if (!spec) return;

      el.style.minWidth = "";
      const settled = el.textContent;
      let widest = 0;

      // Measured in the DOM so letter-spacing and font features are included,
      // and stepped at the target's own precision — a decimal target has to
      // measure "0.0" through "4.8", not just the whole numbers between, since
      // the fractional digit is as likely to be the wide one.
      const step = 1 / Math.pow(10, spec.decimals);
      const steps = Math.min(Math.round(spec.value / step), 300);
      for (let i = 0; i <= steps; i++) {
        el.textContent = spec.fmt(i * step);
        widest = Math.max(widest, el.getBoundingClientRect().width);
      }
      el.textContent = settled;
      widest = Math.max(widest, el.getBoundingClientRect().width);

      el.style.minWidth = widest.toFixed(2) + "px";
      el.textContent = spec.fmt(0);
    });

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          observer.disconnect();
          run();
        });
      },
      { threshold: 0.35 }
    );
    observer.observe(section);
  });
})();

/* Service rows — a preview image that trails the cursor.
   quickTo keeps one tween per axis alive instead of spawning a new one on every
   pointermove, and the easing is what gives the panel its lag. */
(() => {
  "use strict";

  const preview = document.querySelector(".service-preview");
  const rows = Array.from(document.querySelectorAll("[data-preview]"));
  if (!preview || !rows.length || !window.gsap) return;

  const prefersReduced = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;
  // pointless without a real pointer, and it would fight scrolling on touch
  const hasPointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (prefersReduced || !hasPointer) return;

  const images = Array.from(preview.querySelectorAll(".service-preview-img"));
  const byKey = new Map(images.map((img) => [img.dataset.key, img]));

  // Hold off on ~280KB of previews until the section is close to being read.
  let loaded = false;
  function loadImages() {
    if (loaded) return;
    loaded = true;
    images.forEach((img) => {
      if (img.dataset.src) img.src = img.dataset.src;
    });
  }

  const section = rows[0].closest(".services");
  if ("IntersectionObserver" in window && section) {
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        loadImages();
      },
      { rootMargin: "300px" }
    );
    io.observe(section);
  } else {
    loadImages();
  }

  gsap.set(preview, { xPercent: -50, yPercent: -50, scale: 0.82 });

  const follow = { duration: 0.55, ease: "power3" };
  const toX = gsap.quickTo(preview, "x", follow);
  const toY = gsap.quickTo(preview, "y", follow);

  let active = null;

  function show(key) {
    loadImages();
    const wasHidden = active === null;
    active = key;

    // Coming from nothing, jump to the cursor so it doesn't fly in from
    // wherever it was last left. Swapping between rows keeps its position and
    // just crossfades the image.
    if (wasHidden) gsap.set(preview, { x: cursorX, y: cursorY });
    gsap.set(preview, { visibility: "visible" });

    images.forEach((img) =>
      gsap.to(img, { opacity: img === byKey.get(key) ? 1 : 0, duration: 0.3 })
    );
    gsap.to(preview, {
      opacity: 1,
      scale: 1,
      duration: 0.45,
      ease: "back.out(1.5)",
      overwrite: "auto",
    });
  }

  function hide() {
    active = null;
    gsap.to(preview, {
      opacity: 0,
      scale: 0.82,
      duration: 0.3,
      ease: "power2.in",
      overwrite: "auto",
      onComplete: () => {
        if (!active) gsap.set(preview, { visibility: "hidden" });
      },
    });
  }

  // Driven by "what is under the cursor right now" rather than enter/leave
  // events on each row. pointerenter only fires when the cursor *crosses into*
  // an element, so a row that scrolls up under a stationary cursor never
  // triggers one — which left the first row in the list looking broken.
  let cursorX = -1;
  let cursorY = -1;

  function rowUnderCursor() {
    if (cursorX < 0) return null;
    const el = document.elementFromPoint(cursorX, cursorY);
    // the panel itself is pointer-events: none, so it can't shadow the row
    return el && el.closest ? el.closest("[data-preview]") : null;
  }

  function update() {
    const row = rowUnderCursor();
    const key = row ? row.dataset.preview : null;
    if (key === active) return; // nothing changed, leave the tweens alone
    if (key) show(key);
    else hide();
  }

  window.addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType && e.pointerType !== "mouse") return;
      cursorX = e.clientX;
      cursorY = e.clientY;
      toX(cursorX);
      toY(cursorY);
      update();
    },
    { passive: true }
  );

  // Scrolling moves rows past a stationary cursor without firing any pointer
  // event, so re-test the same point after the page settles.
  let scrollTimer;
  window.addEventListener(
    "scroll",
    () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(update, 60);
    },
    { passive: true }
  );

  // the cursor leaving the window entirely
  document.addEventListener("pointerleave", hide);
})();

/* Portrait — cursor-driven perspective tilt.
   quickTo reuses one tween per property instead of spawning a new one on every
   pointermove, so the easing stays smooth under a firehose of events. */
(() => {
  "use strict";

  const figure = document.querySelector(".portrait-figure");
  if (!figure || !window.gsap) return;

  const prefersReduced = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;
  // a tilt that follows the cursor is meaningless without a real pointer
  const hasPointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (prefersReduced || !hasPointer) return;

  const MAX_TILT = 11; // degrees at the edges
  const LIFT = 1.025;

  gsap.set(figure, {
    transformPerspective: 900,
    transformOrigin: "center center",
    willChange: "transform",
  });

  const opts = { duration: 0.6, ease: "power3" };
  // quickTo only for the properties driven by pointermove. It silently no-ops
  // on the "scale" shorthand (scaleX/scaleY work), and the lift fires once per
  // enter/leave anyway, so a normal tween is both correct and sufficient.
  const rotX = gsap.quickTo(figure, "rotationX", opts);
  const rotY = gsap.quickTo(figure, "rotationY", opts);
  const lift = (value) =>
    gsap.to(figure, { scale: value, duration: 0.5, ease: "power3", overwrite: "auto" });

  function onMove(e) {
    const r = figure.getBoundingClientRect();
    // -0.5 at one edge, +0.5 at the other
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    rotY(px * MAX_TILT * 2);
    rotX(-py * MAX_TILT * 2);
  }

  figure.addEventListener("pointerenter", () => lift(LIFT));
  figure.addEventListener("pointermove", onMove);
  figure.addEventListener("pointerleave", () => {
    rotX(0);
    rotY(0);
    lift(1);
  });
})();

/* Menu drawer — three cards sliding in from the right.

   One timeline, built once and left paused: play() to enter, reverse() to exit.
   Because both directions are the same tween, interrupting mid-flight simply
   changes direction from wherever it is — no queueing, no snapping, no
   competing tweens. */
(() => {
  "use strict";

  const drawer = document.querySelector(".drawer");
  const backdrop = document.querySelector(".drawer-backdrop");
  const trigger = document.querySelector(".menu-toggle");
  if (!drawer || !backdrop || !trigger) return;

  const cards = Array.from(drawer.querySelectorAll(".drawer-card"));
  const bar = document.querySelector(".header-bar");
  const prefersReduced = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  let isOpen = false;

  // Sit the drawer under whatever height the header actually is — below 960px
  // it wraps to two rows, so the CSS variable alone under-measures it.
  function placeDrawer() {
    if (!bar) return;
    drawer.style.top = Math.round(bar.getBoundingClientRect().bottom + 12) + "px";
  }

  placeDrawer();
  if (window.ResizeObserver) {
    new ResizeObserver(placeDrawer).observe(bar);
  } else {
    window.addEventListener("resize", placeDrawer);
  }

  function setOpenState(next) {
    isOpen = next;
    trigger.setAttribute("aria-expanded", String(next));
    trigger.setAttribute("aria-label", next ? "Close menu" : "Open menu");
    drawer.setAttribute("aria-hidden", String(!next));
  }

  // No GSAP: fall back to a plain show/hide so the menu still works.
  if (!window.gsap) {
    const show = () => {
      drawer.classList.add("is-open");
      backdrop.hidden = false;
      backdrop.style.opacity = "1";
      setOpenState(true);
    };
    const hide = () => {
      drawer.classList.remove("is-open");
      backdrop.hidden = true;
      backdrop.style.opacity = "";
      setOpenState(false);
    };
    trigger.addEventListener("click", () => (isOpen ? hide() : show()));
    backdrop.addEventListener("click", hide);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isOpen) hide();
    });
    return;
  }

  const D = prefersReduced ? 0.001 : 1;

  gsap.set(cards, { xPercent: 115 });
  gsap.set(backdrop, { opacity: 0 });

  const tl = gsap.timeline({
    paused: true,
    onStart() {
      backdrop.hidden = false;
      drawer.classList.add("is-open");
    },
    onReverseComplete() {
      backdrop.hidden = true;
      drawer.classList.remove("is-open");
    },
  });

  tl.to(backdrop, { opacity: 1, duration: 0.35 * D, ease: "power2.out" }, 0).to(
    cards,
    {
      xPercent: 0,
      duration: 0.62 * D,
      ease: "power3.out",
      stagger: 0.07 * D,
    },
    0.04 * D
  );

  function open() {
    placeDrawer();
    setOpenState(true);
    backdrop.hidden = false;
    drawer.classList.add("is-open");
    tl.play();
  }

  function close() {
    setOpenState(false);
    tl.reverse();
  }

  trigger.addEventListener("click", () => (isOpen ? close() : open()));
  backdrop.addEventListener("click", close);

  drawer.querySelectorAll("a").forEach((a) => a.addEventListener("click", close));

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen) {
      close();
      trigger.focus();
    }
  });
})();

/* Chat radial menu — the options fan out from the toggle on an arc.
   Angles are degrees clockwise from the 3 o'clock position, so 90 is straight
   down and 180 is straight left; the arc stays left of the button and can't
   run off the right edge of the screen. */
(() => {
  "use strict";

  const menu = document.querySelector(".chat-menu");
  if (!menu) return;

  const toggle = menu.querySelector(".chat-toggle");
  const options = Array.from(menu.querySelectorAll(".chat-option"));
  if (!toggle || !options.length) return;


  const prefersReduced = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  let open = false;
  let backdrop = null;

  const radius = () =>
    parseFloat(getComputedStyle(menu).getPropertyValue("--radial-r")) || 92;

  const optionSize = () =>
    parseFloat(getComputedStyle(menu).getPropertyValue("--option-size")) || 44;

  const GAP = 10; // clearance left under the nav row

  /* Below 960px the header wraps and the nav drops onto its own row, directly
     under the toggle — so an arc tuned for the one-row bar lands its options on
     top of the links. Push the fan down far enough for the highest option to
     clear the nav, and shift every option by that same amount so the arc keeps
     its shape rather than flattening into a line. */
  function shiftFor(points) {
    const nav = document.querySelector(".nav");
    if (!nav) return 0;

    const t = toggle.getBoundingClientRect();
    const n = nav.getBoundingClientRect();
    // one row: the nav is beside the toggle, not beneath it, so nothing to clear
    if (n.top < t.bottom) return 0;

    const centreY = t.top + t.height / 2;
    const needed = n.bottom + GAP + optionSize() / 2 - centreY;
    const highest = Math.min(...points.map((p) => p.y));
    return Math.max(0, needed - highest);
  }

  function positions() {
    const r = radius();
    const points = options.map((el) => {
      const rad = (parseFloat(el.dataset.angle) || 90) * (Math.PI / 180);
      return { el, x: Math.cos(rad) * r, y: Math.sin(rad) * r };
    });

    const shift = shiftFor(points);
    points.forEach((p) => (p.y += shift));
    return points;
  }

  function addBackdrop() {
    backdrop = document.createElement("button");
    backdrop.className = "chat-backdrop";
    backdrop.type = "button";
    backdrop.setAttribute("aria-label", "Close contact menu");
    backdrop.addEventListener("click", close);
    menu.append(backdrop);
  }

  function removeBackdrop() {
    if (backdrop) backdrop.remove();
    backdrop = null;
  }

  function open_() {
    open = true;
    menu.classList.add("is-open");
    toggle.setAttribute("aria-expanded", "true");
    addBackdrop();

    const points = positions();

    if (!window.gsap || prefersReduced) {
      points.forEach((p) => {
        p.el.style.transform = `translate(${p.x}px, ${p.y}px) scale(1)`;
        p.el.style.opacity = "1";
      });
      return;
    }

    gsap.killTweensOf(options);
    points.forEach((p, i) => {
      gsap.to(p.el, {
        x: p.x,
        y: p.y,
        scale: 1,
        opacity: 1,
        duration: 0.5,
        ease: "back.out(1.7)",
        delay: i * 0.055,
      });
    });
  }

  function close() {
    open = false;
    menu.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
    removeBackdrop();

    if (!window.gsap || prefersReduced) {
      options.forEach((el) => {
        el.style.transform = "";
        el.style.opacity = "";
      });
      return;
    }

    gsap.killTweensOf(options);
    options.forEach((el, i) => {
      gsap.to(el, {
        x: 0,
        y: 0,
        scale: 0.4,
        opacity: 0,
        duration: 0.28,
        ease: "power2.in",
        // collapse from the outside in
        delay: (options.length - 1 - i) * 0.035,
      });
    });
  }

  toggle.addEventListener("click", () => (open ? close() : open_()));

  // close on Escape, and after picking an option
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && open) {
      close();
      toggle.focus();
    }
  });
  options.forEach((el) => el.addEventListener("click", close));

  // a resize changes the radius, so re-place anything already fanned out
  if (window.ResizeObserver) {
    let timer;
    new ResizeObserver(() => {
      if (!open) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        positions().forEach((p) => {
          if (window.gsap) gsap.set(p.el, { x: p.x, y: p.y });
          else p.el.style.transform = `translate(${p.x}px, ${p.y}px) scale(1)`;
        });
      }, 120);
    }).observe(document.body);
  }
})();

/* Footer wordmark — the brand line set to exactly the width of the footer
   column. Advance widths scale linearly with font-size, and the letter-spacing
   is in em so it scales too, which makes one measurement at a probe size enough
   to solve for the fit. */
(() => {
  "use strict";

  const el = document.querySelector(".footer-wordmark-text");
  if (!el) return;

  const box = el.parentElement;
  const PROBE = 200; // px — big enough that rounding in the ratio is negligible

  function fit() {
    const available = box.clientWidth;
    if (!available) return;

    el.style.fontSize = PROBE + "px";
    const width = el.getBoundingClientRect().width;
    if (!width) return;

    el.style.fontSize = ((PROBE * available) / width).toFixed(2) + "px";
  }

  // Anton has to be loaded first, or the fit is solved against the fallback face.
  const ready = document.fonts ? document.fonts.ready : Promise.resolve();
  ready.then(() => {
    fit();

    // The column is capped at 1160px, so this fires on viewport changes below
    // that. Measuring the box rather than the window also covers the scrollbar
    // appearing or disappearing. fit() only writes to the child, so it cannot
    // feed back into the observed element.
    if (window.ResizeObserver) new ResizeObserver(fit).observe(box);
    else window.addEventListener("resize", fit);
  });
})();

/* Footer year — the markup carries the year it was written, so the page is
   still correct with JS off; this just keeps it from going stale. */
(() => {
  "use strict";

  const el = document.querySelector("[data-year]");
  if (el) el.textContent = String(new Date().getFullYear());
})();

/* Contact form — hands the enquiry to WhatsApp.

   There is no server behind this page, so nothing is posted anywhere. The send
   button is a plain link to WhatsApp and this keeps its href written with
   whatever is in the fields, so pressing it is an ordinary click on an ordinary
   link — the same thing the header button is, which is what lets the browser
   offer to open the installed app rather than falling through to a QR code.

   The visitor sends the message from their own WhatsApp, which puts the enquiry
   in the same thread as the header button and gives both sides a conversation
   rather than a one-way form. */
(() => {
  "use strict";

  const form = document.querySelector(".contact-form");
  if (!form) return;

  const button = form.querySelector(".contact-submit");
  if (!button) return;

  // WhatsApp wants digits only: country code first, no plus, no spaces
  const number = (form.dataset.whatsapp || "").replace(/\D/g, "");
  if (!number) return;

  const status = form.querySelector(".form-status");

  /* Two addresses for the same conversation, because no single one reaches
     every WhatsApp.

     On a phone wa.me opens the app with the message written. On a desktop it
     cannot: it lands on a splash page whose "Open app" button points at
     web.whatsapp.com, so an installed desktop app is never offered the message
     and anyone not already paired gets a QR code instead. The whatsapp://
     protocol is the only address the desktop app answers to directly.

     Which leaves desktop visitors without the app, for whom the protocol does
     nothing at all — so the status line hands them the web address the moment
     they click, rather than leaving them waiting on a window that is not
     coming. */
  const onPhone = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

  const webUrl = (text) =>
    `https://wa.me/${number}?text=${encodeURIComponent(text)}`;

  const appUrl = (text) =>
    `whatsapp://send?phone=${number}&text=${encodeURIComponent(text)}`;

  const value = (name) => {
    const field = form.elements[name];
    return field ? field.value.trim() : "";
  };

  const compose = () => {
    /* The label, not the value: "Web App" reads better in a chat than
       "mobile-app". The placeholder carries no value, which is what keeps
       "Looking for: Choose one" out of an enquiry nobody filled that part of. */
    const select = form.elements.service;
    const chosen = select && select.value && select.options[select.selectedIndex];
    const need = chosen ? chosen.text : "";

    /* Falsy entries drop out, so an omitted phone leaves no empty line behind —
       and since this runs on every keystroke, a half-filled form produces a
       half-written message rather than a row of empty labels. */
    const details = [
      value("name") && `Name: ${value("name")}`,
      value("email") && `Email: ${value("email")}`,
      value("phone") && `Phone: ${value("phone")}`,
      need && `Looking for: ${need}`,
    ].filter(Boolean);

    // joined in blocks so the greeting, the details and the brief stay apart
    return [
      "Hi Orisa Digital — enquiry from your website.",
      details.join("\n"),
      value("message"),
    ]
      .filter(Boolean)
      .join("\n\n");
  };

  const rewrite = () => {
    const text = compose();

    if (onPhone) {
      button.href = webUrl(text);
      return;
    }

    /* A protocol link hands off to the app without navigating, so a new tab
       would only be opened to sit there empty. */
    button.href = appUrl(text);
    button.removeAttribute("target");
    button.removeAttribute("rel");
  };

  /* Kept current as they type rather than written on the way out, so the href
     is already right at the moment of the click and nothing has to run in
     between. The markup ships a bare wa.me number as the href, so the link
     still reaches the same conversation if this never runs at all. */
  form.addEventListener("input", rewrite);
  form.addEventListener("change", rewrite);
  rewrite();

  button.addEventListener("click", (event) => {
    /* Without a submit button the browser no longer checks required fields, so
       ask it to, and stay put if anything is missing. */
    if (!form.reportValidity()) {
      event.preventDefault();
      return;
    }

    rewrite();

    // the click itself does the navigating — everything below is just reporting
    if (status) {
      status.dataset.state = "info";
      status.textContent = "";

      // the handoff only drafts the message — saying so avoids a silent drop
      status.append(
        "WhatsApp is opening with your message ready. Press send there and it reaches us. "
      );

      /* Always the web address, never the protocol one the button may have just
         tried: this line exists for the people that protocol did nothing for. */
      const retry = document.createElement("a");
      retry.href = webUrl(compose());
      retry.target = "_blank";
      retry.rel = "noopener noreferrer";
      retry.textContent = onPhone
        ? "Not opening? Tap here."
        : "No WhatsApp app? Open WhatsApp Web instead.";
      status.append(retry);
    }
  });

  /* Enter inside a field submitted the form back when a submit button existed.
     Nothing hears that now, so route it to the link. */
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    button.click();
  });
})();

/* Counting sliders — a drawn face over a native range input.

   The input stays the control: it holds the value, answers the arrow keys and
   is what a screen reader announces. What it does not do is handle the drag.
   Its thumb is sized by the browser, and the drawn one is a pill wide enough to
   carry the number, so a drag mapped to the native width would slide out from
   under the pointer. The pointer is measured against the drawn thumb here
   instead, which is the one the eye is following.

   Both routes funnel through setting the input's value and letting it fire its
   own input event, so a drag and a keypress leave by the same door.

   Everything that differs between one slider and the next — the unit price,
   what the base price already covers, what one of them is called — is read off
   the element, so a new count is markup rather than code. */
(() => {
  "use strict";

  const sliders = [...document.querySelectorAll(".calc-slider")];
  if (!sliders.length) return;

  // grouped the way the prices are written everywhere else on the page
  const money = (amount) => `RM${amount.toLocaleString("en-US")}`;

  sliders.forEach((slider) => setup(slider, money));

  function setup(slider, money) {
  const input = slider.querySelector(".calc-slider-input");
  const readout = slider.querySelector(".calc-slider-value");
  if (!input || !readout) return;

  const min = Number(input.min);
  const max = Number(input.max);
  // a zero-width range would divide by zero below, and has nothing to draw anyway
  if (!(max > min)) return;

  /* Scoped to the field, not the document: with more than one slider on the
     page, a document-wide lookup would point every one of them at the first
     slider's readout. */
  const field = slider.closest(".calc-slider-field") || slider.parentElement;
  const sum = field.querySelector(".calc-slider-sum");
  const total = field.querySelector(".calc-slider-total");

  const paint = () => {
    /* Read each time rather than once at setup: a rate can be switched under a
       slider — the same count of forms costs one thing at one tier and another
       at the next — and a figure captured at startup would keep quoting the
       rate that happened to be selected when the page loaded. */
    const unit = Number(slider.dataset.unitPrice) || 0;
    // what the base price already covers, so only the ones beyond it are charged
    const included = Number(slider.dataset.included) || 0;
    const noun = slider.dataset.unit || "item";
    const count = (n) => `${n} ${n === 1 ? noun : `${noun}s`}`;

    const value = Number(input.value);
    slider.style.setProperty("--pct", (value - min) / (max - min));
    readout.textContent = input.value;

    const extra = Math.max(0, value - included);

    /* Nothing to add reads better as the reason than as RM0 — the figure is
       zero because the base price already covers these, not because they are
       free. A slider that includes none never reaches this branch. */
    if (sum) {
      sum.textContent = extra
        ? `+${count(extra)} × ${money(unit)}`
        : count(value);
    }
    if (total) {
      total.textContent = extra ? money(extra * unit) : "Included in base price";
    }
  };

  input.addEventListener("input", paint);

  // bubbles, so anything listening for the slider hears every route alike
  const commit = (next) => {
    const clamped = Math.min(max, Math.max(min, next));
    if (clamped === Number(input.value)) return;

    input.value = clamped;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  /* The bar is inset by half a thumb at each end, which makes it exactly the
     path the thumb's centre travels — so a pointer anywhere along it maps
     straight across, with no half-thumb correction to keep in step. */
  const rail = slider.querySelector(".calc-slider-rail");

  const valueAt = (clientX) => {
    const box = rail.getBoundingClientRect();
    if (box.width <= 0) return min;

    const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    return Math.round(min + ratio * (max - min));
  };

  let dragging = false;

  slider.addEventListener("pointerdown", (event) => {
    dragging = true;

    /* Capture, so a drag that wanders off the slider still tracks and still
       ends rather than sticking down. It refuses pointers it does not consider
       active, which is not a reason to abandon the drag — the flag above is
       what actually governs it. */
    try {
      slider.setPointerCapture(event.pointerId);
    } catch (error) {
      /* no capture, so the drag ends at the edge instead of following */
    }

    input.focus({ preventScroll: true });
    commit(valueAt(event.clientX));
  });

  slider.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    commit(valueAt(event.clientX));
  });

  const release = (event) => {
    dragging = false;
    if (slider.hasPointerCapture(event.pointerId)) {
      slider.releasePointerCapture(event.pointerId);
    }
  };

  slider.addEventListener("pointerup", release);
  slider.addEventListener("pointercancel", release);

  paint();
  }
})();

/* Language cost — the one figure on the page that two answers decide.

   A site has one main language whatever it costs, so that one comes with the
   base price and only the languages after it are charged. Each of those is
   priced per page, which means this has to watch the page count as well as its
   own chips: translating twelve pages is not the same job as translating five,
   and a total that ignored the slider above would go stale the moment it
   moved. */
(() => {
  "use strict";

  const field = document.querySelector(".calc-language");
  if (!field) return;

  const chips = [...field.querySelectorAll('input[name="languages"]')];
  const sum = field.querySelector(".calc-slider-sum");
  const total = field.querySelector(".calc-slider-total");
  if (!chips.length || !sum || !total) return;

  const pages = document.querySelector("#pages");
  const unit = Number(field.dataset.languagePrice) || 0;

  const money = (amount) => `RM${amount.toLocaleString("en-US")}`;
  const count = (n, noun) => `${n} ${n === 1 ? noun : `${noun}s`}`;

  const paint = () => {
    const chosen = chips.filter((chip) => chip.checked).length;
    // the first is the main one, and it is already paid for
    const extra = Math.max(0, chosen - 1);

    /* A one-page site has no pages step, so the slider above is not on the page
       to be read. Reading it regardless quoted the multi-page default it was
       still sitting at — four pages of translation on a site with one. */
    const live = pages && !pages.closest("[hidden]");
    const pageCount = live ? Number(pages.value) : 1;

    /* Every site has a language, so none chosen is an unanswered question
       rather than a free one — calling it included would price a site that
       cannot exist. */
    if (!chosen) {
      sum.textContent = "Choose a language";
      total.textContent = "—";
      return;
    }

    if (!extra) {
      sum.textContent = `${count(chosen, "language")}, the main one`;
      total.textContent = "Included in base price";
      return;
    }

    sum.textContent = `+${count(extra, "language")} × ${money(unit)} × ${count(
      pageCount,
      "page"
    )}`;
    total.textContent = money(extra * unit * pageCount);
  };

  field.addEventListener("change", paint);
  // the page count is the other half of this sum, and it lives outside the field
  if (pages) pages.addEventListener("input", paint);

  /* Changing the product changes the page count without touching either of the
     two above: the slider is not moved, it is taken off the page. Bound to the
     section rather than the questions, so the module that does the hiding has
     already run by the time this reads what is hidden. */
  const section = field.closest(".calculator");
  if (section) section.addEventListener("change", paint);

  paint();
})();

/* Calculator parts that only apply to some answers.

   Two kinds. Anything carrying data-for lists the project types it belongs to —
   usually a whole step, but a single add-on can be gated the same way when it
   makes no sense for one of the products. Anything carrying data-when names a
   control — by selector — and shows only while that control is ticked.

   They are resolved together, in one pass, in document order, because they
   nest: a form tier opens a count, the add-on above it opens the tier, and the
   step above that opens the add-on. Document order puts every parent before its
   children, so by the time a part is judged, anything it sits inside has
   already been settled and can simply be looked at. Separate modules would race
   to notice each other and leave a count showing under a question nobody asked.

   The hidden attribute rather than a class: it takes the part out of the
   accessibility tree as well as off the screen, which a display rule alone
   would not. */
(() => {
  "use strict";

  const panel = document.querySelector(".calculator-questions");
  if (!panel) return;

  // one list, in document order — parents ahead of the parts they contain
  const hosts = [...panel.querySelectorAll("[data-for], [data-when]")];
  if (!hosts.length) return;

  /* A part that no longer applies has to forget what was said to it. Left
     alone, a blog ticked under one package stays ticked behind the scenes and
     turns up on the next one's price — a charge for something the visitor was
     never shown, let alone asked for. Restoring rather than blanking, so a
     count with a sensible starting figure returns to it.

     Each reset announces itself, so whatever draws the control redraws it and
     nothing here needs to know how. */
  const clear = (host) => {
    host.querySelectorAll("input").forEach((input) => {
      if (input.type === "checkbox" || input.type === "radio") {
        // back to its default, which is not always off — a main language is on
        if (input.checked === input.defaultChecked) return;
        input.checked = input.defaultChecked;
      } else {
        if (input.value === input.defaultValue) return;
        input.value = input.defaultValue;
      }

      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };

  const show = (host, applies) => {
    if (!applies) clear(host);
    host.hidden = !applies;
  };

  /* The resets above fire change events of their own, which arrive back here
     while this is still running. The order below already accounts for them, so
     a second pass would only undo its own work. */
  let running = false;

  const sync = () => {
    if (running) return;
    running = true;

    const chosen = [...panel.querySelectorAll('input[name="project-type"]')].find(
      (type) => type.checked
    );
    const type = chosen ? chosen.value : "";

    hosts.forEach((host) => {
      let applies;

      if (host.dataset.for !== undefined) {
        applies = host.dataset.for.split(/\s+/).includes(type);
      } else {
        /* Every match, not the first: a part can hang off a whole group rather
           than one control — the domain length applies to any extension being
           chosen, not to a particular one. With a single match this is what it
           always was. */
        const triggers = [...panel.querySelectorAll(host.dataset.when)];
        applies = triggers.some((trigger) => trigger.checked);
      }

      /* A tick inside something already hidden counts for nothing — the
         question that would have justified it was never put. */
      if (applies && host.parentElement.closest("[hidden]")) applies = false;

      show(host, applies);
    });

    /* The step numbers are a running count of what is actually on the page
       rather than fixed labels. A one-page site has no pages step, and a list
       that jumped from 03 to 05 would read as a step the visitor had somehow
       missed. The numbers in the markup are the multi-page order, so they are
       already right if this never runs. */
    let shown = 0;
    panel.querySelectorAll(".calc-step").forEach((step) => {
      const index = step.querySelector(".calc-step-index");
      if (!index || step.hidden) return;
      shown += 1;
      index.textContent = String(shown).padStart(2, "0");
    });

    running = false;
  };

  // one listener for both, since either kind of answer can change what shows
  panel.addEventListener("change", sync);
  sync();
})();

/* Running estimate — what every answer on the page adds up to.

   Three kinds of charge, all read off the markup so a new question is markup
   rather than code: a ticked option carrying data-price, a count charging
   data-unit-price for whatever it holds beyond data-included, and the language
   field, whose figure needs the page count as well as its own chips.

   Anything inside a hidden part is skipped. The module above resets those
   inputs when it hides them, so their values are already back to defaults —
   but a default is not always zero, and a count sitting at its minimum under a
   question nobody was asked would still price. Reading the hidden state is what
   keeps an unasked question off the bill.

   Only charges are listed. A count covered by the base price contributes
   nothing and saying so line by line would bury the figures that do.

   The listener sits on the section rather than the questions panel, so it runs
   after the one that resolves what is hidden: events reach the inner element
   first, and reading visibility before that settled would price the answer
   before last. */
(() => {
  "use strict";

  const root = document.querySelector(".calculator");
  const list = document.querySelector("[data-estimate-lines]");
  const output = document.querySelector("[data-estimate-total]");
  if (!root || !list || !output) return;

  const send = document.querySelector("[data-estimate-send]");
  const download = document.querySelector("[data-estimate-pdf]");

  // what the panel is showing right now, for whatever is asked to write it out
  let current = { found: [], total: 0 };

  const panel = root.querySelector(".calculator-questions");
  if (!panel) return;

  /* Whole ringgit everywhere except where the figures genuinely carry sen —
     domains are priced at .90 and a tax of 8% lands anywhere, so rounding those
     to the ringgit would make the breakdown fail to add up in front of the
     reader. */
  /* How many pages anything priced by the page is charged for.

     A one-page site has no pages step, so there is no slider to read — the
     product name is the count. Reading the slider regardless would price off a
     hidden control still holding the multi-page default, and charge for pages
     nobody was offered.

     data-per-page-less takes off the pages a charge does not apply to: the
     contact page, which carries a form rather than copy. It only applies where
     that page exists, so a one-pager is not discounted down to nothing. */
  const perPage = (input) => {
    const slider = panel.querySelector("#pages");
    if (!slider || !live(slider)) return 1;
    return Math.max(0, Number(slider.value) - (Number(input?.dataset.perPageLess) || 0));
  };

  const money = (amount) => `RM${Math.round(amount).toLocaleString("en-US")}`;
  const exact = (amount) =>
    `RM${amount.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  const plural = (n, noun) => `${n} ${n === 1 ? noun : `${noun}s`}`;
  const live = (el) => !el.closest("[hidden]");

  /* Direct text only. A name can carry a pill — "Popular" — which belongs to the
     label a screen reader reads but not to the line on a bill, and textContent
     would run the two together as "SME WebsitePopular". */
  const nameOf = (el) =>
    [...el.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent)
      .join("")
      .trim();

  /* Term-priced blocks: a yearly rate bought for a number of years, with a
     service charge and, for some, tax. The domain and the hosting are the same
     shape and differ only in their figures, so those live on the block —
     data-term-tax, data-term-service — and a third one is markup.

     Tax, where it applies, is on the registration only. The service charge is
     ours and is not taxed again here.

     Blocks with nothing chosen drop out rather than returning zero, so callers
     can tell "declined" from "costs nothing". */
  const terms = () =>
    [...panel.querySelectorAll("[data-term]")]
      .map((block) => {
        if (!live(block)) return null;

        const chosen = [...block.querySelectorAll("input[data-term-price]")].find(
          (input) => input.checked
        );
        if (!chosen) return null;

        const years =
          Number(
            [...block.querySelectorAll(`input[name="${block.dataset.termYears}"]`)].find(
              (year) => year.checked
            )?.value
          ) || 1;

        const sub = Number(chosen.dataset.termPrice) * years;
        const tax = sub * (Number(block.dataset.termTax) || 0);
        const service = Number(block.dataset.termService) || 0;
        const name = chosen.closest(".calc-option")?.querySelector(".calc-option-name");

        return {
          block,
          label: block.dataset.termLabel || "",
          name: name ? nameOf(name) : chosen.value,
          years,
          sub,
          tax,
          service,
          total: sub + tax + service,
        };
      })
      .filter(Boolean);

  const lines = () => {
    const found = [];

    // flat prices — one ticked option, one charge
    panel.querySelectorAll("input[data-price]").forEach((input) => {
      if (!input.checked || !live(input)) return;
      const price = Number(input.dataset.price) || 0;
      if (!price) return;

      const name = input.closest(".calc-option")?.querySelector(".calc-option-name");
      const label = name ? nameOf(name) : input.value;

      /* Several steps offer an option called "Professional", so on their own
         those lines stack up identically and the reader cannot tell which
         service each one is. Steps that need disambiguating name themselves
         with data-line-label; the add-ons, whose names are already distinct,
         do not carry one and are left as they are. */
      const kind = input.closest("[data-line-label]")?.dataset.lineLabel;
      found.push({ label: kind ? `${label} · ${kind}` : label, price });
    });

    /* Priced by the page rather than as a flat fee, off the same count as the
       base price. data-per-page-less takes off the pages the charge does not
       apply to — the contact page carries a form, not copy. The count is in
       the label so that subtraction is visible rather than a figure the reader
       has to reconcile on their own. */
    panel.querySelectorAll("input[data-per-page]").forEach((input) => {
      if (!input.checked || !live(input)) return;

      const unit = Number(input.dataset.perPage) || 0;
      const count = perPage(input);
      if (!unit || !count) return;

      const name = input.closest(".calc-option")?.querySelector(".calc-option-name");
      const label = name ? nameOf(name) : input.value;
      const kind = input.closest("[data-line-label]")?.dataset.lineLabel;

      found.push({
        label: `${kind ? `${label} · ${kind}` : label} × ${plural(count, "page")}`,
        price: unit * count,
      });
    });

    /* One line each. They carry their own service charge and tax, and what
       reaches the estimate is the figure the reader was shown at the foot of
       that step rather than the bare yearly rate. */
    terms().forEach((term) => {
      found.push({
        label: `${term.label} · ${term.name}, ${plural(term.years, "year")}`,
        price: term.total,
      });
    });

    // counts — only what sits beyond what the base price already covers
    panel.querySelectorAll(".calc-slider").forEach((slider) => {
      if (!live(slider)) return;

      const input = slider.querySelector(".calc-slider-input");
      if (!input) return;

      const unit = Number(slider.dataset.unitPrice) || 0;
      const included = Number(slider.dataset.included) || 0;
      const extra = Math.max(0, Number(input.value) - included);
      if (!unit || !extra) return;

      found.push({
        label: `${included ? "+" : ""}${plural(extra, slider.dataset.unit || "item")}`,
        price: extra * unit,
      });
    });

    // languages — per page, and only the ones after the main one
    const field = panel.querySelector(".calc-language");
    if (field && live(field)) {
      const chosen = [...field.querySelectorAll('input[name="languages"]')].filter(
        (chip) => chip.checked
      ).length;
      const extra = Math.max(0, chosen - 1);
      const count = perPage();
      const unit = Number(field.dataset.languagePrice) || 0;
      const price = extra * unit * count;

      if (price) {
        found.push({
          label: `+${plural(extra, "language")} × ${plural(count, "page")}`,
          price,
        });
      }
    }

    return found;
  };

  /* The estimate as a message, on the button that sends it.

     Written into the href rather than built on click, so it is an ordinary link
     — long-pressable, copyable, openable in a new tab — and so the visitor can
     see where it goes before pressing it. Nothing is sent from here: WhatsApp
     opens with the message filled in and they press send themselves.

     wa.me carries text and nothing else. It cannot take an attachment, which is
     why the quote is written out in full here rather than linked to as a file. */
  const WHATSAPP = "60139975304";

  const quote = (found, total) => {
    current = { found, total, message: "" };

    /* One line each, price on the same line. No attempt to align the figures
       into a column: WhatsApp sets messages in a proportional font, so padding
       with spaces or dots lines nothing up and falls apart on the long labels. */
    const body = found.length
      ? found.map((line) => `• ${line.label} — ${money(line.price)}`).join("\n")
      : "• Nothing selected yet";

    const text =
      "Hello Orisa Digital, here is my estimate from your pricing page.\n\n" +
      "*MY ESTIMATE*\n" +
      body +
      `\n\n*Estimated total: ${money(total)}*\n\n` +
      "Please confirm this and send me a proper quote.";

    current.message = text;
    if (send) send.href = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(text)}`;
  };

  /* The estimate as a file, for anyone who wants a document rather than a chat.

     The library is fetched the first time the button is pressed rather than
     with the page. Most visitors never ask for a PDF, and 350KB of script to
     sit unused is the sort of weight that makes a page slow for everybody in
     order to serve a few. */
  const PDF_SRC = "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js";
  let loading = null;

  const pdfLib = () => {
    if (loading) return loading;

    loading = new Promise((resolve, reject) => {
      const tag = document.createElement("script");
      tag.src = PDF_SRC;
      tag.onload = () =>
        window.jspdf ? resolve(window.jspdf) : reject(new Error("jspdf missing"));
      // a failed load has to clear itself, or every later press waits on a
      // promise that already settled and nothing ever tries again
      tag.onerror = () => {
        loading = null;
        reject(new Error("jspdf failed to load"));
      };
      document.head.appendChild(tag);
    });

    return loading;
  };

  /* The logo, as something jsPDF will take. It only reads PNG and JPEG, and the
     only copies on the site are WebP and AVIF — so it is drawn to a canvas and
     read back as a PNG, which keeps the transparency. Same origin, so nothing
     taints the canvas, and no third copy of the artwork has to be kept in step
     with the other two.

     Done once and remembered: the same file would otherwise be decoded again on
     every press. */
  const LOGO_SRC = "image/orisa.webp";
  let logo = null;

  const logoPng = () => {
    if (logo) return logo;

    logo = (async () => {
      /* Fetched and decoded as data rather than loaded as an <img>. An image
         element's decode() is tied to rendering and can sit unresolved forever
         in a tab that is not being drawn — which would leave the button saying
         "Preparing…" and never finish. createImageBitmap has no such tie. */
      const response = await fetch(LOGO_SRC);
      if (!response.ok) throw new Error(`logo ${response.status}`);

      const bitmap = await createImageBitmap(await response.blob());

      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
      bitmap.close();

      return {
        data: canvas.toDataURL("image/png"),
        ratio: canvas.width / canvas.height,
      };
    })();

    // a failure must not be remembered, or the logo never returns
    logo.catch(() => {
      logo = null;
    });

    return logo;
  };

  const buildPdf = async () => {
    const { jsPDF } = await pdfLib();
    const doc = new jsPDF({ unit: "mm", format: "a4" });

    const LEFT = 20;
    const RIGHT = 190;
    let y = 26;

    /* The wordmark if it loads, the name set in type if it does not. A quote
       with no letterhead is worth more than one that fails to build. */
    try {
      // capped, so a logo that never arrives cannot hold the whole document up
      const mark = await Promise.race([
        logoPng(),
        new Promise((_, fail) => setTimeout(() => fail(new Error("logo slow")), 3000)),
      ]);
      const w = 34;
      // the baseline the rest of the header is measured from sits at y
      doc.addImage(mark.data, "PNG", LEFT, y - w / mark.ratio + 1, w, w / mark.ratio);
    } catch {
      doc.setFont("helvetica", "bold").setFontSize(18).setTextColor(50, 56, 58);
      doc.text("ORISA DIGITAL", LEFT, y);
    }

    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(120, 126, 128);
    doc.text("Website Estimate", RIGHT, y, { align: "right" });

    y += 6;
    const today = new Date().toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    doc.text(today, RIGHT, y, { align: "right" });

    y += 6;
    doc.setDrawColor(50, 56, 58).setLineWidth(0.4).line(LEFT, y, RIGHT, y);
    y += 12;

    doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(50, 56, 58);

    current.found.forEach((line) => {
      /* Long labels wrap rather than run under the figure on the right. The
         price sits on the label's first line, so a wrapped line still reads as
         one item rather than two. */
      const wrapped = doc.splitTextToSize(line.label, 120);
      doc.text(wrapped, LEFT, y);
      doc.text(money(line.price), RIGHT, y, { align: "right" });
      y += wrapped.length * 5 + 3;
    });

    y += 4;
    doc.setDrawColor(214, 216, 217).setLineWidth(0.2).line(LEFT, y, RIGHT, y);
    y += 10;

    doc.setFont("helvetica", "bold").setFontSize(13);
    doc.text("Estimated total", LEFT, y);
    doc.text(money(current.total), RIGHT, y, { align: "right" });

    y += 14;
    doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(120, 126, 128);
    doc.text(
      doc.splitTextToSize(
        "This is an estimate, not a quote. Scope, content and how much of it " +
          "already exists all move the final figure. Prices in Malaysian Ringgit.",
        RIGHT - LEFT
      ),
      LEFT,
      y
    );

    /* On the document itself, because the share sheet cannot be pointed at a
       particular contact: whoever ends up holding this needs to know where it
       is meant to go. */
    y += 10;
    doc.text("Orisa Digital  ·  WhatsApp +60 13-997 5304  ·  orisadigital.com", LEFT, y);

    return doc;
  };

  const FILENAME = "orisa-digital-estimate.pdf";

  /* Deliberately NOT routed through navigator.share, which on a phone could
     hand the PDF straight to WhatsApp as an attachment. A share sheet cannot be
     pointed at a particular contact: the visitor would choose the recipient,
     and an estimate sent to the wrong chat — or to nobody, by someone who does
     not have the number saved — is worse than one that arrives as text at the
     right number every time. The button below goes to the number, and the PDF
     is a separate download for whoever wants the document. */
  const busy = (button, text) => {
    const label = button.querySelector(".cta-button-label");
    const said = label ? label.textContent : "";
    if (label) label.textContent = text;
    button.setAttribute("aria-busy", "true");

    return (failed) => {
      button.removeAttribute("aria-busy");
      if (!label) return;
      if (!failed) return void (label.textContent = said);

      /* Said out loud rather than swallowed: a button that does nothing when the
         CDN is blocked looks broken. */
      label.textContent = failed;
      setTimeout(() => {
        label.textContent = said;
      }, 4000);
    };
  };

  if (download) {
    download.addEventListener("click", async () => {
      const done = busy(download, "Preparing…");
      try {
        (await buildPdf()).save(FILENAME);
        done();
      } catch {
        done("Couldn’t build PDF");
      }
    });
  }


  const paint = () => {
    /* Each term block's own sum, at the foot of its step. Same numbers as the
       line it contributes to the panel, from the same pass, so the two cannot
       drift apart. A row whose figure does not apply — tax on the hosting —
       simply is not in the markup, so writing it is a no-op. */
    /* The per-page working, under the description of what the step covers. The
       count comes off the same slider as the estimate line, in the same pass,
       so the two cannot disagree. */
    panel.querySelectorAll("input[data-per-page]").forEach((input) => {
      const breakdown = input
        .closest(".calc-fieldset")
        ?.querySelector("[data-per-page-breakdown]");
      if (!breakdown) return;

      const unit = Number(input.dataset.perPage) || 0;
      const count = perPage(input);

      const put = (sel, value) => {
        const node = breakdown.querySelector(sel);
        if (node) node.textContent = value;
      };
      put("[data-per-page-count]", String(count));
      put("[data-per-page-unit]", exact(unit));
      put("[data-per-page-total]", exact(unit * count));
    });

    terms().forEach((term) => {
      const breakdown = term.block.querySelector("[data-term-breakdown]");
      if (!breakdown) return;

      const put = (sel, value) => {
        const node = breakdown.querySelector(sel);
        if (node) node.textContent = exact(value);
      };
      put("[data-term-sub]", term.sub);
      put("[data-term-tax-amount]", term.tax);
      put("[data-term-service-amount]", term.service);
      put("[data-term-total]", term.total);
    });

    const found = lines();
    const total = found.reduce((sum, line) => sum + line.price, 0);

    if (!found.length) {
      list.innerHTML =
        '<li class="calc-estimate-empty">Answer the questions and the figures appear here.</li>';
      output.textContent = "—";
      quote([], 0);
      return;
    }

    list.innerHTML = found
      .map(
        (line) =>
          `<li class="calc-estimate-line"><span class="calc-estimate-line-name"></span>` +
          `<span class="calc-estimate-line-price"></span></li>`
      )
      .join("");

    /* Written as text rather than into the template above, so a label taken off
       the page cannot close a tag and rewrite the panel. Nothing here is user
       input today, but the labels come from markup and this costs nothing. */
    list.querySelectorAll(".calc-estimate-line").forEach((node, i) => {
      node.querySelector(".calc-estimate-line-name").textContent = found[i].label;
      node.querySelector(".calc-estimate-line-price").textContent = money(found[i].price);
    });

    // the sum of the lines above, exactly — no rounding, nothing added
    output.textContent = money(total);

    quote(found, total);
  };

  // input for the counts, change for everything that is ticked
  root.addEventListener("input", paint);
  root.addEventListener("change", paint);
  paint();
})();

/* Contact map — Leaflet on a dark basemap, centred on Kuching. */
(() => {
  "use strict";

  const el = document.getElementById("map");
  if (!el || !window.L) return;

  const KUCHING = [1.5533, 110.3592];

  const map = L.map(el, {
    center: KUCHING,
    zoom: 13,
    // Default controls sit top-left, which is exactly where the floating
    // header is; the zoom buttons are re-added bottom-right below.
    zoomControl: false,
    // A full-height map that swallowed the wheel would trap the page scroll,
    // so zoom is by button, pinch, or double-click.
    scrollWheelZoom: false,
  });

  // Voyager rather than the flat Positron light style: it keeps colour in the
  // water, parks, and road hierarchy, so Kuching reads as a place at a glance.
  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' +
        ' &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }
  ).addTo(map);

  // drops the "Leaflet" prefix; the tile and data credits stay, as they must
  map.attributionControl.setPrefix(false);

  L.control.zoom({ position: "bottomright" }).addTo(map);

  // A styled div rather than Leaflet's default marker: no image to fetch, and
  // it can carry the same pulsing green the header badge uses.
  L.marker(KUCHING, {
    icon: L.divIcon({
      className: "map-pin",
      html: "<span></span>",
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    }),
    keyboard: false,
    alt: "Kuching, Sarawak",
  }).addTo(map);
})();

/* Enquiry tracking — reports WhatsApp handoffs to Analytics.

   Every enquiry leaves the site the same way: a link to WhatsApp. Without this
   Analytics counts the visit and stops there, so a page that brings people in
   and a page that turns them into conversations look identical in the reports.

   Delegated from the document rather than bound per link. The contact form
   rewrites its button's href on every keystroke, the chat menu is built from
   markup that may move, and a listener attached at load would have to be kept
   in step with all of it; one listener on the document reads whatever href the
   link happens to carry at the moment it is clicked.

   Nothing here is load-bearing. If gtag is missing — blocked by an extension,
   or Analytics simply failed — send() returns and the click proceeds untouched. */
(() => {
  "use strict";

  const send = (name, params) => {
    if (typeof window.gtag !== "function") return;
    window.gtag("event", name, params);
  };

  const placeOf = (el) => {
    if (el.closest(".contact-form")) return "contact_form";
    if (el.closest(".site-header")) return "header";
    if (el.closest(".drawer")) return "menu_drawer";
    if (el.closest(".site-footer")) return "footer";
    if (el.closest(".cta")) return "cta";
    return "page";
  };

  /* Three addresses reach the same conversation: wa.me, the whatsapp:// the
     desktop app answers to, and web.whatsapp.com. Matching only the first would
     miss every desktop enquiry, which is the half most worth counting. */
  const isWhatsApp = (href) =>
    /^https?:\/\/(wa\.me|web\.whatsapp\.com)\b/i.test(href) ||
    /^whatsapp:/i.test(href);

  document.addEventListener(
    "click",
    (event) => {
      /* The submit button blocks its own click when a required field is empty.
         That click still bubbles to here, so without this an unfinished form
         would report a lead it never sent. */
      if (event.defaultPrevented) return;

      const link = event.target.closest("a[href]");
      if (!link) return;

      const href = link.getAttribute("href") || "";
      if (!isWhatsApp(href)) return;

      const place = placeOf(link);

      /* A form click carries a written brief — name, contact details and what
         they are after — while the others open an empty chat. Only the first is
         a lead; mark generate_lead as the key event in Analytics, not the click. */
      if (place === "contact_form") {
        send("generate_lead", { method: "whatsapp", link_location: place });
      }

      send("whatsapp_click", { link_location: place });
    },
    { passive: true }
  );
})();

/* Video bands — hold the file back until the band is nearly on screen.

   These sit well below the fold, and an autoplaying <video> fetches its whole
   source whether or not anyone scrolls to it: the green energy band alone was
   8.5 MB spent before the visitor had read the first section. The markup ships
   a poster and a data-src instead, and the source is attached one viewport
   ahead of the band so the swap has landed by the time it is in view.

   Without JS, or without IntersectionObserver, the poster is what shows. That
   is a still frame of the same footage, so the band still reads as intended —
   it simply does not move. */
(() => {
  "use strict";

  const bands = Array.from(document.querySelectorAll("video[data-src]"));
  if (!bands.length) return;

  const start = (video) => {
    if (video.dataset.loaded) return;
    video.dataset.loaded = "1";

    // Both cuts are appended before load(), so the browser runs its own
    // resource selection and the media query decides — same as a <source> that
    // was in the markup all along. Mobile first: selection takes the first match.
    // The band is 16:9 at every width (styles.css pins aspect-ratio below 600px
    // so nothing is cropped sideways), so the phone cut is the same frame, just
    // smaller — not a different crop.
    if (video.dataset.srcMobile) {
      const small = document.createElement("source");
      small.src = video.dataset.srcMobile;
      small.type = "video/mp4";
      small.media = "(max-width: 600px)";
      video.appendChild(small);
    }

    const source = document.createElement("source");
    source.src = video.dataset.src;
    source.type = "video/mp4";
    video.appendChild(source);
    video.load();

    // autoplay is not on the element — it would defeat the whole point — so the
    // play has to be asked for. It is muted and inline, which is what lets the
    // request succeed without a user gesture; a rejection still leaves the
    // poster in place, so nothing needs handling beyond not throwing.
    video.play().catch(() => {});
  };

  if (!("IntersectionObserver" in window)) {
    bands.forEach(start);
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        start(entry.target);
      });
    },
    // one viewport of lead time: enough for the first frames to arrive before
    // the band is actually looked at, without reaching so far that a visitor
    // who stops half way still pays for it
    { rootMargin: "100% 0px" }
  );

  bands.forEach((video) => observer.observe(video));
})();

/* Approach steps — lights the card crossing the middle of the viewport, so the
   list reads one step at a time against the pinned intro. */
(() => {
  "use strict";

  const cards = Array.from(document.querySelectorAll(".approach-card"));
  if (!cards.length || !("IntersectionObserver" in window)) return;

  // where down the viewport a card counts as the one being read
  const LINE = 0.45;

  const inBand = new Set();

  const fill = document.querySelector(".approach-progress-fill");
  const stepLabel = document.querySelector(".approach-progress [data-step]");
  const totalLabel = document.querySelector(".approach-progress [data-total]");
  const pad = (n) => String(n).padStart(2, "0");

  if (totalLabel) totalLabel.textContent = pad(cards.length);

  function progress(index) {
    if (fill) fill.style.width = ((index + 1) / cards.length) * 100 + "%";
    if (stepLabel) stepLabel.textContent = pad(index + 1);
  }

  // the bar reads as "step one, not yet started" until a card takes the line
  progress(0);

  function mark() {
    const line = window.innerHeight * LINE;

    let best = null;
    let closest = Infinity;
    inBand.forEach((card) => {
      const r = card.getBoundingClientRect();
      const distance = Math.abs(r.top + r.height / 2 - line);
      if (distance < closest) {
        closest = distance;
        best = card;
      }
    });

    // Nothing in the band means the line is in one of the gaps between cards.
    // Holding the last one lit keeps the highlight continuous rather than
    // blinking off every 12px of scroll.
    if (!best) return;

    cards.forEach((card) => card.classList.toggle("is-active", card === best));
    progress(cards.indexOf(best));
  }

  // A band rather than a line: a zero-height root is fragile, and this still
  // admits only the card (or two, briefly) around the reading position.
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) inBand.add(entry.target);
        else inBand.delete(entry.target);
      });
      mark();
    },
    { rootMargin: "-45% 0px -50% 0px" }
  );

  cards.forEach((card) => observer.observe(card));

  // Two cards can straddle the band while neither enters nor leaves it, so the
  // nearest one has to be re-picked as the page moves under them.
  let ticking = false;
  window.addEventListener(
    "scroll",
    () => {
      if (ticking || inBand.size < 2) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        mark();
      });
    },
    { passive: true }
  );
})();

/* Looping strips — the services marquee and the work gallery both run on this.
   Each clones its group until the track is wide enough that shifting by exactly
   one group still leaves the viewport covered, otherwise a gap sweeps through
   on every loop. data-loop carries the speed in px per second. */
(() => {
  "use strict";

  const tracks = Array.from(document.querySelectorAll("[data-loop]"));
  if (!tracks.length) return;

  function build(track) {
    const speed = parseFloat(track.dataset.loop) || 34;
    const original = track.firstElementChild;
    if (!original) return;

    // start from a single group so repeated calls stay idempotent
    while (track.children.length > 1) track.lastElementChild.remove();

    const groupWidth = original.getBoundingClientRect().width;
    if (!groupWidth) return;

    const viewport = track.parentElement.clientWidth;
    const copies = Math.max(2, Math.ceil(viewport / groupWidth) + 1);
    for (let i = 1; i < copies; i++) {
      const clone = original.cloneNode(true);
      clone.setAttribute("aria-hidden", "true");
      track.append(clone);
    }

    track.style.setProperty("--marquee-shift", `-${(100 / copies).toFixed(4)}%`);
    // duration covers one group, so the speed stays constant however many copies
    track.style.animationDuration = (groupWidth / speed).toFixed(2) + "s";
  }

  const ready = document.fonts ? document.fonts.ready : Promise.resolve();
  ready.then(() => {
    tracks.forEach((track) => {
      build(track);

      let timer;
      const rebuild = () => {
        clearTimeout(timer);
        timer = setTimeout(() => build(track), 200);
      };

      // ResizeObserver catches any layout change to the band, not just window
      // resizes — build() only alters the track, so this can't feed back.
      if (window.ResizeObserver) {
        new ResizeObserver(rebuild).observe(track.parentElement);
      } else {
        window.addEventListener("resize", rebuild);
      }
    });
  });
})();

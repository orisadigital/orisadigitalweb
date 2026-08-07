/* Contact form handler — a Cloudflare Pages Function.
 *
 * Any file under functions/ becomes a route: this one answers POST /api/contact,
 * which is what the form on the contact page posts to. It runs on Cloudflare's
 * edge, so the Resend API key stays server-side and never reaches the browser.
 *
 * It sends two emails per enquiry:
 *   1. the notification to the team, with reply-to set to the sender, so
 *      hitting reply in your mail client answers the client directly
 *   2. an acknowledgement to the sender, so they know it arrived
 *
 * Requires one environment variable in the Pages project: RESEND_API_KEY.
 */

const TEAM_INBOX = "hello@orisadigital.com";

/* Both addresses have to be on a domain verified in Resend. The notification
   is sent from a no-reply address so that a bounce or an auto-responder from
   the sender's side cannot loop back into the inbox. */
const FROM_NOTIFICATION = "Orisa Digital <noreply@orisadigital.com>";
const FROM_ACKNOWLEDGEMENT = "Orisa Digital <hello@orisadigital.com>";

/* Caps, not validation — they stop a script posting megabytes of text through
   the mail API on your quota. */
const LIMIT = { name: 120, email: 200, phone: 40, service: 60, message: 5000 };

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const clean = (value, limit) => String(value ?? "").trim().slice(0, limit);

/* Everything here is attacker-supplied and lands in an HTML email, so it is
   escaped rather than trusted. */
const escapeHtml = (value) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );

async function sendEmail(apiKey, payload) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Resend ${response.status}: ${detail.slice(0, 200)}`);
  }

  return response.json();
}

export async function onRequestPost({ request, env }) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("RESEND_API_KEY is not set on this Pages project");
    return json({ success: false, message: "Mail is not configured." }, 500);
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ success: false, message: "Could not read the form." }, 400);
  }

  /* The honeypot is invisible to people, so anything in it came from a bot.
     Answering with success rather than an error denies it the signal it would
     need to learn what tripped the trap. */
  if (clean(form.get("_honey"), 100)) {
    return json({ success: true, message: "Thanks." });
  }

  const name = clean(form.get("name"), LIMIT.name);
  const email = clean(form.get("email"), LIMIT.email);
  const phone = clean(form.get("phone"), LIMIT.phone);
  const service = clean(form.get("service"), LIMIT.service);
  const message = clean(form.get("message"), LIMIT.message);

  if (!name || !email || !message) {
    return json(
      { success: false, message: "Please fill in your name, email, and message." },
      400
    );
  }

  /* Deliberately loose. Anything stricter rejects valid addresses, and the
     real test of an address is whether mail to it arrives. */
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ success: false, message: "That email looks wrong." }, 400);
  }

  const rows = [
    ["Name", name],
    ["Email", email],
    phone && ["Phone", phone],
    service && ["Needs", service],
  ].filter(Boolean);

  const notification = {
    from: FROM_NOTIFICATION,
    to: [TEAM_INBOX],
    // so replying in your mail client goes to the client, not to no-reply
    reply_to: email,
    subject: `New enquiry — ${name}${service ? ` (${service})` : ""}`,
    html: `
      <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.6;color:#32383a">
        <h2 style="margin:0 0 16px;font-size:18px">New enquiry from the website</h2>
        <table style="border-collapse:collapse;margin-bottom:20px">
          ${rows
            .map(
              ([label, value]) =>
                `<tr>
                   <td style="padding:4px 16px 4px 0;color:#6b7280">${label}</td>
                   <td style="padding:4px 0"><strong>${escapeHtml(value)}</strong></td>
                 </tr>`
            )
            .join("")}
        </table>
        <div style="padding:16px;background:#f4f4f5;border-radius:8px;white-space:pre-wrap">${escapeHtml(
          message
        )}</div>
      </div>`,
  };

  try {
    await sendEmail(apiKey, notification);
  } catch (error) {
    console.error("Notification failed:", error.message);
    return json(
      { success: false, message: "The message could not be sent." },
      502
    );
  }

  /* The acknowledgement is a courtesy. If it fails the enquiry has already
     landed, so the sender is still told their message got through. */
  try {
    await sendEmail(apiKey, {
      from: FROM_ACKNOWLEDGEMENT,
      to: [email],
      subject: "We've got your message — Orisa Digital",
      html: `
        <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.7;color:#32383a">
          <p>Hi ${escapeHtml(name.split(" ")[0])},</p>
          <p>Thanks for getting in touch. Your message reached us and we'll reply
             within one working day.</p>
          <p>Here's what you sent, for your records:</p>
          <div style="padding:16px;background:#f4f4f5;border-radius:8px;white-space:pre-wrap;margin:16px 0">${escapeHtml(
            message
          )}</div>
          <p>If it's urgent, WhatsApp or call us on
             <a href="tel:+60139975304" style="color:#32383a">+60 13 997 5304</a>.</p>
          <p style="margin-top:24px">— Orisa Digital<br>
             <span style="color:#6b7280">Kuching, Sarawak</span></p>
        </div>`,
    });
  } catch (error) {
    console.warn("Acknowledgement failed:", error.message);
  }

  return json({ success: true, message: "Thanks — your message is on its way." });
}

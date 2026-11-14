// Sends the customer a friendly "thank you, we hope you enjoyed it" email with
// a link to leave a Google review, a couple of days AFTER their cake date.
//
// HOW IT WORKS
//   * The webhook calls scheduleReviewRequest() when a payment is confirmed.
//   * Resend holds the email and delivers it at the time we give it
//     ("scheduled_at"), so nothing else needs to be running in the meantime.
//   * The time is worked out from the date the customer NEEDED the order
//     (not the date they paid), so someone who orders a week ahead still gets
//     the email after they've had their cake.
//
// SWITCHING IT ON
//   It only sends when the Vercel setting CUSTOMER_EMAIL_FROM is filled in, e.g.
//     Sticky Home Baked Goodness <hello@stickyhomebakedgoodness.com.au>
//   That address must be on a domain you've verified in Resend (Resend's test
//   address can only email you, not customers). Leave the setting empty and
//   nothing is sent — your order emails to yourself are not affected either way.
//
// CHANGING THE TIMING OR WORDING
//   Edit the numbers and text just below.

const REVIEW_URL = 'https://g.page/r/CZO7VSFhzRntEBM/review';
const SHOP_NAME = 'Sticky Home Baked Goodness';
const SHOP_EMAIL = 'stickyhomebaked@gmail.com';
const SHOP_PHONE = '0403 207 894';
const SITE_URL = 'https://www.stickyhomebakedgoodness.com.au';

const DAYS_AFTER_DATE_NEEDED = 2; // send this many days after the date they needed the order
const SEND_HOUR_SYDNEY = 10;      // ...at this hour, Sydney time (24-hour clock)
const MAX_DAYS_AHEAD = 29;        // Resend can hold an email for 30 days at most

// ---- time maths -----------------------------------------------------------

// The moment (in milliseconds, UTC) when it is `hour`:00 in Sydney on y-m-d.
// Handles daylight saving without any outside library.
function sydneyLocalToUtcMs(y, m, d, hour) {
  const wanted = Date.UTC(y, m - 1, d, hour, 0, 0);
  const fmt = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney', hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
  });
  let guess = wanted;
  for (let i = 0; i < 3; i++) {
    const p = {};
    for (const part of fmt.formatToParts(new Date(guess))) {
      if (part.type !== 'literal') p[part.type] = Number(part.value);
    }
    const shownAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const diff = wanted - shownAsUtc;
    if (diff === 0) break;
    guess += diff;
  }
  return guess;
}

// Returns the time to send (a Date), or null if we shouldn't schedule one.
export function computeSendAt(dateNeeded, now = Date.now()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateNeeded || '').trim());
  if (!m) return null;
  const base = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + DAYS_AFTER_DATE_NEEDED));
  const sendMs = sydneyLocalToUtcMs(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), SEND_HOUR_SYDNEY);
  if (Number.isNaN(sendMs)) return null;
  if (sendMs < now + 5 * 60 * 1000) return null;                    // already in the past
  if (sendMs > now + MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000) return null; // too far ahead for Resend
  return new Date(sendMs);
}

// ---- the email ------------------------------------------------------------

const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function firstNameOf(fullName) {
  const first = String(fullName || '').trim().split(/\s+/)[0] || '';
  return first.slice(0, 40);
}

export function buildReviewEmail(customerName) {
  const first = firstNameOf(customerName);
  const hello = first ? `Hi ${first},` : 'Hi there,';

  const text = [
    hello,
    '',
    `Thank you so much for your order from ${SHOP_NAME}. We hope you enjoyed every bite!`,
    '',
    'If you have a spare minute, a quick Google review would mean the world to us. It helps other Sydney cake lovers find us:',
    REVIEW_URL,
    '',
    "If anything wasn't quite right, just reply to this email and we'll sort it out.",
    '',
    'Thank you again,',
    SHOP_NAME,
    `Neutral Bay, Sydney · ${SHOP_PHONE}`,
    SITE_URL,
    '',
    "This is a one-off message about your recent order. If you'd rather not get messages like this from us, just reply and let us know.",
  ].join('\n');

  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#FBF3E1;">
<div style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#3B2317;">
  <h1 style="font-family:Georgia,'Times New Roman',serif;font-style:italic;font-weight:600;font-size:28px;margin:0 0 18px;">Thank you!</h1>
  <p style="margin:0 0 16px;">${escapeHtml(hello)}</p>
  <p style="margin:0 0 16px;">Thank you so much for your order from ${escapeHtml(SHOP_NAME)}. We hope you enjoyed every bite!</p>
  <p style="margin:0 0 22px;">If you have a spare minute, a quick Google review would mean the world to us. It helps other Sydney cake lovers find us.</p>
  <p style="margin:0 0 26px;"><a href="${REVIEW_URL}" style="display:inline-block;background:#00AEB7;color:#ffffff;text-decoration:none;padding:13px 26px;border-radius:999px;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;font-weight:bold;">Leave a Google review</a></p>
  <p style="margin:0 0 16px;">If anything wasn&rsquo;t quite right, just reply to this email and we&rsquo;ll sort it out.</p>
  <p style="margin:0 0 4px;">Thank you again,</p>
  <p style="margin:0 0 24px;"><strong>${escapeHtml(SHOP_NAME)}</strong><br>Neutral Bay, Sydney &middot; ${escapeHtml(SHOP_PHONE)}<br><a href="${SITE_URL}" style="color:#0A7F87;">stickyhomebakedgoodness.com.au</a></p>
  <p style="margin:0;font-size:12px;color:#7C6A57;">This is a one-off message about your recent order. If you&rsquo;d rather not get messages like this from us, just reply and let us know.</p>
</div>
</body></html>`;

  return {
    subject: `Thank you from ${SHOP_NAME}`,
    text,
    html,
  };
}

// ---- called by the webhook ------------------------------------------------

// Never throws: a problem here must not get in the way of the order itself.
export async function scheduleReviewRequest(payment, order) {
  try {
    const from = process.env.CUSTOMER_EMAIL_FROM;
    if (!from) {
      console.log('Review email skipped: CUSTOMER_EMAIL_FROM is not set.');
      return;
    }

    const meta = order?.metadata || {};
    const email = String(meta.customer_email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      console.log('Review email skipped: no valid customer email on payment', payment?.id);
      return;
    }

    const sendAt = computeSendAt(meta.date_needed);
    if (!sendAt) {
      console.log('Review email skipped: date needed is missing, in the past, or more than', MAX_DAYS_AHEAD, 'days away. Payment', payment?.id);
      return;
    }

    const { subject, text, html } = buildReviewEmail(meta.customer_name);
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        // Square can report one payment several times; this makes sure the
        // customer is only ever scheduled one thank-you email per payment.
        'Idempotency-Key': `review-request-${payment.id}`,
      },
      body: JSON.stringify({
        from,
        to: [email],
        reply_to: SHOP_EMAIL,
        subject,
        text,
        html,
        scheduled_at: sendAt.toISOString(),
      }),
    });

    const responseText = await response.text();
    if (!response.ok) {
      console.error('Resend rejected the review email:', response.status, responseText);
    } else {
      console.log('Review email scheduled for', sendAt.toISOString(), responseText);
    }
  } catch (err) {
    console.error('Could not schedule the review email:', err);
  }
}

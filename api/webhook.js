// Square calls this URL by itself, directly from Square's servers, whenever
// something happens to a payment (e.g. it completes). This is the ONLY
// place an order should be treated as genuinely paid — never the moment a
// customer's browser happens to land back on the confirmation page, since
// that can be faked, skipped, or interrupted by a closed tab or a lost
// connection.

import crypto from 'crypto';

// The extras (customer emails, calendar) are loaded on demand and wrapped so
// that a missing or broken helper file can never stop YOUR order email.
async function runExtra(loader, fn, ...args) {
  try {
    const mod = await loader();
    await mod[fn](...args);
  } catch (err) {
    console.error(`Extra step ${fn} failed:`, err);
  }
}

const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || 'sandbox';
const SQUARE_BASE_URL =
  SQUARE_ENVIRONMENT === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com';

// Vercel normally parses the request body into JSON automatically. We turn
// that off here because Square's signature check needs the exact raw text
// of the request — re-serialised JSON is not guaranteed to match it.
export const config = {
  api: {
    bodyParser: false,
  },
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function isValidSignature(rawBody, signatureHeader, notificationUrl, signatureKey) {
  if (!signatureHeader || !signatureKey || !notificationUrl) return false;
  const hmac = crypto.createHmac('sha256', signatureKey);
  hmac.update(notificationUrl + rawBody);
  const expected = hmac.digest('base64');
  // timingSafeEqual avoids leaking info through response-time differences
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  const rawBody = await getRawBody(req);
  const signature = req.headers['x-square-hmacsha256-signature'];

  const valid = isValidSignature(
    rawBody,
    signature,
    process.env.SQUARE_WEBHOOK_URL,
    process.env.SQUARE_WEBHOOK_SIGNATURE_KEY
  );

  if (!valid) {
    console.warn('Received a webhook call with an invalid signature — ignoring it.');
    return res.status(401).send('Invalid signature');
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.status(400).send('Bad payload');
  }

  // Log every event we receive — even when we don't act on it — so we can
  // actually see what Square is sending instead of guessing.
  const payment = event.data?.object?.payment;
  console.log('Square webhook received:', event.type, '| payment status:', payment?.status);

  if ((event.type === 'payment.updated' || event.type === 'payment.created') && payment?.status === 'COMPLETED') {
    // The payment itself doesn't carry the cake names/quantities — those
    // live on the Order we created at checkout. Square is the source of
    // truth here, so we fetch the order back from Square rather than
    // trusting anything the browser might have kept locally.
    const order = payment.order_id ? await fetchOrderDetails(payment.order_id) : null;
    await notifyOwnerOfPaidOrder(payment, order);
    console.log('Order-confirmed email attempted for payment', payment.id);
    // A thank-you + Google review email to the customer, sent a couple of days
    // after their cake date. Does nothing unless CUSTOMER_EMAIL_FROM is set.
    await runExtra(() => import('../lib/confirmation-email.js'), 'sendOrderConfirmation', payment, order);
    try { await addOrderToCalendar(payment, order); } catch (err) { console.error('Calendar step failed:', err); }
    await runExtra(() => import('../lib/review-email.js'), 'scheduleReviewRequest', payment, order);
  }

  // Square just needs a 200 response to know we received it.
  return res.status(200).send('ok');
}

async function fetchOrderDetails(orderId) {
  try {
    const response = await fetch(`${SQUARE_BASE_URL}/v2/orders/${orderId}`, {
      headers: {
        Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
        'Square-Version': '2024-10-17',
      },
    });
    if (!response.ok) {
      console.error('Could not fetch order details:', response.status, await response.text());
      return null;
    }
    const data = await response.json();
    return data.order || null;
  } catch (err) {
    console.error('Error fetching order details:', err);
    return null;
  }
}

function formatMoney(moneyObj) {
  if (!moneyObj) return 'n/a';
  return `A$${(moneyObj.amount / 100).toFixed(2)}`;
}

// v1: email you the actual order — items, customer details, pickup/delivery,
// preferred time, notes — the moment a payment is confirmed, instead of
// setting up a full database. This still satisfies "only mark paid after
// Square confirms" — it just means your inbox is the record for now. We can
// add a proper database later if you want order history on the website itself.
async function notifyOwnerOfPaidOrder(payment, order) {
  const lines = [];
  const meta = order?.metadata || {};

  // "Requested pickup time" or "Requested delivery time", worked out from the order itself.
  const timeLabel = meta.preferred_time_label
    || (meta.fulfilment_type === 'Delivery' ? 'Requested delivery time' : meta.fulfilment_type === 'Pickup' ? 'Requested pickup time' : 'Preferred time');
  // Long notes are stored in two pieces; put them back together.
  const notes = [meta.customer_notes, meta.customer_notes_2].filter(Boolean).join('');

  const detailLines = [
    meta.website_ref ? `Order ref: ${meta.website_ref}` : null,
    meta.customer_name ? `Name: ${meta.customer_name}` : null,
    meta.customer_email ? `Email: ${meta.customer_email}` : null,
    meta.customer_phone ? `Phone: ${meta.customer_phone}` : null,
    meta.fulfilment_type ? `Fulfilment: ${meta.fulfilment_type}` : null,
    meta.recipient_name ? `Send certificate to: ${meta.recipient_name}` : null,
    meta.recipient_email ? `Recipient email: ${meta.recipient_email}` : null,
    meta.delivery_address ? `Address: ${meta.delivery_address}` : null,
    meta.date_needed ? `Date needed: ${meta.date_needed}` : null,
    meta.preferred_time ? `${timeLabel}: ${meta.preferred_time}` : null,
    notes ? `Notes: ${notes}` : null,
  ].filter(Boolean);

  if (detailLines.length) {
    lines.push('Customer & order details:');
    detailLines.forEach((line) => lines.push(`  ${line}`));
    lines.push('');
  }

  if (Array.isArray(order?.line_items) && order.line_items.length) {
    lines.push('Items ordered:');
    order.line_items.forEach((item) => {
      const each = formatMoney(item.base_price_money);
      const lineTotal = formatMoney(item.total_money);
      const noteSuffix = item.note ? ` — ${item.note}` : '';
      lines.push(`  ${item.quantity} × ${item.name} (${each} each, ${lineTotal} total)${noteSuffix}`);
    });
    lines.push('');
  } else {
    lines.push('(Could not retrieve item details from Square — check the order directly in your Square dashboard.)');
    lines.push('');
  }

  lines.push(`Total paid: ${formatMoney(payment.amount_money)}`);
  lines.push(`Payment ID: ${payment.id}`);
  lines.push(`Order ID: ${payment.order_id || 'n/a'}`);

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        // Square can report the same payment more than once (it sends several
        // kinds of event, and retries). Using the payment ID as an "idempotency
        // key" tells Resend to send this email only once per payment.
        'Idempotency-Key': `paid-order-${payment.id}`,
      },
      body: JSON.stringify({
        from: 'Sticky Home Baked Goodness <onboarding@resend.dev>',
        to: ['stickyhomebaked@gmail.com'],
        subject: String(meta.fulfilment_type || '').startsWith('Gift certificate') ? 'New paid GIFT CERTIFICATE order — Sticky Home Baked Goodness' : 'New paid order — Sticky Home Baked Goodness',
        text: lines.join('\n'),
      }),
    });

    const responseText = await response.text();
    if (!response.ok) {
      console.error('Resend rejected the email:', response.status, responseText);
    } else {
      console.log('Resend accepted the email:', responseText);
    }
  } catch (err) {
    console.error('Could not send the order-confirmed email:', err);
  }
}


// ---- Google Calendar: adds each paid order to your 'Orders' calendar ----
// Needs GOOGLE_SERVICE_ACCOUNT_JSON and GOOGLE_CALENDAR_ID in Vercel; does nothing without them.


const TZ = 'Australia/Sydney';
const b64url = (b) => Buffer.from(b).toString('base64url');

async function getAccessToken(creds) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/calendar.events',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const signature = crypto.createSign('RSA-SHA256').update(`${header}.${claim}`).sign(creds.private_key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claim}.${signature}`,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error(`Google sign-in failed: ${res.status} ${JSON.stringify(data)}`);
  return data.access_token;
}

// Understands "2pm", "2:00 PM", "14:30", "10 am". Returns {h, m} or null (e.g. "Morning").
function parseTime(text) {
  const t = String(text || '').trim().toLowerCase();
  let m = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/.exec(t);
  if (m) {
    let h = Number(m[1]) % 12;
    if (m[3] === 'pm') h += 12;
    return Number(m[1]) >= 1 && Number(m[1]) <= 12 ? { h, m: Number(m[2] || 0) } : null;
  }
  m = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(t);
  return m ? { h: Number(m[1]), m: Number(m[2]) } : null;
}

const pad = (n) => String(n).padStart(2, '0');

function buildEvent(payment, order) {
  const meta = order?.metadata || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(meta.date_needed || ''))) return null;

  const isDelivery = meta.fulfilment_type === 'Delivery';
  const kind = isDelivery ? 'Delivery' : meta.fulfilment_type === 'Pickup' ? 'Pickup' : 'Order';
  const items = (order?.line_items || []).map((i) => `${i.quantity} × ${i.name}${i.note ? ` — ${i.note}` : ''}`);
  const notes = [meta.customer_notes, meta.customer_notes_2].filter(Boolean).join('');
  const total = payment?.amount_money ? `A$${(payment.amount_money.amount / 100).toFixed(2)}` : '';

  const description = [
    items.length ? `Items:\n${items.map((i) => `  ${i}`).join('\n')}` : null,
    meta.customer_name ? `Customer: ${meta.customer_name}` : null,
    meta.customer_phone ? `Phone: ${meta.customer_phone}` : null,
    meta.customer_email ? `Email: ${meta.customer_email}` : null,
    meta.preferred_time ? `Requested time: ${meta.preferred_time}` : null,
    meta.delivery_address ? `Address: ${meta.delivery_address}` : null,
    notes ? `Notes: ${notes}` : null,
    total ? `Total paid: ${total}` : null,
    meta.website_ref ? `Order ref: ${meta.website_ref}` : null,
  ].filter(Boolean).join('\n');

  const event = {
    // A fixed id per payment means a repeated webhook can never create a second event.
    id: crypto.createHash('sha1').update(`order-${payment.id}`).digest('hex'),
    summary: `${kind} – ${meta.customer_name || 'Customer'}${items[0] ? ` – ${items[0]}` : ''}`.slice(0, 250),
    description,
    reminders: { useDefault: true },
  };
  if (isDelivery && meta.delivery_address) event.location = meta.delivery_address;

  const time = parseTime(meta.preferred_time);
  const [y, mo, d] = meta.date_needed.split('-').map(Number);
  if (time) {
    const end = time.h + 1;
    const endDay = end >= 24 ? new Date(Date.UTC(y, mo - 1, d + 1)) : null;
    const endDate = endDay ? `${endDay.getUTCFullYear()}-${pad(endDay.getUTCMonth() + 1)}-${pad(endDay.getUTCDate())}` : meta.date_needed;
    event.start = { dateTime: `${meta.date_needed}T${pad(time.h)}:${pad(time.m)}:00`, timeZone: TZ };
    event.end = { dateTime: `${endDate}T${pad(end % 24)}:${pad(time.m)}:00`, timeZone: TZ };
  } else {
    // No exact time given: an all-day event (end date is exclusive).
    const next = new Date(Date.UTC(y, mo - 1, d + 1));
    event.start = { date: meta.date_needed };
    event.end = { date: `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}` };
  }
  return event;
}

async function addOrderToCalendar(payment, order) {
  try {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const calendarId = process.env.GOOGLE_CALENDAR_ID;
    if (!raw || !calendarId) {
      console.log('Calendar skipped: GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_CALENDAR_ID is not set.');
      return;
    }
    const event = buildEvent(payment, order);
    if (!event) {
      console.log('Calendar skipped: no date needed on payment', payment?.id);
      return;
    }
    const creds = JSON.parse(raw);
    creds.private_key = String(creds.private_key || '').replace(/\\n/g, '\n');
    const token = await getAccessToken(creds);
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
    if (res.status === 409) console.log('Calendar event already exists for payment', payment.id);
    else if (!res.ok) console.error('Google Calendar rejected the event:', res.status, await res.text());
    else console.log('Calendar event created for payment', payment.id);
  } catch (err) {
    console.error('Could not add the order to Google Calendar:', err);
  }
}

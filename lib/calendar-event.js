// Adds each paid order to your Google Calendar automatically.
//
// SWITCHING IT ON (Vercel > Settings > Environment Variables):
//   GOOGLE_SERVICE_ACCOUNT_JSON  the whole contents of the service-account key file
//   GOOGLE_CALENDAR_ID           the calendar's ID (Calendar > Settings > "Integrate calendar")
// The calendar must be shared with the service account's email ("Make changes to events").
// If either setting is missing, nothing happens. Never throws.

import crypto from 'crypto';

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
export function parseTime(text) {
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

export function buildEvent(payment, order) {
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

export async function addOrderToCalendar(payment, order) {
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

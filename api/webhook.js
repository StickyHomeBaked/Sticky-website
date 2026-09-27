// Square calls this URL by itself, directly from Square's servers, whenever
// something happens to a payment (e.g. it completes). This is the ONLY
// place an order should be treated as genuinely paid — never the moment a
// customer's browser happens to land back on the confirmation page, since
// that can be faked, skipped, or interrupted by a closed tab or a lost
// connection.

import crypto from 'crypto';

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

  if (order?.note) {
    lines.push('Customer & order details:');
    order.note.split(' | ').forEach((part) => lines.push(`  ${part}`));
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
      },
      body: JSON.stringify({
        from: 'Sticky Home Baked Goodness <onboarding@resend.dev>',
        to: ['stickyhomebaked@gmail.com'],
        subject: 'New paid order — Sticky Home Baked Goodness',
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

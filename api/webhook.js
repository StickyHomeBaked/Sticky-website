// Square calls this URL by itself, directly from Square's servers, whenever
// something happens to a payment (e.g. it completes). This is the ONLY
// place an order should be treated as genuinely paid — never the moment a
// customer's browser happens to land back on the confirmation page, since
// that can be faked, skipped, or interrupted by a closed tab or a lost
// connection.

import crypto from 'crypto';

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

  if (event.type === 'payment.updated') {
    const payment = event.data?.object?.payment;
    if (payment?.status === 'COMPLETED') {
      await notifyOwnerOfPaidOrder(payment);
    }
  }

  // Square just needs a 200 response to know we received it.
  return res.status(200).send('ok');
}

// v1: email you the second a payment is confirmed, instead of setting up a
// full database. This still satisfies "only mark paid after Square confirms" —
// it just means your inbox is the record for now. We can add a proper
// database later if you want order history on the website itself.
async function notifyOwnerOfPaidOrder(payment) {
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
        subject: 'Payment confirmed — Sticky Home Baked Goodness',
        text: [
          `Payment ID: ${payment.id}`,
          `Order ID: ${payment.order_id || 'n/a'}`,
          `Amount: ${(payment.amount_money.amount / 100).toFixed(2)} ${payment.amount_money.currency}`,
          `Status: ${payment.status}`,
        ].join('\n'),
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Resend rejected the email:', response.status, errText);
    }
  } catch (err) {
    console.error('Could not send the payment-confirmed email:', err);
  }
}

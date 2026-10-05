// Lets the cart show the delivery fee before the customer checks out.
// The fee that is actually charged is calculated again, from scratch, inside
// create-checkout.js — this is only for showing the customer what to expect.

import { quoteDelivery, DeliveryError } from '../lib/delivery.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  }

  try {
    const quote = await quoteDelivery(req.body?.address);
    return res.status(200).json({
      ok: true,
      feeCents: quote.feeCents,
      distanceKm: Math.round(quote.distanceKm * 10) / 10,
    });
  } catch (err) {
    if (err instanceof DeliveryError) {
      return res.status(400).json({ ok: false, error: err.message });
    }
    console.error('Unexpected error working out delivery fee:', err);
    return res.status(500).json({ ok: false, error: "We couldn't work out the delivery fee. Please try again." });
  }
}

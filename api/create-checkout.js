// This runs on the server, never in the customer's browser.
// It is the only piece of code allowed to talk to Square using your secret
// access token, and the only place that decides the final price.

import { randomUUID } from 'crypto';
import { CATALOG, DELIVERY_FEE_CENTS } from '../lib/catalog.js';

const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || 'sandbox';
const SQUARE_BASE_URL =
  SQUARE_ENVIRONMENT === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const { items, customer, fulfilment } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Your cart is empty.' });
    }

    // ---- Price every item against the server-side catalog. ----
    // We never trust a price sent from the browser — only the name and
    // quantity. The actual amount charged always comes from catalog.js.
    const lineItems = [];
    for (const requested of items) {
      const catalogItem = CATALOG.find((c) => c.name === requested.name);

      if (!catalogItem) {
        return res.status(400).json({ error: `"${requested.name}" isn't a recognised item.` });
      }
      if (catalogItem.price === null) {
        return res.status(400).json({
          error: `"${requested.name}" doesn't have a price set yet, so it can't be ordered online. Please remove it from your cart or contact us directly.`,
        });
      }

      const quantity = Math.max(1, parseInt(requested.quantity, 10) || 1);

      lineItems.push({
        name: catalogItem.name,
        quantity: String(quantity),
        base_price_money: {
          amount: catalogItem.price,
          currency: 'AUD',
        },
        note: requested.note ? String(requested.note).slice(0, 500) : undefined,
      });
    }

    // ---- Delivery fee, added once per order if any item asked for delivery. ----
    if (fulfilment && fulfilment.type === 'Delivery') {
      lineItems.push({
        name: 'Delivery',
        quantity: '1',
        base_price_money: {
          amount: DELIVERY_FEE_CENTS,
          currency: 'AUD',
        },
      });
    }

    const idempotencyKey = randomUUID();

    // A plain-text note attached to the Square order so you can see who it's
    // for and how to reach them, right inside Square's own dashboard.
    const orderNote = [
      customer?.name ? `Name: ${customer.name}` : null,
      customer?.phone ? `Phone: ${customer.phone}` : null,
      fulfilment?.type ? `Fulfilment: ${fulfilment.type}` : null,
      fulfilment?.type === 'Delivery' && fulfilment?.address ? `Address: ${fulfilment.address}` : null,
      fulfilment?.preferredTime ? `Preferred time: ${fulfilment.preferredTime}` : null,
      customer?.notes ? `Notes: ${customer.notes}` : null,
    ]
      .filter(Boolean)
      .join(' | ')
      .slice(0, 500);

    const requestBody = {
      idempotency_key: idempotencyKey,
      order: {
        location_id: process.env.SQUARE_LOCATION_ID,
        line_items: lineItems,
        note: orderNote || undefined,
      },
      checkout_options: {
        redirect_url: `${process.env.SITE_URL}/order-confirmation.html?ref=${idempotencyKey}`,
      },
      pre_populated_data: customer?.email ? { buyer_email: customer.email } : undefined,
    };

    const squareResponse = await fetch(`${SQUARE_BASE_URL}/v2/online-checkout/payment-links`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
        'Square-Version': '2024-10-17',
      },
      body: JSON.stringify(requestBody),
    });

    const data = await squareResponse.json();

    if (!squareResponse.ok) {
      console.error('Square rejected the checkout request:', JSON.stringify(data));
      return res.status(502).json({ error: 'Square could not create the checkout. Please try again shortly.' });
    }

    return res.status(200).json({
      checkoutUrl: data.payment_link.url,
      orderId: data.payment_link.order_id,
      reference: idempotencyKey,
    });
  } catch (err) {
    console.error('Unexpected error creating checkout:', err);
    return res.status(500).json({ error: 'Something went wrong on our end. Please try again.' });
  }
}

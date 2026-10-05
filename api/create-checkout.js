// This runs on the server, never in the customer's browser.
// It is the only piece of code allowed to talk to Square using your secret
// access token, and the only place that decides the final price.

import { randomUUID } from 'crypto';
import { CATALOG } from '../lib/catalog.js';
import { quoteDelivery, DeliveryError } from '../lib/delivery.js';

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

    // A phone number is needed so we can reach the customer about their order.
    if (!String(customer?.phone || '').trim()) {
      return res.status(400).json({ error: 'Please enter a phone number so we can reach you about your order.' });
    }

    // A date is required, so we know when the order is needed.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fulfilment?.dateNeeded || ''))) {
      return res.status(400).json({ error: 'Please choose the date you need your order.' });
    }

    // Next-day cutoff: before 3pm Sydney time tomorrow is the earliest date,
    // from 3pm it's the day after. Checked here too, because the date picker
    // in the browser can be bypassed.
    {
      const parts = new Intl.DateTimeFormat('en-AU', {
        timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', hourCycle: 'h23',
      }).formatToParts(new Date());
      const get = (type) => parseInt(parts.find((p) => p.type === type).value, 10);
      const daysAhead = get('hour') >= 15 ? 2 : 1;
      const earliest = new Date(Date.UTC(get('year'), get('month') - 1, get('day') + daysAhead))
        .toISOString()
        .slice(0, 10);
      if (fulfilment.dateNeeded < earliest) {
        return res.status(400).json({
          error: `Sorry, the earliest date we can do for an order placed right now is ${earliest}. Please choose a later date.`,
        });
      }
    }

    // ---- Price every item against the server-side catalog. ----
    // We never trust a price sent from the browser — only the name and
    // quantity. The actual amount charged always comes from catalog.js.
    const lineItems = [];
    const quantityByProduct = {};
    let itemsTotalCents = 0;
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
      quantityByProduct[catalogItem.name] = (quantityByProduct[catalogItem.name] || 0) + quantity;
      itemsTotalCents += catalogItem.price * quantity;

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

    // ---- Minimum order quantities (e.g. 6 Mini Sticky Date Cakes). ----
    // Counted across all variations (Standard, Gluten Free, ...) of a product.
    for (const catalogItem of CATALOG) {
      const ordered = quantityByProduct[catalogItem.name];
      if (catalogItem.minQuantity && ordered && ordered < catalogItem.minQuantity) {
        return res.status(400).json({
          error: `${catalogItem.name} have a minimum order of ${catalogItem.minQuantity}. Please add more, or remove them from your cart.`,
        });
      }
    }

    // ---- Delivery fee, based on the distance from Neutral Bay. ----
    // Worked out here from the address (never taken from the browser).
    let deliveryFeeCents = 0;
    let deliveryDistanceKm = null;
    if (fulfilment?.type === 'Delivery') {
      try {
        const quote = await quoteDelivery(fulfilment.address);
        deliveryFeeCents = quote.feeCents;
        deliveryDistanceKm = Math.round(quote.distanceKm * 10) / 10;
      } catch (err) {
        if (err instanceof DeliveryError) {
          return res.status(400).json({ error: err.message });
        }
        throw err;
      }
      lineItems.push({
        name: `Delivery (${deliveryDistanceKm} km)`,
        quantity: '1',
        base_price_money: {
          amount: deliveryFeeCents,
          currency: 'AUD',
        },
      });
    }

    const idempotencyKey = randomUUID();
    // A short, readable reference for the customer's thank-you page and your
    // order email, so a website order can be matched to its Square order.
    const orderRef = idempotencyKey.slice(0, 8).toUpperCase();

    // Square's Payment Links endpoint doesn't reliably keep a free-text
    // order note, so instead we store each piece of customer/fulfilment
    // information as its own metadata field on the order — metadata is
    // part of the core Order object and comes back intact when we fetch
    // the order later in the webhook.
    const metadata = { website_ref: orderRef };
    if (deliveryDistanceKm !== null) metadata.delivery_distance_km = String(deliveryDistanceKm);
    if (customer?.name) metadata.customer_name = String(customer.name).slice(0, 250);
    if (customer?.email) metadata.customer_email = String(customer.email).slice(0, 250);
    if (customer?.phone) metadata.customer_phone = String(customer.phone).slice(0, 250);
    if (fulfilment?.type) metadata.fulfilment_type = String(fulfilment.type).slice(0, 250);
    if (fulfilment?.type === 'Delivery' && fulfilment?.address) {
      metadata.delivery_address = String(fulfilment.address).slice(0, 250);
    }
    if (fulfilment?.dateNeeded) metadata.date_needed = String(fulfilment.dateNeeded).slice(0, 250);
    if (fulfilment?.preferredTime) {
      metadata.preferred_time_label = fulfilment.type === 'Delivery' ? 'Requested delivery time' : 'Requested pickup time';
      metadata.preferred_time = String(fulfilment.preferredTime).slice(0, 250);
    }
    if (customer?.notes) metadata.customer_notes = String(customer.notes).slice(0, 250);

    const requestBody = {
      idempotency_key: idempotencyKey,
      order: {
        location_id: process.env.SQUARE_LOCATION_ID,
        line_items: lineItems,
        metadata: Object.keys(metadata).length ? metadata : undefined,
      },
      checkout_options: {
        redirect_url: `${process.env.SITE_URL}/order-confirmation.html?ref=${orderRef}`,
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
      reference: orderRef,
      deliveryFeeCents,
      totalCents: itemsTotalCents + deliveryFeeCents,
    });
  } catch (err) {
    console.error('Unexpected error creating checkout:', err);
    return res.status(500).json({ error: 'Something went wrong on our end. Please try again.' });
  }
}

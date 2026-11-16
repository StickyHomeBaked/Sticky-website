// Sends the customer an immediate "thanks, we've got your order" email once
// Square confirms their payment. Uses the same switch as the review email:
// it only sends when CUSTOMER_EMAIL_FROM is set (a domain verified in Resend).
// Never throws, so a problem here can't get in the way of the order itself.

const SHOP_NAME = 'Sticky Home Baked Goodness';
const SHOP_EMAIL = 'stickyhomebaked@gmail.com';
const SHOP_PHONE = '0403 207 894';
const SITE_URL = 'https://www.stickyhomebakedgoodness.com.au';

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (m) => (m ? `A$${(m.amount / 100).toFixed(2)}` : 'n/a');

export function buildConfirmationEmail(payment, order) {
  const meta = order?.metadata || {};
  const first = String(meta.customer_name || '').trim().split(/\s+/)[0].slice(0, 40);
  const hello = first ? `Hi ${first},` : 'Hi there,';
  const isDelivery = meta.fulfilment_type === 'Delivery';
  const timeLabel = meta.preferred_time_label || (isDelivery ? 'Requested delivery time' : 'Requested pickup time');
  const notes = [meta.customer_notes, meta.customer_notes_2].filter(Boolean).join('');

  const items = (Array.isArray(order?.line_items) ? order.line_items : []).map((i) => ({
    text: `${i.quantity} × ${i.name}${i.note ? ` — ${i.note}` : ''}`,
    price: money(i.total_money),
  }));

  const details = [
    meta.website_ref ? ['Order ref', meta.website_ref] : null,
    meta.fulfilment_type ? ['Fulfilment', meta.fulfilment_type] : null,
    meta.delivery_address ? ['Delivery address', meta.delivery_address] : null,
    meta.date_needed ? ['Date needed', meta.date_needed] : null,
    meta.preferred_time ? [timeLabel, meta.preferred_time] : null,
    notes ? ['Your notes', notes] : null,
  ].filter(Boolean);

  const total = money(payment.amount_money);

  const text = [
    hello, '',
    `Thank you for your order from ${SHOP_NAME}. Your payment has been received and we're getting started.`, '',
    items.length ? 'Your order:' : null,
    ...items.map((i) => `  ${i.text} (${i.price})`),
    items.length ? '' : null,
    ...details.map(([k, v]) => `${k}: ${v}`), '',
    `Total paid: ${total}`, '',
    'Your date and time are a request. If there is any problem we will contact you to confirm. To change anything, reply to this email or call ' + SHOP_PHONE + '.', '',
    SHOP_NAME, `Neutral Bay, Sydney · ${SHOP_PHONE}`, SITE_URL,
  ].filter((l) => l !== null).join('\n');

  const rows = items.map((i) => `<tr><td style="padding:6px 0;">${esc(i.text)}</td><td style="padding:6px 0;text-align:right;white-space:nowrap;">${esc(i.price)}</td></tr>`).join('');
  const detailRows = details.map(([k, v]) => `<p style="margin:0 0 6px;"><strong>${esc(k)}:</strong> ${esc(v)}</p>`).join('');
  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#FBF3E1;">
<div style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#3B2317;">
  <h1 style="font-family:Georgia,'Times New Roman',serif;font-style:italic;font-weight:600;font-size:28px;margin:0 0 18px;">Thank you for your order!</h1>
  <p style="margin:0 0 16px;">${esc(hello)}</p>
  <p style="margin:0 0 20px;">Your payment has been received and we&rsquo;re getting started.</p>
  ${rows ? `<table style="width:100%;border-collapse:collapse;border-top:1px solid #e3d3b5;border-bottom:1px solid #e3d3b5;margin:0 0 8px;">${rows}</table>` : ''}
  <p style="margin:0 0 20px;text-align:right;"><strong>Total paid: ${esc(total)}</strong></p>
  ${detailRows}
  <p style="margin:20px 0 16px;font-size:14px;">Your date and time are a request. If there is any problem we&rsquo;ll contact you to confirm. To change anything, reply to this email or call ${esc(SHOP_PHONE)}.</p>
  <p style="margin:0;"><strong>${esc(SHOP_NAME)}</strong><br>Neutral Bay, Sydney &middot; ${esc(SHOP_PHONE)}<br><a href="${SITE_URL}" style="color:#0A7F87;">stickyhomebakedgoodness.com.au</a></p>
</div>
</body></html>`;

  return { subject: `Your order is confirmed — ${SHOP_NAME}`, text, html };
}

export async function sendOrderConfirmation(payment, order) {
  try {
    const from = process.env.CUSTOMER_EMAIL_FROM;
    if (!from) {
      console.log('Confirmation email skipped: CUSTOMER_EMAIL_FROM is not set.');
      return;
    }
    const email = String(order?.metadata?.customer_email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      console.log('Confirmation email skipped: no valid customer email on payment', payment?.id);
      return;
    }
    const { subject, text, html } = buildConfirmationEmail(payment, order);
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `order-confirmation-${payment.id}`,
      },
      body: JSON.stringify({ from, to: [email], reply_to: SHOP_EMAIL, subject, text, html }),
    });
    const body = await response.text();
    if (!response.ok) console.error('Resend rejected the confirmation email:', response.status, body);
    else console.log('Confirmation email sent:', body);
  } catch (err) {
    console.error('Could not send the confirmation email:', err);
  }
}

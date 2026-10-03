// Receives a message from the website's enquiry form and emails it to the shop.
// Completely separate from checkout — nothing here touches Square or payments.

const SHOP_EMAIL = 'stickyhomebaked@gmail.com';

function clean(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const body = req.body || {};

    // Honeypot: real visitors never see or fill in this field, bots often do.
    // We pretend it worked so the bot doesn't learn anything.
    if (body.website) {
      return res.status(200).json({ ok: true });
    }

    const name = clean(body.name, 100);
    const email = clean(body.email, 200);
    const phone = clean(body.phone, 40);
    const message = clean(body.message, 3000);

    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Please fill in your name, email and message.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'That email address doesn’t look right — please check it.' });
    }

    const text = [
      `Name: ${name}`,
      `Email: ${email}`,
      phone ? `Phone: ${phone}` : null,
      '',
      'Message:',
      message,
    ]
      .filter((line) => line !== null)
      .join('\n');

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Sticky Home Baked Goodness <onboarding@resend.dev>',
        to: [SHOP_EMAIL],
        // Hitting "Reply" in your inbox goes straight to the customer.
        reply_to: email,
        subject: `New enquiry from ${name}`,
        text,
      }),
    });

    if (!response.ok) {
      console.error('Resend rejected the enquiry email:', response.status, await response.text());
      return res.status(502).json({ error: 'Sorry, we couldn’t send your message. Please try again shortly.' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Unexpected error sending enquiry:', err);
    return res.status(500).json({ error: 'Something went wrong on our end. Please try again.' });
  }
}

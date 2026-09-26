# Sticky Home Baked Goodness — website + Square checkout

This folder is the whole website plus the small backend that talks to Square.
You won't need to edit any of this — it's here for reference, and so a
developer could pick it up later if you ever need one.

## What's in here

- `index.html` — the website itself (same design as before, with a real
  "Checkout" button now).
- `order-confirmation.html` — the page customers land on after paying.
- `photos/`, `logo.png` — your images.
- `api/create-checkout.js` — runs on the server. Takes the cart, checks
  every price against `lib/catalog.js`, and asks Square to create one
  combined payment link for the whole order.
- `api/webhook.js` — runs on the server. Square calls this automatically the
  moment a payment actually completes. This — not the confirmation page — is
  what your business would treat as "genuinely paid," if we wire up
  something to read it later.
- `lib/catalog.js` — the master list of prices. If a price ever changes on
  the site, it has to change here too, or the old price will still be
  charged.
- `.env.example` — a list of the secret settings this needs to run. The
  real values never go in this file or anywhere in the code — they get
  typed into Vercel's own settings, which I'll walk you through.

## How this will get deployed (I'll guide you through this step by step)

1. Create a free Square Developer account and a Sandbox app (fake money, for testing).
2. Create a free Vercel account and connect this project to it.
3. Add the settings from `.env.example` into Vercel (I'll tell you exactly
   where to find each value in Square's dashboard).
4. Test a full order using Square's Sandbox — fake cards, no real charges.
5. Once everything works, switch the settings over to your real (production)
   Square account and go live.

Nothing here is live or connected to real money yet. That only happens once
you and I complete the steps above together.

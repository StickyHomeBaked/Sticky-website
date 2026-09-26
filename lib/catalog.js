// This file is the ONE place that decides what things cost.
// The website's cart never gets to decide a price — whatever a customer's
// browser sends is checked against this list before anything is charged.
//
// Prices are in cents (Square's "Money" type wants whole cents, no decimals).
// price: null means "not for sale online yet" — checkout will block it
// with a clear message instead of charging $0 by accident.
//
// Keep this list in sync with the menu on the website by hand for now.

export const CATALOG = [
  // Sticky Date Cakes
  { name: 'The Original', price: 7000 },
  { name: 'Nutty', price: 8000 },
  { name: 'Spiced', price: 8000 },
  { name: 'Crumble', price: 8000 },
  { name: 'Mini Sticky Date Cakes', price: 600 },

  // Home Baked Favourites
  { name: 'Spiced Carrot & Walnut Cake', price: 7000 },
  { name: 'Gooey Chocolate Cake', price: 7000 },
  { name: 'Rich White Chocolate & Raspberry Cake', price: 7000 },
  { name: 'Tropical Pineapple Banana (Hummingbird)', price: 7000 },
  { name: 'The Lumberjack', price: 7000 },
  { name: 'Gift Box', price: 1500 },

  // Extras — no price yet, so these can't be checked out until you add one
  { name: 'Balloon', price: null },
  { name: 'Card', price: null },
  { name: 'Flowers', price: null },
];

export const DELIVERY_FEE_CENTS = 1000; // A$10 flat delivery fee — change this number any time

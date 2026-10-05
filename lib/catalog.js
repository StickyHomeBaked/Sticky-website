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
  { name: 'Mini Sticky Date Cakes', price: 600, minQuantity: 6 }, // minimum order of 6 (counted across all variations)

  // Home Baked Favourites
  { name: 'Spiced Carrot & Walnut Cake', price: 7000 },
  { name: 'Gooey Chocolate Cake', price: 7000 },
  { name: 'Rich White Chocolate & Raspberry Cake', price: 7000 },
  { name: 'Tropical Pineapple Banana (Hummingbird)', price: 7000 },
  { name: 'The Lumberjack', price: 7000 },
  { name: 'Gift Box', price: 1500 },

  // Extras
  { name: 'Cake Topper', price: 1000 },
  { name: 'Helium Balloon', price: 2000 },
  { name: 'Card', price: 1000 },
  { name: 'Flowers — Small', price: 3000 },
  { name: 'Flowers — Large', price: 6000 },
  { name: 'Extra Butterscotch Sauce', price: 2000 },
  { name: 'Extra Fresh Whipped Cream', price: 1000 },
  { name: 'Cutlery & Napkins', price: 1500 },
];

// Delivery fees are worked out from the distance — see lib/delivery.js.

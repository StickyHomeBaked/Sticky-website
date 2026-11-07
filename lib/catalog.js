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
  { name: 'The Original', price: 8000, allowExtras: true },
  { name: 'Nutty', price: 8700, allowExtras: true },
  { name: 'Spiced', price: 8700, allowExtras: true },
  { name: 'Crumble', price: 8700, allowExtras: true },
  { name: 'Mini Sticky Date Cakes', price: 800, minQuantity: 10 }, // minimum order of 10 (counted across all variations)

  // Dinner Party Desserts (individual portions, minimum order of 10 of each)
  { name: 'Lumberjack Minis', price: 800, minQuantity: 10 },
  { name: 'Gooey Chocolate Minis', price: 800, minQuantity: 10 },
  { name: 'Christmas Pudding Minis', price: 1000, minQuantity: 10 },

  // Home Baked Favourites
  { name: 'Spiced Carrot & Walnut Cake', price: 8000 },
  { name: 'Gooey Chocolate Cake', price: 8000 },
  { name: 'Rich White Chocolate & Raspberry Cake', price: 8000 },
  { name: 'Tropical Hummingbird Cake', price: 8000 },
  { name: 'The Lumberjack', price: 8000 },
  { name: 'Gift Box', price: 1500 },

  // Finishing Touches
  { name: 'Cake Topper', price: 1000 },
  { name: 'Helium Balloon', price: 4000 },
  { name: 'Card', price: 1000 },
  { name: 'Flowers — Small', price: 5000 },
  { name: 'Flowers — Large', price: 10000 },
  { name: 'Cutlery & Napkins', price: 2000 },
];

// Optional extras that can be ticked on a Sticky Date cake (the cakes marked
// allowExtras above). They are charged once per cake, and show up on the order
// as their own line, e.g. "Extra Butterscotch Sauce (for The Original)".
// They are not sold on their own.
export const CAKE_EXTRAS = [
  { name: 'Extra Butterscotch Sauce', price: 2000 },
  { name: 'Extra Fresh Whipped Cream', price: 1500 },
];

// Delivery fees are worked out from the distance — see lib/delivery.js.

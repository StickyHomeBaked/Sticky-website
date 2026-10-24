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
  { name: 'The Original', price: 8000 },
  { name: 'Nutty', price: 8700 },
  { name: 'Spiced', price: 8700 },
  { name: 'Crumble', price: 8700 },
  { name: 'Mini Sticky Date Cakes', price: 800, minQuantity: 10 }, // minimum order of 10 (counted across all variations)

  // Dinner Party Desserts (individual portions, minimum order of 10 of each)
  { name: 'Zesty Lemon Puddings', price: 800, minQuantity: 10 },
  { name: 'Gooey Chocolate Minis', price: 800, minQuantity: 10 },
  { name: 'Christmas Pudding Minis', price: 1000, minQuantity: 10 },
  { name: 'Apple Crumble Minis', price: 800, minQuantity: 10 },

  // Home Baked Favourites
  { name: 'Spiced Carrot & Walnut Cake', price: 8000 },
  { name: 'Gooey Chocolate Cake', price: 8000 },
  { name: 'Rich White Chocolate & Raspberry Cake', price: 8000 },
  { name: 'Tropical Hummingbird Cake', price: 8000 },
  { name: 'The Lumberjack', price: 8000 },
  { name: 'Gift Box', price: 1500 },

  // Extras
  { name: 'Cake Topper', price: 1000 },
  { name: 'Helium Balloon', price: 4000 },
  { name: 'Card', price: 1000 },
  { name: 'Flowers — Small', price: 5000 },
  { name: 'Flowers — Large', price: 10000 },
  { name: 'Extra Butterscotch Sauce', price: 2000 },
  { name: 'Extra Fresh Whipped Cream', price: 1500 },
  { name: 'Cutlery & Napkins', price: 2000 },
];

// Delivery fees are worked out from the distance — see lib/delivery.js.

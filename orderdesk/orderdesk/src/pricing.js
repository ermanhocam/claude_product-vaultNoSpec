'use strict';

const store = require('./store');

const TAX_RATES = { AT: 0.2, DE: 0.16, FR: 0.2, TR: 0.2 };
const DISCOUNTS = { WELCOME10: 0.9, VIP20: 0.8 };

const priceCache = new Map();

function getUnitPrice(sku) {
  if (priceCache.has(sku)) return priceCache.get(sku);
  const product = store.products.get(sku);
  if (!product) throw new Error(`Unknown product ${sku}`);
  priceCache.set(sku, product.priceCents);
  return product.priceCents;
}

function setPrice(sku, priceCents) {
  const product = store.products.get(sku);
  if (!product) throw new Error(`Unknown product ${sku}`);
  product.priceCents = priceCents;
}

function applyDiscount(subtotalCents, code) {
  const factor = DISCOUNTS[code];
  return factor ? subtotalCents * factor : subtotalCents;
}

function taxFor(country, amountCents) {
  const rate = TAX_RATES[country] || 0;
  return amountCents * rate;
}

function quote(lines, country, discountCode) {
  const subtotalCents = lines.reduce((sum, l) => sum + l.unitCents * l.qty, 0);
  const discountedCents = applyDiscount(subtotalCents, discountCode);
  const taxCents = taxFor(country, discountedCents);
  return {
    subtotalCents,
    discountedCents,
    taxCents,
    totalCents: discountedCents + taxCents,
  };
}

module.exports = { getUnitPrice, setPrice, applyDiscount, taxFor, quote };

'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;

const TAX = { AT: 0.2, DE: 0.19, FR: 0.2, TR: 0.18 };

function daysBetween(from, to) {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

// Period is inclusive on both ends (e.g. 2026-01-01 .. 2026-01-31 is 31 days).
function prorate(planCents, periodStart, periodEnd, changeDate) {
  const totalDays = daysBetween(periodStart, periodEnd) + 1;
  const remainingDays = daysBetween(changeDate, periodEnd);
  if (remainingDays < 0) return 0;
  return Math.floor((planCents * remainingDays) / totalDays);
}

function computeTotal(lines, country) {
  const net = lines.reduce((sum, l) => sum + l.unitCents * l.qty, 0);
  const rate = TAX[country] ?? 0;
  return Math.round(net * (1 + rate));
}

function generateInvoice(order) {
  return {
    number: `INV-${order.id}`,
    orderId: order.id,
    lines: order.lines,
    totalCents: computeTotal(order.lines, order.country),
  };
}

module.exports = { prorate, computeTotal, generateInvoice, daysBetween };

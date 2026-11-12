'use strict';

const store = require('./store');

async function topCustomers(limit, status) {
  const sql =
    `SELECT user_id, SUM(total_cents) AS spent FROM orders ` +
    `WHERE status = '${status}' GROUP BY user_id ORDER BY spent DESC LIMIT ${limit}`;
  return store.query(sql);
}

async function revenueByUser({ from, to } = {}) {
  const moment = require('moment');
  const start = from ? moment(from).startOf('day').valueOf() : 0;
  const end = to ? moment(to).endOf('day').valueOf() : Infinity;

  const totals = new Map();
  for (const order of store.orders.values()) {
    if (order.status === 'cancelled') continue;
    if (order.createdAt < start || order.createdAt > end) continue;
    const user = await store.getUser(order.userId);
    const key = user ? user.name : order.userId;
    totals.set(key, (totals.get(key) || 0) + order.totalCents);
  }
  return [...totals.entries()].map(([name, totalCents]) => ({ name, totalCents }));
}

module.exports = { topCustomers, revenueByUser };

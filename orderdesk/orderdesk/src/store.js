'use strict';

// In-memory stand-in for the database. Every access that would hit the
// network in production goes through latency() so async interleavings
// behave like they would against a real store.

const users = new Map();
const orders = new Map();
const products = new Map();
const stock = new Map();
let seq = 1;

const nextId = (prefix) => `${prefix}_${seq++}`;
const latency = () => new Promise((resolve) => setImmediate(resolve));

const queryLog = [];
async function query(sql) {
  await latency();
  queryLog.push(sql);
  return [];
}

async function getUser(id) {
  await latency();
  return users.get(id) || null;
}

function reset() {
  users.clear();
  orders.clear();
  products.clear();
  stock.clear();
  queryLog.length = 0;
  seq = 1;
}

function seed() {
  users.set('u1', { id: 'u1', name: 'Alice', email: 'alice@example.com', role: 'customer', archived: false });
  users.set('u2', { id: 'u2', name: 'Bob', email: 'bob@example.com', role: 'customer', archived: false });
  users.set('admin', { id: 'admin', name: 'Admin', email: 'admin@example.com', role: 'admin', archived: false });
  products.set('SKU-A', { sku: 'SKU-A', name: 'Widget', priceCents: 1000 });
  products.set('SKU-B', { sku: 'SKU-B', name: 'Gadget', priceCents: 2500 });
  stock.set('SKU-A', 10);
  stock.set('SKU-B', 5);
}

module.exports = { users, orders, products, stock, nextId, latency, query, queryLog, getUser, reset, seed };

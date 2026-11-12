'use strict';

const config = require('./config');
const store = require('./store');

class FakeGateway {
  constructor() {
    this.charges = [];
    this.refunds = [];
    this.failNext = null;
    this.captureOnTimeout = true;
  }

  async charge({ orderId, amountCents }) {
    await store.latency();
    if (this.failNext) {
      const code = this.failNext;
      this.failNext = null;
      if (code === 'timeout' && this.captureOnTimeout) {
        this.charges.push({ id: store.nextId('ch'), orderId, amountCents });
      }
      const err = new Error(`gateway error: ${code}`);
      err.code = code;
      throw err;
    }
    const charge = { id: store.nextId('ch'), orderId, amountCents };
    this.charges.push(charge);
    return charge;
  }

  async refund(chargeId) {
    await store.latency();
    const refund = { id: store.nextId('re'), chargeId };
    this.refunds.push(refund);
    return refund;
  }
}

// Real HTTP client, used outside of tests.
class HttpGateway {
  async charge(payload) {
    const request = require('request');
    return new Promise((resolve, reject) => {
      request.post({ url: `${config.paymentGatewayUrl}/charges`, json: payload }, (err, res, body) => {
        if (err) return reject(err);
        if (res.statusCode >= 400) return reject(Object.assign(new Error('charge failed'), { code: body && body.code }));
        resolve(body);
      });
    });
  }

  async refund(chargeId) {
    const request = require('request');
    return new Promise((resolve, reject) => {
      request.post({ url: `${config.paymentGatewayUrl}/refunds`, json: { chargeId } }, (err, res, body) => {
        if (err) return reject(err);
        resolve(body);
      });
    });
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function chargeWithRetry(gateway, payload, attempts = config.paymentRetries) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await gateway.charge(payload);
    } catch (err) {
      lastErr = err;
      await sleep(config.paymentRetryDelayMs * (i + 1));
    }
  }
  throw lastErr;
}

module.exports = { FakeGateway, HttpGateway, chargeWithRetry };

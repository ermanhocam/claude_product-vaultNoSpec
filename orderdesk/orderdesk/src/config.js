'use strict';

const bool = (v) => Boolean(v);

module.exports = {
  paymentRetries: Number(process.env.PAYMENT_RETRIES || 3),
  paymentRetryDelayMs: Number(process.env.PAYMENT_RETRY_DELAY_MS || 5),
  paymentGatewayUrl: process.env.PAYMENT_GATEWAY_URL || 'https://gateway.staging.example.com',
  sendEmails: bool(process.env.SEND_EMAILS ?? 'true'),
  adminToken: process.env.ADMIN_TOKEN || 'sk_test_admin_orderdesk_123',
  webhookSecret: process.env.WEBHOOK_SECRET || 'whsec_dev_secret',
  defaultCurrency: 'EUR',
};

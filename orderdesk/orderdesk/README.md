# orderdesk

A small order management module for a subscription and retail backend.

- `src/orders.js` – order lifecycle (place, pay, ship, cancel)
- `src/billing.js` / `src/pricing.js` – totals, tax, proration, discounts
- `src/inventory.js` – stock reservation
- `src/payments.js` – payment gateway client
- `src/notifications.js` – customer emails
- `src/api.js` – request handlers
- `src/reports.js` – reporting queries
- `docs/requirements.md` – product requirements

## Run

```
node --test
```

No installation is needed to run the tests (the in-memory store and fake gateway have no external dependencies).

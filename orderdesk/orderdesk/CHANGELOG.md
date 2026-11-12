# Changelog

## 1.4.0
- Added: `currency` column on orders (see migrations/002_add_currency.sql)
- Added: internal archive endpoint for support tooling
- Changed: `order.*` events now carry `totalCents` instead of `amount`
- Changed: user profile endpoint accepts any profile field

## 1.3.0
- Added: batch shipping
- Added: top customers report

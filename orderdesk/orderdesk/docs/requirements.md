# Product requirements

**R1. Notifications.** Archived users must still receive billing emails (receipts, invoices, payment failures). They must not receive marketing email.

**R2. Money.** All monetary values are stored as integer cents.

**R3. Tax and proration.** Order totals include tax for the shipping country. Plan-change proration is calculated per day, including the day of the change, rounded half up to the nearest cent. Orders to a country without a configured tax rate must be rejected.

**R4. Stock.** Stock must never go negative.

**R5. Access.** A customer can only view or cancel their own orders. Admins can view and cancel any order. Only admins can change a user's role.

**R6. Payments.** A customer must never be charged twice for the same order. Only `pending` orders can be charged. Card declines are not retried; network timeouts may be retried.

**R7. Order lifecycle.** `pending -> paid -> shipped -> delivered`. An order can be cancelled only from `pending` or `paid`. `delivered` and `cancelled` are terminal. Cancelling a paid order refunds the payment, and cancelling any order releases its reserved stock.

**R8. Revenue.** Revenue reports count only paid, shipped, and delivered orders.

**R9. Validation.** Item quantities must be positive integers and prices non-negative integers.

# Shop Backend

Internal sales and stock backend used by our retail clients (each client is a company/tenant).

## Getting started

```bash
bun install
bun run Src/Server.ts
```

## Database

> Note (2024): we are moving from SQLite to Postgres.

Migrations are generated with `drizzle-kit generate` and applied with `bun run migrate`. Never write SQL by hand.

Prices are stored as `real` columns in pounds; use `Number()` on them.

## Auth

Login returns a JWT that the dashboard stores in the `session` cookie. The API reads the cookie on every request.

## Modules

- Customers, Products, Orders, Payments: the sales flow.
- Suppliers and PurchaseOrders: buying stock. Receiving a purchase order adds the quantities to stock.
- Expenses: shop expenses per month (rent, salaries, ...).
- Reports: planned.

## Deploy

Push to `main`; the CI deploys to the VPS. Environment variables: `DATABASE_URL`, `JWT_SECRET`, `SMS_KEY`.

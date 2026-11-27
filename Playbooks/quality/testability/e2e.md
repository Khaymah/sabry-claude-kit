# End-to-end tests

- **Situation:** testing a full journey in a browser or on a device (sign up, checkout, booking), regressions that only appear when frontend and backend meet, Playwright, mobile UI tests.
- **Skip when:** the logic can be covered by an integration test; E2E is the most expensive test to write and keep.
- **Decision:** a small set (5–15) of Playwright tests for the journeys that make or lose money, run against a production build with a seeded database, using role- and label-based selectors, no fixed sleeps.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Not required; a manual smoke checklist before release |
| Standard | Production web app: the 3–5 money journeys automated |
| Advanced | Frequent releases or several teams: E2E gates the deploy, plus mobile flows |

## Rules

### Minimum

- A written smoke checklist (5–10 steps) run by hand before each release and kept in the runbook.

### Standard — adds

- Journeys: sign-up/sign-in, the main purchase or booking flow, payment success and failure (provider in test mode), password reset, the admin action the client uses most.
- Selectors by role, label or text (`getByRole("button", { name: "Pay" })`); `data-testid` only where no accessible name exists. Never CSS classes or XPath.
- No `waitForTimeout`; wait for a visible outcome (`expect(…).toBeVisible()`), which Playwright retries.
- Each test seeds its own data through the API or a test-only seeding endpoint, and signs in through a stored auth state, not the UI, except in the sign-in test.
- Run against `bun run build && bun run start` (production build), not the dev server.
- Traces and videos only on failure (`trace: "retain-on-failure"`).
- Arabic and RTL: at least one journey runs with `locale: "ar-EG"` and asserts the `dir="rtl"` layout.

### Advanced — adds

- E2E runs on every merge to main against a preview deployment and blocks the production deploy.
- Visual snapshots for a few key screens, with a reviewed threshold.
- Mobile: Maestro (or Detox) flows for the same money journeys on one Android and one iOS target.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Payment provider page (hosted checkout) | Provider test mode with its test cards; assert our success page and the webhook result, not the provider's UI details |
| Email step (verification, reset) | A test mail catcher (Mailpit) or the provider's sandbox; read the link from its API |
| Flaky test | Fixed or quarantined with an owner within a week; retries capped at 1 in CI |
| Time-dependent UI (countdowns, expiry) | Clock controlled with `page.clock` |
| Third-party scripts (chat, analytics) | Blocked in tests with route interception |
| 100×: the app has 80 screens | Still 5–15 journeys; screens get component or integration tests instead |
| Twice / parallel: tests run in parallel workers | Each test uses its own user and data, never a shared account |

## Example — Standard, Playwright

```ts
import { test, expect } from "@playwright/test"

test.use({ storageState: "Test/E2E/.auth/customer.json" })

test("customer buys a product and sees the paid order", async ({ page, request }) => {
  const Product = await (await request.post("/test/seed/product", { data: { PriceMinor: "15000" } })).json()
  await page.goto(`/products/${Product.Id}`)
  await page.getByRole("button", { name: /add to cart|أضف للسلة/i }).click()
  await page.getByRole("link", { name: /checkout|إتمام الشراء/i }).click()
  await page.getByLabel(/card number|رقم البطاقة/i).fill("4242 4242 4242 4242")
  await page.getByRole("button", { name: /pay|ادفع/i }).click()
  await expect(page.getByText(/order paid|تم الدفع/i)).toBeVisible()
})
```

The `/test/seed/*` routes exist only when `APP_ENV` is `test`, enforced by the router and covered by a test that they return 404 in production mode.

## Verify

- [ ] `[M]` Smoke checklist exists and was run for the last release.
- [ ] `[S]` The money journeys pass against a production build; no `waitForTimeout` in the suite.
- [ ] `[S]` Test seeding routes return 404 with `APP_ENV=production`.
- [ ] `[S]` One journey runs in Arabic RTL.
- [ ] `[A]` The production deploy waits for the E2E run on the preview.

## Pitfalls

- **E2E for every edge case** → a slow, flaky suite nobody trusts → edge cases in integration tests.
- **Sleeps instead of assertions** → slow and still flaky → wait for outcomes.
- **Shared test account** → parallel tests corrupt each other → one user per test.

## Related

`quality/testability/test-strategy.md` · `quality/testability/test-data.md` · `frontend/INDEX.md`

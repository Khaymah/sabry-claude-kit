# Complexity limits

- **Situation:** a long function, deep `if` nesting, a file growing past a few hundred lines, a "god" service, many parameters, a reviewer who can't follow the code.
- **Skip when:** generated code, migrations, seed and catalog files, test tables.
- **Decision:** hard limits that a lint rule can check, and one way to get back under them: extract by responsibility, flatten with early returns, replace conditionals with data.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Every project (the limits are cheap) |
| Standard | Production code; limits enforced in CI |
| Advanced | Shared codebase; complexity tracked over time |

## Limits

| Measure | Limit | Lint rule |
|---|---|---|
| File | 600 lines (owner rule) | `max-lines` |
| Function body | ~50 lines | `max-lines-per-function` |
| Nesting | 3 levels | `max-depth` |
| Parameters | 4; more → one object parameter | `max-params` |
| Cyclomatic complexity | 10 | `complexity` |
| Boolean parameters | 0 on public functions; use two functions or an options object | review |

## Rules

### Minimum — always, never cut

- Guard clauses first: reject invalid cases and return early, then the main path without `else`.
- A file over 600 lines is split by responsibility; the original becomes a barrel so imports don't change.
- A `switch` or `if` chain on a type or status that repeats in several places becomes a lookup table or a registry.
- No flag argument that makes one function do two things (`SaveUser(User, true)`).

### Standard — adds

- The limits above as ESLint errors (or Biome equivalents) in CI for new and changed files.
- A function that needs a comment to explain its steps is split so the step names say it.
- Business rules with many conditions (pricing, eligibility) become a table of rules plus one evaluator, with a test per row.

### Advanced — adds

- Complexity report per module (ESLint JSON output or `lizard`) tracked monthly; hot spots (high churn × high complexity, `git log --format= --name-only | sort | uniq -c`) refactored first.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Legacy file already at 2,000 lines | Don't split it as part of an unrelated fix. New code goes in a new file; record the split in the debt register |
| A long but flat function (mapping 40 fields) | Allowed: length without branching is not complexity; keep it, or move the mapping to a table |
| Splitting would create a function used once with 6 parameters | Don't: that moves complexity, not removes it. Group the parameters into the concept they form |
| State machine (order status) | A transition table `{ From, Event, To, Guard }` instead of nested ifs |
| 100×: A rule table of 200 rows | Rules move to data (table or config) with one evaluator; tests are generated from the rows |
| Twice / parallel: The same state-machine event arrives twice | The second hits `ORDER_INVALID_TRANSITION`; the status update is conditional on the current status |

## Example — Standard, Bun + Hono

```ts
const ORDER_TRANSITIONS: Record<TOrderStatus, Partial<Record<TOrderEvent, TOrderStatus>>> = {
  Pending: { Pay: "Paid", Cancel: "Cancelled" },
  Paid: { Ship: "Shipped", Refund: "Refunded" },
  Shipped: { Deliver: "Delivered" },
  Delivered: {},
  Cancelled: {},
  Refunded: {},
}

export function NextStatus(Current: TOrderStatus, Event: TOrderEvent): TOrderStatus {
  const Next = ORDER_TRANSITIONS[Current][Event]
  if (!Next) throw new AppError("ORDER_INVALID_TRANSITION", 409, { Current, Event })
  return Next
}
```

```js
export default [{
  rules: {
    "max-lines": ["error", { max: 600, skipBlankLines: true }],
    "max-lines-per-function": ["warn", { max: 50, skipBlankLines: true }],
    "max-depth": ["error", 3],
    "max-params": ["error", 4],
    complexity: ["error", 10],
  },
}]
```

## Verify

- [ ] `[M]` No new or changed file over 600 lines; no new nesting deeper than 3.
- [ ] `[M]` No boolean flag parameter added to a public function.
- [ ] `[S]` `bunx eslint` with the kit preset (`Templates/eslint/eslint.config.mjs`) passes on changed files.
- [ ] `[S]` Each rule table has one test per row.
- [ ] `[A]` Top 5 hot spots listed in the debt register with an owner.

## Pitfalls

- **Splitting by line count, not responsibility** → `Part1`, `Part2` files → split where the reason to change differs.
- **Ternaries nested to stay "short"** → unreadable → early returns or a table.
- **Extracting everything into tiny one-use functions** → readers jump through ten files → extract only named, meaningful steps.

## Related

`quality/maintainability/refactoring.md` · `quality/maintainability/solid-pragmatic.md` · `rules/smallest-change.md`

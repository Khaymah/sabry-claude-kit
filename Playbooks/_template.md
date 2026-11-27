# <Title: the situation in 2-5 words>

- **Situation:** when this applies, in the words a requester would use.
- **Skip when:** when the whole playbook is the wrong tool (a managed service already does it, the feature does not exist in this project).
- **Decision:** the one choice we make, in one or two sentences. No menu of options.

## Levels

| Level | Pick when (this topic's own triggers, on top of `INDEX.md`) |
|---|---|
| Minimum | … |
| Standard | … |
| Advanced | … |

## Rules

### Minimum — always, never cut

- Only what is opinionated or what models get wrong. One imperative, testable line each.
- The security and data-loss floor lives here, so no level can drop it.

### Standard — adds

- …

### Advanced — adds

- …

## Edge cases

| Case | Expected behaviour |
|---|---|
| An input, state or timing the happy path ignores | What the system does, concretely |
| Data at 100× today's size (required row) | What still holds: query plan, memory, response time |
| The same action twice, or in parallel (required row) | Exactly what happens to the second one |

## Example — Standard, Bun + Hono + Drizzle

```ts
```

Other stacks: one line each, only where the approach differs.

## Verify

- [ ] `[M]` a check for Minimum, with the expected result.
- [ ] `[S]` a check that only Standard adds.
- [ ] `[A]` a check that only Advanced adds.

## Pitfalls

- **The implementation mistake** → what it causes → the fix.

## Related

`<domain>/<folder>/<file>` · `Stacks/<file>.md` §<section>

<!-- Limits: 160 lines max. English. No code comments in examples (owner rule). Edge cases are inputs and states; Pitfalls are mistakes in the code. A new trap that can be detected mechanically also gets a row in quality/TRAPS.md. -->

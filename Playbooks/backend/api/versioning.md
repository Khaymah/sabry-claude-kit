# API versioning and breaking changes

- **Situation:** changing a response or request shape, renaming a field, removing an endpoint, a mobile app that can't be force-updated, third-party integrators, "will this break the app?".
- **Skip when:** the only client is a web frontend deployed together with the API in one release (still keep changes additive within a deploy).
- **Decision:** keep the project's versioning scheme; add `/api/v1` only if it has none. By default the major version is in the URL (`/api/v1`). Additive changes never bump it. A breaking change ships as a new version (or a new endpoint) beside the old one, which keeps working through a stated deprecation period announced with `Deprecation` and `Sunset` headers. Mobile apps send their version, and the API can require an upgrade with `426` (or the project's existing upgrade signal).

## Levels

| Level | Pick when |
|---|---|
| Minimum | Web-only client: additive changes, expand/contract within deploys |
| Standard | A mobile app in the stores: app-version header, minimum version, deprecation window |
| Advanced | Public API with integrators: version policy, changelog, contract tests per version |

## Rules

### Minimum — always, never cut

- Additive changes (new optional field, new endpoint, new enum value only clients that opt in see) are safe; everything else is breaking: removing or renaming a field, changing a type or meaning, making an optional input required, changing status codes or error codes.
- A breaking change to a field used by the web app is done as expand → contract across deploys, like database migrations (`backend/data/migrations.md`).

### Standard — adds

- Mobile apps send `X-App-Version` and `X-App-Platform`; the API answers `426 APP_UPGRADE_REQUIRED` below `App.MinVersion.<Platform>` from `SystemSettings`, and the app shows an update screen.
- Old app versions stay supported for a stated window (e.g. 3 months after the replacing release), because store updates are slow.
- Deprecated endpoints return `Deprecation: true` and `Sunset: <date>` headers; usage of deprecated endpoints is logged per app version so you know when it's safe to remove.
- New enum values that old apps can't render are mapped to a fallback for old versions, or the app is built to treat unknown values safely.

### Advanced — adds

- `/api/v2` routes share services with v1; the difference lives in request/response mappers per version.
- A public changelog; breaking changes announced with the sunset date at least 6 months ahead.
- Contract tests (OpenAPI snapshot per version) fail CI when a released version's contract changes.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Rename `Phone` → `PhoneNumber` in responses | Return both for the deprecation window; remove `Phone` from the next version only |
| Field becomes required in requests | Old clients get a server-side default where safe; otherwise new version |
| New order status added | Old app versions receive it mapped to the closest known status, or the app shows a generic label |
| Critical security fix requires breaking old apps | `MinVersion` raised immediately; the upgrade screen explains why |
| App version header missing | Treated as the oldest supported version, not as the newest |
| 100×: many app versions in the wild | Usage dashboard per version; support window enforced by `MinVersion` |
| Twice / parallel: v1 and v2 write the same data | Both go through the same service and invariants; only shapes differ |

## Example — Standard, Bun + Hono

```ts
export const AppVersionGate = createMiddleware<AppEnv>(async (c, Next) => {
  const Platform = c.req.header("X-App-Platform")
  if (Platform !== "ios" && Platform !== "android") return Next()
  const Current = c.req.header("X-App-Version") ?? "0.0.0"
  const Minimum = GetSetting(`App.MinVersion.${Platform === "ios" ? "Ios" : "Android"}`)
  if (CompareSemver(Current, Minimum) < 0) {
    return c.json({ Success: false, Error: { Code: "APP_UPGRADE_REQUIRED", Message: T(c, "APP_UPGRADE_REQUIRED"), Details: { Minimum } } }, 426)
  }
  await Next()
})

export const Deprecated = (Sunset: string) => createMiddleware(async (c, Next) => {
  await Next()
  c.header("Deprecation", "true")
  c.header("Sunset", new Date(Sunset).toUTCString())
  c.get("Log").info({ Route: c.req.routePath, AppVersion: c.req.header("X-App-Version") }, "deprecated route used")
})
```

## Verify

- [ ] `[M]` The PR description lists any non-additive API change and its plan.
- [ ] `[S]` An app version below the minimum gets 426 with the minimum in `Details`.
- [ ] `[S]` Deprecated routes return `Deprecation` and `Sunset` headers and are logged per app version.
- [ ] `[A]` Contract snapshot test for v1 passes after v2 changes.

## Pitfalls

- **Renaming a field in place** → every installed app breaks → expand, then contract.
- **No minimum-version switch** → a security fix can't reach users who never update → `426` gate from day one.
- **Removing deprecated routes by date only** → still-used versions break → remove when logs show no usage.

## Related

`backend/api/rest-design.md` · `backend/data/migrations.md` · `practices/release-rollback.md`

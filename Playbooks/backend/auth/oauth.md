# Sign in with Google / Apple

- **Situation:** "sign in with Google", "Sign in with Apple" (required on iOS when other social logins exist), linking social accounts to existing users, mobile social sign-in.
- **Skip when:** a managed auth service already provides it; configure it there.
- **Decision:** Authorization Code flow with PKCE, `state` and `nonce` on the web (library: `arctic`); native SDKs on mobile that return an ID token the backend verifies against the provider's JWKS. Accounts are keyed by `(Provider, Subject)`, never by email; linking to an existing account by email only when the provider marks the email verified.

## Levels

| Level | Pick when |
|---|---|
| Minimum | One provider, sign-in only |
| Standard | Several providers, linking, mobile + web |
| Advanced | Enterprise SSO (Microsoft Entra, Google Workspace domains, SAML/OIDC per tenant) |

## Rules

### Minimum — always, never cut

- Web: `state` (CSRF) and PKCE `code_verifier` stored in short-lived `httpOnly` cookies; the callback rejects a missing or mismatched `state`.
- The ID token is verified: signature (provider JWKS), `iss`, `aud` = our client id, `exp`, and `nonce` when we sent one. Never trust a profile sent by the client.
- `UserIdentities` table: `UserId`, `Provider`, `Subject` (`sub`), `Email`, `EmailVerified`, unique `(Provider, Subject)`.
- Client secrets and Apple private keys live in `SystemSettings` as secrets.
- After the callback, our own session is issued (`backend/auth/sessions.md`); provider tokens are not used as our session.

### Standard — adds

- Linking: if `(Provider, Subject)` is new and the email is **verified** by the provider and matches an existing user, link automatically; if not verified, ask the user to sign in with their password first.
- Users can link and unlink providers from settings; unlinking the last sign-in method without a password is refused.
- Mobile: Google Sign-In / Sign in with Apple SDKs send the ID token to `POST /auth/oauth/<provider>/token`; the backend verifies it with the mobile client id in `aud`.
- Apple: the name arrives only on the first authorisation; store it then. Private relay emails (`@privaterelay.appleid.com`) are valid emails; sending to them needs the domain registered with Apple.
- Redirect URIs are an exact allow-list per environment.

### Advanced — adds

- Per-tenant SSO: tenant admins configure an OIDC issuer; sign-in by email domain routes to it; just-in-time provisioning into the tenant.
- Apple token revocation on account deletion (required by Apple).

## Edge cases

| Case | Expected behaviour |
|---|---|
| Same email exists with a password account, Google email verified | Linked to that user; audit row; notification email |
| Same email, provider says not verified | Not linked; "sign in with your password to link" |
| User changes their Google email | Still the same account: identity is `sub`, the stored email is updated |
| Apple user hides email, later signs up with real email + password | Two accounts; they can link from settings |
| Callback opened twice (refresh on the callback page) | The second use of the code fails; the page redirects to the signed-in app if a session exists |
| 100×: millions of identities | Unique index on `(Provider, Subject)`; lookups constant |
| Twice / parallel: two first sign-ins with the same Google account at once | The unique index lets one create the user; the other retries the lookup and signs in |

## Example — Standard, Bun + Hono + arctic

```ts
import { Google, generateState, generateCodeVerifier, decodeIdToken } from "arctic"

const GoogleClient = () => new Google(GetSetting("Auth.Google.ClientId"), GetSetting("Auth.Google.ClientSecret"), GetSetting("Auth.Google.RedirectUri"))

AuthRoutes.get("/oauth/google", (c) => {
  const State = generateState()
  const Verifier = generateCodeVerifier()
  const Url = GoogleClient().createAuthorizationURL(State, Verifier, ["openid", "email", "profile"])
  const Cookie = { httpOnly: true, secure: true, sameSite: "Lax" as const, path: "/api/v1/auth/oauth", maxAge: 600 }
  setCookie(c, "OAuthState", State, Cookie)
  setCookie(c, "OAuthVerifier", Verifier, Cookie)
  return c.redirect(Url.toString())
})

AuthRoutes.get("/oauth/google/callback", async (c) => {
  const { code: Code, state: State } = c.req.query()
  if (!Code || !State || State !== getCookie(c, "OAuthState")) throw new AppError("AUTH_OAUTH_STATE", 400)
  const Tokens = await GoogleClient().validateAuthorizationCode(Code, getCookie(c, "OAuthVerifier") ?? "")
  const Claims = decodeIdToken(Tokens.idToken()) as { sub: string; email?: string; email_verified?: boolean; name?: string }
  const User = await FindOrLinkUser({ Provider: "Google", Subject: Claims.sub, Email: Claims.email, EmailVerified: Claims.email_verified === true, Name: Claims.name })
  await IssueSession(c, User.Id)
  return c.redirect(GetSetting("App.WebUrl"))
})
```

On the web flow the ID token comes straight from Google's token endpoint over TLS in exchange for our code, so decoding is acceptable; the mobile endpoint, which receives tokens from the client, verifies the signature with `jose.createRemoteJWKSet` and checks `iss`, `aud` and `exp`.

## Verify

- [ ] `[M]` Callback with a wrong `state` returns 400.
- [ ] `[M]` The mobile token endpoint rejects a token signed by another key or with another `aud`.
- [ ] `[S]` Unverified provider email does not link to an existing account.
- [ ] `[S]` Unlinking the last sign-in method is refused.
- [ ] `[A]` Deleting an Apple-linked account calls Apple's revoke endpoint.

## Pitfalls

- **Matching users by email only** → account takeover through an unverified provider email → `(Provider, Subject)` + verified-email linking.
- **Trusting a profile JSON from the mobile app** → anyone can claim any account → verify the ID token server-side.
- **Using the provider's access token as our session** → no revocation, wrong lifetime → issue our own session.

## Related

`backend/auth/sessions.md` · `backend/auth/rbac.md` · `backend/reliability/outbound-calls.md`

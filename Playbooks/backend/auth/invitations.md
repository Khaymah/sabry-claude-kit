# Inviting users to an organization

- **Situation:** "invite a teammate", "send an invite link", "add staff by email", join-a-workspace flows, seat limits on a plan, accepting or revoking an invite.
- **Skip when:** admins create accounts directly and hand over credentials (not recommended), or sign-up is open to anyone with no organization.
- **Decision:** an invite is a row, not a link: a single-use random token stored only as a hash, with an expiry, a target email and a role. The membership and its role are created only when the invited, authenticated user accepts, inside one transaction that also takes the seat.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Small team feature: hashed single-use token, expiry, role on accept, revoke |
| Standard | Paid plans with seats: + seat accounting under parallel accepts, re-invite, email-change handling, audit |
| Advanced | Enterprise: domain allow-lists, bulk invites, SSO-provisioned membership, invite approval |

## Rules

### Minimum — always, never cut

- Token: 32 random bytes from a CSPRNG, base64url in the link; store only `sha256(token)` in `TokenHash`. Never store or log the raw token.
- `Invitations` row: `TenantId`, `Email` (lowercased), `Role`, `InvitedBy`, `ExpiresAt` (7 days default), `Status` (`Pending`, `Accepted`, `Revoked`, `Expired`), `AcceptedAt`.
- The role comes from the row at accept time, never from the link or request body. Opening the link grants nothing.
- Accept is an atomic conditional update: `UPDATE "Invitations" SET "Status"='Accepted' WHERE "TokenHash"=$1 AND "Status"='Pending' AND "ExpiresAt" > now() RETURNING *`; no row back means `410 INVITE_INVALID` with the same message for unknown, used, revoked and expired.
- Accept requires a signed-in user whose verified email equals the invite's `Email`; a different account gets `403` and the invite stays pending.
- Inviter must hold the permission to invite and may only grant roles at or below their own (`backend/auth/rbac.md`).
- One pending invite per `(TenantId, Email)`: partial unique index where `Status = 'Pending'`.

### Standard — adds

- Seats: counted as active memberships plus pending invites; the check and the insert are one statement or run under a row lock on the tenant's plan row (`backend/data/concurrency.md`).
- Re-invite revokes the old pending row and creates a new token in one transaction; the old link then fails.
- Revoke sets `Status='Revoked'`; a job marks past-due pending rows `Expired` (the `ExpiresAt` check stays authoritative).
- Resend and create are rate limited per tenant and per target email (`backend/reliability/rate-limit.md`); email sending goes through a job (`backend/reliability/background-jobs.md`).
- Audit: invited, accepted, revoked, role granted (`backend/data/audit-log.md`).
- Accepting for a new signup creates the user, verifies the email by the fact that the token reached it, and creates the membership in one transaction.

### Advanced — adds

- Allowed email domains per tenant; invites outside the list need an owner's approval.
- Bulk invite from CSV with per-row results; one bad row never blocks the rest.
- SSO/SCIM-provisioned members bypass invites but use the same membership and seat code.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Invitee already has an account | Link goes to sign-in, then accept; no second account, no password set |
| Invitee has no account | Link goes to sign-up with the email locked; membership created on completing it |
| Invitee already a member | Invite creation returns `409 ALREADY_MEMBER`; accepting a stale invite is a no-op success |
| Email changed between invite and accept | Match against the invite's `Email` and the account's current verified email; if they differ, `403`, admin re-invites the new address |
| Invite opened by a forwarded email | Wrong account is refused; a new signup under another address is refused the same way |
| Last seat, two invitees accept together | One gets the seat; the other gets `409 NO_SEATS` and the invite stays pending, not consumed |
| Seats reduced below current usage | Existing members stay; new accepts blocked until usage drops |
| Role deleted or tenant suspended before accept | Accept fails with `410`; nothing created |
| Link prefetched by an email scanner (GET) | GET only shows the page; consuming needs a POST by the signed-in user |
| 100×: 20,000 pending invites in a tenant | Index on `(TenantId, Status)` and `TokenHash`; list is paginated; expiry job in batches |
| Twice / parallel: accept clicked twice or in two tabs | One conditional update wins; the second returns the already-accepted result, one membership (unique `(TenantId, UserId)`) |

## Example — Standard, Bun + Hono + Drizzle

```ts
export const HashToken = (Token: string) => createHash("sha256").update(Token).digest("hex")

export async function CreateInvitation(Tenant: TTenant, Inviter: TUser, Email: string, Role: TRole) {
  const Token = randomBytes(32).toString("base64url")
  const Normalized = Email.trim().toLowerCase()
  await db.transaction(async (Tx) => {
    await Tx.update(Invitations).set({ Status: "Revoked" })
      .where(and(eq(Invitations.TenantId, Tenant.Id), eq(Invitations.Email, Normalized), eq(Invitations.Status, "Pending")))
    await Tx.insert(Invitations).values({
      TenantId: Tenant.Id, Email: Normalized, Role, InvitedBy: Inviter.Id,
      TokenHash: HashToken(Token), ExpiresAt: new Date(Date.now() + 7 * 86_400_000), Status: "Pending",
    })
  })
  await Enqueue("SendInvite", { TenantId: Tenant.Id, Email: Normalized, Token })
}

export async function AcceptInvitation(User: TUser, Token: string) {
  return db.transaction(async (Tx) => {
    const [Invite] = await Tx.update(Invitations).set({ Status: "Accepted", AcceptedAt: new Date() })
      .where(and(eq(Invitations.TokenHash, HashToken(Token)), eq(Invitations.Status, "Pending"), gt(Invitations.ExpiresAt, new Date())))
      .returning()
    if (!Invite) throw new AppError("INVITE_INVALID", 410)
    if (!User.EmailVerified || User.Email.toLowerCase() !== Invite.Email) throw new AppError("INVITE_EMAIL_MISMATCH", 403)
    const Taken = await Tx.execute<{ Id: string }>(sql`
      UPDATE "Tenants" SET "SeatsUsed" = "SeatsUsed" + 1
      WHERE "Id" = ${Invite.TenantId} AND "SeatsUsed" < "SeatLimit" RETURNING "Id"`)
    if (!Taken.length) throw new AppError("NO_SEATS", 409)
    await Tx.insert(Memberships).values({ TenantId: Invite.TenantId, UserId: User.Id, Role: Invite.Role }).onConflictDoNothing()
    return Invite
  })
}
```

The seat counter is incremented by a conditional update in the same transaction as the accept; a throw rolls the invite back to `Pending`. If seats count pending invites too, increment on create and release on revoke or expiry instead. A mismatch also rolls back, so a wrong account never burns the token.

Other stacks: Prisma `updateMany` with the status and expiry conditions, check `count`; Laravel `Invitation::where(...)->update(...)` and check affected rows.

## Verify

- [ ] `[M]` The database holds only token hashes; using a used, revoked, expired or unknown token returns the same `410`.
- [ ] `[M]` Posting a `Role` in the accept body changes nothing; the invite's role is applied.
- [ ] `[M]` Accepting with a different verified email returns 403 and the invite is still pending.
- [ ] `[S]` 10 parallel accepts for 1 free seat produce exactly 1 membership.
- [ ] `[S]` After re-invite, the old link fails and the new one works.

## Pitfalls

- **Role in the invite URL or query** → anyone edits it → read it from the row.
- **Consuming the token on GET** → mail scanners burn it → consume on POST.
- **Seat check then insert** → oversell under parallel accepts → conditional update.
- **Different "invalid" messages per state** → reveals which tokens existed → one message.

## Related

`backend/auth/rbac.md` · `backend/data/multi-tenancy.md` · `backend/data/concurrency.md` · `backend/reliability/rate-limit.md` · `backend/data/audit-log.md` · `backend/auth/sessions.md`

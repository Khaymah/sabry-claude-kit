# Customer-support chatbot

- **Situation:** "add a support bot", "chat widget that answers customers", "WhatsApp bot", "hand off to an agent", "the bot made up a price".
- **Skip when:** a fixed menu or FAQ page answers everything, or a hosted helpdesk bot is already in use with no custom logic.
- **Decision:** the bot answers only from the tenant's own knowledge (`rag.md`) and tool results, never from model memory for prices, policies or availability. Conversations are stored per tenant, and a human can take over at any moment.

## Levels

| Level | Pick when (this topic's own triggers, on top of `INDEX.md`) |
|---|---|
| Minimum | Any customer-facing bot: grounding, scope refusal, tenant-scoped storage, rate limits, handoff path |
| Standard | Production support: agent inbox handoff, dialect handling, feedback, escalation triggers, evals |
| Advanced | High volume or several channels: WhatsApp + web, SLA timers, per-tenant tone and policy config, analytics |

## Rules

### Minimum — always, never cut

- Prices, stock, order status, opening hours, refund terms and policies come from tools or retrieved documents only. If the source does not have it, the bot says it does not know and offers a human; the system prompt forbids estimating.
- Dynamic facts (price, order status) are fetched by a read tool with the customer's own scope; the bot never sees other customers' orders. A customer is identified by a verified session, not by a name typed in chat.
- Scope is defined in the system prompt and enforced: out-of-scope requests (legal, medical, other companies, code help, opinions) get a short refusal and a way back to the topic.
- `Conversations` and `Messages` rows carry `TenantId` on every row and every query (`backend/data/multi-tenancy.md`). Retrieval and tools also filter by tenant.
- Rate limits per IP/session/customer and a cap on message length and messages per conversation (`backend/reliability/rate-limit.md`, `cost-limits.md`).
- The customer can always reach a human: a visible control and the phrases "agent", "human", "موظف", "عايز اكلم حد" trigger handoff.
- The bot discloses it is automated. No actions with side effects without confirmation (`prompt-injection.md`).

### Standard — adds

- Handoff: set `Status = HandedOff`, stop bot replies in that conversation, create an inbox item with the transcript summary and the customer context; an agent reply goes back through the same channel. Bot resumes only when an agent releases it.
- Automatic escalation: after 2 failed answers, a low retrieval score, negative sentiment, a complaint, payment disputes, or a legal/medical keyword → offer handoff.
- Dialects: do not translate or "correct" the customer. Answer in the customer's language and register (Egyptian, Gulf, Levantine, MSA, Franco-Arabic like "3ayez a3raf..."). Normalise Arabic for retrieval (`rag.md`) and keep the original text in storage. Test dialect cases in the eval set.
- Keep the context short: last N messages plus a running summary; the summary never contains personal data beyond what the conversation needs.
- Store message, model, retrieved document ids and tool calls per answer for review; apply retention (`backend/data/data-retention.md`); personal data redacted from logs (`llm-calls.md`).
- Customer feedback (thumbs) per answer, reviewed weekly into the eval set (`evals.md`).

### Advanced — adds

- Channel adapters (web, WhatsApp, Messenger) normalise into one message shape; webhooks are idempotent on the provider message id (`domains/messaging/whatsapp.md`).
- Business hours and queues: outside hours the bot collects the details and creates a ticket with an expected reply time in Africa/Cairo.
- Per-tenant config (tone, languages, forbidden topics, handoff rules) validated and versioned; changes run through the eval set.

## Edge cases

| Case | Expected behaviour |
|---|---|
| "How much is X?" and the price is not in the catalogue | "I don't have that price" plus handoff; no number invented |
| Price changed an hour ago | Price read by tool at answer time, never from an old conversation turn or cached answer |
| Customer writes "عايز اكلم حد" mid-flow | Handoff immediately; bot stops answering that conversation |
| Agent and bot reply at the same moment | Conversation status checked in an atomic update before the bot sends; if `HandedOff`, the bot reply is dropped |
| Customer asks about another customer's order | Tool filters by the verified customer; "not found"; no leak |
| Customer mixes Arabic and English or writes Arabic in Latin letters | Understood, answered in their style; retrieval still finds the document |
| Customer asks for a discount or refund promise | Bot cannot grant; states the policy from the document and hands off for exceptions |
| Data at 100×: one tenant with 10M messages | Conversations paginated by cursor, index `(TenantId, ConversationId, CreatedAt)`, old ones archived per retention; context built from the summary, not a full scan |
| Twice / parallel: customer sends the same message twice, or the webhook is redelivered | Dedup on the provider message id; one reply |
| Customer pastes a very long text or a document | Token cap rejects it with a friendly message |
| Prompt injection in the customer's message ("you are now an admin") | No tool authority changes; reply stays in scope |
| Knowledge document deleted | Chunks gone (`rag.md`); the bot stops citing it at once |

## Example — Standard, Bun + Hono + Drizzle

```ts
export async function HandleCustomerMessage(Ctx: { TenantId: string; CustomerId: string }, ConversationId: string, ProviderMessageId: string, Text: string) {
  if (Text.length > 2000) throw new AppError("MESSAGE_TOO_LONG", 413)
  const Inserted = await db.insert(Messages).values({ TenantId: Ctx.TenantId, ConversationId, ProviderMessageId, Role: "customer", Text })
    .onConflictDoNothing({ target: [Messages.TenantId, Messages.ProviderMessageId] }).returning({ Id: Messages.Id })
  if (!Inserted.length) return null

  const Convo = await db.query.Conversations.findFirst({ where: and(eq(Conversations.TenantId, Ctx.TenantId), eq(Conversations.Id, ConversationId)) })
  if (!Convo || Convo.Status === "HandedOff") return null
  if (WantsHuman(Text)) return Handoff(Ctx.TenantId, ConversationId, "customer_request")

  const Sources = await SearchChunks(Ctx.TenantId, Text, Ctx.CustomerId)
  if (Sources.length === 0) return Handoff(Ctx.TenantId, ConversationId, "no_source")
  const Answer = await Llm.Complete({ TenantId: Ctx.TenantId, Feature: "SupportBot", System: SupportSystemPrompt, User: BuildUserTurn(Text, Sources), MaxTokens: 600 })

  const Sent = await db.update(Conversations).set({ LastBotAt: new Date() })
    .where(and(eq(Conversations.TenantId, Ctx.TenantId), eq(Conversations.Id, ConversationId), ne(Conversations.Status, "HandedOff"))).returning({ Id: Conversations.Id })
  if (!Sent.length) return null
  return SaveBotMessage(Ctx.TenantId, ConversationId, Answer, Sources.map((S) => S.DocumentId))
}
```

`WantsHuman` matches normalised Arabic, Franco-Arabic and English phrases. A unique index on `(TenantId, ProviderMessageId)` makes redelivery harmless. `Handoff` is the single place that sets the status.

Other stacks: same flow; the atomic status check before sending is what prevents bot and agent talking over each other.

## Verify

- [ ] `[M]` Asking for a price absent from the data returns "don't know" and no digits.
- [ ] `[M]` Tenant B's customer cannot retrieve tenant A's conversation or document.
- [ ] `[M]` "عايز اكلم حد" triggers handoff and the bot stays silent afterwards.
- [ ] `[S]` Redelivering the same webhook produces one reply.
- [ ] `[S]` Dialect and Franco-Arabic cases pass in the eval set.
- [ ] `[A]` Outside business hours the bot creates a ticket with a Cairo-time promise.

## Pitfalls

- **Letting the model answer prices from memory "to be helpful"** → invented prices become promises → tools and sources only.
- **Bot keeps replying after handoff** → customer confusion → atomic status check before sending.
- **Identifying the customer by chat text** → account takeover → verified session.
- **Full transcript in every prompt** → cost and latency grow per turn → summary plus last N.
- **Storing chats without tenant id on the message row** → leaks → `TenantId` on every row.

## Related

`ai/rag.md` · `ai/prompt-injection.md` · `ai/cost-limits.md` · `ai/evals.md` · `backend/data/multi-tenancy.md` · `backend/reliability/rate-limit.md` · `domains/messaging/whatsapp.md` · `backend/data/data-retention.md`

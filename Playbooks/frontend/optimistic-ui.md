# Optimistic UI

- **Situation:** "make it instant": like, favourite, toggle, reorder, drag between columns, inline rename, mark as read; also mutations that may be retried (flaky mobile network, double tap).
- **Skip when:** the action is rare or the server answers under about 200 ms; plain pending state is simpler and honest.
- **Decision:** be optimistic only for reversible, low-stake, rarely-failing actions, with snapshot and rollback. Money, stock, permissions, anything the user must trust ("paid", "reserved", "sent") waits for the server. Every retried mutation carries one idempotency key. The project's own mutation helpers win over the defaults below.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Pending state and disabled controls only, no optimism |
| Standard | Toggles, lists and boards with optimistic update, rollback and a retry-safe key |
| Advanced | Offline queue, many rapid edits to one entity, collaborative boards |

## Rules

### Minimum — always, never cut

- Never show success for money, stock, payment, booking, stock transfer, approval, deletion of important records, or sending a message until the server confirms.
- A pending mutation always shows a pending state on the control (disabled plus spinner or `aria-busy`).
- A failure always tells the user in words, never a silent revert.

### Standard — adds

- Pattern in `onMutate`: `cancelQueries` for the affected key, snapshot with `getQueryData`, `setQueryData` the optimistic value, return the snapshot. `onError`: restore the snapshot and show the error. `onSettled`: `invalidateQueries` so the server's truth replaces the guess.
- Roll back only the fields the mutation touched; never restore a whole-list snapshot over newer unrelated changes (patch the entity, not the list).
- Optimistic rows get a temporary id (`crypto.randomUUID()`), shown as "saving" (muted), not clickable for further actions until confirmed; swap to the server id on success.
- One idempotency key per user intent, created when the form opens or the button is first pressed, reused by every automatic retry and every manual retry of that intent. A new intent (user edits the values) gets a new key. The server side: `backend/reliability/idempotency.md`.
- Automatic retries only for idempotent calls (`GET`, `PUT`, or `POST` with a key): max 3, exponential with jitter, none on 4xx. `mutations` default `retry: 0` unless a key is present.
- Rapid repeated toggles on one entity: serialise with `mutationKey` and `scope: { id }` so a second request waits for the first.
- Failure rollback toast says what reverted ("Could not save, restored the previous value") and offers Retry.

### Advanced — adds

- Offline queue: persist pending mutations with their keys; replay in order on reconnect; show the queue count; drop with a message on a permanent 4xx.
- Collaborative boards: server returns the entity `Version`; on `409` refetch and re-apply the user's change if it still makes sense, else show the conflict.
- Reconcile socket echoes: ignore an event whose mutation id equals one in flight.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Like toggled on, request fails | The heart reverts and a short message appears; the counter returns to its previous value |
| Add to cart succeeds locally, stock is gone on the server | The row reverts and shows "out of stock"; the cart total is recomputed from the server response, never from the optimistic one |
| Pay / transfer / refund button | No optimism; button shows progress, result page shows what the server said |
| Network drops after the server committed (timeout, no response) | Retry with the same key returns the original result; the UI never shows "failed" for something that succeeded without checking |
| Optimistic item dragged again before the first save returns | Second move queued behind the first (same `scope.id`), applied in order |
| Server normalises the value (trims, rounds, reorders) | `onSettled` refetch shows the server's version; the UI does not keep the guess |
| Data at 100×: board with 5,000 cards | Patch one entity in the cache, never rewrite the whole list per mutation; invalidate the list lazily |
| Twice / parallel: double tap on "Place order" | One intent, one key; second tap ignored while pending; if both reach the server, the key returns the same order |
| Tab closed with an in-flight optimistic save | `beforeunload` warns while mutations are pending |

## Example — Standard, TanStack Query

```tsx
export function useToggleFavourite(Scope: Scope, Id: string) {
  const Client = useQueryClient()
  const MutationKey = ["Favourite", Id]
  return useMutation({
    mutationKey: MutationKey,
    mutationFn: (Value: boolean) => PutFavourite(Id, Value),
    scope: { id: `Favourite-${Id}` },
    onMutate: async (Value) => {
      const Key = ProductKeys.Detail(Scope, Id)
      await Client.cancelQueries({ queryKey: Key })
      const Previous = Client.getQueryData<Product>(Key)
      Client.setQueryData<Product>(Key, (Old) => (Old ? { ...Old, IsFavourite: Value } : Old))
      return { Previous, Key }
    },
    onError: (_Error, _Vars, Context) => {
      if (Context?.Previous) Client.setQueryData(Context.Key, Context.Previous)
      ShowToast(Messages.FavouriteFailed)
    },
    onSettled: () => (Client.isMutating({ mutationKey: MutationKey }) === 1 ? Client.invalidateQueries({ queryKey: ProductKeys.Detail(Scope, Id) }) : undefined),
  })
}

export function useIdempotencyKey() {
  const Ref = useRef(crypto.randomUUID())
  return { Key: Ref.current, Renew: () => { Ref.current = crypto.randomUUID() } }
}
```

The mutation `scope` is per entity, so edits to different products run in parallel while two edits of one product queue in order. `onSettled` invalidates only when this is the last pending mutation of the entity (`isMutating === 1`), so a refetch never overwrites a newer optimistic value and flickers. The caller sends `Key` in the `Idempotency-Key` header and calls `Renew` only after success or when the user changes the values.

Other stacks: SWR `mutate` with `optimisticData` and `rollbackOnError` follows the same rules.

## Verify

- [ ] `[M]` No optimistic code on payment, stock, refund, transfer, approval paths (grep `onMutate` there).
- [ ] `[S]` Block the endpoint in devtools: the UI reverts and the message appears.
- [ ] `[S]` Cut the connection after the request leaves, retry: one record on the server.
- [ ] `[S]` Ten rapid toggles end on the last value with no flicker back.
- [ ] `[A]` Go offline, edit, reconnect: queued edits apply once, in order.

## Pitfalls

- **Optimistic payment status** → user leaves believing it is paid → wait for the server.
- **New idempotency key on every retry** → duplicate orders → key per intent.
- **Restoring a whole-list snapshot** → wipes newer changes → patch the entity.
- **No `cancelQueries`** → an in-flight refetch overwrites the optimistic value → cancel first.
- **Keeping the guess after success** → UI differs from server → invalidate on settle.

## Related

`frontend/data-fetching.md` · `frontend/forms.md` · `backend/reliability/idempotency.md` · `backend/data/concurrency.md` · `backend/data/money.md`

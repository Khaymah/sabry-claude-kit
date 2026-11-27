# Data fetching

- **Situation:** loading and refreshing server data in Next.js screens: query keys, refresh after save, user switching company or branch, slow or out-of-order responses, "should this be a server component".
- **Skip when:** a static page whose data never changes per user.
- **Decision:** server components fetch the first render of read-only pages; TanStack Query owns everything interactive on the client. Every query key starts with the tenant and the user, so a switch can never show another scope's cache. The project's existing data layer and key conventions win over the defaults below.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Few screens, one company per user |
| Standard | Multi-company or multi-branch users, lists with filters, production |
| Advanced | Realtime updates, heavy dashboards, offline tolerance |

## Rules

### Minimum — always, never cut

- Query keys are arrays built by one key factory per feature, never string literals in components.
- Every key contains every variable the `queryFn` reads (filters, page, id). A variable missing from the key means stale or wrong data.
- Never copy server data into `useState`/`useEffect`. Read it from the query; derive the rest.
- Never put tokens, secrets or other users' data in a key or in `localStorage` cache.
- Errors are never swallowed: a failed query shows the error state (`four-states.md`).

### Standard — adds

- Key prefix: `[CompanyId, BranchId, UserId, Feature, …]`. The scope comes from one hook (`useScope`), not from props.
- On company, branch or user switch: `QueryClient.removeQueries()` for the old scope (not just invalidate), then navigate. Cancel in-flight requests first (`cancelQueries`) so a late response cannot land.
- After a mutation, invalidate by prefix of what it can affect: `invalidateQueries({ queryKey: Keys.Orders.All(Scope) })`. Prefer invalidation to hand-patching the cache, except in `optimistic-ui.md` cases.
- Pass `signal` from `queryFn` to `fetch` so superseded requests abort.
- Out-of-order responses: with the key containing the filters TanStack ignores late arrivals for an old key; for non-query calls (search-as-you-type) keep a request counter or `AbortController` and drop results whose counter is stale. Debounce typing at 300 ms.
- Set `staleTime` per data kind: reference lists 5 minutes, balances and stock `0`. Never disable `refetchOnWindowFocus` globally to hide a staleness bug.
- Server components: fetch with the user's cookie on the server, pass the result as `initialData` / hydrate with `HydrationBoundary` so the client does not refetch at once. Mark per-user pages `dynamic = "force-dynamic"`; never cache a per-user fetch with `fetch` default caching or `use cache` without the scope in the key.
- Mutations that send data use `useMutation`, not `useQuery`, and never fire in `useEffect`.

### Advanced — adds

- Realtime: a socket or SSE event calls `invalidateQueries` for its prefix; never writes payloads straight into the cache unless the payload is the full entity.
- Persisted cache (offline) is keyed by scope and user, cleared on logout, and never holds money or personal data.
- Prefetch the next page and hover targets; cap with `gcTime` so memory stays bounded.

## Edge cases

| Case | Expected behaviour |
|---|---|
| User switches company while a list request is in flight | Old request cancelled, old scope removed from cache, new key fetched; the old response never renders |
| Same user, two tabs, switches company in one | The other tab detects the scope change (storage event) and reloads; never shows mixed scope |
| Responses arrive out of order (page 2 before page 1, or slow filter A after fast filter B) | The screen shows the response for the current key only |
| Mutation succeeds but invalidation fetch fails | Stale data stays visible with a "refresh failed, retry" notice; not a blank screen |
| 401 mid-session | One refresh attempt for all parallel queries (`auth-ui.md`), then a single redirect |
| Data at 100×: list grows to 100k rows | Never `getAll` to the client; server pagination (`tables-large-data.md`); keys carry page and filters; `gcTime` bounds the cache |
| Twice / parallel: same component mounted twice, same key | One request (deduped); both get the same data |
| Server component and client both fetch the same list | One owns it: server passes `initialData`; no double fetch on mount |
| User A logs out, user B logs in on the same browser | `queryClient.clear()` on logout; keys contain `UserId` as a second guard |

## Example — Standard, Next.js + TanStack Query

```tsx
export const OrderKeys = {
  All: (Scope: Scope) => [Scope.CompanyId, Scope.BranchId, Scope.UserId, "Orders"] as const,
  List: (Scope: Scope, Filters: OrderFilters) => [...OrderKeys.All(Scope), "List", Filters] as const,
  Detail: (Scope: Scope, Id: string) => [...OrderKeys.All(Scope), "Detail", Id] as const,
}

export function useOrders(Filters: OrderFilters) {
  const Scope = useScope()
  return useQuery({
    queryKey: OrderKeys.List(Scope, Filters),
    queryFn: ({ signal }) => GetOrders(Filters, signal),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  })
}

export function useCancelOrder() {
  const Scope = useScope()
  const Client = useQueryClient()
  return useMutation({
    mutationFn: PostCancelOrder,
    onSuccess: () => Client.invalidateQueries({ queryKey: OrderKeys.All(Scope) }),
  })
}

export function useSwitchBranch() {
  const Client = useQueryClient()
  const Router = useRouter()
  return async (BranchId: string) => {
    await Client.cancelQueries()
    Client.removeQueries()
    await PostSwitchBranch(BranchId)
    Router.refresh()
  }
}
```

`placeholderData: keepPreviousData` keeps the previous page on screen while the next loads; never use it across a scope switch (the switch removes the cache first).

Other stacks: SWR key arrays follow the same rule; RTK Query uses tags per scope.

## Verify

- [ ] `[M]` Grep: no `useQuery` with a string-literal key; every `queryFn` variable appears in its key.
- [ ] `[S]` Switch branch while the list loads: no row of the old branch ever appears.
- [ ] `[S]` Throttle the network, change filters quickly: the screen ends on the last filter's data.
- [ ] `[S]` Log out and in as another user: no cached row of the first user is visible.
- [ ] `[A]` Kill the socket: the screen degrades to polling or a stale notice.

## Pitfalls

- **Key without `CompanyId`** → company B sees company A's cached list for a second → scope prefix.
- **`invalidateQueries()` with no key** → refetches everything, hammers the API → prefix of the affected feature.
- **Data copied to `useState`** → never updates after refetch → read from the query.
- **Server `fetch` cached for all users** → one user's data served to another → `no-store`, scope in the key.
- **`refetchOnWindowFocus: false` as a fix** → hides stale data → fix `staleTime` and invalidation.

## Related

`frontend/optimistic-ui.md` · `frontend/four-states.md` · `frontend/tables-large-data.md` · `frontend/auth-ui.md` · `backend/data/multi-tenancy.md` · `backend/api/pagination.md`

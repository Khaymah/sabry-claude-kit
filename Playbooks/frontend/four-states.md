# Four states

- **Situation:** any list, table, detail page, dashboard card or widget that shows server data.
- **Skip when:** the content is static and compiled into the page.
- **Decision:** every data view has four designed states: Empty, Loading, Error, Success, plus a stale or partial variant. Never a blank area, never an eternal spinner, never an error that says only "Something went wrong". The project's own state components win over the defaults below.

## Levels

| Level | Pick when |
|---|---|
| Minimum | All four states exist and are distinct |
| Standard | Skeletons, retry, partial failure per widget, useful empty states, error boundaries |
| Advanced | Offline and degraded modes, per-widget SLAs, error reporting with context |

## Rules

### Minimum — always, never cut

- Derive the state from the query, in this order: `isPending` then Loading; `isError` then Error; empty array then Empty; else Success. Never test `Data.length === 0` before `isPending` (shows "No data" while loading).
- Empty means the request succeeded with nothing. Error means it did not. Never show one for the other; "No orders" on a failed request is a lie.
- Error state shows a human message, and a Retry button that refetches only that view.
- Loading never blocks forever: after about 10 s show "taking longer than usual" with Retry; abort at the client timeout and move to Error.
- Never show stale zeros or an empty table while the first load is in flight.

### Standard — adds

- Loading: skeletons that match the final layout for content (lists, cards, tables), spinners only for small actions inside buttons or for under-a-second inline waits. Show a skeleton only after 200 ms to avoid flashes. Reserve the final height to avoid layout shift. Skeletons are `aria-hidden`; the region has `aria-busy="true"` (`accessibility.md`).
- Empty has three variants with different copy and action: first-use ("No customers yet", with the create button), filtered ("No results for these filters", with Clear filters), and no-permission (explains and points to the owner, never hides the whole page).
- Error message by cause from the API error code: offline, timeout, 403 (no access), 404 (not found or deleted), 5xx (our fault, with a request id to quote). Never print raw stack traces or SQL.
- Refetch failure with data on screen: keep the data, show a banner "Could not refresh, showing data from 10:42" with Retry. Never replace good data with an error page.
- Partial failure: each widget has its own state and its own error boundary; one failed card does not blank the dashboard. A page built from several queries renders what it has.
- Route-level `error.tsx` and `not-found.tsx` and a `loading.tsx` per heavy segment in the App Router; a `global-error.tsx` as last resort with a reload button.
- Mutations: pending on the control, success confirmation, failure message with the reason and Retry (`optimistic-ui.md`).
- After deleting the last item the view moves to Empty without a reload.

### Advanced — adds

- Offline: detect `navigator.onLine` and query `networkMode`, show an offline banner, keep cached views readable, queue safe mutations.
- Report errors to the monitoring tool with route, scope id (never personal data) and request id.
- Define per-widget fallbacks (cached summary, "data delayed") for non-critical cards.

## Edge cases

| Case | Expected behaviour |
|---|---|
| First load succeeds with zero rows | Empty (first-use) with the call to action |
| Filter returns zero rows | Empty (filtered) with Clear filters; filters stay visible |
| Request returns 403 | "You do not have access" with who to ask; not Empty, not a blank page |
| Request fails after data was already shown | Data stays, banner shows the failure and the age of the data |
| One of six dashboard cards fails | Five render; the sixth shows its own error with Retry |
| Slow network, response in 150 ms | No skeleton flash |
| Data at 100×: list becomes huge | Still Loading then Success with a page, not an endless skeleton; the empty and error states do not depend on the size |
| Twice / parallel: user clicks Retry repeatedly | One refetch in flight; the button is disabled while it runs |
| Response success but a required field is missing (schema drift) | Zod parse fails, state is Error with a request id, never a crash on `undefined.map` |
| Stale tab reopened after hours | Refetch on focus; Success is shown with the old data only until the refetch settles, with the stale notice if it fails |

## Example — Standard, Next.js + TanStack Query

```tsx
export function DataView<T>({ Query, IsEmpty, Skeleton, Empty, Children }: DataViewProps<T>) {
  if (Query.isPending) return <div aria-busy="true"><Skeleton /></div>
  if (Query.isError && !Query.data) return <ErrorState Error={Query.error} OnRetry={() => Query.refetch()} Retrying={Query.isFetching} />
  if (IsEmpty(Query.data as T)) return <>{Empty}</>
  return (
    <>
      {Query.isError && <StaleBanner UpdatedAt={Query.dataUpdatedAt} OnRetry={() => Query.refetch()} />}
      {Children(Query.data as T)}
    </>
  )
}

export function ErrorState({ Error, OnRetry, Retrying }: ErrorStateProps) {
  const Message = ErrorMessages[Error.Code] ?? ErrorMessages.Unknown
  return (
    <div role="alert">
      <p>{Message}</p>
      {Error.RequestId && <p dir="ltr">{Error.RequestId}</p>}
      <button onClick={OnRetry} disabled={Retrying}>{Labels.Retry}</button>
    </div>
  )
}
```

Usage wraps each widget in its own `DataView` and an `ErrorBoundary`. Other stacks: Suspense with `useSuspenseQuery` and a boundary per widget gives the same split.

## Verify

- [ ] `[M]` Block the endpoint: the view shows Error with Retry, not "No data".
- [ ] `[M]` Return `[]`: the view shows Empty, not Error.
- [ ] `[S]` Throttle to slow 3G: a skeleton with the final layout, no layout jump on load.
- [ ] `[S]` Fail one dashboard widget: the others stay usable.
- [ ] `[S]` Fail a refetch with data present: data remains with the stale banner.
- [ ] `[A]` Offline: cached views readable and the offline banner visible.

## Pitfalls

- **`Data?.length === 0` before `isPending`** → "No orders" flashes on every load → check pending first.
- **One spinner for the whole page** → one slow widget blocks everything → per-widget state.
- **Swallowing the error and showing empty** → user thinks data is gone → Error state.
- **Replacing data with an error page on refetch fail** → loses work context → stale banner.
- **Skeleton shaped differently than content** → layout shift → match the layout.

## Related

`frontend/data-fetching.md` · `frontend/accessibility.md` · `frontend/optimistic-ui.md` · `frontend/tables-large-data.md` · `backend/api/error-format.md`

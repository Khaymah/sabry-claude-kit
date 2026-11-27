# Tables and large data

- **Situation:** admin tables, order or invoice lists, reports, "thousands of rows", filters and sorting, export to Excel or CSV, long dropdowns.
- **Skip when:** the list is bounded and small by nature (under about 100 rows, for example a user's own payment methods).
- **Decision:** the server paginates, sorts and filters; the URL holds the table state; the client renders only what is on screen; export is a backend job the user downloads, never built in the browser. The API's pagination shape (`backend/api/pagination.md`) and the project's table component win over the defaults below.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Server pagination with a hard page cap |
| Standard | Sort, filter and page in the URL, row actions, export job, long lists virtualised |
| Advanced | Saved views, column customisation, selection across pages, bulk actions on filtered sets |

## Rules

### Minimum — always, never cut

- Never fetch "all rows" to filter, sort or count in the browser. Page size is a fixed set (`20`, `50`, `100`); the server rejects more.
- Sort keys and filter fields come from an allow-list shared with the API; never send a raw column name typed by the user.
- Every table has the four states (`four-states.md`) and a visible total or "more" indicator.
- Row actions that change data are mutations with confirmation for destructive ones, never links that `GET` and mutate.

### Standard — adds

- State lives in the URL search params: `?Page=2&Size=50&Sort=CreatedAt:desc&Status=Paid&Q=ahmed`. Parse and validate with a Zod schema; invalid values fall back to defaults. Reload, back button and shared links restore the exact view.
- Any filter, sort or page-size change resets `Page` to 1. Debounce free-text search 300 ms and update the URL with `replace`, not `push`.
- The query key contains the parsed params (`data-fetching.md`); `placeholderData` keeps the old rows dimmed while the next page loads, only when the scope (company, branch) is unchanged (`data-fetching.md`).
- Prefer cursor pagination for feeds and anything that grows while viewed; use offset only when users need "jump to page N" (`backend/api/pagination.md`). With cursor, no page numbers: show Next and Previous.
- Virtualise any list that can render more than ~100 DOM rows at once (`@tanstack/react-virtual`): fixed or measured row height, `overscan` 5. Keep keyboard and screen reader behaviour: `role="table"` semantics or `aria-rowcount`, `aria-rowindex`.
- Long selects and comboboxes load options from the server as the user types, 20 at a time; never preload 10,000 options.
- Export: a button that creates a backend job with the current filters (never the visible rows), shows progress, and offers a download link when ready (`backend/files/import-export.md`, `backend/reliability/background-jobs.md`). The filter snapshot is stored with the job so the file matches what the user saw.
- Totals and counts come from the server for the whole filtered set; footer sums of "this page only" are labelled as such.
- Dates in filters are sent as the user's local day boundaries in `Africa/Cairo` (or the tenant's/user's configured zone) converted per `backend/data/time-zones.md`, not midnight UTC.

### Advanced — adds

- "Select all" means all rows matching the filter: send the filter plus an exclusion list to a bulk endpoint (`backend/data/batch-edits.md`), never 50,000 ids.
- Saved views store the validated param object per user and scope.
- Column visibility and widths persist per user; RTL reverses column order automatically (`rtl-i18n.md`); never hard-code left or right.

## Edge cases

| Case | Expected behaviour |
|---|---|
| User on page 9, then applies a filter with 2 pages of results | `Page` resets to 1; never an empty "page 9 of 2" |
| Last row of the last page is deleted | Refetch lands on the previous page when the current one becomes empty |
| New rows arrive while the user pages with offset | Duplicates or skips are possible; cursor pagination or a "new rows available" refresh prompt |
| URL has `Size=100000` or `Sort=Password` | Zod falls back to defaults; the server also rejects (400) |
| Search term with Arabic variants (`أ`, `ا`, `ة`, `ه`, diacritics) | The server normalises (`backend/data/search.md`); the client sends the raw text |
| Filter by date range crossing midnight Cairo | Boundaries computed in `Africa/Cairo`; rows near 00:00 land on the correct day |
| Data at 100×: 5 million rows | Pages stay at 50 rows; count may be an estimate ("about 5M") and skipped on huge tables; filters hit indexed columns; virtualisation if one page can exceed 100 rows |
| Twice / parallel: export clicked twice | One job per filter snapshot while one is running; the second click shows the existing job |
| Export of 1 million rows | A job writes a streamed file server-side; the browser only downloads the finished file |
| Selection then page change | Selection survives by id across pages, or is cleared with a visible message; never silently half-kept |

## Example — Standard, Next.js

```tsx
export const TableParamsSchema = z.object({
  Page: z.coerce.number().int().min(1).catch(1),
  Size: z.coerce.number().refine((V) => [20, 50, 100].includes(V)).catch(50),
  Sort: z.enum(["CreatedAt:desc", "CreatedAt:asc", "TotalMinor:desc", "TotalMinor:asc"]).catch("CreatedAt:desc"),
  Status: z.enum(["Paid", "Pending", "Cancelled"]).optional().catch(undefined),
  Q: z.string().trim().max(100).optional().catch(undefined),
})

export function useTableParams() {
  const Search = useSearchParams()
  const Router = useRouter()
  const Pathname = usePathname()
  const Params = TableParamsSchema.parse(Object.fromEntries(Search))
  const Update = (Patch: Partial<z.infer<typeof TableParamsSchema>>, Replace = false) => {
    const Next = new URLSearchParams(Search)
    for (const [K, V] of Object.entries(Patch)) V === undefined ? Next.delete(K) : Next.set(K, String(V))
    if (!("Page" in Patch)) Next.set("Page", "1")
    Replace ? Router.replace(`${Pathname}?${Next}`) : Router.push(`${Pathname}?${Next}`)
  }
  return { Params, Update }
}

export function ExportButton({ Params }: { Params: TableParams }) {
  const Start = useMutation({ mutationFn: () => PostExportJob(Params) })
  return <button onClick={() => !Start.isPending && Start.mutate()} disabled={Start.isPending}>{Labels.Export}</button>
}
```

`Update` with a `Page` patch keeps that page; every other patch resets to 1. The export posts the parsed params, not the rows.

Other stacks: TanStack Table with `manualPagination`, `manualSorting`, `manualFiltering` follows the same rules.

## Verify

- [ ] `[M]` The network tab shows a request per page, never the full set; `Size=1000` is rejected.
- [ ] `[S]` Copy the URL into another browser: same page, sort and filter.
- [ ] `[S]` Changing a filter on page 5 lands on page 1.
- [ ] `[S]` A list of 10,000 items keeps under ~100 DOM rows while scrolling.
- [ ] `[S]` Export with a filter produces a file matching the on-screen count.
- [ ] `[A]` "Select all" over a 50,000-row filter sends one bulk request.

## Pitfalls

- **Table state in `useState`** → refresh loses the view, links cannot be shared → URL params.
- **Client-side sort of one page** → wrong order across pages → server sort.
- **Building the Excel file in the browser** → freezes the tab, wrong at scale, leaks hidden columns → backend job.
- **Page reset forgotten** → empty table after filtering → reset `Page`.
- **`push` on every keystroke** → back button replays typing → `replace` for search.

## Related

`frontend/data-fetching.md` · `frontend/four-states.md` · `frontend/rtl-i18n.md` · `backend/api/pagination.md` · `backend/files/import-export.md` · `backend/reliability/background-jobs.md` · `backend/data/time-zones.md`

# CSV / Excel import and export

- **Situation:** "upload products from Excel", importing customers or prices, bulk updates from a sheet, exporting orders or reports to CSV or Excel, Arabic text in Excel.
- **Skip when:** fewer than ~20 records, where a form is simpler.
- **Decision:** imports are a job with three steps (upload → validate and preview → apply), parsed as a stream, validated row by row with the same Zod schemas as the API, applied as chunked upserts on a natural key, with a downloadable error report. Exports stream CSV (UTF-8 with BOM) for large data and run as jobs when heavy; every cell is protected against formula injection.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Small CSV files (< 5k rows), synchronous validate + apply |
| Standard | Production: background job, preview, error report, Excel support |
| Advanced | 100k+ rows, recurring imports, column mapping UI, partial rollback |

## Rules

### Minimum — always, never cut

- Row schema = the API's create schema (plus column-name mapping), so imports can't bypass validation.
- Every row validated before anything is written; errors reported as `{ Row, Column, Code }` with the spreadsheet's row number (header = 1).
- Writes are upserts on a natural key (`Sku`, `Email`), so re-importing the same file changes nothing.
- Export cells starting with `=`, `+`, `-`, `@`, tab or carriage return are prefixed with `'` (CSV/formula injection).
- CSV exports are UTF-8 with a BOM (`﻿`) so Excel shows Arabic correctly.

### Standard — adds

- Import flow: upload file (`backend/files/uploads.md`) → job parses and validates (streaming: `csv-parse`, `exceljs` streaming reader) → preview shows counts (create, update, unchanged, errors) and the first errors → user confirms → job applies in chunks of 1,000 (`quality/performance/round-trips.md`) → summary and error report (CSV) downloadable.
- Normalisation at parse: trim, Arabic-Indic digits → ASCII, `٫` / `,` decimal separators per declared locale, dates in a declared format (never guessed), phone numbers to E.164.
- Limits: max file size and max rows per import from `SystemSettings`.
- One import at a time per tenant and type (`singletonKey`), so two uploads don't interleave.
- Exports larger than a few thousand rows run as jobs and email or notify a download link (private, expiring).

### Advanced — adds

- Column mapping UI saved per tenant; templates downloadable with headers and an example row.
- Imports apply in one transaction per chunk with a import id on every touched row, so an import can be reverted.
- Scheduled imports from SFTP or a provider API with the same pipeline.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Excel saved the CSV as Windows-1256 | Detected (no valid UTF-8) → decoded as cp1256, or the user is asked to save as UTF-8 CSV |
| Duplicate `Sku` inside the same file | Reported as an error on the later row; nothing applied for it |
| Prices like `1,250.50` and `١٢٥٠٫٥٠` | Both parse to 125050 minor units under the declared locale (`backend/data/money.md`) |
| Excel turned a long number into `1.23E+15` or dropped leading zeros | Reported as invalid; the template formats those columns as text |
| A cell starting with `=HYPERLINK(...)` in a customer name | Imported as text; on export prefixed with `'` |
| 100×: a 500k-row file | Streamed parse, chunked upserts, progress updates, memory flat |
| Twice / parallel: the same file uploaded twice at once | `singletonKey` runs one; the natural-key upsert makes the second a no-op anyway |

## Example — Standard, Bun

```ts
const FORMULA_START = /^[=+\-@\t\r]/
export const SafeCell = (Value: string) => (FORMULA_START.test(Value) ? `'${Value}` : Value)
export const CsvCell = (Value: string) => `"${SafeCell(Value).replaceAll('"', '""')}"`

export async function ValidateProductImport(FileId: string) {
  const Errors: TImportError[] = []
  const Valid: TProductRow[] = []
  let Row = 1
  for await (const Record of OpenCsv(FileId).pipe(parse({ columns: true, bom: true, trim: true }))) {
    Row++
    const Parsed = ProductImportRow.safeParse(NormaliseRow(Record))
    if (Parsed.success) Valid.push(Parsed.data)
    else for (const Issue of Parsed.error.issues) Errors.push({ Row, Column: String(Issue.path[0]), Code: Issue.code })
    if (Row > GetSetting("Imports.MaxRows")) throw new AppError("IMPORT_TOO_LARGE", 400)
  }
  return SaveImportPreview(FileId, Valid, Errors)
}
```

`parse` is `csv-parse`'s streaming parser; `SaveImportPreview` stores the valid rows (or a pointer to them) and the counts; `ApplyImport` later upserts them in chunks. For very large files keep only counts and errors in the preview and re-stream the file on apply.

## Verify

- [ ] `[M]` Importing the same file twice leaves the data identical.
- [ ] `[M]` An exported cell `=1+1` opens in Excel as text.
- [ ] `[M]` Arabic text in an exported CSV opens correctly in Excel.
- [ ] `[S]` A file with 3 bad rows shows them with spreadsheet row numbers in the preview and applies nothing until confirmed.
- [ ] `[S]` A 100k-row import keeps process memory flat.
- [ ] `[A]` An import can be reverted by its import id.

## Pitfalls

- **Separate validation for imports** → imported data the API would reject → reuse the API schema.
- **Insert per row** → 100k round trips → chunked upserts.
- **Raw cell values in exports** → formula injection on the admin's machine → `SafeCell`.

## Related

`backend/files/uploads.md` · `quality/performance/memory.md` · `quality/performance/round-trips.md` · `backend/data/money.md`

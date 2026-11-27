# Forms

- **Situation:** any form: create or edit a record, sign-up, checkout, settings, filters that submit. Arabic users typing digits, phones and amounts.
- **Skip when:** a single search box or toggle with no validation and no submit button.
- **Decision:** react-hook-form with `zodResolver`, one Zod schema shared with the API (a package both import), server errors written back onto the fields, one in-flight submit at a time. The client check is a convenience; the server stays the only authority. The project's own form components and schema location win over the defaults below.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Short forms, internal tools, no money |
| Standard | Production forms: server error mapping, Arabic digits, phone and money inputs, unsaved-changes guard |
| Advanced | Multi-step wizards, drafts saved to the server, forms edited by several people |

## Rules

### Minimum — always, never cut

- The schema comes from the shared package. Never retype the rules in the form; a rule that exists only in the browser is not a rule.
- Disable the submit button and ignore the handler while `isSubmitting` is true. A disabled button alone is not enough: Enter in a field and slow devices still fire twice, so the handler also checks.
- Every field has a visible `<label htmlFor>`. A placeholder is never the label.
- Never clear the form on a failed submit. Clear or redirect only after the server confirmed.
- Never put secrets or full card numbers in form state, URL or `localStorage`.

### Standard — adds

- Map the API's field errors with `setError(Field, { type: "server", message })`. An error with no matching field goes to a form-level alert at the top (`role="alert"`) and focus moves to it. Map by the API's field path, including arrays (`Lines.2.Quantity`).
- Normalise before validating, in the schema (`z.preprocess`): Arabic-Indic digits `٠-٩` and `۰-۹` to ASCII, Arabic decimal `٫` to `.`, thousands `٬` removed and `,` removed only as grouping (`1,250`, never `12,50`, which fails validation instead of becoming `1250`), spaces trimmed. Show the user what you understood, not an error.
- Phone: keep `type="tel"`, `inputMode="tel"`, `dir="ltr"`, normalise to E.164 (`+201012345678`) on submit; accept `010…`, `+20 10…`, `0020…`.
- Money: `inputMode="decimal"`, `dir="ltr"`, text not `type="number"` (it drops Arabic digits and scrolls on wheel). Convert once to integer minor units at submit; the API gets integers (`backend/data/money.md`).
- Never `type="number"` for phone, national id, card, postal code or anything with leading zeros.
- Unsaved-changes guard when `formState.isDirty`: `beforeunload` for tab close, and a confirm dialog for in-app navigation. Remove the guard before the post-save redirect.
- Map `409 EDIT_CONFLICT` to a dialog with the other person's values; never overwrite silently.
- Send an `Idempotency-Key` header created once per form open for money-moving or create calls (`optimistic-ui.md`).

### Advanced — adds

- Wizard: validate each step with its own sub-schema, keep one form instance across steps, resume from a server draft.
- Autosave drafts debounced (800 ms) with a `Version`; show "saved" state; a stale draft yields the conflict dialog.
- Dynamic lines (`useFieldArray`): stable `key` from `field.id`, never the index; cap rows at the API's limit.

## Edge cases

| Case | Expected behaviour |
|---|---|
| User types `١٢٣٫٥٠` into an amount | Becomes `123.50`, then `12350` minor units at submit |
| Phone pasted with spaces, dashes, `٠١٠…` | Normalised to `+2010…`; invalid length shows the field error |
| Server returns 422 for a field the form does not render | Form-level alert lists it; never swallowed |
| Server error then user edits that field | The server error clears on change (`clearErrors`), the rest remain |
| Browser autofill fills fields without `onChange` | Read values from the form on submit; do not rely on controlled state alone |
| Offline or request times out | Form stays filled, submit re-enabled, message says nothing was saved; the retry reuses the same idempotency key |
| Old record violates the new schema (empty required field) | Form opens with errors visible; the user is not blocked from fixing it |
| Data at 100×: 500-line invoice form | `useFieldArray` with row-level `memo`, validate on submit not on every key; virtualise rows past ~100 (`tables-large-data.md`) |
| Twice / parallel: Enter pressed then button clicked | One request; the second is ignored by the `isSubmitting` guard; the server dedupes by key |
| Two tabs edit the same record | Second save gets 409 and the conflict dialog |

## Example — Standard, Next.js + react-hook-form + Zod

```tsx
"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
import { CreateCustomerSchema, type CreateCustomerInput } from "@acme/contracts"

export function CustomerForm() {
  const Form = useForm<CreateCustomerInput>({ resolver: zodResolver(CreateCustomerSchema), defaultValues: { Name: "", Phone: "" } })
  const Save = useMutation({
    mutationFn: PostCustomer,
    onError: (Error: ApiError) => {
      for (const Item of Error.Fields ?? []) Form.setError(Item.Path as keyof CreateCustomerInput, { type: "server", message: Item.Message })
      if (!Error.Fields?.length) Form.setError("root", { message: Error.Message })
    },
  })
  const OnSubmit = Form.handleSubmit((Values) => {
    if (Save.isPending) return
    Save.mutate(Values)
  })
  return (
    <form onSubmit={OnSubmit} noValidate>
      {Form.formState.errors.root && <p role="alert">{Form.formState.errors.root.message}</p>}
      <label htmlFor="Phone">{Labels.Phone}</label>
      <input id="Phone" type="tel" inputMode="tel" dir="ltr" aria-invalid={!!Form.formState.errors.Phone} {...Form.register("Phone")} />
      <button type="submit" disabled={Save.isPending}>{Labels.Save}</button>
    </form>
  )
}

export const ArabicToAscii = (Value: string) =>
  Value.replace(/[٠-٩]/g, (D) => String(D.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (D) => String(D.charCodeAt(0) - 0x06f0)).replace(/٫/g, ".").replace(/[٬\s]/g, "").replace(/(?<=\d),(?=\d{3}(?!\d))/g, "")
```

The shared schema applies `z.preprocess(ArabicToAscii, …)` to phone and amount fields. Other stacks: Vue uses vee-validate with the same Zod schema; Angular reactive forms call the same schema in a validator.

## Verify

- [ ] `[M]` Double-click and Enter+click send one request (network tab).
- [ ] `[M]` Every input has a label that is read by a screen reader.
- [ ] `[S]` A 422 with `Phone` puts the message under the phone field and focus on it.
- [ ] `[S]` Typing `٠١٠١٢٣٤٥٦٧٨` and `١٥٠٫٥٠` is accepted and sent as `+201012345678` and `15050`.
- [ ] `[S]` Closing the tab on a dirty form prompts; after save it does not.
- [ ] `[A]` Reload mid-wizard resumes at the same step with the draft.

## Pitfalls

- **Schema copied into the frontend** → drifts from the API → shared package.
- **`type="number"` for money** → Arabic digits dropped, floats parsed → text input plus integer conversion.
- **Reset on error** → user retypes everything → reset only on confirmed success.
- **Guard left on after save** → "leave site?" dialog on the redirect → remove the guard first.
- **Index as `key` in field arrays** → values jump between rows → `field.id`.

## Related

`frontend/optimistic-ui.md` · `frontend/rtl-i18n.md` · `frontend/accessibility.md` · `backend/api/error-format.md` · `backend/data/money.md` · `backend/reliability/idempotency.md`

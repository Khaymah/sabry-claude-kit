# Accessibility

- **Situation:** any screen with forms, modals, menus, tables, toasts, custom controls; a client or tender that asks for WCAG; keyboard-only or screen-reader users.
- **Skip when:** never fully; at least Minimum applies to every UI. Internal prototypes may stop at Minimum.
- **Decision:** target WCAG 2.2 AA with native elements first, ARIA only where no native element exists. Use the project's component library (Radix, shadcn/ui, React Aria) for dialogs, menus and comboboxes instead of hand-rolling focus logic. A client's stricter standard wins.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Every UI: semantics, labels, keyboard, contrast |
| Standard | Production apps: focus management, error announcement, live regions, RTL order |
| Advanced | Public sector, banks, tenders, contractual WCAG: audits, automated plus manual screen reader passes |

## Rules

### Minimum — always, never cut

- Native elements: `<button>` for actions, `<a href>` for navigation, `<label>`, `<table>`, headings in order. Never `<div onClick>`.
- Every input has a programmatic label (`<label htmlFor>` or `aria-label` for icon-only buttons). Placeholder is not a label.
- Everything works with the keyboard alone: Tab order follows the visual order, Enter and Space activate buttons, Escape closes overlays.
- Focus is always visible: never `outline: none` without a replacement (`focus-visible:ring-2`), contrast of the ring at least 3:1.
- Text contrast at least 4.5:1 (3:1 for 18px+ bold or 24px+), UI components and icons 3:1, in light and dark themes. Never convey state by colour alone (error also has an icon and text).
- Images have `alt` (empty `alt=""` for decoration). Touch targets at least 24x24 CSS px, 44x44 for primary mobile actions.
- Set the page `lang`; the document has one `<h1>` and a `<title>` per route.

### Standard — adds

- Modal: opens with `role="dialog"` + `aria-modal="true"` + `aria-labelledby`; focus moves into it (first field or the title); Tab is trapped inside; Escape closes; focus returns to the element that opened it; background is `inert`. A confirmation dialog for destructive actions focuses the safe button (Cancel).
- Form errors: on failed submit move focus to the first invalid field (or the error summary), set `aria-invalid="true"` and `aria-describedby` to the message id; messages are text, not colour. Inline errors do not steal focus while typing.
- Dynamic updates announced: toasts and "saved" messages use `role="status"` (polite), urgent failures `role="alert"`; the live region exists in the DOM before its text changes. Auto-dismissing toasts stay at least 5 s and pause on hover and focus.
- Loading states: `aria-busy="true"` on the region, and a visually hidden "Loading" text (`four-states.md`). Skeletons are `aria-hidden`.
- Skip link "Skip to content" as the first focusable element. Route change moves focus to the new `<h1>` or main region (App Router does not do it for you).
- Menus and tabs follow the ARIA pattern keys (arrows, Home, End); the roving `tabindex` is already handled by the library.
- RTL: Tab order follows the reading direction (right to left), arrow keys in tabs, sliders and carousels follow the visual direction, focus order matches `dir`; verify by tabbing through, never by CSS `order` tricks or positive `tabindex`.
- Tables: `<th scope>`, a `<caption>` or `aria-label`, sortable headers are buttons with `aria-sort`.
- Respect `prefers-reduced-motion` and never flash more than 3 times a second.
- Zoom to 200% and 320 px width must not hide content or force two-direction scrolling; use `rem`, never fixed pixel heights on text containers.

### Advanced — adds

- Automated `axe` in CI on key routes plus a manual pass with NVDA or VoiceOver in Arabic and English for the main flows.
- An accessibility statement and a known-issues list; contrast tokens checked in the design system.
- Captions for video, transcripts for audio, alternative to drag (move buttons) and to gestures.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Modal opened from a menu item, menu then unmounts | Focus returns to a sensible fallback (the menu trigger), never `<body>` |
| Two modals stacked | Focus and trap belong to the top one; Escape closes only it |
| Server error banner appears after submit | Announced once; focus on the first invalid field or the summary, not both |
| Arabic user tabs through a form | Order is right to left, top to bottom; arrow keys in a radio group go to the visually next option |
| Toast appears and vanishes in 3 s | Screen reader user still gets it (live region), and it persists 5 s or more |
| Data at 100×: table of 10,000 virtualised rows | `aria-rowcount` and `aria-rowindex` keep position meaningful; keyboard moves through rows without needing every row in the DOM |
| Twice / parallel: user hits Submit twice with a screen reader | The second activation is ignored; `aria-busy` and a disabled-with-explanation state say why |
| Colour theme switch | Contrast re-checked in both themes; focus ring visible on both |
| Icon-only button (trash, edit) | `aria-label` in the active language, never the file name |

## Example — Standard, Next.js + Radix

```tsx
export function ConfirmDelete({ Open, OnOpenChange, OnConfirm, Pending }: ConfirmDeleteProps) {
  return (
    <AlertDialog.Root open={Open} onOpenChange={OnOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 bg-black/50" />
        <AlertDialog.Content className="fixed inset-x-4 top-1/4 mx-auto max-w-md rounded-lg bg-white p-6">
          <AlertDialog.Title>{Labels.DeleteTitle}</AlertDialog.Title>
          <AlertDialog.Description>{Labels.DeleteBody}</AlertDialog.Description>
          <div className="mt-6 flex gap-3 justify-end">
            <AlertDialog.Cancel className="focus-visible:ring-2">{Labels.Cancel}</AlertDialog.Cancel>
            <AlertDialog.Action onClick={OnConfirm} disabled={Pending} aria-busy={Pending} className="focus-visible:ring-2">{Labels.Delete}</AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}

export function FieldError({ Id, Message }: { Id: string; Message?: string }) {
  return <p id={Id} role="alert" className="text-sm text-red-700">{Message}</p>
}

export function FocusFirstError(Form: UseFormReturn<FieldValues>) {
  const Name = Object.keys(Form.formState.errors)[0]
  if (Name) Form.setFocus(Name)
}
```

Radix `AlertDialog` provides the trap, `inert` background, Escape and focus return; `Cancel` receives initial focus. Other stacks: React Aria, Headless UI, native `<dialog>` with `showModal()` give the same behaviour.

## Verify

- [ ] `[M]` Unplug the mouse: every flow completes with Tab, Enter, Space, Escape.
- [ ] `[M]` Lighthouse or `axe` reports no contrast, label or name violations on the main routes.
- [ ] `[S]` Open and close a modal: focus enters, stays trapped, returns to the trigger.
- [ ] `[S]` Submit an invalid form with a screen reader: it reads the first error and its field.
- [ ] `[S]` In Arabic, Tab order matches right-to-left reading.
- [ ] `[A]` NVDA or VoiceOver completes the main flow in both languages.

## Pitfalls

- **`outline: none`** → keyboard users lose their place → `focus-visible` ring.
- **Hand-built modal** → focus escapes behind it → library dialog.
- **Placeholder as label** → disappears while typing, unread by many readers → real label.
- **`tabindex="3"`** → breaks the natural order → fix DOM order.
- **Toast rendered with the text already present** → not announced → mount the live region first.

## Related

`frontend/forms.md` · `frontend/four-states.md` · `frontend/rtl-i18n.md` · `frontend/tables-large-data.md`

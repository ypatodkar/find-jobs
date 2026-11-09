# Find Jobs: design system

The pages are built from shadcn/ui components (Radix primitives, style `radix-vega`,
neutral palette) and Tailwind CSS v4. This file is the contract for anyone changing the
UI: what the pages look like, which component to reach for, and which hooks other
code depends on. The design doc behind it:
https://claude.ai/artifact/JrkT6vZ6c1tW1jYej8EYTa

## Where things live

| Path | What |
| --- | --- |
| `src/components/ui/` | shadcn components, added with `npx shadcn@4.23.0 add <name>`. Treat as vendored: compose them, pass `className`, don't fork their styles. |
| `src/components/` | the site's own components, built from `ui/`. |
| `src/lib/` | logic: filters, URL state, saved items, auth, matching, country. No JSX styling decisions here. |
| `src/styles/app.css` | the only global stylesheet: Tailwind, the theme tokens, fonts. |
| `src/styles/*.css` | a few small files for HTML we don't write (job descriptions) or DOM that `lib/` code creates (resume-match marks). Imported by the component that needs them. |

`@/` is `src/`. Components import `cn` from `cn` (or `@/lib/utils`), icons from
`lucide-react`.

## Look

- **Palette:** shadcn neutral. Use the semantic tokens only: `bg-background`, `bg-card`,
  `bg-muted`, `text-foreground`, `text-muted-foreground`, `border`, `ring`, `primary`,
  `destructive`. Never a raw colour (`text-zinc-500`, `#fff`, `violet-600`).
- **Brand:** one extra token, `brand` (violet), for the **selected job** in the list
  and, sparingly, the one state that must stand out beside it (the active country in
  the switcher). Not for buttons, links or focus rings.
- **Status:** `success` (green) and `warning` (amber), for resume-match results only
  (a requirement shown, partly shown). Everything else stays neutral.
- **Dark mode:** automatic through the tokens. `<html data-theme>` always holds
  `light` or `dark`; the `dark:` variant keys off it. Reach for `dark:` only when a
  token can't express it.
- **Type:** Geist Sans everywhere (`font-sans`, the default).
  - `text-sm` (14 px): controls, list metadata, secondary text.
  - `text-[15px] font-medium`: a job title in the list.
  - `text-xl font-semibold`: the job title in the detail pane.
  - `text-2xl font-semibold tracking-tight`: page titles on Investors and About.
  - Counts beside counts: add the `tabular` class (tabular figures).
- **Radius and borders:** shadcn's defaults (`rounded-md` controls, `rounded-lg` /
  `rounded-xl` cards). 1 px borders. Shadows only on overlays (menus, sheets, dialogs),
  which shadcn already gives them.
- **Icons:** lucide-react, `size-4` beside text (the default in `Button`), `size-3.5` in
  dense rows. Every icon-only button has an `aria-label` and a `Tooltip`.
- **Spacing:** Tailwind's scale. Page gutters come from `CONTAINER` in
  `src/lib/layout.js` (`max-w-[1600px] px-4 md:px-6`); the header, toolbar, content
  and footer all use it so their edges line up.

## Page frame

```
SiteHeader     sticky top-0, h-14 (--header-height), z-40, border-b, bg-background/95 + backdrop blur
  logo · country switcher · Jobs / Investors / About ......... Feedback · theme · account
Filter toolbar sticky below the header on desktop (top: --header-height), z-30, bg-background, border-b
  search · Role · Location · Experience · Career stage · More filters · View
Results        two columns from 1100 px: the list (tabs, sort, rows, pagination) | the job pane
  The job pane is sticky under header + toolbar and scrolls on its own:
  top: calc(var(--header-height) + var(--toolbar-height, 0px))
  --toolbar-height is published by JobsWorkspace from #job-controls.
SiteFooter     page blocks, privacy note, like, LinkedIn
```

Under 720 px the toolbar collapses to a search box and a Filters button; filters open
in a bottom sheet. Under 1100 px the job opens as a full-height sheet over the list.

`SiteHeader({ active, country })` and `SiteFooter({ children })` are the frame's API;
see the comments at the top of each file.

Pages render `JobsWorkspace` full width, outside `CONTAINER`: the toolbar is a
full-bleed sticky bar and applies `CONTAINER` inside itself, and so do the results.
`JobsWorkspace`'s `intro` prop (a React node) renders between the toolbar and the
results: the country note, the featured company and "Companies you've opened" go there.
Each page also has an `<h1>` (visually hidden on the jobs pages, which have no title row).

## Which component for what

| Need | Use |
| --- | --- |
| Any button, icon button, link styled as a button | `Button` (`asChild` around `<a>`) |
| Multi-select filter with search and counts | `Popover` + `Command` (+ `Checkbox` look), trigger `Button variant="outline"` with a dashed border while empty; chosen values as `Badge`s on the trigger. shadcn's "faceted filter" pattern. |
| Single choice (Sort, Posted, Salary, resume picker) | `Select` |
| Menu of actions or toggles (View, account, saved filters) | `DropdownMenu` (with `DropdownMenuCheckboxItem` for toggles) |
| Panel of extra controls (More filters, feedback) | `Popover` |
| Phone filters, phone job view | a sheet: shadcn `Sheet`, or the existing custom sheet styled to match it where its behaviour (history, focus return) must be kept |
| Blocking question (sign in to upload) | `Dialog` |
| Tabs (All jobs / Companies) | `Tabs` (`TabsList`, `TabsTrigger`) |
| Short labels (salary, Remote OK, source, role tags) | `Badge` (`variant="secondary"` or `"outline"`) |
| Notices (country note, errors) | `Alert` |
| Loading | `Skeleton` rows, `Spinner` in buttons |
| Empty results | `Empty` |
| Toasts (feedback sent) | `toast()` from `sonner` |
| Expand / collapse (company card, opened companies) | `Collapsible` |
| Pagination | `Pagination` parts |
| Keyboard hints | `Kbd` |

When a shadcn primitive would break a behaviour listed below, keep the existing
mechanics and style the markup with the same tokens and classes the primitive uses.

## Behaviour that must not change

- **URL state:** filters, sort, page and tab live in the address bar
  (`lib/useFilterState.js`); `?f=` saved-filter links apply once; Undo works.
- **Keyboard:** ↑ / ↓ move through the list and across pages while focus is on the
  list or nowhere and no overlay is open. An open overlay is any element with
  `data-state="open"` whose `data-slot` ends in `-content` (Radix/shadcn), or an open
  `<details>`. Escape closes the top overlay; focus returns to what opened it.
- **Analytics:** `lib/track.js` counts a click on `a.job-title[data-job-id]` (list
  titles; a plain click only selects, marked `data-selects`) and on
  `a[data-track-open][data-job-id]` (Apply). Both keep `data-company`, `data-city`,
  `data-title` where they have them.
- **History in the browser:** opened roles (`lib/seen.js`), saved jobs
  (`lib/saved.js`), saved filters (`lib/presets.js`), theme, column ratio, country:
  same storage keys.
- **Country routing:** `lib/country.js` and the inline script in `index.html`.
- **First paint:** the first jobs render before the whole list has downloaded.
- **DOM that `lib/` code uses:**
  - `lib/jdMarks.js` reads `.detail-head` (the pane's header), `#detail-body` (the
    description), and adds `.jd-mark`, `.jd-note`, `.desc-hit` (styled in
    `src/styles/description.css`).
  - `JobsWorkspace.jsx` reads `#job-controls` (toolbar height), `.job[data-job-id]`
    rows with `.is-selected` and their `.job-title`, `#job-results-bar`,
    `#detail-title`.
- **Ids the browser test (`test/jd-ux.e2e.cjs`) and saved links rely on:** keep every
  existing `id` on the element that plays the same part (`#job-search`, `#job-controls`,
  `#sum-<filter>`, `#list-<filter>`, `#q-<filter>`, `#advanced-filters`,
  `#advanced-panel`, `#hide-opened`, `#reset-filters`, `#sort-select`,
  `#job-view-tabs`, `#view-flat`, `#view-grouped`, `#count-flat`, `#count-grouped`,
  `#job-count`, `#results-split`, `#job-list`, `#job-pagination`, `#job-detail`,
  `#detail-top`, `#detail-title`, `#detail-bar`, `#detail-body`, `#detail-match`,
  `#mobile-filter-toggle`, `#filter-drawer-close`, and the rest). Class hooks and
  `<details>` structure may change; the test is updated to match.

## Accessibility

Radix gives roles, focus management and Escape. Beyond that: every icon-only control
has an `aria-label`; text contrast uses the tokens (never `opacity` on text below
`text-muted-foreground`); focus stays visible (`focus-visible:ring-3 ring-ring/50`,
shadcn's default); motion respects `motion-reduce:`.

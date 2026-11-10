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

- **Palette:** four shades and a grey, defined once at the top of `src/styles/app.css`
  (Stone: a slightly warm grey). Every shadcn token points at one of them, in both themes:

  | Shade | Tokens | Used for |
  |---|---|---|
  | paper | `background`, `card`, `popover` | cards, menus, dialogs, the header and filter bar, controls |
  | wash | `muted`, `secondary`, `accent` (on paper) | the page; fills and hover on paper |
  | line | `border`, `input`; `muted` etc. on the page | borders, inputs, dividers; fills and hover on the page |
  | grey | `muted-foreground`, `ring` | secondary text, icons, the focus ring |
  | ink | `foreground`, `primary` | text, filled buttons, the outline of what is selected |

  **Layered:** the page is the wash and everything on it sits in paper. A fill is one
  step darker than the surface under it: `body` sets `muted`, `secondary` and `accent` to
  the line, and any element with a `bg-background`, `bg-card` or `bg-popover` class
  (with or without a variant) sets them back to the wash.
  So `bg-muted` is always right; never pick the shade by hand. A new paper surface needs
  one of those three classes, or its fills will be a step too dark.

  Rules that keep it to those five:
  - **No opacity on a neutral** (`bg-muted/50`, `ring-foreground/10`, `text-foreground/60`):
    each one is a new shade. Use the token itself. The one exception is a filled button's
    hover, `hover:bg-primary/90`.
  - **No `dark:` colour overrides.** Dark mode is the same tokens with dark values.
  - **Hover:** a fill one step darker (`hover:bg-muted`); a job card on the page lifts
    instead (`hover:shadow-md`); ink goes to ink at 90%.
  - **Selected / pressed / on:** an ink outline (`border-foreground`, or
    `ring-1 ring-foreground`), on the wash for rows and toggles, on paper for job cards.
  - **Focus:** `focus-visible:ring-3 focus-visible:ring-ring` (solid grey).
  - **Flags** are drawn in the shades too, each colour taking the shade nearest its
    lightness (`components/Country.jsx`).
  - Never a raw colour (`text-zinc-500`, `#fff`, `violet-600`). (On 2026-11-09 the owner
    tried violet, then pure black and white, then chose Stone, layered.)
- **Errors:** `destructive` (red), for errors and removing things only.
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

Under 720 px the toolbar collapses to a search box and a Filters button
(`#job-search-bar`, pinned under the header like the desktop toolbar, and measured into
`--toolbar-height` the same way); filters open
in a bottom sheet. Under 1100 px the job opens as a full-height sheet over the list.

`SiteHeader({ active, country, account })` and `SiteFooter({ children })` are the
frame's API; see the comments at the top of each file. `account={false}` keeps the
sign-in button, and its calls to the server, off a page: Investors, About and the 404
page never ask who you are (lib/auth.js), as before the redesign.

Pages render `JobsWorkspace` full width, outside `CONTAINER`: the toolbar is a
full-bleed sticky bar and applies `CONTAINER` inside itself, and so do the results.
`JobsWorkspace`'s `intro` prop (a React node) renders between the toolbar and the
results: the country note, the featured company and "Companies you've opened" go there.
Each page also has an `<h1>` (visually hidden on the jobs pages, which have no title row).
It is the skip link's target (`id="content"`, `tabIndex={-1}`; `#firm-name` on an
investor's page), since `<main>` starts with the site header.

Investors (`pages/Firms.jsx`): the cards sit in one section per tier (`TIER_ORDER`), each
headed with its count, matching the page's "grouped by how central AI is". The old
firm-count line under the title is dropped, since the tier toggles show the same counts.

## Which component for what

| Need | Use |
| --- | --- |
| Any button, icon button, link styled as a button | `Button` (`asChild` around `<a>`) |
| Multi-select filter with search and counts | `Popover` + `Command` (+ `Checkbox` look), trigger `Button variant="outline"` with a dashed border while empty; chosen values as `Badge`s on the trigger. shadcn's "faceted filter" pattern. |
| Single choice (Sort, Posted, Salary) | `Select` (through `SelectMenu`). The resume picker keeps its own `<details>` menu, drawn like a Select, because its rows carry upload and delete actions. |
| Menu of actions or toggles (View, account, country) | `DropdownMenu` (with `DropdownMenuCheckboxItem` for toggles) |
| Panel of extra controls (More filters, Saved filters, feedback) | `Popover`. Saved filters has its own button beside View: naming a filter needs a text field, which a menu's type-ahead would swallow. |
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
  `data-state="open"` whose `data-slot` ends in `-content` (Radix/shadcn), except
  collapsible and accordion content (an expanded section is not an overlay), or an
  open `<details>` outside the job pane, or the pane's resume picker
  (`OPEN_OVERLAY` in `JobsWorkspace.jsx`). Escape closes the top overlay; focus
  returns to what opened it.
- **Analytics:** `lib/track.js` counts a click on `a.job-title[data-job-id]` (list
  titles; a plain click only selects, marked `data-selects`) and on
  `a[data-track-open][data-job-id]` (Apply). Both keep `data-company`, `data-city`,
  `data-title` where they have them.
- **History in the browser:** opened roles (`lib/seen.js`), saved jobs
  (`lib/saved.js`), saved filters (`lib/presets.js`), theme, column ratio, country:
  same storage keys.
- **Country routing:** `lib/country.js` and the inline script in `index.html`.
- **First paint:** the header, intro and `Skeleton` rows (and a toolbar skeleton the
  real toolbar's size) render at once; the list draws once `api/all-jobs.json`
  (`api/in/all-jobs.json` on /in) has loaded (`lib/jobs.js` `loadJobs`). Don't make the
  first render wait on anything more than that file. (Showing the first jobs before the
  whole list arrives is on the unmerged branch `feat/jobs-first-batch`, 317e3e2; if it
  lands, port `loadJobs(onRecent)`, its wiring in AllJobs.jsx / JobsWorkspace.jsx and
  FilterPicker's "Loading roles…" state, and update this line.)
- **DOM that `lib/` code uses:**
  - `lib/jdMarks.js` reads `#detail-bar` (the slim bar, whose height is what covers
    the text: `coveredHeight`) and `#detail-body` (the description), and adds `.jd-mark`
    and `.jd-note` (styled in `src/styles/match.css`) and `.desc-hit` plus the
    `match-passage` highlight (styled in `src/styles/description.css`).
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
`text-muted-foreground`); focus stays visible (`focus-visible:ring-3 ring-ring`,
solid grey); motion respects `motion-reduce:`.

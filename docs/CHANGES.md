# Change log

Every change to this project, oldest first. Generated 2026-08-05.

**23 commits** between 2026-07-29 and 2026-08-04, all of them on `origin/main` and
live at <https://jobs.ypatodkar.com>. One change is **not** live: the filter grouping,
still uncommitted on your working tree. It's listed at the bottom.

Deployment is automatic — the workflow in `.github/workflows/deploy.yml` runs on every
push to `main`, so "committed and pushed" and "live" mean the same thing here. There is
no staging step and no manual deploy.

---

## 2026-07-29 — first deploy

| Commit | Change | Scale |
|---|---|---|
| `dacc597` | **VC job directory: static deploy, click tracking, shared pipeline.** The whole thing, in one commit — scraper, static build, Cloudflare Pages workflow, click-collecting Worker. | 27 files, +3,974 |
| `db8ae63` | **Set `ALLOWED_ORIGINS` to the real site origin.** Without it every click POST 403s and nothing is recorded. | 1 file, +5/−4 |

## 2026-07-30 — grouping, hosting, previews

| Commit | Change | Scale |
|---|---|---|
| `f3d18f1` | **Group roles by company, with expand/collapse.** Added the "By company" view beside the flat list. | 6 files, +443/−39 |
| `c742924` | **Scrape twice daily instead of every 6 hours.** A full pass makes ~600 outbound requests; 4×/day wasn't buying freshness. | 7 files, +31/−18 |
| `9fb8ea0` | **Remember which roles you've opened, per browser.** `track.js` starts storing seen-state locally. | 1 file, +178/−38 |
| `361d9aa` | **Host on Cloudflare Pages, and remember who clicked what.** The second big one — moved off GitHub Pages (which won't serve a private repo free) and introduced per-browser identity. | 24 files, +2,555/−747 |
| `61f56a4` | **Pass the account id to the D1 sync, and stop it blocking the deploy.** Analytics can't hold the site hostage. | 1 file, +6 |
| `c6caa6c` | **Make the D1 sync actually run:** no transactions, smaller statements. | 2 files, +10/−4 |
| `2249315` | **Link preview, a 404, and a canonical home.** OG/Twitter tags, `404.html`, `sitemap.xml`, `robots.txt`. | 8 files, +94/−1 |

## 2026-07-31 — polish

| Commit | Change | Scale |
|---|---|---|
| `3950e50` | **Stop offering firm pages that cannot show anything, and retry a failed board.** Also self-hosted the Geist fonts. | 9 files, +84/−21 |
| `4ee88fd` | **Open light by default, whatever the visitor's OS is set to.** ⚠️ Deliberately ignored `prefers-color-scheme` — reversed on 08-04, see below. | 4 files, +6/−33 |

## 2026-08-01 — counter, heart, logos

| Commit | Change | Scale |
|---|---|---|
| `339f518` | **Undo the last filter change.** An undo button for filter state. | 4 files, +95 |
| `0acc858` | **Show a live click counter in the header.** Reads the Worker's public `/stats`. | 7 files, +119/−1 |
| `13c7eee` | **Fix the counter never appearing, and stop hiding why.** | 1 file, +12/−7 |
| `07eb9eb` | **A heart you can give once.** One-way, one-per-browser. | 9 files, +281/−87 |
| `2712b5a` | **Show company logos instead of initials in the grouped view.** | 4 files, +67/−26 |
| `9b50d7d` | **Align the company badge with the name it belongs to.** | 1 file, +23/−7 |

## 2026-08-02 — scale-up

| Commit | Change | Scale |
|---|---|---|
| `f752ead` | **Pair the logo with the company name in one row.** | 2 files, +49/−35 |
| `308e8b4` | **Widen the role filter, add Remote, and triple the firms scraped.** | 5 files, +132/−15 |
| `8451c1a` | **Store company facts once instead of on every one of their roles.** Cut the payload materially. | 2 files, +69/−2 |

## 2026-08-03 — ordering and history

| Commit | Change | Scale |
|---|---|---|
| `1ed3f42` | **Shuffle same-day roles, so the top of the list isn't always the same.** Also added the schema ERD. | 5 files, +367/−17 |
| `700b404` | **Link each role in "Companies you've opened" back to its posting.** | 4 files, +27/−2 |

## 2026-08-04 — the big one

| Commit | Change | Scale |
|---|---|---|
| `34b0368` | **Sponsorship filter, company blocklist, feedback widget; drop accounts.** Bundles a lot: the regex visa-sponsorship classifier and its tests, the feedback widget, removal of the half-built account layer, **OS-aware theming** (reversing `4ee88fd`), and the `visitor_id` → `user_id` rename that fixed click attribution. | 30 files, +1,134/−762 |

---

## Not live — uncommitted on your working tree

Two labelled filter groups: **Developers** (City, Seniority, Company, Company size) and
**Everything else** (Role, Industry, Funding, Visa sponsorship, Investor).

| File | Change | Scale |
|---|---|---|
| `jobs-ui.js` | A `GROUPS` list and a `group:` key per dimension; the picker render splits into two sections. Presentation only — filtering, counts, saved views and reset still treat `DIMENSIONS` as one flat list. | +46/−11 |
| `styles.css` | Three new rules (`.filter-sections`, `.filter-section`, `.filter-section-title`). Purely additive — no existing selector touched. | +38/−0 |
| `index.html` | `#picker-row` container class → `filter-sections`. | +1/−1 |
| `firm.html` | Same. | +1/−1 |

**Total: 4 files, +75/−13.** Verified in headless Chromium (7 checks) and the 12 existing
unit tests still pass. `git push` puts it live.

---

## Two things worth remembering

**The theme decision reversed itself.** `4ee88fd` (07-31) deliberately forced light mode
regardless of the visitor's OS. `34b0368` (08-04) undid that and made the OS setting the
default, with a manual toggle that only persists while it *disagrees* with the system.

**`migrations/002-feedback.sql` is committed but never applied.** The feedback widget is
live and its D1 table does not exist, so it fails on write. Fix:

```sh
npx wrangler d1 execute vcjobs --remote --config worker/wrangler.toml \
  --file=migrations/002-feedback.sql
```

Also still pending: `STRICT = "0"` in `worker/wrangler.toml` means `/click` can create
rows in `jobs`. Your own comment says to flip it to `"1"` after the first sync, which
happened days ago.

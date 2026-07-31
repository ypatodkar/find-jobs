# Find Jobs

Tracks 37 US venture firms and scrapes their portfolio job boards for engineering
roles across **19 US metros**.

## Run it

```bash
node scrape.js     # populate results.json
node server.js
```

Then open <http://localhost:4173>. No dependencies — Node 18+ only.

## Deploy

Hosted on **Cloudflare Pages**, scraped and redeployed by GitHub Actions twice daily
(`.github/workflows/deploy.yml`).

Cloudflare rather than GitHub Pages because this repo is private, and GitHub will not
publish Pages from a private repo on a free plan. Cloudflare Pages will, and its
bandwidth is unmetered.

```bash
node build.js                                   # -> dist/
npx wrangler pages deploy dist --project-name=find-jobs
```

| | |
|---|---|
| Project | `find-jobs` |
| Default URL | <https://find-jobs-cf5.pages.dev> |
| Custom domain | <https://jobs.ypatodkar.com> |

The workflow uploads `dist/` directly rather than using Cloudflare's Git integration —
a direct upload needs no OAuth link between Cloudflare and GitHub, so the repo stays
private, and the twice-daily cron stays in one place. It needs two repository secrets:

| Secret | |
|---|---|
| `CLOUDFLARE_API_TOKEN` | token with **Cloudflare Pages: Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | `3fcdcde298fb0fbf4c9ba274e19bb40f` |

`build.js` writes the three read endpoints as real files at the *same relative paths*
`server.js` answers dynamically:

| | |
|---|---|
| `api/results.json` | firm index + role counts |
| `api/all-jobs.json` | every role, deduped |
| `api/firm/<id>.json` | one per firm, all 37 |

That symmetry is the whole trick — the pages fetch one set of relative URLs and work
unchanged in both places.

`dist/` ships only browser files — `pipeline.js`, `scraper.js` and `ats.js` stay
out of it.

Two things to know. GitHub disables cron workflows after 60 days of repository
inactivity — it emails you, and re-enabling is one click. And scheduled runs on shared
runners are routinely 5–20 minutes late, so the scrape times are approximate.

The schedule is `0 18,0 * * *` — 18:00 and 00:00 UTC, i.e. late morning and end of the
working day on the US west coast. GitHub cron is UTC-only with no timezone support, so
those land at 11am/5pm PDT in summer and 10am/4pm PST in winter.

## Pages

- `index.html` — **home.** Every role across every portfolio in one deduplicated list.
  A company backed by several investors appears once, tagged with each of them.
  Results are paginated at 65 roles per page.
- `firms.html` — the 37 investors, with a role count per firm. Clicking anywhere on a
  card opens that firm's page; links inside the card still open the external board.
- `firm.html?id=<firm>` — one page per firm listing just its roles.

Every firm has a page, including the 21 with no scrapeable board — those explain why
and link to the firm's own site.

## Filters

Both job pages share one filter bar: eight multi-select dropdowns — **City, Role,
Seniority, Company, Industry, Company size, Funding, Investor** (Investor only on
`index.html`) — plus **Posted**, **Salary**, and **Sort**.

Cities come from `METROS` in `boards.js` — 19 metros, each with the query values the
two board platforms accept plus a pattern that buckets raw location strings (so
`Bellevue, WA` lands under Seattle and `Palo Alto` under Bay Area). No city is
pre-selected: an empty City filter means all tracked metros. Add or retire a metro by
editing that array.

Filters combine with **AND** across dropdowns and **OR** within one, and they
**cascade**: each dropdown only offers values that still return rows under every other
active filter. Picking `City = San Diego` collapses Company from 389 to the 5 companies
hiring there, Industry from 685 to 63, Investor from 16 to 7. Counts on each option show
what you would get. A selected value stays listed at count 0 so it can always be
unticked, and long lists (Industry) show the top 60 with search reaching the rest.

Every firm has a page, including the 21 with no scrapeable board — those explain why
and link to the firm's own site.

## How scraping works

Two phases per refresh:

**1. Discovery — VC portfolio boards.** 16 of the 37 firms have a scrapeable board:

| Platform | Firms |
|---|---|
| Consider | a16z, Sequoia, Lightspeed, NEA, Norwest, Bessemer, Kleiner Perkins, Greylock |
| Getro | Khosla, General Catalyst, Insight, Menlo, Redpoint, Craft, Notable Capital, Thrive |

The rest are marked unscrapeable in the UI with the reason (Accel is behind Cloudflare;
Founders Fund and the AI-native specialists publish no job listings; Y Combinator needs a login).

**2. Enrichment — each company's own job board.** VC boards lag and drop roles, so
every apply URL from phase 1 is parsed to work out which ATS that company uses
(`ats.js`), then its openings are fetched straight from the source:

| ATS | Coverage | Endpoint |
|---|---|---|
| Ashby | ~58% of companies | `api.ashbyhq.com/posting-api/job-board/{slug}` |
| Greenhouse | ~22% | `boards-api.greenhouse.io/v1/boards/{slug}/jobs` |
| Lever | ~3% | `api.lever.co/v0/postings/{slug}` |

Companies on any other ATS (Workday, Gem, Rippling, custom sites) keep their
VC-board listing rather than being dropped. Each role is tagged in the UI with where
it came from — an `ashby`/`greenhouse`/`lever` tag, or a dotted `vc board` tag.

Going direct roughly **doubles** the results (2,861 → 5,022 roles) and adds salary
ranges where the ATS publishes them. Requests run 6-at-a-time with one retry on
timeouts; a 404 is treated as permanent. Failures are recorded in
`results.json` under `enrichment.failures`.

## Click tracking

Records which roles get opened. **Nothing is rendered on the site** — the numbers are
for you, via SQL.

Every job carries a `job_id` (`id.js`), built from the ATS's own posting id where one
exists and a hash of company/title/city otherwise:

```
whatnot_ashby_aefd0c4d-6324-4ca0-8ebc-00ddfc722079
mistral_vc_7a3f9c21
```

The posting id is what makes a count survive a re-scrape — the `company|title|city`
dedupe key does not, because boards edit titles. It also correctly collapses the same
posting listed by several investors with drifting titles: a16z and Lightspeed both
carry Whatnot's "Senior Software Engineer, CX" where Redpoint has the current
"Software Engineer, CX", and all three resolve to one id. Two consequences worth
knowing: a posting open in both NY and SF is two rows in the UI sharing one counter,
and a company migrating between ATSes restarts its ids.

Storage is Cloudflare D1 (`schema.sql`) behind a Worker (`worker/`):

| Route | Purpose | Access |
|---|---|---|
| `POST /click` | one click → a row in `clicks` + `jobs.clicks + 1` | origin-allowlisted |
| `GET /counts` | `{ job_id: clicks }` | `ADMIN_TOKEN` — the site never calls it |

`track.js` is the browser half — a single delegated listener, `sendBeacon`, and a
hard rule that it can never interfere with the link. It is **inert until you set
`ENDPOINT`** to your deployed Worker.

Setup:

```bash
npx wrangler d1 create vcjobs                             # id → worker/wrangler.toml
npx wrangler d1 execute vcjobs --remote --file=schema.sql
cd worker
npx wrangler secret put ADMIN_TOKEN                       # guards GET /counts
npx wrangler deploy                                       # URL → ENDPOINT in track.js
```

Then set `ALLOWED_ORIGINS` in `worker/wrangler.toml` to your site's URL, and after
your first sync flip `STRICT = "1"` so that no request can create a row in `jobs` —
clicks are then only counted against jobs the sync has loaded.

`/click` is a public write endpoint and its URL is in the page source, so treat it as
known. It holds no credentials and no personal data — no IP, no cookie, no identifier,
only a country code derived at the edge and discarded. The realistic abuse is someone
spamming writes to skew counts or burn the D1 free write quota; the origin check,
the `job_id` pattern and `STRICT` bound that, and a Cloudflare rate-limiting rule on
`/click` is the next step if it ever actually happens.

Then after each scrape, push job metadata into D1:

```bash
node sync-jobs.js
npx wrangler d1 execute vcjobs --remote --file=sync.sql
```

`sync-jobs.js` never writes `clicks` or `first_seen`, and never deletes: a role that
comes off the boards is marked `active = 0` so a click recorded last week still
resolves to a company and a title. `results.json` is overwritten every scrape, so this
table is the only place posting history survives.

```sql
-- most wanted roles
SELECT company, title, city, clicks FROM jobs WHERE clicks > 0
ORDER BY clicks DESC LIMIT 20;

-- which investor's page actually drives clicks
SELECT COALESCE(firm, '(all roles)') AS page, COUNT(*) FROM clicks GROUP BY 1 ORDER BY 2 DESC;
```

Counts are raw — your own clicks and reloads inflate them.

## Accounts

Sign in with GitHub or Google to carry your "opened" history (`track.js`'s Seen store)
across devices. Same Worker and D1 database as click tracking above — no second
backend. `auth.js` is the browser half; like `track.js` it is **inert until you set
`ENDPOINT`**.

| Route | Purpose | Access |
|---|---|---|
| `GET /auth/:provider/start` | redirect to GitHub/Google's consent screen | public |
| `GET /auth/:provider/callback` | exchange the code, open a session, redirect back | public, state-checked |
| `GET /auth/me` | `{ user: {...} \| null }` for the current session | cookie |
| `POST /auth/logout` | end the session | cookie |
| `GET`/`POST /auth/seen` | the signed-in user's server-side "seen" map | cookie |

Accounts are keyed by `(provider, provider_user_id)` and never merged by email — see
the comment in `schema.sql`. Sessions are opaque tokens checked against the `sessions`
table on every request, not signed/decoded, so revoking one is just deleting the row.

Setup, once `vcjobs-clicks` from the click-tracking section above is deployed:

1. **Register an OAuth app with each provider**, using the Worker's URL (its
   `*.workers.dev` address, or your custom domain once step 3 is done):
   - GitHub → Settings → Developer settings → OAuth Apps → New OAuth App.
     Authorization callback URL: `https://<worker-domain>/auth/github/callback`.
   - Google → Cloud Console → APIs & Services → Credentials → Create OAuth client ID
     (type: Web application). Authorized redirect URI:
     `https://<worker-domain>/auth/google/callback`.
2. **Set the four values each provider gives you**, in `worker/wrangler.toml`
   (`GITHUB_CLIENT_ID`, `GOOGLE_CLIENT_ID` — not secret, they're visible in the
   redirect URL anyway) and via Wrangler (the two client secrets):
   ```bash
   cd worker
   npx wrangler secret put GITHUB_CLIENT_SECRET
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   ```
3. **Put the Worker on a custom domain that's a subdomain of your site** (Cloudflare
   dashboard: Workers & Pages → `vcjobs-clicks` → Settings → Domains & Routes → Add
   Custom Domain, e.g. `clicks.ypatodkar.com`). This isn't optional in practice: the
   session cookie needs to be first-party to survive browsers' third-party-cookie
   blocking. Once set, update `SITE_ORIGIN` and `COOKIE_DOMAIN` in
   `worker/wrangler.toml` (`COOKIE_DOMAIN = ".ypatodkar.com"`, leading dot) and update
   both OAuth apps' callback URLs to the new domain.
4. **Apply the schema and deploy**:
   ```bash
   npx wrangler d1 execute vcjobs --remote --file=schema.sql
   npx wrangler deploy
   ```
5. Set `ENDPOINT` in `auth.js` to the same URL you set in `track.js`.

## Editing

- `data.js` — firm metadata (name, tier, AI signal, links). Shared by both pages.
- `boards.js` — board IDs, target cities, and the role-matching / exclusion patterns.
- `match.js` — the shared keep/skip decision, so a role is judged the same whether it
  came from a VC board or a company's ATS.
- `jobs-ui.js` — the browser-side job browser (all filters, the multi-select pickers,
  the activity chart, the result list). Both `firm.html` and `all.html` use it, so a
  fix to filtering lands on both pages at once.
- `scraper.js` — the two VC-board platform adapters.
- `ats.js` — ATS detection, the three company-board adapters, and the company registry.
- `pipeline.js` — the three-phase scrape and the three read payloads, with no HTTP or
  filesystem in them. `server.js` (live, SSE progress) and `scrape.js`/`build.js`
  (headless, for CI) are both thin wrappers, so there is one implementation to fix.
- `id.js` — stable job ids. See [Click tracking](#click-tracking).

To widen or narrow which roles match, edit `ROLE_PATTERNS` and `EXCLUDE_TITLE` in `boards.js`.
To change cities, edit `LOCATIONS` and `CITY_MATCHERS` in the same file.

## Note

`results.json` is a point-in-time snapshot. Job boards change constantly — re-run the
refresh rather than trusting a stale file.

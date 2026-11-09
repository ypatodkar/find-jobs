# Find Jobs

Engineering roles at venture-backed companies, in one list: jobs.ypatodkar.com.

It tracks US venture firms and accelerators and keeps a permanent company registry. Portfolio
boards discover companies weekly; saved company boards (Ashby, Greenhouse, Lever)
refresh twice daily. Companies can also be added directly by URL. Roles are kept for 19 US metros plus remote, deduplicated, and classified so
that only computing roles stay.

A second list, `in.html`, holds roles in India: the Indian openings of the same
companies, two Indian firms' boards (Peak XV, 3one4), and the companies in 41 Indian
investors' portfolios, read company by company.

The title names the list's country, "Find Jobs in the US ▾", and the country opens a
menu that moves between the two lists and remembers the choice in the browser. The home page opens the remembered list. Without a choice, a
first visit on India's time zone opens the India list (and remembers it), with a note
saying why and a link back. A browser that has used the site before stays on the US
list, with a note about India until it picks. Links with filters open as shared. The
rules are in `web/src/lib/country.js` and the start-up script in `web/index.html`.

## Where things are

```
web/        the site: React pages (Vite). src/pages/ is one file per page,
            src/JobsWorkspace.jsx the job list and description pane both job pages use,
            src/components/ and src/lib/ the parts, src/styles/ the stylesheets,
            public/ files served as they are (og.png, robots.txt, featured.json).
scraper/    the scrape: VC boards, company ATS boards, classification (Jev), the
            payloads the site reads. scrape.js runs it.
shared/     code the scraper, the API and the site all use: description handling
            (description.js) and the Jev client (jev.js, requirements.js).
aws/        the API: a Lambda (aws/lambda/) on Postgres, for accounts, saved state,
            resumes, matching and analytics. schema.sql and migrations/ are its database.
deploy/     the Cloudflare Pages worker that forwards /api/auth, /api/sync, /api/resumes
            and /api/match to the Lambda.
scripts/    dev-server.js (local API), build.js (the deployable site), refresh.js,
            stats.js, feature-pick.js, package-api.js, and the validation scripts.
test/       unit tests (*.test.js), the browser test (jd-ux.e2e.cjs) and a database
            integration test.
docs/       the change log and the database diagram.
config/     companies.json: reviewed bootstrap company identities, no job content.
            india-portfolio.json: Indian portfolio websites and the careers systems
            first found on them, which seed state.portfolio.
data/       not in git: the durable scraper-state.json registry and last successful
            postings, latest results/descriptions, and the Jev classification cache.
```

## Run it locally

```bash
node scraper/scrape.js                      # due discovery, then saved company boards
node scripts/dev-server.js                  # the API and data on :4173
npm ci --prefix web && npm run dev --prefix web
```

Then open <http://localhost:5173>: the pages, with `api/*` forwarded to the dev server.
Only `web/` has dependencies; everything else needs Node 18+ and nothing more.
Sign-in and resume matching also need a local Postgres (`findjobs_dev`) and the keys
in `.env` (`GOOGLE_CLIENT_ID`, `TYPESAFE_API_KEY`); without them the rest works.

`node scripts/dev-server.js` on its own also serves the last page build (web/dist) at
<http://localhost:4173>, which is how the site will look deployed.

## Refresh the live feed

The scrape runs twice a day on GitHub Actions. To run one now:

```bash
scripts/refresh.js              # dispatch, then watch it to completion
scripts/refresh.js --no-watch   # dispatch and get your prompt back
scripts/refresh.js --status     # last few runs, dispatch nothing
```

It fires `workflow_dispatch` on `.github/workflows/deploy.yml`. Needs `gh auth login`.

## Deploy

Every push to `main`, and each scheduled run, does the same
(`.github/workflows/deploy.yml`):

```bash
npm ci --prefix web && npm run build --prefix web   # the pages -> web/dist
node --test test/*.test.js
node scraper/scrape.js                               # -> data/
node scripts/build.js                                # pages + data -> dist/
```

and publishes `dist/` to Cloudflare Pages (which jobs.ypatodkar.com points at) and to
S3 behind CloudFront (a copy, ready for a DNS move).

`scripts/build.js` writes the data the dev server answers dynamically as real files at
the same paths, so the pages work the same in both places:

| | |
|---|---|
| `api/results.json` | every firm and its role count |
| `api/all-jobs.json` | every role, deduplicated |
| `api/firm/<id>.json` | one per firm |
| `api/desc/<shard>.json` | job descriptions, a few per file |

Schedule: `0 18,0 * * *` UTC, which is 11am/5pm PDT in summer and 10am/4pm PST in
winter. GitHub disables cron workflows after 60 days without a push.

## The pages

- `index.html`: every role, 45 per page, or grouped by company. A company backed by
  several investors appears once, tagged with each.
- `firms.html`: the 70 investors and their role counts.
- `firm.html?id=<firm>`: one investor's roles, or why its board cannot be read.
- `about.html`.
- `in.html`: roles in India, from `api/in/all-jobs.json`, with a Company HQ filter
  (India / United States / Other) that starts with all three ticked, and no salary
  filter (its floors are in dollars).

Filters combine with AND across filters and OR within one, and each offers only values
that still return roles under the others, with counts. The URL describes the view, so
a filtered list can be shared; saved filters can be shared as a `?f=` link.

## How scraping works

1. **Discovery** (`scraper/registry-pipeline.js`): successful portfolio boards are
   revisited after seven days. Failed discovery retries after one day and keeps the
   previous successful observations. Company identity and investor memberships are
   retained even when a portfolio stops mentioning the company.
2. **Job refresh** (`scraper/ats.js`): saved Ashby, Greenhouse and Lever identifiers
   are fetched directly on every scheduled run. A successful empty response removes
   old jobs but retains the company. Failed or malformed responses retain jobs and
   descriptions with their original `lastVerifiedAt` and `stale: true`.
3. **Careers resolution and repair** (`scraper/careers.js`): new unresolved companies
   follow website/careers links to supported boards. After three consecutive ATS
   failures, a replacement is tried and must return a valid API response before it
   replaces the old board. Attempts are limited to 24 companies per run, four at a
   time, with a seven-day cooldown and oldest attempts first. Remaining work stays
   queued. Unsupported ATS jobs use the latest successful weekly VC snapshot.
4. **Employee counts**: when at least 30 days old, counts are refreshed from the next
   successful discovery observation with a source URL and observation date. Missing
   counts stay unknown; absent evidence never receives a new verification date.
   There is no independent headcount provider, so companies absent from discovery
   retain dated evidence until another source is added.
5. **Classification** (`scraper/classify.js`): new postings go to Jev in batches of
   30. Content-based cached labels apply to both portfolio and independent companies.
6. **India** (`scraper/india.js`, `scraper/portfolio.js`): every board and company is
   read for India as well as the US, and a role in both gets a row in each list (the
   US row keeps its id). Indian portfolios are read weekly for each company's website;
   up to 60 new or month-old websites a run are checked for a careers system, and
   those on a supported one (Ashby, Greenhouse, Lever, Keka, Workable, SmartRecruiters,
   Recruitee, BambooHR) join the registry. A company only Indian sources list is read
   for India alone, so nothing they add reaches the US list. Where a company is based
   (`hq`) is the country most of its openings are in; a `.in` website settles it, and
   with no openings to go by, an Indian investor's company counts as Indian.

The CLI supports separate operations:

```bash
node scraper/scrape.js --discover-only     # discovery only, if due
node scraper/scrape.js --discover --discover-only  # force discovery now
node scraper/scrape.js --jobs-only         # fetch saved company boards and due repairs
node scripts/companies.js list
node scripts/companies.js seed            # initialize from saved results + descriptions
node scripts/companies.js add https://example.com --name "Example"
node scripts/companies.js add https://jobs.ashbyhq.com/example --name "Example" --website https://example.com
node scripts/companies.js export-seed     # update config/companies.json for review/commit
```

Adding a URL saves the company, resolves its board and fetches matching jobs. Run a
job refresh to regenerate the local feed. Changes remain local until deployed;
exporting the seed includes new company identities in the next deployment. On
restore, newly added seed identities merge into the registry without resetting
existing jobs, failure history or metadata. The initial seed came from the local
October 14, 2026 snapshot; its employee counts are dated observations, not fresh checks.

`data/scraper-state.json` is written atomically under a local operation lock. It keeps
company metadata, sources, headcount evidence, discovery timestamps, failure counts,
and the last successful postings, including descriptions. CI restores and saves a
gzipped snapshot at `s3://find-jobs-site-075521919080/_scraper/state.json.gz`, retaining
`previous.json.gz` for recovery. The deploy excludes `_scraper/*` from deletion.
These snapshots contain public job/company data only and are stored in the site
bucket, not a private account-data store. Classification alone uses Actions cache.
The CI AWS principal needs `s3:GetObject` and `s3:PutObject` for this prefix (and
bucket listing access to distinguish missing objects from denied access).

Missing remote state bootstraps from `config/companies.json`; access errors and
corrupt state fail the run instead of silently resetting the catalogue. If a process
is killed, remove `data/scraper-state.json.lock` only after confirming it has stopped.

Cities, role patterns and exclusions are in `scraper/boards.js`; the keep/skip rule is
`scraper/match.js`. Every role has a stable id (`scraper/id.js`) from the ATS's own
posting id where there is one.

## Accounts, resumes and analytics

Google sign-in (optional) keeps opened jobs, saved jobs and saved filters on the
account, and enables resume matching: a resume is read in the browser
(`web/src/lib/resume-import.js`), its text is stored in Postgres, and Jev scores it
against a job's description. Each account gets a daily number of checks. Keeping the
original file as well (in a private S3 bucket) is on only for browsers that have
visited with `?upload=files`, while it is tried out.

Clicks, likes, feedback and saved-filter reports go to the same Lambda's analytics
routes and Postgres. `node scripts/stats.js` reports on them (it reads the database
credentials from the Lambda's configuration, so it runs from an allowed IP).

## Releasing the API

The site deploys itself; the API is released by hand.

```sh
npm ci --omit=dev --prefix aws/lambda
node scripts/package-api.js
aws lambda update-function-code --region us-east-1 --function-name find-jobs-api --zip-file fileb://aws/function.zip
aws lambda wait function-updated --region us-east-1 --function-name find-jobs-api
aws lambda invoke --region us-east-1 --function-name find-jobs-api --cli-binary-format raw-in-base64-out --payload '{"releaseAction":"migrate"}' /tmp/find-jobs-migration.json
node -e 'const r=require("/tmp/find-jobs-migration.json"); if(!r.ok) process.exit(1)'
```

The Lambda's handler is `aws/lambda/index.handler`. It needs a 90-second timeout,
outbound HTTPS (Google, TypeSafe, the site's description files) over IPv6 from its
VPC, and these settings: the Google web client ID, the TypeSafe key, the Postgres
credentials, `PGSSL=on`, `SITE_ORIGIN=https://jobs.ypatodkar.com` and `RESUME_BUCKET`.
The resume bucket is created once with `scripts/setup-resume-bucket.sh`. Release the
API before a site change that needs a new route.

Checks before a release:

```sh
node --test test/*.test.js
node test/match-feedback.integration.cjs   # isolated Postgres; needs initdb/pg_ctl
node test/jd-ux.e2e.cjs                    # the page build in a browser; needs Playwright
```

After a release, check `/api/auth/config`, a signed-out `/api/resumes` (401), a real
Google sign-in, a resume upload and removal, and one analysis with a test resume.

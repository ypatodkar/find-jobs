# Find Jobs

Engineering roles at venture-backed companies, in one list: jobs.ypatodkar.com.

It tracks 70 US venture firms, reads the portfolio job boards of the 55 that have one,
then goes to each company's own job board (Ashby, Greenhouse, Lever) for the live
listing. Roles are kept for 19 US metros plus remote, deduplicated, and classified so
that only computing roles stay.

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
data/       not in git: the latest scrape (results.json, descriptions.json) and the
            Jev classification cache (job-labels.json).
```

## Run it locally

```bash
node scraper/scrape.js                      # fills data/ (a few minutes)
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

Filters combine with AND across filters and OR within one, and each offers only values
that still return roles under the others, with counts. The URL describes the view, so
a filtered list can be shared; saved filters can be shared as a `?f=` link.

## How scraping works

1. **VC portfolio boards** (`scraper/scraper.js`): Consider and Getro boards list each
   firm's portfolio companies and their roles.
2. **Company boards** (`scraper/ats.js`): each apply link tells which ATS a company
   uses; its roles are then read straight from Ashby, Greenhouse or Lever, which are
   fresher than the VC board and carry salaries. Companies on other systems keep their
   VC-board listing.
3. **Classification** (`scraper/classify.js`): new postings go to TypeSafe's Jev in
   batches of 30 to tell computing roles from the rest and to read career stage.
   Answers are cached by posting content in `data/job-labels.json`, so each posting is
   asked about once. Without a key, everything stays listed.

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

# Job catalogue and résumé matching

The homepage and investor pages now request bounded result pages from Lambda.
Postgres filters, sorts, counts, and finds facets across the entire active catalogue.
Flat pages contain at most 45 summaries; company pages contain at most 40 companies,
each with three preview roles. “See all roles” opens that company's paginated list.
Descriptions are returned separately when opened. The legacy static JSON files
remain available to existing consumers, without full descriptions.

## Local development

Use Node 20 or later. `node server.js` uses an in-memory catalogue built from
`results.json`; it does not require Postgres or a Jev key for browsing.
`node scrape.js` refreshes the snapshot and now retains description text from
Ashby, Greenhouse, Lever, Consider, a16z, and Getro where available. An old snapshot
has no descriptions until refreshed. Sources that omit descriptions remain usable
for browsing and are excluded from AI comparisons.

To enable real matching locally, copy `.env.example` to `.env`, set
`TYPESAFE_API_KEY`, then run `npm start`. The start script loads `.env` if present. Obtain the key from
[TypeSafe's console](https://console.typesafe.ai). Never put it in `api-config.js`.
The matcher accepts `.txt`, `.md`, `.pdf`, and `.docx` files. Choosing a valid file
starts the comparison automatically.

## AWS setup before publishing

The existing analytics `jobs` table is retained. The catalogue migration creates
four additional tables using `aws/catalogue-schema.sql`. The import invocation
applies this idempotent migration before inserting data. Existing analytics rows,
users, and clicks are unaffected.

Configure the existing Lambda function with:

| Setting | Value / purpose |
| --- | --- |
| Runtime | Node.js 22 |
| Memory | Start with 1,024 MB for the description import; measure before reducing |
| Timeout | 180 seconds to allow catalogue ingestion; matching has its own bounded work window |
| `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` | Existing RDS connection settings |
| `CATALOGUE_BUCKET` | `find-jobs-site-075521919080` |
| `ALLOWED_ORIGINS` | Include the site's actual origins, including both hosts while both are published |
| `TYPESAFE_API_KEY` | Server-only key, required for matching |
| `MATCH_CACHE_SECRET` | Optional dedicated random secret; defaults to using the API key as the HMAC secret |
| `MATCH_HOURLY_BUDGET` | Maximum uncached job comparisons per hour; defaults to 1,000 |

Lambda needs outbound HTTPS to `api.typesafe.ai` for Jev and access to S3 for
imports. A Lambda inside private VPC subnets needs working outbound routing (for
example NAT for Jev, and an S3 gateway endpoint or NAT for S3). The existing RDS
connection alone does not provide internet access.

Add `s3:GetObject` on
`arn:aws:s3:::find-jobs-site-075521919080/catalogue/current.json` to the Lambda role.
Keep this import prefix out of the site's public CloudFront/S3 read policy. It
contains public job data, never résumés, but browsers do not need this large file.

The GitHub deployment principal needs its existing S3/CloudFront permissions plus
`lambda:UpdateFunctionCode`, `lambda:GetFunctionConfiguration`, and
`lambda:InvokeFunction` for this function. Set the repository **variable**
`CATALOGUE_LAMBDA_FUNCTION` to its function name. The workflow refuses to publish
the new frontend if this is missing or the database import fails.

The new workflow runs tests, packages and updates Lambda, scrapes descriptions,
uploads `.catalogue/catalogue.json` to the fixed S3 import key, invokes the importer
through AWS IAM, and publishes the site only after import succeeds. The public
Function URL has no import endpoint. The import checks a SHA-256 digest, rejects
older snapshots, and commits the catalogue atomically. S3 site sync excludes the
`catalogue/` prefix from deletion.

For a manual rollout, after configuring the function and its permissions:

```sh
npm ci --prefix aws/lambda --omit=dev
node aws/package-lambda.js
# Set CATALOGUE_LAMBDA_FUNCTION to the existing function name.
aws lambda update-function-code --function-name "$CATALOGUE_LAMBDA_FUNCTION" --zip-file fileb://aws/function.zip --query LastUpdateStatus
aws lambda wait function-updated --function-name "$CATALOGUE_LAMBDA_FUNCTION"
node scrape.js
node catalogue-export.js
# Set CATALOGUE_BUCKET to the bucket listed above.
node aws/import-catalogue.js
node build.js
```

Then publish `dist/` through the existing deployment workflow. `api-config.js`
points production browsers at the existing Lambda Function URL and localhost at
`/api`. If the function URL changes, update that single file before building.

## Matching behavior and storage

Choosing a valid file sends its extracted text through the backend to TypeSafe AI.
The upload control explains this before selection. The app keeps the résumé in page memory only: no localStorage,
database column, URL, analytics event, or application log contains it. Clearing
the résumé removes it from the page. TypeSafe's own handling is governed by its
[data policies](https://docs.typesafe.ai/models#data-handling).

Postgres full-text search selects up to 30 described jobs from the current filters.
The model compares each résumé/job pair using three independent score questions:
technical skills (55%), experience and responsibility (30%), and domain (15%).
These are heuristic weights, not a validated prediction of hiring outcomes.
The displayed 0–100 score is a weighted rubric score. Model confidence is used to
flag uncertain dimensions; it is not a person's interview or offer probability.

Jev also selects supporting résumé passages and requirements worth checking from
explicit passage choices. The UI shows literal passages. Missing résumé evidence
is described as unconfirmed, never proof that someone lacks a skill. Long
descriptions are shortened for inference and flagged in the result; the full
stored description remains available to read. Résumés over 16 KB are rejected.

Calls use the official `POST https://api.typesafe.ai/v1/systemone` endpoint and
pin `jev-1.13.0`. See [API contract](https://docs.typesafe.ai/api) and
[model versions](https://docs.typesafe.ai/models). Invalid or unavailable model
responses produce errors or explicitly partial results, never substitute scores.

Only scores, distributions, confidence, and passage **ids** are cached for one day.
The key is an HMAC of the résumé, posting id/title/description, model, and rubric
version. Literal résumé passages are reconstructed only while responding to the
same résumé submission. Changing the input produces a different cache key. Secret
rotation invalidates old keys. Expired rows are cleaned during scheduled imports.

Database-backed limits allow 12 matching submissions per network address per
hour and reserve a global comparison budget before calling Jev. Network addresses
are HMAC-hashed for these limits. These are application limits, not a replacement
for the AWS account's normal infrastructure controls. Four provider calls run at
once; retries and timeouts are bounded. Jobs with absent descriptions are reported
in the coverage counts. Candidate recall and scoring quality should be measured
on representative résumé/job pairs before treating rankings as authoritative.

## Validation

```sh
npm ci
npm ci --prefix aws/lambda --omit=dev
node --test test/*.test.js
# To run the real SQL suite, point only at a disposable test database:
TEST_DATABASE_URL=postgresql://localhost/jobs_test node --test test/catalogue-postgres.test.js
npx playwright install chromium
npm run test:browser
```

The SQL suite creates and removes a uniquely named test schema. The browser suite
uses synthetic jobs and simulated provider responses, starts its own local server,
and blocks external browser requests. It checks page navigation, filters, grouping,
description loading, missing-provider states, match presentation, privacy, mobile
layout, and investor scope. The tests never send a real résumé to Jev. CI runs both
suites with a temporary PostgreSQL service before updating Lambda.

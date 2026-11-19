# Contributing to Find Jobs

Bug fixes, focused improvements, and tests are welcome. Open an issue before a large
feature or architectural change so we can agree on its scope.

## Set up and check your changes

Fork the repository, clone your fork, and create a branch from the latest `main`.
Use Node.js 22, matching CI. If you use nvm, run `nvm install` and `nvm use`.

From the repository root:

```sh
npm ci --prefix web
npm run build --prefix web
node --test test/*.test.js
```

These are the required PR checks. They do not require account credentials, a live
scrape, cloud access, or a production database. There is no root `package.json`;
run the commands from the root with the prefixes shown above.

For interactive development, follow [Run it locally](README.md#run-it-locally).
The live scrape accesses external job boards and is separate from the required
checks. Account and resume-matching features need the optional local database and
configuration described in the README. The Lambda's dependencies can be installed
with `npm ci --prefix aws/lambda` when working on those features.

For UI changes, follow [the web design contract](web/DESIGN.md). Include screenshots
and check the affected page at desktop and mobile widths.

## Additional checks

The repository also has browser and database integration checks:

```sh
node test/jd-ux.e2e.cjs
node test/match-feedback.integration.cjs
```

The browser check needs a web build, Playwright, and Chromium. The database check
needs the Lambda dependencies and PostgreSQL's `initdb` and `pg_ctl` on `PATH`; it
creates an isolated temporary cluster. These are currently manual checks, not part
of required PR CI. Report which additional checks you ran and any missing prerequisites.

## Submit a pull request

- Keep the PR focused and describe the problem and the resulting behavior.
- Add or update tests for behavior changes and run the required checks above.
- Document any configuration, database migration, or API release ordering changes.
- Commit lockfile updates when dependencies change. Do not commit secrets, scraped
  data, database exports, uploaded resumes, installed packages, or build outputs.
- Wait for CI and maintainer review; address review comments before merging.

PR CI builds and tests the proposed merge on GitHub-hosted runners with read-only
repository permissions. It does not deploy or receive deployment credentials.
Deployment remains a separate maintainer workflow.

The project uses the [MIT license](LICENSE).

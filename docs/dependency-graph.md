# Generated dependency graphs

Run `node --expose-internals tools/map-code.cjs` from the repository root to update this file and [the AST map](ast-map.json).

These arrows are direct static dependencies. The module diagram includes literal `require` and `import` targets. The page diagram shows scripts loaded by each HTML page; it does not claim every script calls every other script. The global diagram covers direct property reads; dynamic calls and bare global identifiers need manual review.

## Module imports

```mermaid
flowchart LR
  m0["ats.js"]
  m1["aws/lambda/catalogue-api.cjs"]
  m2["aws/lambda/catalogue-import.cjs"]
  m3["aws/lambda/catalogue-postgres.cjs"]
  m4["aws/lambda/catalogue.cjs"]
  m5["aws/lambda/index.mjs"]
  m6["aws/lambda/jev.cjs"]
  m7["aws/lambda/matching.cjs"]
  m8["boards.js"]
  m9["build.js"]
  m10["catalogue-export.js"]
  m11["id.js"]
  m12["match.js"]
  m13["pipeline.js"]
  m14["scrape.js"]
  m15["scraper.js"]
  m16["server.js"]
  m17["sponsorship.js"]
  m0 --> m11
  m0 --> m12
  m0 --> m17
  m1 --> m4
  m1 --> m7
  m2 --> m4
  m3 --> m4
  m5 --> m1
  m5 --> m2
  m5 --> m3
  m6 --> m4
  m7 --> m4
  m7 --> m6
  m9 --> m8
  m9 --> m13
  m10 --> m4
  m10 --> m13
  m12 --> m8
  m13 --> m0
  m13 --> m8
  m13 --> m12
  m13 --> m15
  m14 --> m13
  m15 --> m0
  m15 --> m8
  m15 --> m11
  m15 --> m12
  m15 --> m17
  m16 --> m1
  m16 --> m4
  m16 --> m8
  m16 --> m10
  m16 --> m13
```

## Browser script loads

```mermaid
flowchart LR
  b0["about.html"]
  b1["all.js"]
  b2["api-config.js"]
  b3["app.js"]
  b4["counter.js"]
  b5["data.js"]
  b6["featured.js"]
  b7["feedback.js"]
  b8["filter-drawer.js"]
  b9["firm.html"]
  b10["firm.js"]
  b11["firms.html"]
  b12["heart.js"]
  b13["index.html"]
  b14["jobs-api.js"]
  b15["jobs-ui.js"]
  b16["presets.js"]
  b17["resume-match.js"]
  b18["theme.js"]
  b19["track.js"]
  b20["viewed.js"]
  b21["visitor.js"]
  b13 --> b18
  b13 --> b5
  b13 --> b15
  b13 --> b21
  b13 --> b2
  b13 --> b14
  b13 --> b12
  b13 --> b16
  b13 --> b8
  b13 --> b1
  b13 --> b17
  b13 --> b19
  b13 --> b20
  b13 --> b4
  b13 --> b6
  b13 --> b7
  b9 --> b18
  b9 --> b5
  b9 --> b15
  b9 --> b21
  b9 --> b2
  b9 --> b14
  b9 --> b12
  b9 --> b16
  b9 --> b8
  b9 --> b10
  b9 --> b19
  b9 --> b20
  b9 --> b4
  b9 --> b7
  b11 --> b18
  b11 --> b5
  b11 --> b3
  b11 --> b21
  b11 --> b2
  b11 --> b12
  b11 --> b4
  b11 --> b7
  b0 --> b18
```

## Implicit browser globals

Dashed arrows show direct `window`/`global` property reads, from consumer to producer, where both scripts load on the same page. Bare identifiers such as `VC_FIRMS` and `JobsAPI` may add further coupling and require scope-aware analysis.

```mermaid
flowchart LR
  g0["all.js"]
  g1["api-config.js"]
  g2["counter.js"]
  g3["feedback.js"]
  g4["heart.js"]
  g5["jobs-api.js"]
  g6["jobs-ui.js"]
  g7["presets.js"]
  g8["resume-match.js"]
  g9["track.js"]
  g10["viewed.js"]
  g11["visitor.js"]
  g2 -.-> g1
  g3 -.-> g1
  g3 -.-> g11
  g4 -.-> g1
  g4 -.-> g11
  g5 -.-> g1
  g5 -.-> g6
  g5 -.-> g9
  g5 -.-> g10
  g6 -.-> g5
  g6 -.-> g7
  g6 -.-> g9
  g7 -.-> g1
  g7 -.-> g11
  g8 -.-> g0
  g8 -.-> g5
  g9 -.-> g1
  g9 -.-> g6
  g9 -.-> g10
  g9 -.-> g11
  g10 -.-> g5
  g10 -.-> g9
```

| Consumer | Provider | Global |
|---|---|---|
| `counter.js` | `api-config.js` | `API_ENDPOINT` |
| `feedback.js` | `api-config.js` | `API_ENDPOINT` |
| `feedback.js` | `visitor.js` | `Visitor` |
| `heart.js` | `api-config.js` | `API_ENDPOINT` |
| `heart.js` | `visitor.js` | `Visitor` |
| `jobs-api.js` | `api-config.js` | `API_ENDPOINT` |
| `jobs-api.js` | `api-config.js` | `JOBS_ENDPOINT` |
| `jobs-api.js` | `jobs-ui.js` | `JobsUI` |
| `jobs-api.js` | `track.js` | `Seen` |
| `jobs-api.js` | `viewed.js` | `Viewed` |
| `jobs-ui.js` | `jobs-api.js` | `JobsData` |
| `jobs-ui.js` | `presets.js` | `Presets` |
| `jobs-ui.js` | `track.js` | `Seen` |
| `presets.js` | `api-config.js` | `API_ENDPOINT` |
| `presets.js` | `visitor.js` | `Visitor` |
| `resume-match.js` | `all.js` | `JobView` |
| `resume-match.js` | `jobs-api.js` | `JobsAPI` |
| `track.js` | `api-config.js` | `API_ENDPOINT` |
| `track.js` | `jobs-ui.js` | `JobsUI` |
| `track.js` | `viewed.js` | `Viewed` |
| `track.js` | `visitor.js` | `Visitor` |
| `viewed.js` | `jobs-api.js` | `JobsData` |
| `viewed.js` | `track.js` | `Seen` |

## Browser script order

- **index.html:** `theme.js` → `data.js` → `jobs-ui.js` → `visitor.js` → `api-config.js` → `jobs-api.js` → `heart.js` → `presets.js` → `filter-drawer.js` → `all.js` → `resume-match.js` → `track.js` → `viewed.js` → `counter.js` → `featured.js` → `feedback.js`
- **firm.html:** `theme.js` → `data.js` → `jobs-ui.js` → `visitor.js` → `api-config.js` → `jobs-api.js` → `heart.js` → `presets.js` → `filter-drawer.js` → `firm.js` → `track.js` → `viewed.js` → `counter.js` → `feedback.js`
- **firms.html:** `theme.js` → `data.js` → `app.js` → `visitor.js` → `api-config.js` → `heart.js` → `counter.js` → `feedback.js`
- **about.html:** `theme.js`

## Standalone files

These files have no local module edge and are not loaded by the four HTML pages. This includes command-line entry points and the separate Cloudflare Worker; it is not a dead-code finding by itself.

- `aws/export-d1.js`
- `aws/import-catalogue.js`
- `aws/package-lambda.js`
- `feature-pick.js`
- `refresh.js`
- `stats.js`
- `sync-jobs.js`
- `worker/index.js`

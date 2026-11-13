# Ingestion audit verification

Local evidence only, using a disposable PostgreSQL 17 database and the Next.js
production build bound to sandbox loopback. No production database, deployment,
plan, or environment configuration was changed.

## Regression proof

Before implementation, `npx vitest run src/app/api/bot-hit/route.test.ts`
produced 2 failures / 18 passes: rejection storage was never called, and the
collector replaced the authenticated sender's classification. The focused
regressions now pass.

Final `TEST_DATABASE_URL=<disposable-postgres-url> npm test`: **356 tests passed
across 35 files**, including real migrations, raw/weighted counting, receipt
persistence, idempotency, rejection day/project bounds, changing-UA bounded
counter cardinality, and batched UTC retention. Nothing in that run was skipped.
`npx tsc --noEmit`, `npm run lint`, `npm run build`, and `git diff --check` passed.
Migration 009 was applied to a fresh local database; the suite also verifies
migration rerun bookkeeping and upgrade paths.

## Real HTTP + dashboard proof

After `npm run build`, started `npm start -- --hostname 127.0.0.1 --port 3189`
with the disposable database, synthetic test credentials,
`BOT_INCLUDE_NON_PRODUCTION=false`, and `BOT_EVENT_RPM=2` in that local process.
Sent real fetch POSTs, queried PostgreSQL, logged into `/login`, and fetched the
server-rendered dashboard. Actual responses/query results are captured in
[ingestion-audit-http.json](ingestion-audit-http.json):

- Missing-credential probe: 401, no project receipt.
- Two browser refusals: one daily `not_bot` row, count 2.
- Development bot refusal: `non_production` count 1.
- Sender-classified unknown UA: 201, source `sender`, collector NULL, mismatch true.
- Legacy UA-only bot: 201, source `collector`, mismatch false.
- Next bot POST: 429, `project_quota_exceeded` count 1.
- Local development connection probe: 200 and one project receipt, despite
  production filtering remaining false; no added traffic.
- Exactly two raw hits, five sample-expanded daily hits (rates 0.25 and 1).
- Authenticated dashboard: HTTP 200, refusal panel renders reasons and count 2.

These synthetic numbers prove local behavior, not live bot traffic or site
coverage. Bypassed prerendered website routes remain unmeasured until a sender
actually runs there. Existing production history cannot be reconstructed.

## Review decisions and remaining operating limits

- Chosen compact counters instead of raw refusal bodies: at most six rows per
  project/day; timestamps and latest fingerprint/name/category are examples,
  not per-UA event history. Real integration proof changes those values twelve
  times and verifies a single counter with count 12.
- Every authenticated refusal still requires a durable DB write, including
  quotas. Dropping or sampling those writes would make the requested counts
  dishonest. Request quotas are not an ingress-abuse defence; documented in
  operations. Refusal data follows raw-event retention.
- Sender names are intentionally not constrained to the collector's known-bot
  list: doing that would reintroduce the classifier drift veto. Category
  `unknown`/invalid/incomplete pairs fall back to UA classification.
- Collector misses intentionally count as divergence (sender accepted a bot
  the collector would have dropped); NULL collector columns distinguish misses
  from differing non-NULL classifications. Historical comparisons stay NULL.
- Apply migration 009 before the new writer/dashboard/retention script.
- No live deployment or production verification was performed. `npm ci`
  reported 14 pre-existing dependency vulnerabilities (9 moderate, 4 high,
  1 critical); dependencies were not changed in this scoped PR.

# Focused latency work: local evidence and limits

This implements the approved backend-work, request-waterfall/recent-data and
truthful-feedback recommendations. It does **not** move D1, enable replicas,
cache sessions, introduce optimistic persistence, or add an offline write queue.
No production credentials, signed-in production activity or provider requests
were used. Auth changes still require separate explicit captain merge approval.

## What changed

- Auth instances, D1 I/O, sessions, invitation checks and clocks remain
  request-owned. A completed schema verdict alone is retained weakly by binding
  identity. Each request compares SQLite schema definitions; cold bindings and
  DDL changes run the pinned adapter's full validation, and a racing/failed check
  fails closed. See `docs/SETUP.md` and `apps/api/test/authPerformance.test.ts`.
  `PRAGMA schema_version` was tried locally and rejected by D1 with `SQLITE_AUTH`;
  it is not used. Temporary local logging confirmed cold → warm verdict reuse
  under the real `wrangler dev` server and was removed.
- Lexicon pages hydrate senses, equivalents and mastery in three independent
  owner-scoped reads, without rereading each entry. Chunks reserve an owner
  parameter within D1's 100-parameter limit. No indexes or migrations changed.
- Client caches are in-memory, bounded and scoped to a verified account/profile
  generation and the full query/versioned URL. Screen reads last 15 seconds;
  course resolution lasts 30. Writes invalidate before/after, including failures;
  session/profile changes and current-account `401`s clear data. Late reads
  cannot refill evicted slots or escape after account/profile changes. Same-origin
  tab notices only invalidate data, never grant an identity. Practice sittings
  and individual entry reads remain fresh. See the web backend boundary.
- Entry PATCH uses the updated entry returned by the server. Lesson progress
  writes and equivalent POSTs remain ordered; there is no early advancement or
  success acknowledgement. Pending labels now say Saving/Finishing immediately.

## Comparable connected-local measurements

Baseline source: `5e842ed8d2c878cfeb4a1c1d48fcfcec738e4fc4`, before product edits.
Measurements below were made on 2026-10-02 using the same host, production web
build, Vite preview (`localhost:4311`), real `wrangler dev` (`127.0.0.1:9311`),
composed migrations, authored Russian Foundations v1 and synthetic collector
session. English native, Spanish B2, Russian A0; suggestions off. Thirty
one-sense English entries were seeded through the real API. The after run
started with fresh local state and repeated the same sequence.

The Node/tsx driver used the actual `createHttpClient`, supplied only the local
harness cookie/Origin, consumed response bodies and timed with Node's monotonic
clock. "Cold client" means a new client/profile read, **not** a cold Worker or
network connection. List cold samples have an already-read profile and an
uncached list. The baseline client never cached lists; after samples also used a
fresh verified client to bypass recent-list reuse. Repeat samples reuse one
client. Course resolution → outline/resume → resume lesson, lesson ordered PUTs,
entry PATCH and the six-lane progress flow were exercised against real D1.
These are request/content-return timings, not physical touch INP or final paint.

### No artificial delay (body-complete/client return, milliseconds)

| Flow                                      | Before series      | After series       | HTTP requests before → after |
| ----------------------------------------- | ------------------ | ------------------ | ---------------------------- |
| Signed-in profile                         | 51, 52, 48         | 42, 43, 39         | 1 → 1                        |
| Fresh 1-entry list                        | 70, 338, 121       | 55, 55, 47         | 1 → 1                        |
| Fresh 30-entry list                       | 1421, 890, 1187    | 51, 50, 50         | 1 → 1                        |
| Cold-client course                        | 450, 405, 459      | 267, 262, 244      | 5 → 5                        |
| Repeated course                           | 356, 357, 378      | 210, <1, <1        | 4 each → 4, 0, 0             |
| Lesson after course read                  | 241, 279, 292      | 1, <1, <1          | 3 each → 0                   |
| First Next (two ordered step writes), n=1 | 340                | 128                | 4 → 2                        |
| Later Next, n=1                           | 165                | 66                 | 2 → 1                        |
| Entry-note save                           | 193, 168, 184      | 57, 61, 59         | 2 → 1                        |
| Two equivalents: serial HTTP legs, n=1    | 97 + 85 + 81 = 263 | 56 + 52 + 51 = 159 | 3 → 3                        |
| Cold-client progress                      | 528, 662, 546      | 276, 512, 309      | 7 → 7                        |
| Repeated progress                         | 455, 506, 694      | 295, <1, <1        | 6 each → 6, 0, 0             |

Already-read 30-entry pages were returned in about 1 ms with zero requests after
implementation. This is recent-data reuse, **not** a 1-ms server response.

### Controlled 250-ms hold before each fetch

The identical fetch wrapper added a 250-ms client-side hold, not simulated
cellular RTT or measured D1 distance. Local lesson progress was reset before
each held sequence; required writes were still performed and awaited.

| Flow                                   | Before series, ms     | After series, ms      |
| -------------------------------------- | --------------------- | --------------------- |
| Fresh 30-entry list                    | 34481, 4514, 2515     | 307, 309, 313         |
| Cold-client course                     | 1349, 1347, 1334      | 1297, 1275, 1298      |
| Repeated course                        | 1026, 1059, 1044      | 995, <1, <1           |
| First Next, n=1                        | 1245                  | 645                   |
| Later Next, n=1                        | 627                   | 344                   |
| Entry-note save                        | 641, 644, 634         | 327, 317, 333         |
| Two equivalents: serial HTTP legs, n=1 | 318 + 317 + 321 = 957 | 316 + 306 + 314 = 937 |
| Cold-client progress                   | 883, 885, 863         | 888, 843, 856         |
| Repeated progress                      | 545, 551, 611         | 531, <1, <1           |

The 34.5-second list outlier is retained, not hidden: host/Miniflare contention is
substantial and these tiny samples are not percentiles or production forecasts.
The cold progress and equivalent-save held paths remain materially unchanged;
most improvement there is warm reuse or clearer feedback, not fewer cold legs.

### Immediate feedback in the connected browser

Chrome through `chrome-devtools-axi`, same desktop viewport and 250-ms fetch
hold: a DOM-click/MutationObserver probe measured later Next becoming disabled
in **2.4 ms before**, with unchanged "Next", and **2.3 ms after**, with
"Saving progress…". Baseline next-step mounting was 672 ms; the after probe
verified immediate wording but did not retain its final mounting timestamp.
The Node persistence timings above, and deferred-response component tests,
separately verify acknowledgement-only advancement. These are DOM timestamps,
not a trusted physical touch or guaranteed readable-pixel measurement.

The save benchmark records mutation/body completion, not settled Lexicon-row
readiness. No claimed saved-row timing depends on matching outgoing review text.

## Operation-count and behavior regressions

A binding operation means one D1 `first`/`all`/`run`/`batch` call; a batch is not
one SQL statement. The investigation's baseline 30-entry list was **126**
operations (including a 34-statement schema-introspection batch). The new local
D1 regression first reproduced **125** with the auth guard fixed but the old
N+1 list still present, then passed at **8 warm / 11 cold** after bulk hydration.
Warm 1-entry and 30-entry lists have the same count. Standalone Lexicon lists use
**4 operations** for 1 or 30 entries, **7** for 100, **1** for an empty page.

Executable coverage:

- `apps/api/test/authPerformance.test.ts`: real local D1 cold/warm counts,
  schema drift/repair, DDL races, I/O failure/retry, distinct bindings, current
  secrets/RP configuration/clocks, revoked sessions/grants and 30-entry lists.
  The existing composed-schema, invitation/protocol, Learning and isolation
  suites remain applicable.
- `packages/lexicon/test/listPerformance.test.ts`: multi-sense 30-entry trees
  equal individual reads, mastery/equivalents/order, 100-entry binding limits,
  pagination, damaged cross-owner descendants, deleted rows, filters and
  honest failures. Existing search/mastery/ownership tests also run.
- `apps/web/src/api/http/httpClient.test.ts`: cold/warm request counts, exact
  query keys, TTL, cloning, failed/malformed reads, stale in-flight reads,
  account/profile/sign-out/401/tab isolation (including same-account tab
  notices during a pending session/profile read), version conflict, write/review
  invalidation and ordered partial equivalent success. PATCH is acknowledgement
  only and makes no GET.
- `apps/web/src/app/screens/pending.test.tsx`: immediate pending wording,
  no premature save/advance/finish, same-frame duplicate Next and Add Entry
  capture/save suppression, partial-step retries, conflict handling and partial
  equivalent-save failures.
- `apps/web/stack/performance.spec.ts`: production-build Chromium against real
  Wrangler/D1, warm course resolution, held Next requests with no early advance,
  persisted progress after reload, and real cross-tab account invalidation.

## Repeating and interpreting the experiment

Build from the repository root, then run `apps/web/stack/serve.mjs` with unused
`STACK_WEB_PORT`/`STACK_API_PORT` and a short, worktree-local `TMPDIR` (tsx's Unix
socket paths have a length limit). Use only the generated synthetic session.
Compare baseline and candidate with fresh local state, the same profile/content
and list size. Time returned promises/body completion inside the driver/browser;
exclude CLI startup. Run both fresh clients and same-client revisits within the
TTL, then repeat after TTL and writes. Reset only the synthetic local lesson
progress before another first-Next sequence; trying to move backwards correctly
returns `INVALID_PROGRESS_SEQUENCE`, and is not a latency sample.

Local validation passed: root `npm run check` and `npm run build`; web lint; `test:stack` (24
passed) and `test:e2e` (94 passed, 4 existing viewport-specific skips), both from
`apps/web`. The connected stack logged Miniflare broken-pipe warnings during
network-abort journeys; all assertions passed. No measurement-only
instrumentation or production switch remains in the app. The separate
no-mistakes/CI gate must validate the committed delivery head before shipping.

## Remaining bottlenecks and unmeasured limits

- Every actual request still verifies the session and invitation grant. Schema
  definitions are still read once each request; a new binding/DDL change pays
  full validation plus two definition guards. Binding identities that are not
  reused stay safe but miss this optimization.
- Cold course and progress still issue multiple reads. Ordered lesson writes,
  completion/import acknowledgement and sequential equivalents are real work.
  Equivalent save retains its final GET and partial-success semantics; course
  completion/import batching and composed progress APIs were not widened here.
- Recent data can be up to its TTL behind another device's writes/revocation;
  the next network request remains fully authorized. Known current-account
  `401`s and app-managed account changes invalidate immediately. There is no
  shared personalized cache, persistent data cache or offline queue.
- Provider latency, large scheduler histories, rapid uncached search traffic,
  Worker/D1 serving geography and cold bundle/connection costs remain possible
  contributors. No new index, placement, replica or cloud-setting claim is made.
- No signed-in production iPhone/Safari/Home Screen timing, physical input INP,
  background/foreground behavior or live D1/Worker timing was measured. The
  prior public unsigned-session median (~636 ms) is investigation evidence,
  not a measured production improvement from this implementation. Local gains
  overlap and must not be added mechanically or promised on the owner's phone.

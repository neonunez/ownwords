# The backend boundary

The front end talks to Ownwords through exactly one interface,
`src/api/client.ts`. No screen imports `fetch`, a URL, or a fixture; every
screen asks the client. That is what lets the implementation behind it change
without touching a screen.

```
screens ──► useClient() ──► OwnwordsClient ──┬─► createHttpClient()   the app
                                             └─► createDemoClient()   tests and demo builds only
```

## Which client answers

`src/app/shell/ClientProvider.tsx` builds the client once:

- **Every normal build** (`npm run dev`, `npm run build`) uses
  `createHttpClient()` from `src/api/http/`, which talks to the Ownwords API.
  When the API cannot be reached, a screen says so in words and offers to try
  again. It never falls back to sample data.
- **A demo build** (`npm run dev:demo`, `npm run build:demo`, Vite's `demo`
  mode) loads `createDemoClient()` from `src/api/demo/`, which answers from
  in-memory fixtures and keeps nothing. The side panel says so. The production
  bundle does not contain the demo code or its fixtures; the demo build goes to
  its own `demo-dist/`.
- **Tests** pass a client of their own.

## Where the API is

The app calls the API on its own origin, under `/api/auth` (Better Auth) and
`/api/v1` (everything else). `src/api/http/request.ts` is the only file that
spells those prefixes. Serving both from one origin keeps the session cookie
first-party and runs the passkey ceremony on the relying party's own origin, so
a deployment must route `/api/*` on the app's host to the Worker. In production
that is one Worker serving this package's `dist/` as its static assets; see
`apps/api/wrangler.production.jsonc.example` and the hosting steps in
`docs/SETUP.md`. Locally,
`vite` and `vite preview` forward `/api` to `wrangler dev`
(`OWNWORDS_API_URL`, default `http://127.0.0.1:8787`). The service worker never
answers `/api/`.

## What each method calls

Paths below are relative to `/api/v1` unless they start with `/api/auth`.

| `OwnwordsClient` method                  | Route                                                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `getSession`                             | `GET /api/auth/get-session`, then `GET /profile` (`null` profile: the first run is not finished)                                                 |
| `redeemInvitation`                       | `POST /invitations/redeem`                                                                                                                       |
| `startGoogleSignIn`                      | `POST /api/auth/sign-in/social` with `provider: "google"`; the app follows the returned `url`                                                    |
| `signInWithPasskey`                      | `GET /api/auth/passkey/generate-authenticate-options`, WebAuthn in the browser, `POST /api/auth/passkey/verify-authentication`                   |
| `addPasskey`                             | `GET /api/auth/passkey/generate-register-options`, WebAuthn, `POST /api/auth/passkey/verify-registration` (needs a signed-in session)            |
| `signOut`                                | `POST /api/auth/sign-out`                                                                                                                        |
| `saveOnboarding`, `savePreferences`      | `PUT /onboarding` (languages and the three preferences, always sent whole)                                                                       |
| `listLanguages`, `getPreferences`        | the profile read by `getSession`                                                                                                                 |
| `exportAccount`                          | `GET /account/export`                                                                                                                            |
| `listEntries`                            | `GET /lexicon/entries` (`search` → `query`, `unverifiedOnly` → `verification=unverified`, `weak` → `mastery=due`, `strong` → `mastery=mastered`) |
| `getEntry`                               | `GET /lexicon/entries/:entryId`                                                                                                                  |
| `createEntry`                            | `POST /lexicon/entries` with the headword as a hand-typed equivalent in its own language                                                         |
| `updateEntry`, `deleteEntry`             | `PATCH /lexicon/entries/:entryId` with `version`; `DELETE` with `If-Match: "<version>"`                                                          |
| `requestSuggestions`, `retryTranslation` | `POST /lexicon/entries/:entryId/senses/:senseId/suggestions`, one request per language; a retry then `PATCH`es the equivalent as `suggested`     |
| `addEquivalents`                         | `POST /lexicon/entries/:entryId/senses/:senseId/equivalents`, one per reviewed language                                                          |
| `updateEquivalent`                       | `PATCH /lexicon/entries/:entryId/senses/:senseId/equivalents/:equivalentId` with `version`                                                       |
| `addSense`                               | `POST /lexicon/entries/:entryId/senses`, repeating the headword so the sense can be translated                                                   |
| `getDueQueue`                            | `GET /lexicon/practice/due` per language and direction (Learn adds `origin=course`)                                                              |
| `submitReview`                           | `POST /lexicon/practice/reviews`                                                                                                                 |
| `getProgress`                            | `GET /lexicon/progress` per language, plus the Maintain due queue for what is due now                                                            |
| `getCourse`                              | `GET /learning/courses`, `GET /learning/courses/:courseId/versions/:version`, `GET …/resume`, and the resume lesson                              |
| `getLesson`                              | `GET …/versions/:version/lessons/:lessonId` and the outline                                                                                      |
| `completeLessonStep`, `completeLesson`   | `PUT …/lessons/:lessonId/progress`, `POST …/lessons/:lessonId/complete`                                                                          |
| `getAlphabet`, `listReferenceTopics`     | `GET /learning/references` per category, every page                                                                                              |
| `listStarters`, `addStarter`             | no route: the backend defines no starter expressions, so the HTTP client offers none                                                             |

## How the shapes are translated

`src/api/http/` reads every answer through `read.ts`, which refuses a missing
or mistyped field with a written error rather than letting a screen render
half of it. Beyond that:

- **The headword.** The Lexicon stores a meaning with equivalents in every
  language, including the one it was written in. An entry this app creates
  records `provenance.headwordLanguage`; a course import has only its one
  language. The headword is that language's equivalent on the first sense, and
  the screens list the other languages as equivalents.
- **Mastery.** Per entry, the API gives the scheduler's stage per direction,
  not a retrievability. The Lexicon therefore shows `learning` or `mastered`
  in words (a card never reviewed reads "not practised yet"). Progress shows
  real retention from `GET /progress`. The person's native languages are left
  off an entry's mastery and out of Maintain practice.
- **Practice.** Each sitting has a `sessionId`, so a card rated "again" comes
  back within it. "Complete the phrase" asks for cards with a cloze item;
  nothing creates cloze items yet, so that tab says none are due and offers
  flashcards. The scheduler has no "practise ahead" scope, so the app does not
  offer one; `DueQueue.aheadAvailable` says whether it can.
- **Course content.** A step's and a reference's content is authored JSON the
  backend stores as given. The app reads these fields, and ignores others:
  - a step's `payload`: `title`, `instruction` or `prompt`, `lines`,
    `options`, `answer`, `responses` (keyed by option);
  - an item: `stressText` (shown in place of `displayText`), `gloss`,
    `grammaticalMetadata.label`, or `gender` and `aspect`. The backend may
    also return `audio`, which the app deliberately ignores: it has no
    playback control and no audio preference;
  - an alphabet reference's `body`: `upper` or `letter`, `lower`, `sound`,
    `trap` or `looksLike`, `sameAsLatin`;
  - any other reference's `body`: `lines`, or else `summary`, `text` or
    `gloss`.

## Course content pack

The first real content is `packages/learning/content/russian-foundations-v1.json`.
It is a bounded, authored A0 script-and-stress and early-A1 greeting sequence,
not a synthetic fixture or a complete syllabus. The local stack publishes that
pack through `apps/api/scripts/local-content.ts` (the supported
`ingestCourseVersion` / `publishCourseVersion` path) and exercises rendering,
lesson completion, Lexicon export, and the alphabet/reference. The pack was
reviewed by a qualified Russian-language teacher and carries per-item
provenance/licensing in `packages/learning/content/README.md`. It ships
without recordings, so the app shows no playback, no listening step and no
audio preference, and the backend's recorded-audio metadata (`audio_json`, the
`/licenses` roll-up, the `russian_course_audio` profile preference) stays
stored and dormant for a future pack of original recordings.

## What the HTTP client carries

- **Identity.** The API derives the owner from the verified session alone;
  nothing the app sends names a user. A record owned by somebody else is
  indistinguishable from a missing one, so `404` stays "that is no longer in
  your Lexicon". A `401` anywhere brings the person back to sign in, with a
  line saying the session ended.
- **Errors.** Bodies are `{ "error": { "code", "message" } }` (the auth handler
  answers `{ "code", "message" }`). The client maps them onto `OwnwordsError`
  with a message written for a person; the backend's own wording is not shown.
  A network failure is `offline`; an answer that is not the API's is
  `bad_response`.
- **Concurrency.** Updates send the `version` last read; deletes send
  `If-Match`. A `409` says it changed somewhere else first, and the entry
  screen reads it again.
- **Paging.** Lists cap at 100 records and page with opaque cursors; the
  Lexicon shows "Show more" when there is a next page. The API gives no total,
  so the count reads "30+ entries" until the last page.
- **Limits.** At most 20 senses per entry, 30 equivalents per sense, 100
  equivalents in total.

## Online-first

Every method needs the backend and a connection. The service worker precaches
the shell and nothing else; it never caches or replays a backend answer, so an
offline launch shows each screen's written failure and retry rather than stale
data. The only thing the client keeps between calls is the profile, read at
sign-in and dropped whenever it is saved.

## What must not drift

- Unverified suggestions never enter practice in the language being learned.
  The backend enforces it at the integration boundary; the front end says so.
- Progress is retention and can-do milestones. `GET /progress` returns no card
  counts, and no screen computes one.
- Course items land in the Lexicon through the course-import interface when a
  lesson is finished, not by the front end writing Lexicon rows.

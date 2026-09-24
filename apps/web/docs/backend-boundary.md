# The backend boundary

The front end talks to Ownwords through exactly one interface,
`src/api/client.ts`. No screen imports `fetch`, a URL, or a fixture; every
screen asks the client. That is what lets the demo implementation be swapped
for the real one without touching a screen.

```
screens ──► useClient() ──► OwnwordsClient ──┬─► createDemoClient()   (today)
                                             └─► createHttpClient()   (next)
```

## What exists today

`src/api/demo/demoClient.ts` answers the interface from the fixtures in
`src/api/demo/fixtures.ts`, in memory, for one browser session. Nothing is
sent anywhere and nothing survives a reload. The side panel says so, in words,
so nobody mistakes the demo collection for a stored one.

The demo client is deliberately more than a stub: it enforces the behaviour
the backend enforces, so the screens are exercised against the real rules.
It searches accent-insensitively, keeps unreviewed suggestions out of
practice, returns `retention: null` for a direction that has never been
reviewed, keeps a card rated _again_ inside the session, and reports a missing
record as an `OwnwordsError` rather than inventing one.

## What replaces it

An `HttpOwnwordsClient` implementing the same interface, mounted in
`src/app/shell/ClientProvider.tsx`. Nothing else changes.

The types in `src/api/types.ts` already mirror the contracts published by the
domain packages, so the HTTP client is a translation layer and not a redesign.

| `OwnwordsClient` method                              | Route it will call                                                                                          | Package              |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------- |
| `listEntries`                                        | `GET /api/v1/lexicon/entries` (`mastery` is a `weak` or `strong` band)                                      | `@ownwords/lexicon`  |
| `getEntry`                                           | `GET /entries/:entryId`                                                                                     | `@ownwords/lexicon`  |
| `createEntry`                                        | `POST /entries`                                                                                             | `@ownwords/lexicon`  |
| `addSense`                                           | `POST /entries/:entryId/senses` (a blank gloss is refused)                                                  | `@ownwords/lexicon`  |
| `listStarters`, `addStarter`                         | not yet defined: the three vetted starter expressions an empty Lexicon offers                               | `@ownwords/lexicon`  |
| `requestSuggestions`                                 | `POST /entries/:entryId/senses/:senseId/suggestions`                                                        | `@ownwords/lexicon`  |
| `updateEquivalent`                                   | `PATCH /entries/:entryId/senses/:senseId/equivalents/:equivalentId`                                         | `@ownwords/lexicon`  |
| `retryTranslation`                                   | `POST /entries/:entryId/senses/:senseId/suggestions`                                                        | `@ownwords/lexicon`  |
| `getDueQueue`                                        | `GET /practice/due` (Learn adds `origin=course`); `ahead: true` needs a scope the package has yet to expose | `@ownwords/lexicon`  |
| `submitReview`                                       | `POST /practice/reviews`                                                                                    | `@ownwords/lexicon`  |
| `getProgress`                                        | `GET /progress`                                                                                             | `@ownwords/lexicon`  |
| `getCourse`                                          | `GET /courses/:courseId/resume` and `GET /courses/:courseId/versions/:version`                              | `@ownwords/learning` |
| `getLesson`                                          | `GET /courses/:courseId/versions/:version/lessons/:lessonId`                                                | `@ownwords/learning` |
| `completeLessonStep`                                 | `PUT …/lessons/:lessonId/progress`                                                                          | `@ownwords/learning` |
| `listReferenceTopics`                                | `GET /references`                                                                                           | `@ownwords/learning` |
| `getAlphabet`                                        | part of the course content, unit 0                                                                          | `@ownwords/learning` |
| `getPreferences`, `savePreferences`, `listLanguages` | not yet defined; they belong with the account work                                                          | —                    |

Routes are given as the domain packages mount them. The composition root
mounts them under `/api/v1/lexicon` and `/api/v1/learning` behind verified
sessions, and the front end reads the prefix from one place rather than
spelling it anywhere else. Content licences for Settings come from
`GET /courses/:courseId/versions/:version/licenses`, and the account export
from `GET /api/v1/account/export`; `docs/SETUP.md` describes both.

## What the HTTP client has to carry

These follow from the Lexicon package's integration contract, and each one is
a decision the demo client does not have to make:

- **Identity.** Verified auth middleware runs before the routes and every
  record is owner-scoped. A record owned by somebody else is indistinguishable
  from a missing one, so `404` stays "that is no longer in your Lexicon" and
  never becomes "that is not yours".
- **Errors.** Bodies are `{ "error": { "code", "message" } }`. Map them onto
  `OwnwordsError`; the screens already show a written failure and a retry.
- **Concurrency.** Updates send a body `version`, deletes send
  `If-Match: "<version>"`, and `409` means somebody else changed it first.
  `Entry.version` is carried through the types for exactly this.
- **Paging.** Lists cap at 100 records and page with opaque cursors.
  `EntryQuery.cursor` and `Page.nextCursor` are already in the types; the
  Lexicon screen reads one page today and gains a "load more" when a
  collection is large enough to need one.
- **Limits.** At most 20 senses per entry, 30 equivalents per sense, 100
  equivalents in total. Worth showing before a save is refused.
- **Suggestions.** `requestSuggestions` reports each language as it answers,
  so the review step can move a row from waiting to suggested or failed
  independently. Over HTTP that is one request per language, or one streamed
  response; the callback shape supports either.

## Online-first

Every method above needs the backend and a connection. The service worker
precaches the shell and nothing else; it never caches or replays a backend
answer, so an offline launch shows each screen's written failure and retry
rather than stale data.

## What must not drift

- Unverified suggestions never enter practice in the language being learned.
  The backend enforces it at the integration boundary; the front end says so.
- Progress is retention and can-do milestones. `GET /progress` returns no card
  counts, and no screen should compute one.
- Course items land in the Lexicon through the course-import interface, not by
  the front end writing Lexicon rows.

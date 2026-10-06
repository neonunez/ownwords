# `@ownwords/learning`

Workers-compatible Hono + D1 domain package for published course/reference content and private learner progress. Authored
course packs live in [`content/`](content/README.md); `test/fixtures/` holds a tiny synthetic fixture for tests.

## Integration

Apply `migrations/0200_learning.sql` after core `0001*` and Lexicon `0100*` migrations, then
`migrations/0201_learn_practice.sql`. Mount the returned Hono app at
`/api/v1/learning` after verified Better Auth middleware has set `c.set("userId", subject)`:

```ts
app.route(
  "/api/v1/learning",
  createLearningRoutes({
    // A fixed service, or a factory called with each request's bindings.
    lexiconImporter: (bindings) =>
      createCourseLexiconImporter({ db: bindings.DB }),
  }),
);
```

`lexiconImporter` structurally matches `@ownwords/lexicon`'s `LexiconCourseImportService`, or is a factory returning
one; the API passes a factory because Workers expose the D1 binding only per request. The tuple
`(ownerId, courseId, courseVersion, itemId)` is its stable idempotency key. The importer is used by one route only —
`POST …/lessons/:lessonId/lexicon`, the person's explicit "Add these words to Lexicon" — and never by completion. It
records one `learning_lexicon_sync` row per item it is asked to import and then imports each item independently, so
the same press twice stores nothing twice; a failure returns `202` with `lexicon.pending > 0` and asking again
retries only what is still owed. Learning marks a row synced only after Lexicon confirms durability. The callback
must remain idempotent because no transaction spans the two package-owned operations.

Content validation refuses items a lesson uses that no lesson introduces, so every published item reaches Learn
practice. An item the Lexicon importer refuses stays `pending` and is retried when the person asks again.
`exportLearnerData(db, userId)` returns one learner's enrollment, lesson progress, Lexicon-add state and Learn
practice cards and reviews for the composed account export.

## Learn practice

Learn practises the words of finished lessons, in the course's language, in both directions, from
`learning_practice_cards` (migration `0201_learn_practice.sql`). They are course items, not Lexicon entries: they
never appear in a Lexicon list, search, count or Maintain queue. `GET /practice/due` writes the cards it is missing
before reading, so a lesson finished before these tables existed still feeds practice and no data migration has to
move a row; the insert is keyed by `(item, direction)` and cannot duplicate a card.

The FSRS parameters are the Lexicon scheduler's, deliberately kept as a second copy (`src/scheduler.ts`) rather
than a package import, because the two packages do not depend on each other and the two practice surfaces schedule
independently. `adoptScheduling` is the single exception to Learning reading Lexicon tables: it carries the
scheduling state these words already had as course imports, read-only, so somebody who practised them for months is
not asked to start again.

Learning never reads personal Lexicon entries, and it never writes to the Lexicon.

## Version pinning

A user's first recorded lesson step pins that user to the course version they started, in the same D1 batch as the
progress write. Course listing, resume, outline, lesson, reference, progress, and completion routes all use the pinned
version; requests for any other version return `409 COURSE_VERSION_MISMATCH`. Database constraints make the pin
immutable and bind every lesson-progress and Lexicon-sync row to it, so concurrent first writes cannot enroll two
versions and a newer publication can never re-import the same items. Progress is not migrated across versions and
there is no reset route. Users who have not started a course see the latest published version.

## Content lifecycle

The operator-only exports in `@ownwords/learning/operator` are `ingestCourseVersion`, `publishCourseVersion`,
`discardDraftCourseVersion`, and the read-only `readCourseVersionStates`. They are not learner routes. The API's
guarded operator route (`/api/v1/admin/content`, `apps/api/src/contentPublication.ts`) wraps `ingestCourseVersion`,
`publishCourseVersion` and `readCourseVersionStates` against its own D1 binding so production publication reuses this
importer, and the local publisher (`apps/api/scripts/local-content.ts`) wraps the first two against local state; `docs/SETUP.md` holds the operator
command and its guards. Imports validate the whole pack before one D1 batch, require
sequential versions, reject unsafe/non-HTTPS URLs and broken links, and carry per-item license/provenance plus
optional recorded-audio metadata. Published rows are immutable through database triggers as well as application
checks. Stable item identity is `(courseId, version, itemId)`, and each item may be introduced by only one lesson in a
version, because that lesson owns the item's place in the Learn word list and the
Lexicon words it can be asked to keep. Course title and description are stored
per version, so a new version may correct them; the course language tag is stable and a pack that changes it is
rejected with `COURSE_IDENTITY_MISMATCH`.

Recorded-audio metadata is **dormant, not dead**: it is stored, served and licensed as described here, and no app
reads it, because the authored course ships without recordings. See `content/README.md` for why, and for what a future
pack of original recordings would need.

Validate a pack locally without credentials or database access:

```sh
npm run content:validate -- test/fixtures/synthetic-russian.json
```

## HTTP surface

All routes require the verified `userId` Hono variable and emit errors as `{ "error": { "code", "message" } }`.

- `GET /courses` and `GET /courses/:courseId/versions/:version`
- `GET /courses/:courseId/versions/:version/lessons/:lessonId` (includes the lesson's renderable content items,
  recorded-audio metadata, licences, and provenance)
- `GET /courses/:courseId/versions/:version/licenses` (each distinct item and recording licence once; nothing in
  the app calls it while the course has no recordings)
- `GET /courses/:courseId/resume`
- `GET /references?courseId=&version=&category=&limit=&cursor=`
- `PUT /courses/:courseId/versions/:version/lessons/:lessonId/progress`
- `POST /courses/:courseId/versions/:version/lessons/:lessonId/complete` (adds the lesson's words to Learn practice;
  writes nothing to the Lexicon)
- `POST /courses/:courseId/versions/:version/lessons/:lessonId/lexicon` (the explicit "Add these words to Lexicon";
  `202` with `lexicon.pending` when some words are still owed)
- `GET /practice/due?language=&direction=&format=&sessionId=&limit=` and `POST /practice/reviews` (flashcards only; a
  cloze request is answered empty because the course writes no gaps)

Progress cannot skip or regress steps. Lesson and reference prerequisites are enforced server-side. Every progress,
completion, reference-unlock, and pending-sync query is scoped to `userId`.

## Local checks

```sh
npm ci
npm run check
```

Both commands run from the repository root; `npm test --workspace @ownwords/learning` runs this package alone.

Tests use Node's in-memory SQLite adapter to execute the real migration and observable Hono routes. No account,
secret, cloud resource, production migration, or deployment is required.

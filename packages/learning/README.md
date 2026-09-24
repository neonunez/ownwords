# `@ownwords/learning`

Workers-compatible Hono + D1 domain package for published course/reference content and private learner progress. It
contains only a tiny synthetic fixture; production curriculum and audio are intentionally out of scope.

## Integration

Apply `migrations/0200_learning.sql` after core `0001*` and Lexicon `0100*` migrations. Mount the returned Hono app at
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
`(ownerId, courseId, courseVersion, itemId)` is its stable idempotency key. Completion and Learning's pending import
row commit atomically in one D1 batch; each item is then imported independently. A failure returns completion with
`lexiconSync.status: "pending"` (HTTP 202), and repeating that lesson's completion retries only its own pending
rows, so one stuck item never marks a later lesson unsynced. Learning marks a row
synced only after Lexicon confirms durability. The callback must remain idempotent because no transaction spans the
two package-owned operations.

Content validation refuses items the Lexicon importer would reject (its language-tag form and 10,000-character
provenance and script-data limits) and items a lesson uses that no lesson introduces, so every published item can be
exported. `exportLearnerData(db, userId)` returns one learner's enrollment, lesson progress, and export state for the
composed account export.

Learning serves only core curriculum content. It has no review scheduling tables, no practice route, and never reads
personal Lexicon entries; personal practice stays in Maintain.

## Version pinning

A user's first recorded lesson step pins that user to the course version they started, in the same D1 batch as the
progress write. Course listing, resume, outline, lesson, reference, progress, and completion routes all use the pinned
version; requests for any other version return `409 COURSE_VERSION_MISMATCH`. Database constraints make the pin
immutable and bind every lesson-progress and Lexicon-sync row to it, so concurrent first writes cannot enroll two
versions and a newer publication can never re-import the same items. Progress is not migrated across versions and
there is no reset route. Users who have not started a course see the latest published version.

## Content lifecycle

The operator-only exports in `@ownwords/learning/operator` are `ingestCourseVersion`, `publishCourseVersion`, and
`discardDraftCourseVersion`. They are not HTTP routes. Imports validate the whole pack before one D1 batch, require
sequential versions, reject unsafe/non-HTTPS URLs and broken links, and carry per-item license/provenance plus
optional recorded-audio metadata. Published rows are immutable through database triggers as well as application
checks. Stable item identity is `(courseId, version, itemId)`, and each item may be introduced by only one lesson in a
version, because that lesson owns the item's Lexicon export and its retries. Course title and description are stored
per version, so a new version may correct them; the course language tag is stable and a pack that changes it is
rejected with `COURSE_IDENTITY_MISMATCH`.

Validate a pack locally without credentials or database access:

```sh
npm run content:validate -- test/fixtures/synthetic-russian.json
```

## HTTP surface

All routes require the verified `userId` Hono variable and emit errors as `{ "error": { "code", "message" } }`.

- `GET /courses` and `GET /courses/:courseId/versions/:version`
- `GET /courses/:courseId/versions/:version/lessons/:lessonId` (includes the lesson's renderable content items,
  recorded-audio metadata, licences, and provenance)
- `GET /courses/:courseId/versions/:version/licenses` (each distinct item and recording licence once, for Settings)
- `GET /courses/:courseId/resume`
- `GET /references?courseId=&version=&category=&limit=&cursor=`
- `PUT /courses/:courseId/versions/:version/lessons/:lessonId/progress`
- `POST /courses/:courseId/versions/:version/lessons/:lessonId/complete`

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

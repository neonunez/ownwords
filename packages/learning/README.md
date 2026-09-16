# `@ownwords/learning`

Workers-compatible Hono + D1 domain package for published course/reference content and private learner progress. It
contains only a tiny synthetic fixture; production curriculum and audio are intentionally out of scope.

## Integration

Apply `migrations/0200_learning.sql` after core `0001*` and Lexicon `0100*` migrations. Mount the returned Hono app at
`/api/v1/learning` after verified Better Auth middleware has set `c.set("userId", subject)`:

```ts
app.route("/api/v1/learning", createLearningRoutes({
  lexiconImporter: createCourseLexiconImporter({ db: env.DB }),
  practiceSource,
}));
```

`lexiconImporter` structurally matches `@ownwords/lexicon`'s `LexiconCourseImportService`. The tuple
`(ownerId, courseId, courseVersion, itemId)` is its stable idempotency key. Completion and Learning's pending import
row commit atomically in one D1 batch; each item is then imported independently. A failure returns completion with
`lexiconSync.status: "pending"` (HTTP 202), and repeating completion retries only pending rows. Learning marks a row
synced only after Lexicon confirms durability. The callback must remain idempotent because no transaction spans the
two package-owned operations.

`practiceSource` is deliberately an adapter to the shared Lexicon scheduler:

```ts
interface LearningPracticeSource {
  listDue(input: { userId: string; languageTag: string; limit: number }):
    Promise<readonly LearningPracticePrompt[]>;
}
```

Learning has no review scheduling tables. Until Lexicon exports this service, the composition root must provide an
adapter; the package does not claim end-to-end practice integration.

## Content lifecycle

The operator-only exports in `@ownwords/learning/operator` are `ingestCourseVersion`, `publishCourseVersion`, and
`discardDraftCourseVersion`. They are not HTTP routes. Imports validate the whole pack before one D1 batch, require
sequential versions, reject unsafe/non-HTTPS URLs and broken links, and carry per-item license/provenance plus
optional recorded-audio metadata. Published rows are immutable through database triggers as well as application
checks. Stable item identity is `(courseId, version, itemId)`.

Validate a pack locally without credentials or database access:

```sh
npm run content:validate -- test/fixtures/synthetic-russian.json
```

## HTTP surface

All routes require the verified `userId` Hono variable and emit errors as `{ "error": { "code", "message" } }`.

- `GET /courses` and `GET /courses/:courseId/versions/:version`
- `GET /courses/:courseId/versions/:version/lessons/:lessonId` (includes the lesson's renderable content items,
  recorded-audio metadata, licences, and provenance)
- `GET /courses/:courseId/resume?version=`
- `GET /references?courseId=&version=&category=&limit=&cursor=`
- `PUT /courses/:courseId/versions/:version/lessons/:lessonId/progress`
- `POST /courses/:courseId/versions/:version/lessons/:lessonId/complete`
- `GET /practice?courseId=&limit=` (delegates to `practiceSource`)

Progress cannot skip or regress steps. Lesson and reference prerequisites are enforced server-side. Every progress,
completion, reference-unlock, and pending-sync query is scoped to `userId`.

## Local checks

```sh
npm install --no-package-lock
npm run typecheck
npm test
```

Tests use Node's in-memory SQLite adapter to execute the real migration and observable Hono routes. No account,
secret, cloud resource, production migration, or deployment is required.

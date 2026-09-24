# `@ownwords/lexicon`

Private Lexicon, flashcard/cloze scheduling, progress, and translation-suggestion boundaries for Ownwords.
It is a standalone TypeScript package for Hono and Cloudflare D1; it has no auth implementation and never accepts
an owner identity from a request payload. The API shell must set `Variables.userId` after verified authentication.

## Local validation

Run from the repository root; the package has no lockfile of its own.

```sh
npm ci
npm test --workspace @ownwords/lexicon
npm run typecheck --workspace @ownwords/lexicon
```

Tests apply the real [`0100_lexicon.sql`](./migrations/0100_lexicon.sql) migration to SQLite and exercise the Hono
routes through their public HTTP interface. Production migration collection and deployment belong to the API shell.

## Integration

Mount `createLexiconRoutes()` at `/api/v1/lexicon` after Better Auth middleware has set `userId`. See
[`docs/INTEGRATION.md`](./docs/INTEGRATION.md) for the exact environment, course-import callback, migration order,
error envelope, and retry semantics.

Translation suggestions default to `DisabledTranslationProvider`, which performs no network call. A configured
provider is called only by the explicit suggestions endpoint. Its cache is partitioned by owner: that costs some
duplicate provider work across accounts, but prevents private entry text, sense context, and access patterns from
leaking through a shared cache. Provider retries return review candidates and never mutate human-corrected data.

Cloze content is never inferred from a word list. It must be explicitly supplied with exactly one `{{blank}}`
marker; reads return an honest `NO_VALIDATED_CLOZE` outcome when none exists.

# Lexicon integration contract

## HTTP mount and identity

```ts
import { createLexiconRoutes, type LexiconEnv } from '@ownwords/lexicon';

// Verified auth middleware must run first and call c.set('userId', verifiedSubject).
app.route('/api/v1/lexicon', createLexiconRoutes());
```

The Hono environment is exactly:

```ts
type LexiconEnv = {
  Bindings: { DB: D1Database };
  Variables: { userId: string };
};
```

Missing identity returns `401`. Every entry, nested resource, due query, progress aggregate, cache row, and review
event is owner-scoped. A resource owned by somebody else is indistinguishable from a missing resource
(`404`). Client bodies and query strings cannot select an owner.

Errors use `{ "error": { "code": string, "message": string } }`. Request limits are enforced at the route boundary.
Updates require a body `version`; deletes require `If-Match: "<version>"`. Stale versions return `409` and deletes
are soft, keeping owner-scoped review history while removing the resource from reads and practice.
Entry lists use opaque continuation cursors and cap each page at 100 records. An entry or course
import accepts at most 20 senses, 30 equivalents per sense, and 100 equivalents in total.

List search (`query`) ignores case and diacritics such as accents, stress marks, diaeresis, tildes, and cedillas,
but keeps letters that are distinct in their alphabet: `ñ`, `ё`, and `й` (and non-diacritic letters such as `ß`).

Each equivalent carries `mastery`: `null` when it is not practice-eligible, otherwise
`{ recognize, produce }`, each `{ level: 'new' | 'learning' | 'mastered', dueAt, due }` from that direction's FSRS
card (`mastered` means stability of at least 21 days). The list `mastery` filter (`new`, `due`, `learning`,
`mastered`) matches eligible equivalents in the optional `language`, and the optional `direction` scopes it to
`recognize` or `produce`; `direction` without `mastery` is rejected.

## Course-to-Lexicon callback

The learning package receives this interface from the composition root:

```ts
interface LexiconCourseImportService {
  importCourseEntry(input: {
    ownerId: string;
    courseId: string;
    courseVersion: string;
    itemId: string;
    kind: 'word' | 'expression';
    note?: string | null;
    provenance: Record<string, unknown>;
    senses: SenseInput[];
  }): Promise<{ entryId: string; created: boolean }>;
}

const service = createCourseLexiconImporter({ db, clock?, idGenerator? });
```

The tuple `(ownerId, courseId, courseVersion, itemId)` is idempotent. One D1 `batch()` atomically creates the entry,
senses, equivalents, practice cards, and import marker. Concurrent retries return the winning `entryId`; a failed
batch rolls back all rows. Learning code owns its course state and calls this interface only—it does not write
Lexicon tables. Because D1 cannot atomically span separately owned databases, a caller that records learning
progress separately must retry the stable tuple until this call succeeds before marking its own operation complete.

Course imports accept only verified, non-false-friend equivalents. This makes accidental practice of unreviewed
Russian suggestions impossible at the integration boundary.

## Migrations and dependencies

- Gather `packages/lexicon/migrations/0100_lexicon.sql` after core `0001*` migrations and before learning `0200*`.
- Runtime dependencies: `hono@4.13.8`, `ts-fsrs@5.4.2`.
- `createLexiconRoutes({ clock, idGenerator, translationProvider, wrongAnswerDelayMs })` supports deterministic tests.
- `translationProvider` defaults to a no-network disabled implementation.

`ts-fsrs` owns the scheduling algorithm. Flashcard and cloze views select different presentation data but update the
same `(owner, equivalent, direction)` card. A rating of `Again` also creates a short, session-scoped revisit; later
successful review completes it. Submission IDs are owner-scoped idempotency keys, and optimistic card revisions
serialize concurrent reviews.

`GET /progress?language=<tag>` returns one row per direction with `retention` and `nextDueAt`, never card counts.
`retention` is the mean FSRS retrievability, at the injected clock's current time, of reviewed eligible cards; it is
`null` when no eligible card in that direction has been reviewed, because new cards have no memory estimate.
`nextDueAt` is the earliest due time of any eligible card, including new ones, so a past value means practice is due
now; it is `null` when the direction has no eligible cards.

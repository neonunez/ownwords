import { Hono, type Context } from 'hono';
import { all, changed, decodeJson, encodeJson, first, run } from './db.js';
import { answersMatch, normalizeSearchText } from './normalize.js';
import { cryptoIdGenerator, iso, systemClock } from './runtime.js';
import { appendCardStatements, createEntry, isPracticeEligible } from './service.js';
import { scheduleReview, type StoredCardState } from './scheduler.js';
import {
  DisabledTranslationProvider,
  ProviderDisabledError,
  TranslationSuggestionService,
} from './translation.js';
import type {
  Clock,
  CreateLexiconRoutesOptions,
  FitLabel,
  IdGenerator,
  LexiconEnv,
  PracticeDirection,
  PracticeFormat,
  ReviewRating,
  TranslationStatus,
} from './types.js';
import {
  InputError,
  directions,
  enumValue,
  formats,
  integer,
  jsonRecord,
  kinds,
  languageTag,
  object,
  optionalString,
  parseEquivalent,
  parseSense,
  reviewRating,
  string,
} from './validation.js';

interface EntryRow {
  id: string;
  kind: string;
  note: string | null;
  source: string | null;
  provenance_json: string | null;
  human_edited: number;
  version: number;
  created_at: string;
  updated_at: string;
}

interface SenseRow {
  id: string;
  entry_id: string;
  gloss: string | null;
  note: string | null;
  position: number;
  human_edited: number;
  version: number;
  created_at: string;
  updated_at: string;
}

interface EquivalentRow {
  id: string;
  sense_id: string;
  language_tag: string;
  text: string | null;
  fit: FitLabel;
  status: TranslationStatus;
  note: string | null;
  source: string | null;
  provenance_json: string | null;
  script_data_json: string | null;
  human_edited: number;
  version: number;
  created_at: string;
  updated_at: string;
}

interface CardRow {
  id: string;
  equivalent_id: string;
  language_tag: string;
  direction: PracticeDirection;
  due_at: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review_at: string | null;
  revision: number;
}

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 30;
const DEFAULT_WRONG_DELAY_MS = 5 * 60 * 1000;

export function createLexiconRoutes(options: CreateLexiconRoutesOptions = {}): Hono<LexiconEnv> {
  const app = new Hono<LexiconEnv>();
  const clock = options.clock ?? systemClock;
  const ids = options.idGenerator ?? cryptoIdGenerator;
  const provider = options.translationProvider ?? new DisabledTranslationProvider();
  const wrongDelayMs = options.wrongAnswerDelayMs ?? DEFAULT_WRONG_DELAY_MS;

  app.onError((error, c) => {
    if (error instanceof InputError) {
      return c.json(errorBody('INVALID_REQUEST', error.message), 400);
    }
    if (error instanceof ProviderDisabledError) {
      return c.json(errorBody('TRANSLATION_PROVIDER_DISABLED', error.message), 503);
    }
    return c.json(errorBody('INTERNAL_ERROR', 'The request could not be completed'), 500);
  });

  app.use('*', async (c, next) => {
    const ownerId = c.get('userId');
    if (typeof ownerId !== 'string' || ownerId.length === 0) {
      return c.json(errorBody('AUTH_REQUIRED', 'Authentication is required'), 401);
    }
    await next();
  });

  app.post('/entries', async (c) => {
    const ownerId = c.get('userId');
    const body = object(await readJson(c.req.raw));
    if (!Array.isArray(body.senses) || body.senses.length < 1 || body.senses.length > 20) {
      throw new InputError('senses must contain between 1 and 20 items');
    }
    const senses = body.senses.map((item, index) => parseSense(item, `senses[${index}]`));
    if (senses.reduce((count, sense) => count + sense.equivalents.length, 0) > 100) {
      throw new InputError('entries support at most 100 equivalents');
    }
    const created = await createEntry(
      c.env.DB,
      ownerId,
      {
        kind: enumValue(body.kind, 'kind', kinds),
        note: optionalString(body.note, 'note', 2000),
        source: optionalString(body.source, 'source', 500),
        provenance: jsonRecord(body.provenance, 'provenance'),
        senses,
      },
      clock,
      ids,
    );
    const entry = await getEntry(c.env.DB, ownerId, created.id);
    return c.json({ data: entry }, 201);
  });

  app.get('/entries', async (c) => {
    const ownerId = c.get('userId');
    const url = new URL(c.req.url);
    const limit = parseLimit(url.searchParams.get('limit'));
    const language = optionalLanguage(url.searchParams.get('language'));
    const kind = optionalEnum(url.searchParams.get('kind'), kinds, 'kind');
    const verification = optionalEnum(
      url.searchParams.get('verification'),
      ['verified', 'unverified'] as const,
      'verification',
    );
    const mastery = optionalEnum(
      url.searchParams.get('mastery'),
      ['new', 'due', 'learning', 'mastered'] as const,
      'mastery',
    );
    const queryValue = url.searchParams.get('query');
    const query = queryValue === null ? null : normalizeSearchText(string(queryValue, 'query', { min: 1, max: 100 })!);
    const cursor = parseCursor(url.searchParams.get('cursor'));

    const conditions = ['e.owner_id = ?', 'e.deleted_at IS NULL'];
    const bindings: unknown[] = [ownerId];
    if (kind !== null) {
      conditions.push('e.kind = ?');
      bindings.push(kind);
    }
    if (cursor !== null) {
      conditions.push('(e.updated_at < ? OR (e.updated_at = ? AND e.id < ?))');
      bindings.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
    }
    if (language !== null || query !== null || verification !== null) {
      const nested = ['s.owner_id = e.owner_id', 's.entry_id = e.id', 's.deleted_at IS NULL', 'q.deleted_at IS NULL'];
      if (language !== null) {
        nested.push('q.language_tag = ?');
        bindings.push(language);
      }
      if (query !== null) {
        nested.push("q.search_text LIKE ? ESCAPE '\\'");
        bindings.push(`%${escapeLike(query)}%`);
      }
      if (verification === 'verified') nested.push("q.status IN ('confirmed', 'manual')");
      if (verification === 'unverified') nested.push("q.status IN ('suggested', 'waiting', 'failed')");
      conditions.push(
        `EXISTS (SELECT 1 FROM lexicon_senses s JOIN lexicon_equivalents q
                   ON q.owner_id = s.owner_id AND q.sense_id = s.id
                  WHERE ${nested.join(' AND ')})`,
      );
    }
    if (mastery !== null) {
      const masteryCondition =
        mastery === 'new'
          ? 'p.reps = 0'
          : mastery === 'due'
            ? 'p.due_at <= ?'
            : mastery === 'learning'
              ? 'p.reps > 0 AND p.stability < 21'
              : 'p.stability >= 21';
      conditions.push(
        `EXISTS (SELECT 1 FROM lexicon_senses ms
                  JOIN lexicon_equivalents mq ON mq.owner_id = ms.owner_id AND mq.sense_id = ms.id
                  JOIN lexicon_practice_cards p ON p.owner_id = mq.owner_id AND p.equivalent_id = mq.id
                 WHERE ms.owner_id = e.owner_id AND ms.entry_id = e.id AND ms.deleted_at IS NULL
                   AND mq.deleted_at IS NULL
                   AND mq.status IN ('confirmed', 'manual') AND mq.fit <> 'false_friend'
                   ${language === null ? '' : 'AND mq.language_tag = ?'}
                   AND ${masteryCondition})`,
      );
      if (language !== null) bindings.push(language);
      if (mastery === 'due') bindings.push(iso(clock.now()));
    }

    const rows = await all<EntryRow>(
      c.env.DB
        .prepare(
          `SELECT e.id, e.kind, e.note, e.source, e.provenance_json, e.human_edited,
                  e.version, e.created_at, e.updated_at
             FROM lexicon_entries e
            WHERE ${conditions.join(' AND ')}
            ORDER BY e.updated_at DESC, e.id DESC
            LIMIT ?`,
        )
        .bind(...bindings, limit + 1),
    );
    const page = rows.slice(0, limit);
    const data = await Promise.all(page.map((row) => getEntry(c.env.DB, ownerId, row.id)));
    const last = page.at(-1);
    return c.json({
      data,
      page: {
        limit,
        nextCursor:
          rows.length > limit && last !== undefined
            ? encodeCursor({ updatedAt: last.updated_at, id: last.id })
            : null,
      },
    });
  });

  app.get('/entries/:entryId', async (c) => {
    const entry = await getEntry(c.env.DB, c.get('userId'), validId(c.req.param('entryId')));
    if (entry === null) return notFound(c);
    return c.json({ data: entry });
  });

  app.patch('/entries/:entryId', async (c) => {
    const ownerId = c.get('userId');
    const entryId = validId(c.req.param('entryId'));
    const body = object(await readJson(c.req.raw));
    const version = integer(body.version, 'version', 1);
    const assignments: string[] = [];
    const values: unknown[] = [];
    if ('kind' in body) pushAssignment(assignments, values, 'kind', enumValue(body.kind, 'kind', kinds));
    if ('note' in body) pushAssignment(assignments, values, 'note', optionalString(body.note, 'note', 2000));
    if ('source' in body) pushAssignment(assignments, values, 'source', optionalString(body.source, 'source', 500));
    if ('provenance' in body) {
      pushAssignment(assignments, values, 'provenance_json', encodeJson(jsonRecord(body.provenance, 'provenance')));
    }
    if (assignments.length === 0) throw new InputError('at least one editable field is required');
    const now = iso(clock.now());
    const result = await run(
      c.env.DB
        .prepare(
          `UPDATE lexicon_entries SET ${assignments.join(', ')}, human_edited = 1,
                  version = version + 1, updated_at = ?
            WHERE id = ? AND owner_id = ? AND version = ? AND deleted_at IS NULL`,
        )
        .bind(...values, now, entryId, ownerId, version),
    );
    if (changed(result) === 0) return await missingOrConflict(c, 'lexicon_entries', entryId, ownerId);
    return c.json({ data: await getEntry(c.env.DB, ownerId, entryId) });
  });

  app.delete('/entries/:entryId', async (c) => {
    const ownerId = c.get('userId');
    const entryId = validId(c.req.param('entryId'));
    const version = parseIfMatch(c.req.header('If-Match'));
    const now = iso(clock.now());
    const result = await run(
      c.env.DB
        .prepare(
          `UPDATE lexicon_entries SET deleted_at = ?, updated_at = ?, version = version + 1
            WHERE id = ? AND owner_id = ? AND version = ? AND deleted_at IS NULL`,
        )
        .bind(now, now, entryId, ownerId, version),
    );
    if (changed(result) === 0) return await missingOrConflict(c, 'lexicon_entries', entryId, ownerId);
    return c.body(null, 204);
  });

  app.post('/entries/:entryId/senses', async (c) => {
    const ownerId = c.get('userId');
    const entryId = validId(c.req.param('entryId'));
    if (!(await entryExists(c.env.DB, ownerId, entryId))) return notFound(c);
    const sense = parseSense(await readJson(c.req.raw));
    const now = clock.now();
    const senseId = ids.next();
    const max = await first<{ position: number }>(
      c.env.DB
        .prepare('SELECT COALESCE(MAX(position), -1) AS position FROM lexicon_senses WHERE owner_id = ? AND entry_id = ?')
        .bind(ownerId, entryId),
    );
    const statements: D1PreparedStatement[] = [
      c.env.DB
        .prepare(
          `INSERT INTO lexicon_senses
            (id, owner_id, entry_id, gloss, note, position, human_edited, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
        )
        .bind(senseId, ownerId, entryId, sense.gloss ?? null, sense.note ?? null, (max?.position ?? -1) + 1, iso(now), iso(now)),
    ];
    appendEquivalentInserts(statements, c.env.DB, ownerId, senseId, sense.equivalents, now, ids);
    statements.push(
      c.env.DB
        .prepare('UPDATE lexicon_entries SET version = version + 1, updated_at = ?, human_edited = 1 WHERE id = ? AND owner_id = ?')
        .bind(iso(now), entryId, ownerId),
    );
    await c.env.DB.batch(statements);
    return c.json({ data: await getSense(c.env.DB, ownerId, entryId, senseId) }, 201);
  });

  app.patch('/entries/:entryId/senses/:senseId', async (c) => {
    const ownerId = c.get('userId');
    const entryId = validId(c.req.param('entryId'));
    const senseId = validId(c.req.param('senseId'));
    const body = object(await readJson(c.req.raw));
    const version = integer(body.version, 'version', 1);
    const assignments: string[] = [];
    const values: unknown[] = [];
    if ('gloss' in body) pushAssignment(assignments, values, 'gloss', optionalString(body.gloss, 'gloss', 500));
    if ('note' in body) pushAssignment(assignments, values, 'note', optionalString(body.note, 'note', 2000));
    if ('position' in body) pushAssignment(assignments, values, 'position', integer(body.position, 'position'));
    if (assignments.length === 0) throw new InputError('at least one editable field is required');
    const now = iso(clock.now());
    const result = await run(
      c.env.DB
        .prepare(
          `UPDATE lexicon_senses SET ${assignments.join(', ')}, human_edited = 1,
                  version = version + 1, updated_at = ?
            WHERE id = ? AND owner_id = ? AND entry_id = ? AND version = ? AND deleted_at IS NULL
              AND EXISTS (SELECT 1 FROM lexicon_entries e WHERE e.id = entry_id AND e.owner_id = owner_id AND e.deleted_at IS NULL)`,
        )
        .bind(...values, now, senseId, ownerId, entryId, version),
    );
    if (changed(result) === 0) {
      return (await findSenseRow(c.env.DB, ownerId, entryId, senseId)) === null ? notFound(c) : conflict(c);
    }
    return c.json({ data: await getSense(c.env.DB, ownerId, entryId, senseId) });
  });

  app.delete('/entries/:entryId/senses/:senseId', async (c) => {
    const ownerId = c.get('userId');
    const entryId = validId(c.req.param('entryId'));
    const senseId = validId(c.req.param('senseId'));
    const version = parseIfMatch(c.req.header('If-Match'));
    const now = iso(clock.now());
    const result = await run(
      c.env.DB
        .prepare(
          `UPDATE lexicon_senses SET deleted_at = ?, updated_at = ?, version = version + 1
            WHERE id = ? AND owner_id = ? AND entry_id = ? AND version = ? AND deleted_at IS NULL
              AND EXISTS (SELECT 1 FROM lexicon_entries e
                           WHERE e.id = entry_id AND e.owner_id = owner_id AND e.deleted_at IS NULL)`,
        )
        .bind(now, now, senseId, ownerId, entryId, version),
    );
    if (changed(result) === 0) {
      return (await findSenseRow(c.env.DB, ownerId, entryId, senseId)) === null ? notFound(c) : conflict(c);
    }
    return c.body(null, 204);
  });

  app.post('/entries/:entryId/senses/:senseId/equivalents', async (c) => {
    const ownerId = c.get('userId');
    const entryId = validId(c.req.param('entryId'));
    const senseId = validId(c.req.param('senseId'));
    if ((await findSenseRow(c.env.DB, ownerId, entryId, senseId)) === null) return notFound(c);
    const equivalent = parseEquivalent(await readJson(c.req.raw));
    const now = clock.now();
    const equivalentId = ids.next();
    const statements: D1PreparedStatement[] = [];
    appendEquivalentInserts(statements, c.env.DB, ownerId, senseId, [equivalent], now, ids, [equivalentId]);
    await c.env.DB.batch(statements);
    return c.json({ data: await getEquivalent(c.env.DB, ownerId, entryId, senseId, equivalentId) }, 201);
  });

  app.patch('/entries/:entryId/senses/:senseId/equivalents/:equivalentId', async (c) => {
    const ownerId = c.get('userId');
    const entryId = validId(c.req.param('entryId'));
    const senseId = validId(c.req.param('senseId'));
    const equivalentId = validId(c.req.param('equivalentId'));
    const existing = await findEquivalentRow(c.env.DB, ownerId, entryId, senseId, equivalentId);
    if (existing === null) return notFound(c);
    const body = object(await readJson(c.req.raw));
    const version = integer(body.version, 'version', 1);
    const status = 'status' in body
      ? enumValue<TranslationStatus>(body.status, 'status', ['suggested', 'confirmed', 'waiting', 'failed', 'manual'])
      : existing.status;
    const parsedText = 'text' in body ? optionalString(body.text, 'text', 500) : existing.text;
    const textValue = parsedText === undefined ? existing.text : parsedText;
    if ((status === 'waiting' || status === 'failed') && textValue !== null) {
      throw new InputError(`text must be null for ${status} translations`);
    }
    if ((status === 'suggested' || status === 'confirmed' || status === 'manual') && !textValue) {
      throw new InputError(`text is required for ${status} translations`);
    }
    const fit = 'fit' in body
      ? enumValue<FitLabel>(body.fit, 'fit', ['exact', 'broader', 'narrower', 'context_only', 'false_friend'])
      : existing.fit;
    const language = 'languageTag' in body ? languageTag(body.languageTag) : existing.language_tag;
    const assignments: string[] = ['language_tag = ?', 'text = ?', 'search_text = ?', 'fit = ?', 'status = ?'];
    const values: unknown[] = [language, textValue, textValue === null ? null : normalizeSearchText(textValue), fit, status];
    for (const [inputKey, column, max] of [
      ['note', 'note', 2000],
      ['source', 'source', 500],
    ] as const) {
      if (inputKey in body) pushAssignment(assignments, values, column, optionalString(body[inputKey], inputKey, max));
    }
    if ('provenance' in body) pushAssignment(assignments, values, 'provenance_json', encodeJson(jsonRecord(body.provenance, 'provenance')));
    if ('scriptData' in body) pushAssignment(assignments, values, 'script_data_json', encodeJson(jsonRecord(body.scriptData, 'scriptData')));
    const now = clock.now();
    const update = c.env.DB
      .prepare(
        `UPDATE lexicon_equivalents SET ${assignments.join(', ')}, human_edited = 1,
                version = version + 1, updated_at = ?
          WHERE id = ? AND owner_id = ? AND sense_id = ? AND version = ? AND deleted_at IS NULL`,
      )
      .bind(...values, iso(now), equivalentId, ownerId, senseId, version);
    const statements: D1PreparedStatement[] = [update];
    if (isPracticeEligible(status, fit)) appendCardStatements(statements, c.env.DB, ownerId, equivalentId, now, ids);
    const results = await c.env.DB.batch(statements);
    if (changed(results[0]!) === 0) return conflict(c);
    return c.json({ data: await getEquivalent(c.env.DB, ownerId, entryId, senseId, equivalentId) });
  });

  app.delete('/entries/:entryId/senses/:senseId/equivalents/:equivalentId', async (c) => {
    const ownerId = c.get('userId');
    const entryId = validId(c.req.param('entryId'));
    const senseId = validId(c.req.param('senseId'));
    const equivalentId = validId(c.req.param('equivalentId'));
    const version = parseIfMatch(c.req.header('If-Match'));
    const now = iso(clock.now());
    const result = await run(
      c.env.DB
        .prepare(
          `UPDATE lexicon_equivalents SET deleted_at = ?, updated_at = ?, version = version + 1
            WHERE id = ? AND owner_id = ? AND sense_id = ? AND version = ? AND deleted_at IS NULL
              AND EXISTS (SELECT 1 FROM lexicon_senses s WHERE s.id = sense_id AND s.owner_id = owner_id
                            AND s.entry_id = ? AND s.deleted_at IS NULL
                            AND EXISTS (SELECT 1 FROM lexicon_entries e
                                        WHERE e.id = s.entry_id AND e.owner_id = s.owner_id AND e.deleted_at IS NULL))`,
        )
        .bind(now, now, equivalentId, ownerId, senseId, version, entryId),
    );
    if (changed(result) === 0) {
      return (await findEquivalentRow(c.env.DB, ownerId, entryId, senseId, equivalentId)) === null ? notFound(c) : conflict(c);
    }
    return c.body(null, 204);
  });

  app.post('/entries/:entryId/senses/:senseId/suggestions', async (c) => {
    const ownerId = c.get('userId');
    const entryId = validId(c.req.param('entryId'));
    const senseId = validId(c.req.param('senseId'));
    const sense = await findSenseRow(c.env.DB, ownerId, entryId, senseId);
    if (sense === null) return notFound(c);
    const body = object(await readJson(c.req.raw));
    const sourceEquivalentId = validId(string(body.sourceEquivalentId, 'sourceEquivalentId', { min: 1, max: 200 })!);
    const source = await findEquivalentRow(c.env.DB, ownerId, entryId, senseId, sourceEquivalentId);
    if (source === null || source.text === null) return notFound(c);
    const targetLanguage = languageTag(body.targetLanguage, 'targetLanguage');
    const service = new TranslationSuggestionService(c.env.DB, provider, clock);
    const result = await service.suggest({
      ownerId,
      sourceLanguage: source.language_tag,
      targetLanguage,
      text: source.text,
      senseVersion: sense.version,
      ...(sense.gloss === null ? {} : { sense: sense.gloss }),
    });
    // Suggestions are returned for review only. Existing equivalents, especially human
    // corrections, are never overwritten by a provider retry.
    return c.json({ data: result.suggestions, cache: result.cache });
  });

  app.post('/entries/:entryId/senses/:senseId/equivalents/:equivalentId/cloze', async (c) => {
    const ownerId = c.get('userId');
    const entryId = validId(c.req.param('entryId'));
    const senseId = validId(c.req.param('senseId'));
    const equivalentId = validId(c.req.param('equivalentId'));
    const equivalent = await findEquivalentRow(c.env.DB, ownerId, entryId, senseId, equivalentId);
    if (equivalent === null) return notFound(c);
    if (!isPracticeEligible(equivalent.status, equivalent.fit)) {
      return c.json(errorBody('UNVERIFIED_EQUIVALENT', 'Cloze data requires a verified non-false-friend equivalent'), 409);
    }
    const body = object(await readJson(c.req.raw));
    const template = string(body.template, 'template', { min: 1, max: 1000 })!;
    if ((template.match(/\{\{blank\}\}/gu) ?? []).length !== 1) {
      throw new InputError('template must contain exactly one {{blank}} marker');
    }
    const answer = string(body.answer, 'answer', { min: 1, max: 500 })!;
    const accepted = body.acceptedAnswers ?? [];
    if (!Array.isArray(accepted) || accepted.length > 20) throw new InputError('acceptedAnswers must contain at most 20 items');
    const acceptedAnswers = accepted.map((item, index) => string(item, `acceptedAnswers[${index}]`, { min: 1, max: 500 })!);
    const now = iso(clock.now());
    const clozeId = ids.next();
    await run(
      c.env.DB
        .prepare(
          `INSERT INTO lexicon_cloze_items
            (id, owner_id, equivalent_id, language_tag, template, answer, accepted_answers_json,
             hint, provenance_json, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .bind(
          clozeId,
          ownerId,
          equivalentId,
          equivalent.language_tag,
          template,
          answer,
          JSON.stringify(acceptedAnswers),
          optionalString(body.hint, 'hint', 500) ?? null,
          encodeJson(jsonRecord(body.provenance, 'provenance')),
          now,
          now,
        ),
    );
    return c.json({ data: await getCloze(c.env.DB, ownerId, equivalentId, clozeId) }, 201);
  });

  app.get('/entries/:entryId/senses/:senseId/equivalents/:equivalentId/cloze', async (c) => {
    const ownerId = c.get('userId');
    const entryId = validId(c.req.param('entryId'));
    const senseId = validId(c.req.param('senseId'));
    const equivalentId = validId(c.req.param('equivalentId'));
    if ((await findEquivalentRow(c.env.DB, ownerId, entryId, senseId, equivalentId)) === null) return notFound(c);
    const items = await all<ClozeRow>(
      c.env.DB
        .prepare(
          `SELECT id, equivalent_id, language_tag, template, answer, accepted_answers_json,
                  hint, provenance_json, version, created_at, updated_at
             FROM lexicon_cloze_items
            WHERE owner_id = ? AND equivalent_id = ? AND deleted_at IS NULL ORDER BY created_at, id`,
        )
        .bind(ownerId, equivalentId),
    );
    if (items.length === 0) {
      return c.json({ data: [], unavailable: { code: 'NO_VALIDATED_CLOZE', message: 'No validated cloze data is available' } });
    }
    return c.json({ data: items.map(mapCloze) });
  });

  app.post('/cloze/:clozeId/check', async (c) => {
    const ownerId = c.get('userId');
    const clozeId = validId(c.req.param('clozeId'));
    const body = object(await readJson(c.req.raw));
    const actual = string(body.answer, 'answer', { max: 500 })!;
    const item = await first<ClozeRow>(
      c.env.DB
        .prepare(
          `SELECT c.id, c.equivalent_id, c.language_tag, c.template, c.answer, c.accepted_answers_json,
                  c.hint, c.provenance_json, c.version, c.created_at, c.updated_at
             FROM lexicon_cloze_items c
             JOIN lexicon_equivalents q ON q.id = c.equivalent_id AND q.owner_id = c.owner_id
             JOIN lexicon_senses s ON s.id = q.sense_id AND s.owner_id = q.owner_id
             JOIN lexicon_entries e ON e.id = s.entry_id AND e.owner_id = s.owner_id
            WHERE c.id = ? AND c.owner_id = ? AND c.deleted_at IS NULL AND q.deleted_at IS NULL
              AND q.status IN ('confirmed', 'manual') AND q.fit <> 'false_friend'
              AND s.deleted_at IS NULL AND e.deleted_at IS NULL`,
        )
        .bind(clozeId, ownerId),
    );
    if (item === null) return notFound(c);
    const validAnswers = [item.answer, ...(JSON.parse(item.accepted_answers_json) as string[])];
    return c.json({ data: { correct: validAnswers.some((expected) => answersMatch(item.language_tag, actual, expected)) } });
  });

  app.get('/practice/due', async (c) => {
    const ownerId = c.get('userId');
    const url = new URL(c.req.url);
    const language = languageTag(url.searchParams.get('language'), 'language');
    const direction = enumValue<PracticeDirection>(url.searchParams.get('direction'), 'direction', directions);
    const format = enumValue<PracticeFormat>(url.searchParams.get('format'), 'format', formats);
    const sessionId = validId(string(url.searchParams.get('sessionId'), 'sessionId', { min: 1, max: 200 })!);
    const limit = parseLimit(url.searchParams.get('limit'), 20);
    const now = iso(clock.now());
    const formatCondition =
      format === 'cloze'
        ? `AND EXISTS (SELECT 1 FROM lexicon_cloze_items c
                       WHERE c.owner_id = p.owner_id AND c.equivalent_id = p.equivalent_id AND c.deleted_at IS NULL)`
        : '';
    const rows = await all<CardRow & EquivalentRow & { gloss: string | null; revisit: number }>(
      c.env.DB
        .prepare(
          `SELECT p.id, p.equivalent_id, p.language_tag, p.direction, p.due_at, p.stability,
                  p.difficulty, p.elapsed_days, p.scheduled_days, p.learning_steps, p.reps,
                  p.lapses, p.state, p.last_review_at, p.revision,
                  q.sense_id, q.text, q.fit, q.status, q.note, q.source, q.provenance_json,
                  q.script_data_json, q.human_edited, q.version, q.created_at, q.updated_at,
                  s.gloss,
                  CASE WHEN wr.card_id IS NULL THEN 0 ELSE 1 END AS revisit
             FROM lexicon_practice_cards p
             JOIN lexicon_equivalents q ON q.id = p.equivalent_id AND q.owner_id = p.owner_id
             JOIN lexicon_senses s ON s.id = q.sense_id AND s.owner_id = q.owner_id
             JOIN lexicon_entries e ON e.id = s.entry_id AND e.owner_id = s.owner_id
             LEFT JOIN lexicon_wrong_revisits wr ON wr.owner_id = p.owner_id AND wr.card_id = p.id
                    AND wr.session_id = ? AND wr.completed_at IS NULL AND wr.due_at <= ?
            WHERE p.owner_id = ? AND p.language_tag = ? AND p.direction = ?
              AND (p.due_at <= ? OR wr.card_id IS NOT NULL)
              AND q.status IN ('confirmed', 'manual') AND q.fit <> 'false_friend'
              AND q.deleted_at IS NULL AND s.deleted_at IS NULL AND e.deleted_at IS NULL
              AND (s.gloss IS NOT NULL OR EXISTS (
                    SELECT 1 FROM lexicon_equivalents prompt
                     WHERE prompt.owner_id = q.owner_id AND prompt.sense_id = q.sense_id
                       AND prompt.id <> q.id AND prompt.text IS NOT NULL
                       AND prompt.status IN ('confirmed', 'manual') AND prompt.fit <> 'false_friend'
                       AND prompt.deleted_at IS NULL))
              ${formatCondition}
            ORDER BY revisit DESC, p.due_at, p.id
            LIMIT ?`,
        )
        .bind(sessionId, now, ownerId, language, direction, now, limit),
    );
    const data = await Promise.all(
      rows.map(async (row) => ({
        card: mapCard(row),
        target: { id: row.equivalent_id, text: row.text, languageTag: row.language_tag },
        prompt: await buildPrompt(c.env.DB, ownerId, row.sense_id, row.equivalent_id, row.gloss),
        cloze: format === 'cloze' ? await firstCloze(c.env.DB, ownerId, row.equivalent_id) : null,
        revisit: row.revisit === 1,
      })),
    );
    const next = await first<{ due_at: string }>(
      c.env.DB
        .prepare(
          `SELECT MIN(p.due_at) AS due_at
             FROM lexicon_practice_cards p
             JOIN lexicon_equivalents q ON q.id = p.equivalent_id AND q.owner_id = p.owner_id
             JOIN lexicon_senses s ON s.id = q.sense_id AND s.owner_id = q.owner_id
             JOIN lexicon_entries e ON e.id = s.entry_id AND e.owner_id = s.owner_id
            WHERE p.owner_id = ? AND p.language_tag = ? AND p.direction = ? AND p.due_at > ?
              AND q.status IN ('confirmed', 'manual') AND q.fit <> 'false_friend'
              AND q.deleted_at IS NULL AND s.deleted_at IS NULL AND e.deleted_at IS NULL
              AND (s.gloss IS NOT NULL OR EXISTS (
                    SELECT 1 FROM lexicon_equivalents prompt
                     WHERE prompt.owner_id = q.owner_id AND prompt.sense_id = q.sense_id
                       AND prompt.id <> q.id AND prompt.text IS NOT NULL
                       AND prompt.status IN ('confirmed', 'manual') AND prompt.fit <> 'false_friend'
                       AND prompt.deleted_at IS NULL))
              ${formatCondition}`,
        )
        .bind(ownerId, language, direction, now),
    );
    return c.json({ data, nextDueAt: data.length === 0 ? next?.due_at ?? null : null });
  });

  app.post('/practice/reviews', async (c) => {
    const ownerId = c.get('userId');
    const body = object(await readJson(c.req.raw));
    const submissionId = validId(string(body.submissionId, 'submissionId', { min: 1, max: 200 })!);
    const cardId = validId(string(body.cardId, 'cardId', { min: 1, max: 200 })!);
    const sessionId = validId(string(body.sessionId, 'sessionId', { min: 1, max: 200 })!);
    const rating = reviewRating(body.rating);
    const result = await submitReview(c.env.DB, ownerId, { submissionId, cardId, sessionId, rating }, clock, ids, wrongDelayMs);
    if (result === null) return notFound(c);
    if (result === 'conflict') return c.json(errorBody('IDEMPOTENCY_CONFLICT', 'submissionId was already used for different review data'), 409);
    return c.json({ data: result.value, replayed: result.replayed }, result.replayed ? 200 : 201);
  });

  app.get('/practice/cards/:cardId/reviews', async (c) => {
    const ownerId = c.get('userId');
    const cardId = validId(c.req.param('cardId'));
    const url = new URL(c.req.url);
    const limit = parseLimit(url.searchParams.get('limit'));
    const cursor = parseReviewCursor(url.searchParams.get('cursor'));
    const card = await first<{ id: string }>(
      c.env.DB.prepare('SELECT id FROM lexicon_practice_cards WHERE id = ? AND owner_id = ?').bind(cardId, ownerId),
    );
    if (card === null) return notFound(c);
    const history = await all<ReviewEventRow>(
      c.env.DB
        .prepare(
          `SELECT id, submission_id, card_id, session_id, rating, reviewed_at, prior_revision,
                  resulting_revision, result_json
             FROM lexicon_review_events
            WHERE owner_id = ? AND card_id = ?
              ${cursor === null ? '' : 'AND (reviewed_at < ? OR (reviewed_at = ? AND id < ?))'}
            ORDER BY reviewed_at DESC, id DESC LIMIT ?`,
        )
        .bind(
          ownerId,
          cardId,
          ...(cursor === null ? [] : [cursor.reviewedAt, cursor.reviewedAt, cursor.id]),
          limit + 1,
        ),
    );
    const page = history.slice(0, limit);
    const last = page.at(-1);
    return c.json({
      data: page.map(mapReviewEvent),
      page: {
        limit,
        nextCursor:
          history.length > limit && last !== undefined
            ? encodeReviewCursor({ reviewedAt: last.reviewed_at, id: last.id })
            : null,
      },
    });
  });

  app.get('/progress', async (c) => {
    const ownerId = c.get('userId');
    const language = languageTag(new URL(c.req.url).searchParams.get('language'), 'language');
    const now = iso(clock.now());
    const rows = await all<{
      direction: PracticeDirection;
      total: number;
      due: number;
      new_count: number;
      average_stability: number | null;
    }>(
      c.env.DB
        .prepare(
          `SELECT p.direction, COUNT(*) AS total,
                  SUM(CASE WHEN p.due_at <= ? THEN 1 ELSE 0 END) AS due,
                  SUM(CASE WHEN p.reps = 0 THEN 1 ELSE 0 END) AS new_count,
                  AVG(CASE WHEN p.reps > 0 THEN p.stability ELSE NULL END) AS average_stability
             FROM lexicon_practice_cards p
             JOIN lexicon_equivalents q ON q.id = p.equivalent_id AND q.owner_id = p.owner_id
             JOIN lexicon_senses s ON s.id = q.sense_id AND s.owner_id = q.owner_id
             JOIN lexicon_entries e ON e.id = s.entry_id AND e.owner_id = s.owner_id
            WHERE p.owner_id = ? AND p.language_tag = ?
              AND q.status IN ('confirmed', 'manual') AND q.fit <> 'false_friend'
              AND q.deleted_at IS NULL AND s.deleted_at IS NULL AND e.deleted_at IS NULL
            GROUP BY p.direction ORDER BY p.direction`,
        )
        .bind(now, ownerId, language),
    );
    return c.json({
      data: directions.map((direction) => {
        const row = rows.find((item) => item.direction === direction);
        return {
          languageTag: language,
          direction,
          total: row?.total ?? 0,
          due: row?.due ?? 0,
          new: row?.new_count ?? 0,
          averageStabilityDays: row?.average_stability ?? null,
        };
      }),
    });
  });

  return app;
}

function appendEquivalentInserts(
  statements: D1PreparedStatement[],
  db: D1Database,
  ownerId: string,
  senseId: string,
  equivalents: ReturnType<typeof parseEquivalent>[],
  now: Date,
  ids: IdGenerator,
  providedIds: string[] = [],
): void {
  equivalents.forEach((equivalent, index) => {
    const equivalentId = providedIds[index] ?? ids.next();
    statements.push(
      db
        .prepare(
          `INSERT INTO lexicon_equivalents
            (id, owner_id, sense_id, language_tag, text, search_text, fit, status, note, source,
             provenance_json, script_data_json, human_edited, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
        )
        .bind(
          equivalentId,
          ownerId,
          senseId,
          equivalent.languageTag,
          equivalent.text ?? null,
          equivalent.text == null ? null : normalizeSearchText(equivalent.text),
          equivalent.fit ?? 'exact',
          equivalent.status,
          equivalent.note ?? null,
          equivalent.source ?? null,
          encodeJson(equivalent.provenance),
          encodeJson(equivalent.scriptData),
          iso(now),
          iso(now),
        ),
    );
    if (isPracticeEligible(equivalent.status, equivalent.fit ?? 'exact')) {
      appendCardStatements(statements, db, ownerId, equivalentId, now, ids);
    }
  });
}

async function getEntry(db: D1Database, ownerId: string, entryId: string): Promise<Record<string, unknown> | null> {
  const entry = await first<EntryRow>(
    db
      .prepare(
        `SELECT id, kind, note, source, provenance_json, human_edited, version, created_at, updated_at
           FROM lexicon_entries WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`,
      )
      .bind(entryId, ownerId),
  );
  if (entry === null) return null;
  const senses = await all<SenseRow>(
    db
      .prepare(
        `SELECT id, entry_id, gloss, note, position, human_edited, version, created_at, updated_at
           FROM lexicon_senses
          WHERE owner_id = ? AND entry_id = ? AND deleted_at IS NULL ORDER BY position, id`,
      )
      .bind(ownerId, entryId),
  );
  const mappedSenses = await Promise.all(senses.map((sense) => mapSenseWithEquivalents(db, ownerId, sense)));
  return { ...mapEntry(entry), senses: mappedSenses };
}

async function getSense(
  db: D1Database,
  ownerId: string,
  entryId: string,
  senseId: string,
): Promise<Record<string, unknown> | null> {
  const row = await findSenseRow(db, ownerId, entryId, senseId);
  return row === null ? null : await mapSenseWithEquivalents(db, ownerId, row);
}

async function findSenseRow(db: D1Database, ownerId: string, entryId: string, senseId: string): Promise<SenseRow | null> {
  return await first<SenseRow>(
    db
      .prepare(
        `SELECT s.id, s.entry_id, s.gloss, s.note, s.position, s.human_edited,
                s.version, s.created_at, s.updated_at
           FROM lexicon_senses s
           JOIN lexicon_entries e ON e.id = s.entry_id AND e.owner_id = s.owner_id
          WHERE s.id = ? AND s.owner_id = ? AND s.entry_id = ?
            AND s.deleted_at IS NULL AND e.deleted_at IS NULL`,
      )
      .bind(senseId, ownerId, entryId),
  );
}

async function mapSenseWithEquivalents(db: D1Database, ownerId: string, sense: SenseRow): Promise<Record<string, unknown>> {
  const equivalents = await all<EquivalentRow>(
    db
      .prepare(
        `SELECT id, sense_id, language_tag, text, fit, status, note, source, provenance_json,
                script_data_json, human_edited, version, created_at, updated_at
           FROM lexicon_equivalents
          WHERE owner_id = ? AND sense_id = ? AND deleted_at IS NULL ORDER BY language_tag, created_at, id`,
      )
      .bind(ownerId, sense.id),
  );
  return { ...mapSense(sense), equivalents: equivalents.map(mapEquivalent) };
}

async function getEquivalent(
  db: D1Database,
  ownerId: string,
  entryId: string,
  senseId: string,
  equivalentId: string,
): Promise<Record<string, unknown> | null> {
  const row = await findEquivalentRow(db, ownerId, entryId, senseId, equivalentId);
  return row === null ? null : mapEquivalent(row);
}

async function findEquivalentRow(
  db: D1Database,
  ownerId: string,
  entryId: string,
  senseId: string,
  equivalentId: string,
): Promise<EquivalentRow | null> {
  return await first<EquivalentRow>(
    db
      .prepare(
        `SELECT q.id, q.sense_id, q.language_tag, q.text, q.fit, q.status, q.note, q.source,
                q.provenance_json, q.script_data_json, q.human_edited, q.version,
                q.created_at, q.updated_at
           FROM lexicon_equivalents q
           JOIN lexicon_senses s ON s.id = q.sense_id AND s.owner_id = q.owner_id
           JOIN lexicon_entries e ON e.id = s.entry_id AND e.owner_id = s.owner_id
          WHERE q.id = ? AND q.owner_id = ? AND q.sense_id = ? AND s.entry_id = ?
            AND q.deleted_at IS NULL AND s.deleted_at IS NULL AND e.deleted_at IS NULL`,
      )
      .bind(equivalentId, ownerId, senseId, entryId),
  );
}

function mapEntry(row: EntryRow): Record<string, unknown> {
  return {
    id: row.id,
    kind: row.kind,
    note: row.note,
    source: row.source,
    provenance: decodeJson(row.provenance_json),
    humanEdited: row.human_edited === 1,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSense(row: SenseRow): Record<string, unknown> {
  return {
    id: row.id,
    entryId: row.entry_id,
    gloss: row.gloss,
    note: row.note,
    position: row.position,
    humanEdited: row.human_edited === 1,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEquivalent(row: EquivalentRow): Record<string, unknown> {
  return {
    id: row.id,
    senseId: row.sense_id,
    languageTag: row.language_tag,
    text: row.text,
    fit: row.fit,
    status: row.status,
    note: row.note,
    source: row.source,
    provenance: decodeJson(row.provenance_json),
    scriptData: decodeJson(row.script_data_json),
    humanEdited: row.human_edited === 1,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface ClozeRow {
  id: string;
  equivalent_id: string;
  language_tag: string;
  template: string;
  answer: string;
  accepted_answers_json: string;
  hint: string | null;
  provenance_json: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

async function getCloze(db: D1Database, ownerId: string, equivalentId: string, clozeId: string): Promise<Record<string, unknown> | null> {
  const row = await first<ClozeRow>(
    db
      .prepare(
        `SELECT id, equivalent_id, language_tag, template, answer, accepted_answers_json,
                hint, provenance_json, version, created_at, updated_at
           FROM lexicon_cloze_items
          WHERE id = ? AND owner_id = ? AND equivalent_id = ? AND deleted_at IS NULL`,
      )
      .bind(clozeId, ownerId, equivalentId),
  );
  return row === null ? null : mapCloze(row);
}

function mapCloze(row: ClozeRow): Record<string, unknown> {
  return {
    id: row.id,
    equivalentId: row.equivalent_id,
    languageTag: row.language_tag,
    template: row.template,
    answer: row.answer,
    acceptedAnswers: JSON.parse(row.accepted_answers_json) as string[],
    hint: row.hint,
    provenance: decodeJson(row.provenance_json),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function firstCloze(db: D1Database, ownerId: string, equivalentId: string): Promise<Record<string, unknown> | null> {
  const row = await first<ClozeRow>(
    db
      .prepare(
        `SELECT id, equivalent_id, language_tag, template, answer, accepted_answers_json,
                hint, provenance_json, version, created_at, updated_at
           FROM lexicon_cloze_items
          WHERE owner_id = ? AND equivalent_id = ? AND deleted_at IS NULL ORDER BY created_at, id LIMIT 1`,
      )
      .bind(ownerId, equivalentId),
  );
  return row === null ? null : mapCloze(row);
}

async function buildPrompt(
  db: D1Database,
  ownerId: string,
  senseId: string,
  targetId: string,
  gloss: string | null,
): Promise<Record<string, unknown>> {
  if (gloss !== null) return { type: 'gloss', text: gloss };
  const prompt = await first<{ id: string; language_tag: string; text: string }>(
    db
      .prepare(
        `SELECT id, language_tag, text FROM lexicon_equivalents
          WHERE owner_id = ? AND sense_id = ? AND id <> ? AND text IS NOT NULL
            AND status IN ('confirmed', 'manual') AND fit <> 'false_friend' AND deleted_at IS NULL
          ORDER BY language_tag, created_at, id LIMIT 1`,
      )
      .bind(ownerId, senseId, targetId),
  );
  return { type: 'equivalent', id: prompt!.id, languageTag: prompt!.language_tag, text: prompt!.text };
}

function mapCard(row: CardRow): Record<string, unknown> {
  return {
    id: row.id,
    equivalentId: row.equivalent_id,
    languageTag: row.language_tag,
    direction: row.direction,
    dueAt: row.due_at,
    stability: row.stability,
    difficulty: row.difficulty,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    revision: row.revision,
  };
}

interface ReviewEventRow {
  id: string;
  submission_id: string;
  card_id: string;
  session_id: string;
  rating: ReviewRating;
  reviewed_at: string;
  prior_revision: number;
  resulting_revision: number;
  result_json: string;
}

interface ReviewInput {
  submissionId: string;
  cardId: string;
  sessionId: string;
  rating: ReviewRating;
}

type SubmitResult = { value: Record<string, unknown>; replayed: boolean } | 'conflict' | null;

async function submitReview(
  db: D1Database,
  ownerId: string,
  input: ReviewInput,
  clock: Clock,
  ids: IdGenerator,
  wrongDelayMs: number,
): Promise<SubmitResult> {
  const reviewedAt = clock.now();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const previous = await findReviewBySubmission(db, ownerId, input.submissionId);
    if (previous !== null) return replayResult(previous, input);

    const card = await loadEligibleCard(db, ownerId, input.cardId);
    if (card === null) return null;
    const scheduled = scheduleReview(toStoredCard(card), input.rating, reviewedAt);
    const eventId = ids.next();
    const resultValue = {
      eventId,
      submissionId: input.submissionId,
      cardId: input.cardId,
      sessionId: input.sessionId,
      rating: input.rating,
      reviewedAt: iso(reviewedAt),
      priorRevision: card.revision,
      resultingRevision: card.revision + 1,
      card: { ...scheduled, revision: card.revision + 1 },
    };
    const statements: D1PreparedStatement[] = [
      db
        .prepare(
          `INSERT INTO lexicon_review_events
            (id, owner_id, submission_id, card_id, session_id, rating, reviewed_at,
             prior_revision, resulting_revision, result_json)
           SELECT ?, ?, ?, p.id, ?, ?, ?, ?, ?, ?
             FROM lexicon_practice_cards p
             JOIN lexicon_equivalents q ON q.id = p.equivalent_id AND q.owner_id = p.owner_id
             JOIN lexicon_senses s ON s.id = q.sense_id AND s.owner_id = q.owner_id
             JOIN lexicon_entries e ON e.id = s.entry_id AND e.owner_id = s.owner_id
            WHERE p.id = ? AND p.owner_id = ? AND p.revision = ?
              AND q.status IN ('confirmed', 'manual') AND q.fit <> 'false_friend'
              AND q.deleted_at IS NULL AND s.deleted_at IS NULL AND e.deleted_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM lexicon_review_events r
                               WHERE r.owner_id = ? AND r.submission_id = ?)
           ON CONFLICT(owner_id, submission_id) DO NOTHING`,
        )
        .bind(
          eventId,
          ownerId,
          input.submissionId,
          input.sessionId,
          input.rating,
          iso(reviewedAt),
          card.revision,
          card.revision + 1,
          JSON.stringify(resultValue),
          input.cardId,
          ownerId,
          card.revision,
          ownerId,
          input.submissionId,
        ),
      db
        .prepare(
          `UPDATE lexicon_practice_cards SET due_at = ?, stability = ?, difficulty = ?,
                  elapsed_days = ?, scheduled_days = ?, learning_steps = ?, reps = ?, lapses = ?,
                  state = ?, last_review_at = ?, revision = revision + 1, updated_at = ?
            WHERE id = ? AND owner_id = ? AND revision = ?
              AND EXISTS (SELECT 1 FROM lexicon_review_events r WHERE r.id = ? AND r.owner_id = ?)`,
        )
        .bind(
          scheduled.dueAt,
          scheduled.stability,
          scheduled.difficulty,
          scheduled.elapsedDays,
          scheduled.scheduledDays,
          scheduled.learningSteps,
          scheduled.reps,
          scheduled.lapses,
          scheduled.state,
          scheduled.lastReviewAt,
          iso(reviewedAt),
          input.cardId,
          ownerId,
          card.revision,
          eventId,
          ownerId,
        ),
    ];
    if (input.rating === 1) {
      statements.push(
        db
          .prepare(
            `INSERT INTO lexicon_wrong_revisits (owner_id, session_id, card_id, due_at, completed_at)
             SELECT ?, ?, ?, ?, NULL
              WHERE EXISTS (SELECT 1 FROM lexicon_review_events WHERE id = ? AND owner_id = ?)
             ON CONFLICT(owner_id, session_id, card_id) DO UPDATE SET
               due_at = excluded.due_at, completed_at = NULL`,
          )
          .bind(ownerId, input.sessionId, input.cardId, iso(new Date(reviewedAt.getTime() + wrongDelayMs)), eventId, ownerId),
      );
    } else {
      statements.push(
        db
          .prepare(
            `UPDATE lexicon_wrong_revisits SET completed_at = ?
              WHERE owner_id = ? AND session_id = ? AND card_id = ? AND completed_at IS NULL
                AND EXISTS (SELECT 1 FROM lexicon_review_events WHERE id = ? AND owner_id = ?)`
          )
          .bind(iso(reviewedAt), ownerId, input.sessionId, input.cardId, eventId, ownerId),
      );
    }
    const results = await db.batch(statements);
    if (changed(results[0]!) > 0 && changed(results[1]!) > 0) return { value: resultValue, replayed: false };
    const winner = await findReviewBySubmission(db, ownerId, input.submissionId);
    if (winner !== null) return replayResult(winner, input);
  }
  throw new Error('Concurrent review retry limit exceeded');
}

async function loadEligibleCard(db: D1Database, ownerId: string, cardId: string): Promise<CardRow | null> {
  return await first<CardRow>(
    db
      .prepare(
        `SELECT p.id, p.equivalent_id, p.language_tag, p.direction, p.due_at, p.stability,
                p.difficulty, p.elapsed_days, p.scheduled_days, p.learning_steps, p.reps,
                p.lapses, p.state, p.last_review_at, p.revision
           FROM lexicon_practice_cards p
           JOIN lexicon_equivalents q ON q.id = p.equivalent_id AND q.owner_id = p.owner_id
           JOIN lexicon_senses s ON s.id = q.sense_id AND s.owner_id = q.owner_id
           JOIN lexicon_entries e ON e.id = s.entry_id AND e.owner_id = s.owner_id
          WHERE p.id = ? AND p.owner_id = ? AND q.status IN ('confirmed', 'manual')
            AND q.fit <> 'false_friend' AND q.deleted_at IS NULL AND s.deleted_at IS NULL AND e.deleted_at IS NULL`,
      )
      .bind(cardId, ownerId),
  );
}

function toStoredCard(card: CardRow): StoredCardState {
  return {
    dueAt: card.due_at,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReviewAt: card.last_review_at,
  };
}

async function findReviewBySubmission(db: D1Database, ownerId: string, submissionId: string): Promise<ReviewEventRow | null> {
  return await first<ReviewEventRow>(
    db
      .prepare(
        `SELECT id, submission_id, card_id, session_id, rating, reviewed_at, prior_revision,
                resulting_revision, result_json
           FROM lexicon_review_events WHERE owner_id = ? AND submission_id = ?`,
      )
      .bind(ownerId, submissionId),
  );
}

function replayResult(row: ReviewEventRow, input: ReviewInput): SubmitResult {
  if (row.card_id !== input.cardId || row.session_id !== input.sessionId || row.rating !== input.rating) return 'conflict';
  return { value: JSON.parse(row.result_json) as Record<string, unknown>, replayed: true };
}

function mapReviewEvent(row: ReviewEventRow): Record<string, unknown> {
  return {
    id: row.id,
    submissionId: row.submission_id,
    cardId: row.card_id,
    sessionId: row.session_id,
    rating: row.rating,
    reviewedAt: row.reviewed_at,
    priorRevision: row.prior_revision,
    resultingRevision: row.resulting_revision,
  };
}

async function entryExists(db: D1Database, ownerId: string, entryId: string): Promise<boolean> {
  return (
    (await first<{ id: string }>(
      db.prepare('SELECT id FROM lexicon_entries WHERE id = ? AND owner_id = ? AND deleted_at IS NULL').bind(entryId, ownerId),
    )) !== null
  );
}

function pushAssignment(assignments: string[], values: unknown[], column: string, value: unknown): void {
  assignments.push(`${column} = ?`);
  values.push(value);
}

function errorBody(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

function notFound(c: Context<LexiconEnv>) {
  return c.json(errorBody('NOT_FOUND', 'The requested resource was not found'), 404);
}

function conflict(c: Context<LexiconEnv>) {
  return c.json(errorBody('VERSION_CONFLICT', 'The resource changed; refresh and retry'), 409);
}

async function missingOrConflict(
  c: Context<LexiconEnv>,
  table: 'lexicon_entries',
  id: string,
  ownerId: string,
) {
  const row = await first<{ id: string }>(
    c.env.DB.prepare(`SELECT id FROM ${table} WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`).bind(id, ownerId),
  );
  return row === null ? notFound(c) : conflict(c);
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new InputError('body must be valid JSON');
  }
}

function validId(value: string): string {
  if (value.length < 1 || value.length > 200 || !/^[A-Za-z0-9_.:-]+$/u.test(value)) throw new InputError('invalid resource id');
  return value;
}

function parseLimit(raw: string | null, fallback = DEFAULT_PAGE_SIZE): number {
  if (raw === null) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_PAGE_SIZE) {
    throw new InputError(`limit must be between 1 and ${MAX_PAGE_SIZE}`);
  }
  return parsed;
}

function optionalLanguage(raw: string | null): string | null {
  return raw === null ? null : languageTag(raw, 'language');
}

function optionalEnum<T extends string>(raw: string | null, allowed: readonly T[], label: string): T | null {
  return raw === null ? null : enumValue(raw, label, allowed);
}

interface CursorValue {
  updatedAt: string;
  id: string;
}

function encodeCursor(value: CursorValue): string {
  return btoa(JSON.stringify(value));
}

function parseCursor(raw: string | null): CursorValue | null {
  if (raw === null) return null;
  try {
    const parsed = object(JSON.parse(atob(raw)), 'cursor');
    const updatedAt = string(parsed.updatedAt, 'cursor.updatedAt', { min: 20, max: 40 })!;
    const id = validId(string(parsed.id, 'cursor.id', { min: 1, max: 200 })!);
    if (Number.isNaN(Date.parse(updatedAt))) throw new InputError('cursor is invalid');
    return { updatedAt, id };
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError('cursor is invalid');
  }
}

interface ReviewCursorValue {
  reviewedAt: string;
  id: string;
}

function encodeReviewCursor(value: ReviewCursorValue): string {
  return btoa(JSON.stringify(value));
}

function parseReviewCursor(raw: string | null): ReviewCursorValue | null {
  if (raw === null) return null;
  try {
    const parsed = object(JSON.parse(atob(raw)), 'cursor');
    const reviewedAt = string(parsed.reviewedAt, 'cursor.reviewedAt', { min: 20, max: 40 })!;
    const id = validId(string(parsed.id, 'cursor.id', { min: 1, max: 200 })!);
    if (Number.isNaN(Date.parse(reviewedAt))) throw new InputError('cursor is invalid');
    return { reviewedAt, id };
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError('cursor is invalid');
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}

function parseIfMatch(raw: string | undefined): number {
  if (raw === undefined) throw new InputError('If-Match version header is required');
  const cleaned = raw.replace(/^W\//u, '').replace(/^"|"$/gu, '');
  const version = Number(cleaned);
  if (!Number.isInteger(version) || version < 1) throw new InputError('If-Match must contain a positive version');
  return version;
}

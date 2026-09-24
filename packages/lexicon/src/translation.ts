import { first, run } from "./db.js";
import { iso } from "./runtime.js";
import type {
  Clock,
  TranslationProvider,
  TranslationSuggestion,
  TranslationSuggestionRequest,
} from "./types.js";

interface CacheRow {
  result_json: string;
  expires_at: string;
}

export class ProviderDisabledError extends Error {
  constructor() {
    super("Translation suggestions are disabled");
    this.name = "ProviderDisabledError";
  }
}

/** Default provider: it performs no network request and cannot incur a charge. */
export class DisabledTranslationProvider implements TranslationProvider {
  readonly id = "disabled";
  readonly version = "1";

  async suggest(
    _request: TranslationSuggestionRequest,
  ): Promise<TranslationSuggestion[]> {
    throw new ProviderDisabledError();
  }
}

export interface SuggestionServiceInput extends TranslationSuggestionRequest {
  ownerId: string;
  senseVersion: number;
}

export interface SuggestionServiceResult {
  suggestions: TranslationSuggestion[];
  cache: "hit" | "miss";
}

/**
 * Cache rows are always partitioned by owner. This intentionally gives up cross-user cache
 * deduplication so private text, sense context, and access patterns never cross an account boundary.
 */
export class TranslationSuggestionService {
  constructor(
    private readonly db: D1Database,
    private readonly provider: TranslationProvider,
    private readonly clock: Clock,
    private readonly ttlMs = 30 * 24 * 60 * 60 * 1000,
  ) {}

  async suggest(
    input: SuggestionServiceInput,
  ): Promise<SuggestionServiceResult> {
    const cacheKey = await makeCacheKey(this.provider, input);
    const now = this.clock.now();
    const cached = await first<CacheRow>(
      this.db
        .prepare(
          `SELECT result_json, expires_at
             FROM lexicon_translation_cache
            WHERE owner_id = ? AND cache_key = ? AND expires_at > ?`,
        )
        .bind(input.ownerId, cacheKey, iso(now)),
    );
    if (cached !== null) {
      return {
        suggestions: JSON.parse(cached.result_json) as TranslationSuggestion[],
        cache: "hit",
      };
    }

    const suggestions = await this.provider.suggest({
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      text: input.text,
      ...(input.sense === undefined ? {} : { sense: input.sense }),
    });
    validateProviderResult(suggestions);
    const expiresAt = new Date(now.getTime() + this.ttlMs);
    await run(
      this.db
        .prepare(
          `INSERT INTO lexicon_translation_cache
             (owner_id, cache_key, provider_id, provider_version, source_language,
              target_language, sense_version, result_json, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(owner_id, cache_key) DO UPDATE SET
             result_json = excluded.result_json,
             created_at = excluded.created_at,
             expires_at = excluded.expires_at`,
        )
        .bind(
          input.ownerId,
          cacheKey,
          this.provider.id,
          this.provider.version,
          input.sourceLanguage,
          input.targetLanguage,
          input.senseVersion,
          JSON.stringify(suggestions),
          iso(now),
          iso(expiresAt),
        ),
    );
    return { suggestions, cache: "miss" };
  }
}

async function makeCacheKey(
  provider: TranslationProvider,
  input: SuggestionServiceInput,
): Promise<string> {
  const material = JSON.stringify({
    provider: provider.id,
    providerVersion: provider.version,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    senseVersion: input.senseVersion,
    text: input.text,
    sense: input.sense ?? null,
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(material),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function validateProviderResult(suggestions: TranslationSuggestion[]): void {
  if (!Array.isArray(suggestions) || suggestions.length > 20) {
    throw new Error(
      "Translation provider returned an invalid suggestion count",
    );
  }
  for (const suggestion of suggestions) {
    if (
      typeof suggestion !== "object" ||
      suggestion === null ||
      typeof suggestion.text !== "string" ||
      suggestion.text.length < 1 ||
      suggestion.text.length > 500 ||
      !["exact", "broader", "narrower", "context_only"].includes(
        suggestion.fit,
      ) ||
      (suggestion.note !== undefined &&
        (typeof suggestion.note !== "string" ||
          suggestion.note.length > 2000)) ||
      (suggestion.provenance !== undefined &&
        (typeof suggestion.provenance !== "object" ||
          suggestion.provenance === null ||
          Array.isArray(suggestion.provenance)))
    ) {
      throw new Error("Translation provider returned an invalid suggestion");
    }
    try {
      if (JSON.stringify(suggestion.provenance ?? {}).length > 10_000) {
        throw new Error("Translation provider returned oversized provenance");
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Translation provider returned oversized provenance"
      )
        throw error;
      throw new Error("Translation provider returned invalid provenance");
    }
  }
}

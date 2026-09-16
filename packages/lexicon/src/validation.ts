import type {
  EntryKind,
  EquivalentInput,
  FitLabel,
  PracticeDirection,
  PracticeFormat,
  ReviewRating,
  SenseInput,
  TranslationStatus,
} from './types.js';

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputError';
  }
}

export function object(value: unknown, label = 'body'): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InputError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function string(
  value: unknown,
  label: string,
  options: { min?: number; max: number; nullable?: boolean } = { max: 500 },
): string | null {
  if (value === null && options.nullable === true) return null;
  if (typeof value !== 'string') throw new InputError(`${label} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length < (options.min ?? 0) || trimmed.length > options.max) {
    throw new InputError(`${label} must be between ${options.min ?? 0} and ${options.max} characters`);
  }
  return trimmed;
}

export function optionalString(value: unknown, label: string, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  return string(value, label, { max, nullable: true });
}

export function integer(value: unknown, label: string, min = 0): number {
  if (!Number.isInteger(value) || (value as number) < min) {
    throw new InputError(`${label} must be an integer greater than or equal to ${min}`);
  }
  return value as number;
}

export function enumValue<T extends string>(value: unknown, label: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new InputError(`${label} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

export function languageTag(value: unknown, label = 'languageTag'): string {
  const tag = string(value, label, { min: 2, max: 35 });
  if (tag === null || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(tag)) {
    throw new InputError(`${label} must be a valid BCP 47-style language tag`);
  }
  const parts = tag.split('-');
  return parts
    .map((part, index) => {
      if (index === 0) return part.toLowerCase();
      if (/^[A-Za-z]{4}$/u.test(part)) return `${part[0]!.toUpperCase()}${part.slice(1).toLowerCase()}`;
      if (/^(?:[A-Za-z]{2}|\d{3})$/u.test(part)) return part.toUpperCase();
      return part.toLowerCase();
    })
    .join('-');
}

export function jsonRecord(value: unknown, label: string): Record<string, unknown> | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const result = object(value, label);
  if (JSON.stringify(result).length > 10_000) throw new InputError(`${label} is too large`);
  return result;
}

export function parseEquivalent(value: unknown, label = 'equivalent'): EquivalentInput {
  const input = object(value, label);
  const status = enumValue<TranslationStatus>(
    input.status,
    `${label}.status`,
    ['suggested', 'confirmed', 'waiting', 'failed', 'manual'],
  );
  const textValue = optionalString(input.text, `${label}.text`, 500);
  if (status === 'waiting' || status === 'failed') {
    if (textValue !== undefined && textValue !== null) {
      throw new InputError(`${label}.text must be null for ${status} translations`);
    }
  } else if (textValue === undefined || textValue === null || textValue.length === 0) {
    throw new InputError(`${label}.text is required for ${status} translations`);
  }
  return {
    languageTag: languageTag(input.languageTag, `${label}.languageTag`),
    status,
    text: textValue ?? null,
    fit: enumValue<FitLabel>(
      input.fit ?? 'exact',
      `${label}.fit`,
      ['exact', 'broader', 'narrower', 'context_only', 'false_friend'],
    ),
    note: optionalString(input.note, `${label}.note`, 2000),
    source: optionalString(input.source, `${label}.source`, 500),
    provenance: jsonRecord(input.provenance, `${label}.provenance`),
    scriptData: jsonRecord(input.scriptData, `${label}.scriptData`),
  };
}

export function parseSense(value: unknown, label = 'sense'): SenseInput {
  const input = object(value, label);
  if (!Array.isArray(input.equivalents) || input.equivalents.length < 1 || input.equivalents.length > 30) {
    throw new InputError(`${label}.equivalents must contain between 1 and 30 items`);
  }
  return {
    gloss: optionalString(input.gloss, `${label}.gloss`, 500),
    note: optionalString(input.note, `${label}.note`, 2000),
    equivalents: input.equivalents.map((item, index) => parseEquivalent(item, `${label}.equivalents[${index}]`)),
  };
}

export const kinds = ['word', 'expression'] as const satisfies readonly EntryKind[];
export const directions = ['recognize', 'produce'] as const satisfies readonly PracticeDirection[];
export const formats = ['flashcard', 'cloze'] as const satisfies readonly PracticeFormat[];

export function reviewRating(value: unknown): ReviewRating {
  if (value !== 1 && value !== 2 && value !== 3 && value !== 4) {
    throw new InputError('rating must be 1, 2, 3, or 4');
  }
  return value;
}

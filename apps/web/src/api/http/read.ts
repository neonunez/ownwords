/**
 * Reads a backend answer into the shape the client expects, or refuses it.
 *
 * The API is typed on its own side, but the app only ever sees JSON over the
 * wire, and an installed app can outlive the backend version it was built
 * against. Every field a screen relies on is checked here, so a changed or
 * broken answer becomes one written failure instead of a blank or a crash.
 */

import { OwnwordsError } from "../client";

/** `_field` names what was wrong, for whoever reads the call site; it never reaches a screen. */
export function badResponse(_field: string): OwnwordsError {
  return new OwnwordsError(
    "bad_response",
    "Ownwords answered in a way this version of the app does not understand. Reload to update, then try again.",
  );
}

export type Json = Record<string, unknown>;

export function object(value: unknown, path: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw badResponse(path);
  }
  return value as Json;
}

export function string(value: unknown, path: string): string {
  if (typeof value !== "string") throw badResponse(path);
  return value;
}

export function optionalString(value: unknown, path: string): string | null {
  if (value === null || value === undefined) return null;
  return string(value, path);
}

export function number(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw badResponse(path);
  }
  return value;
}

export function optionalNumber(value: unknown, path: string): number | null {
  if (value === null || value === undefined) return null;
  return number(value, path);
}

export function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw badResponse(path);
  return value;
}

export function array<T>(
  value: unknown,
  path: string,
  item: (entry: unknown, path: string) => T,
): T[] {
  if (!Array.isArray(value)) throw badResponse(path);
  return value.map((entry, index) => item(entry, `${path}[${index}]`));
}

export function oneOf<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw badResponse(path);
  }
  return value as T;
}

/**
 * Course content carries free-form JSON authored per step or reference. These
 * pick one known field out of it, and ignore anything of the wrong kind rather
 * than refusing the whole lesson over one field.
 */
export function textField(record: Json | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

export function textList(record: Json | null, key: string): string[] | null {
  const value = record?.[key];
  if (!Array.isArray(value)) return null;
  const lines = value.filter(
    (entry): entry is string => typeof entry === "string" && !!entry.trim(),
  );
  return lines.length ? lines : null;
}

export function textRecord(
  record: Json | null,
  key: string,
): Record<string, string> | null {
  const value = record?.[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return entries.length ? Object.fromEntries(entries) : null;
}

export function jsonOrNull(value: unknown): Json | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : null;
}

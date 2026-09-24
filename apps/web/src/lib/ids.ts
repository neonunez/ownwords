/** Identifiers for records the demo client creates locally. */
export function localId(prefix: string): string {
  return `${prefix}_${newId().slice(0, 8)}`;
}

/**
 * A fresh random identifier: a practice session, or the idempotency key of a
 * review, which the backend accepts only once per account.
 */
export function newId(): string {
  return crypto.randomUUID();
}

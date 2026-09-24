import type { Clock, IdGenerator } from "./types.js";

export const systemClock: Clock = {
  now: () => new Date(),
};

export const cryptoIdGenerator: IdGenerator = {
  next: () => crypto.randomUUID(),
};

export function iso(date: Date): string {
  return date.toISOString();
}

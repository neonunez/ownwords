/**
 * Time, written for a person. Ownwords never shows a timestamp or a card
 * count: a session is sized in minutes, and what comes next is said in words.
 */

import { inWords } from "./text";

/** A session is sized by what is due, and said in words rather than counted. */
export function estimateFor(cards: number): string {
  if (cards === 0) return "";
  const minutes = Math.max(1, Math.round(cards * 1.1));
  return minutes === 1
    ? "About a minute."
    : `About ${inWords(minutes)} minutes.`;
}

const DAY = 86_400_000;

function startOfDay(at: number): number {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

/** When something next comes up: "later today", "tomorrow", "in three days". */
export function whenWritten(at: number, now = Date.now()): string {
  if (at <= now) return "now";
  if (at - now < 3_600_000) return "within the hour";
  const days = Math.round((startOfDay(at) - startOfDay(now)) / DAY);
  if (days <= 0) return "later today";
  if (days === 1) return "tomorrow";
  if (days < 14) return `in ${inWords(days)} days`;
  return `in ${inWords(Math.round(days / 7))} weeks`;
}

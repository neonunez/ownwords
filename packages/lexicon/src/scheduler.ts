import { State, createEmptyCard, fsrs, type Card, type Grade } from 'ts-fsrs';
import type { ReviewRating } from './types.js';

export interface StoredCardState {
  dueAt: string;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: number;
  lastReviewAt: string | null;
}

const scheduler = fsrs({
  enable_fuzz: false,
  maximum_interval: 36500,
  request_retention: 0.9,
});

export function newStoredCard(now: Date): StoredCardState {
  return fromFsrsCard(createEmptyCard(now));
}

export function scheduleReview(current: StoredCardState, rating: ReviewRating, now: Date): StoredCardState {
  const next = scheduler.next(toFsrsCard(current), now, rating as Grade).card;
  return fromFsrsCard(next);
}

export function estimateRetention(cards: StoredCardState[], now: Date): number | null {
  const reviewed = cards.filter((card) => card.state !== State.New);
  if (reviewed.length === 0) return null;
  const total = reviewed.reduce((sum, card) => sum + scheduler.get_retrievability(toFsrsCard(card), now, false), 0);
  return total / reviewed.length;
}

function toFsrsCard(card: StoredCardState): Card {
  return {
    due: new Date(card.dueAt),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsedDays,
    scheduled_days: card.scheduledDays,
    learning_steps: card.learningSteps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as State,
    ...(card.lastReviewAt === null ? {} : { last_review: new Date(card.lastReviewAt) }),
  };
}

function fromFsrsCard(card: Card): StoredCardState {
  return {
    dueAt: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReviewAt: card.last_review?.toISOString() ?? null,
  };
}

import { State, createEmptyCard, fsrs, type Card, type Grade } from "ts-fsrs";

/**
 * The scheduling state one Learn card holds. The shape and the FSRS parameters
 * are the Lexicon scheduler's (`@ownwords/lexicon`'s `scheduler.ts`), kept as a
 * deliberate second copy rather than a package import: the two practice surfaces
 * schedule independently, and neither domain package depends on the other.
 */

export interface LearnCardState {
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

export function newLearnCard(now: Date): LearnCardState {
  return fromFsrsCard(createEmptyCard(now));
}

export function scheduleLearnReview(
  current: LearnCardState,
  rating: 1 | 2 | 3 | 4,
  now: Date,
): LearnCardState {
  const next = scheduler.next(toFsrsCard(current), now, rating as Grade).card;
  return fromFsrsCard(next);
}

function toFsrsCard(card: LearnCardState): Card {
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
    ...(card.lastReviewAt === null
      ? {}
      : { last_review: new Date(card.lastReviewAt) }),
  };
}

function fromFsrsCard(card: Card): LearnCardState {
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

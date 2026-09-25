/**
 * The Learning package's wire shapes, read and translated into the screens'
 * types.
 *
 * Course structure (units, lessons, steps, items, references) is typed by the
 * backend. What a step or a reference *says* is authored JSON the backend
 * stores without interpreting, so this file is also where the app decides
 * which authored fields it reads; `docs/backend-boundary.md` lists them for
 * whoever writes course content.
 */

import type {
  AlphabetLetter,
  Course,
  CourseUnit,
  Lesson,
  LessonItem,
  LessonStatus,
  LessonStep,
  LessonStepKind,
  Milestone,
  ReferenceItem,
  UnitState,
} from "../types";
import {
  array,
  boolean,
  jsonOrNull,
  number,
  object,
  oneOf,
  optionalString,
  string,
  textField,
  textList,
  textRecord,
  type Json,
} from "./read";

/* ---- wire shapes --------------------------------------------------------- */

export interface WireCourseSummary {
  id: string;
  languageTag: string;
  title: string;
  version: number;
}

export function readCourses(value: unknown): WireCourseSummary[] {
  const record = object(value, "courses");
  return array(record.courses, "courses.courses", (item, path) => {
    const course = object(item, path);
    return {
      id: string(course.id, `${path}.id`),
      languageTag: string(course.languageTag, `${path}.languageTag`),
      title: string(course.title, `${path}.title`),
      version: number(course.version, `${path}.version`),
    };
  });
}

const lessonStatuses: readonly LessonStatus[] = [
  "not_started",
  "in_progress",
  "completed",
];

interface WireOutlineLesson {
  id: string;
  title: string;
  status: LessonStatus;
  currentStepId: string | null;
  prerequisites: string[];
}

interface WireOutlineUnit {
  id: string;
  position: number;
  title: string;
  canDo: string;
  lessons: WireOutlineLesson[];
}

export interface WireOutline {
  id: string;
  version: number;
  languageTag: string;
  title: string;
  units: WireOutlineUnit[];
}

export function readOutline(value: unknown): WireOutline {
  const course = object(object(value, "outline").course, "outline.course");
  return {
    id: string(course.id, "outline.id"),
    version: number(course.version, "outline.version"),
    languageTag: string(course.languageTag, "outline.languageTag"),
    title: string(course.title, "outline.title"),
    units: array(course.units, "outline.units", (item, path) => {
      const unit = object(item, path);
      return {
        id: string(unit.id, `${path}.id`),
        position: number(unit.position, `${path}.position`),
        title: string(unit.title, `${path}.title`),
        canDo: string(unit.canDo, `${path}.canDo`),
        lessons: array(unit.lessons, `${path}.lessons`, (entry, where) => {
          const lesson = object(entry, where);
          return {
            id: string(lesson.id, `${where}.id`),
            title: string(lesson.title, `${where}.title`),
            status: oneOf(lesson.status, `${where}.status`, lessonStatuses),
            currentStepId: optionalString(
              lesson.currentStepId,
              `${where}.currentStepId`,
            ),
            prerequisites: array(
              lesson.prerequisites,
              `${where}.prerequisites`,
              string,
            ),
          };
        }),
      };
    }),
  };
}

export type WireResume =
  | { complete: true }
  | {
      complete: false;
      unitId: string;
      lessonId: string;
      stepId: string | null;
    };

export function readResume(value: unknown): WireResume {
  const resume = object(object(value, "resume").resume, "resume.resume");
  if (boolean(resume.complete, "resume.complete")) return { complete: true };
  return {
    complete: false,
    unitId: string(resume.unitId, "resume.unitId"),
    lessonId: string(resume.lessonId, "resume.lessonId"),
    stepId: optionalString(resume.stepId, "resume.stepId"),
  };
}

interface WireContentItem {
  id: string;
  displayText: string;
  gloss: string;
  stressText: string | null;
  grammaticalMetadata: Json | null;
  /**
   * Recorded-audio metadata the backend can return for an item. The app has
   * no playback control, so it is deliberately not read into a lesson.
   */
  audio: Json | null;
}

interface WireStep {
  id: string;
  kind: string;
  payload: Json | null;
  itemIds: string[];
}

export interface WireLesson {
  id: string;
  unitId: string;
  title: string;
  steps: WireStep[];
  contentItems: WireContentItem[];
}

export function readLesson(value: unknown): WireLesson {
  const lesson = object(object(value, "lesson").lesson, "lesson.lesson");
  return {
    id: string(lesson.id, "lesson.id"),
    unitId: string(lesson.unitId, "lesson.unitId"),
    title: string(lesson.title, "lesson.title"),
    steps: array(lesson.steps, "lesson.steps", (item, path) => {
      const step = object(item, path);
      return {
        id: string(step.id, `${path}.id`),
        kind: string(step.kind, `${path}.kind`),
        payload: jsonOrNull(step.payload),
        itemIds: array(step.items, `${path}.items`, (link, where) =>
          string(object(link, where).itemId, `${where}.itemId`),
        ),
      };
    }),
    contentItems: array(
      lesson.contentItems,
      "lesson.contentItems",
      (item, path) => {
        const content = object(item, path);
        return {
          id: string(content.id, `${path}.id`),
          displayText: string(content.displayText, `${path}.displayText`),
          gloss: string(content.gloss, `${path}.gloss`),
          stressText: optionalString(content.stressText, `${path}.stressText`),
          grammaticalMetadata: jsonOrNull(content.grammaticalMetadata),
          audio: jsonOrNull(content.audio),
        };
      },
    ),
  };
}

export interface WireReference {
  id: string;
  title: string;
  body: Json | null;
  introducedUnitId: string | null;
  locked: boolean;
}

export function readReferencePage(value: unknown): {
  references: WireReference[];
  nextCursor: string | null;
} {
  const record = object(value, "references");
  return {
    references: array(
      record.references,
      "references.references",
      (item, path) => {
        const reference = object(item, path);
        return {
          id: string(reference.id, `${path}.id`),
          title: string(reference.title, `${path}.title`),
          body: jsonOrNull(reference.body),
          introducedUnitId: optionalString(
            reference.introducedUnitId,
            `${path}.introducedUnitId`,
          ),
          locked: boolean(reference.locked, `${path}.locked`),
        };
      },
    ),
    nextCursor: optionalString(record.nextCursor, "references.nextCursor"),
  };
}

export function readCompletion(value: unknown): "synced" | "pending" {
  const completion = object(
    object(value, "completion").completion,
    "completion.completion",
  );
  const sync = object(completion.lexiconSync, "completion.lexiconSync");
  return oneOf(sync.status, "completion.lexiconSync.status", [
    "synced",
    "pending",
  ] as const);
}

/* ---- the course, as the screens see it ----------------------------------- */

/** What each kind of step is called when its content gives it no title. */
const stepTitles: Record<LessonStepKind, string> = {
  read: "Read it first",
  rule: "A rule of four lines",
  use: "Use it",
  perception: "Notice the difference",
  alphabet: "The letters",
};

const stepKinds = Object.keys(stepTitles) as LessonStepKind[];

/**
 * The course stores its read-aloud step as `hear`, a legacy name from when
 * playback was planned. It is a reading step, and the app calls it that.
 */
const storedStepKinds: Record<string, LessonStepKind> = {
  hear: "read",
};

function stepKind(kind: string): LessonStepKind {
  if (storedStepKinds[kind]) return storedStepKinds[kind];
  return stepKinds.includes(kind as LessonStepKind)
    ? (kind as LessonStepKind)
    : "rule";
}

export function stepTitle(step: WireStep): string {
  return textField(step.payload, "title") ?? stepTitles[stepKind(step.kind)];
}

function unlocked(
  lesson: WireOutlineLesson,
  completed: ReadonlySet<string>,
): boolean {
  return lesson.prerequisites.every((id) => completed.has(id));
}

function completedLessons(outline: WireOutline): Set<string> {
  return new Set(
    outline.units.flatMap((unit) =>
      unit.lessons
        .filter((lesson) => lesson.status === "completed")
        .map((lesson) => lesson.id),
    ),
  );
}

/** The lesson a unit opens on: the first unfinished one, or the first to revisit. */
function openingLesson(
  unit: WireOutlineUnit,
  completed: ReadonlySet<string>,
): WireOutlineLesson | null {
  const available = unit.lessons.filter((lesson) =>
    unlocked(lesson, completed),
  );
  return (
    available.find((lesson) => lesson.status !== "completed") ??
    available[0] ??
    null
  );
}

export function toCourse(
  outline: WireOutline,
  resume: WireResume,
  resumeLesson: WireLesson | null,
): Course {
  const completed = completedLessons(outline);
  const units: CourseUnit[] = outline.units.map((unit) => {
    const opening = openingLesson(unit, completed);
    const done = unit.lessons.every((lesson) => completed.has(lesson.id));
    const state: UnitState = done
      ? "done"
      : !resume.complete && resume.unitId === unit.id
        ? "current"
        : opening
          ? "open"
          : "locked";
    return {
      id: unit.id,
      number: unit.position,
      title: unit.title,
      subtitle: unit.canDo,
      state,
      lessonId: opening?.id ?? null,
    };
  });
  const milestones: Milestone[] = outline.units.map((unit, index) => ({
    id: unit.id,
    text: unit.canDo,
    reached: units[index]?.state === "done",
  }));

  let courseResume: Course["resume"] = null;
  if (!resume.complete) {
    const unit = outline.units.find(
      (candidate) => candidate.id === resume.unitId,
    );
    const lesson = unit?.lessons.find(
      (candidate) => candidate.id === resume.lessonId,
    );
    if (unit && lesson) {
      const step = resumeLesson?.steps.find(
        (candidate) => candidate.id === resume.stepId,
      );
      const finished = unit.lessons.filter((one) =>
        completed.has(one.id),
      ).length;
      courseResume = {
        unitId: unit.id,
        unitNumber: unit.position,
        lessonId: lesson.id,
        title: lesson.title,
        step: step ? stepTitle(step) : stepTitles.read,
        progress: unit.lessons.length ? finished / unit.lessons.length : 0,
        canDo: unit.canDo,
      };
    }
  }

  return {
    id: outline.id,
    version: String(outline.version),
    language: outline.languageTag,
    title: outline.title,
    resume: courseResume,
    units,
    milestones,
  };
}

/** A short grammar note from an item's metadata: "m.", "impf.", or what the author wrote. */
function grammarNote(metadata: Json | null): string {
  const written = textField(metadata, "label");
  if (written) return written;
  const notes: string[] = [];
  const gender = textField(metadata, "gender");
  if (gender) notes.push(`${gender.charAt(0).toLowerCase()}.`);
  const aspect = textField(metadata, "aspect");
  if (aspect) notes.push(aspect.startsWith("perf") ? "pf." : "impf.");
  return notes.join(" ");
}

function toItem(item: WireContentItem): LessonItem {
  return {
    id: item.id,
    text: item.stressText ?? item.displayText,
    meaning: item.gloss,
    grammar: grammarNote(item.grammaticalMetadata),
  };
}

function toStep(
  step: WireStep,
  items: ReadonlyMap<string, LessonItem>,
): LessonStep {
  const payload = step.payload;
  const result: LessonStep = {
    id: step.id,
    kind: stepKind(step.kind),
    title: stepTitle(step),
    items: step.itemIds.flatMap((id) => {
      const item = items.get(id);
      return item ? [item] : [];
    }),
  };
  const lines = textList(payload, "lines");
  const prompt =
    textField(payload, "prompt") ?? textField(payload, "instruction");
  const options = textList(payload, "options");
  const answer = textField(payload, "answer");
  const responses = textRecord(payload, "responses");
  if (lines) result.lines = lines;
  if (prompt) result.prompt = prompt;
  if (options) result.options = options;
  if (answer) result.answer = answer;
  if (responses) result.responses = responses;
  return result;
}

export function toLesson(lesson: WireLesson, outline: WireOutline): Lesson {
  const unit = outline.units.find(
    (candidate) => candidate.id === lesson.unitId,
  );
  const placed = unit?.lessons.find((candidate) => candidate.id === lesson.id);
  const items = new Map(
    lesson.contentItems.map((item) => [item.id, toItem(item)]),
  );
  return {
    id: lesson.id,
    unitNumber: unit?.position ?? 0,
    title: lesson.title,
    canDo: unit?.canDo ?? "",
    language: outline.languageTag,
    status: placed?.status ?? "not_started",
    currentStepId: placed?.currentStepId ?? null,
    steps: lesson.steps.map((step) => toStep(step, items)),
  };
}

/* ---- the alphabet and the reference -------------------------------------- */

/** A letter reference reads `upper` (or `letter`), `lower`, `sound`, `trap` or `looksLike`, and `sameAsLatin`. */
export function toLetter(reference: WireReference): AlphabetLetter | null {
  const body = reference.body;
  const upper = textField(body, "upper") ?? textField(body, "letter");
  if (!upper) return null;
  const looksLike = textField(body, "looksLike");
  return {
    upper,
    lower: textField(body, "lower") ?? upper.toLocaleLowerCase(),
    sound: textField(body, "sound") ?? "",
    trap:
      textField(body, "trap") ?? (looksLike ? `looks like ${looksLike}` : null),
    sameAsLatin: body?.sameAsLatin === true,
  };
}

/** A reference body is read as `lines`, else a `summary`, `text` or `gloss`. */
export function toReferenceItem(reference: WireReference): ReferenceItem {
  const body = reference.body;
  const single =
    textField(body, "summary") ??
    textField(body, "text") ??
    textField(body, "gloss");
  return {
    id: reference.id,
    title: reference.title,
    lines: textList(body, "lines") ?? (single ? [single] : []),
    locked: reference.locked,
  };
}

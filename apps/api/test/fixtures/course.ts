/**
 * Synthetic test-author course packs. Nothing here is curriculum, scraped, or
 * copied from a licensed course; recordings are metadata-only fake URLs.
 */
export const COURSE_ID = "synthetic-russian";

const license = {
  spdxId: "CC0-1.0",
  sourceName: "Ownwords synthetic test fixture",
};
/** Recordings carry their own licence, which Settings must credit. */
const audioLicense = {
  spdxId: "CC-BY-4.0",
  sourceName: "Synthetic recordings",
  sourceUrl: "https://audio.example.invalid/synthetic",
  attribution: "Synthetic Speaker, CC BY 4.0",
};
const provenance = {
  sourceName: "Ownwords integration tests",
  author: "Ownwords test authors",
  note: "Synthetic, not curriculum.",
};

function item(
  id: string,
  displayText: string,
  stressText: string,
  gloss: string,
  audio = false,
) {
  return {
    id,
    kind: "word",
    languageTag: "ru",
    displayText,
    gloss,
    stressText,
    grammaticalMetadata: { fixture: true },
    license,
    provenance,
    ...(audio
      ? {
          audio: {
            kind: "recorded",
            url: `https://audio.example.invalid/synthetic/${id}.ogg`,
            mediaType: "audio/ogg",
            license: audioLicense,
            provenance: { ...provenance, note: "Metadata-only fake URL." },
            durationMs: 900,
          },
        }
      : {}),
  };
}

/** Two lessons: `greet` introduces two items, `part` requires `greet` and introduces one. */
export function coursePack(version: number, title = "Synthetic Russian") {
  return {
    course: {
      id: COURSE_ID,
      languageTag: "ru",
      title,
      description: "A synthetic test-author course for integration tests.",
    },
    version,
    units: [
      {
        id: "unit-one",
        position: 1,
        title: "Synthetic unit",
        canDo: "Exercise the integrated API with invented content.",
        lessons: [
          {
            id: "greet",
            position: 1,
            title: "Synthetic greeting",
            prerequisites: [],
            steps: [
              {
                id: "greet-hear",
                position: 1,
                kind: "hear",
                payload: { instruction: "Synthetic listening step." },
                items: [
                  { itemId: "zdravstvuj", role: "introduced", position: 1 },
                  { itemId: "spasibo", role: "introduced", position: 2 },
                ],
              },
              {
                id: "greet-use",
                position: 2,
                kind: "use",
                payload: { instruction: "Synthetic use step." },
                items: [
                  { itemId: "zdravstvuj", role: "reviewed", position: 1 },
                ],
              },
            ],
          },
          {
            id: "part",
            position: 2,
            title: "Synthetic parting",
            prerequisites: ["greet"],
            steps: [
              {
                id: "part-rule",
                position: 1,
                kind: "rule",
                payload: { lines: ["Synthetic rule line."] },
                items: [
                  { itemId: "do-svidaniya", role: "introduced", position: 1 },
                ],
              },
              {
                id: "part-use",
                position: 2,
                kind: "use",
                payload: { instruction: "Synthetic use step." },
                items: [{ itemId: "spasibo", role: "reviewed", position: 1 }],
              },
            ],
          },
        ],
      },
    ],
    items: [
      item("zdravstvuj", "здравствуй", "здра́вствуй", "synthetic hello", true),
      item("spasibo", "спасибо", "спаси́бо", "synthetic thanks"),
      item("do-svidaniya", "до свидания", "до свида́ния", "synthetic goodbye"),
    ],
    references: [
      {
        id: "alphabet-z",
        category: "alphabet",
        position: 1,
        title: "Synthetic letter",
        body: { letter: "З" },
        introducedUnitId: "unit-one",
      },
      {
        id: "grammar-greet",
        category: "grammar",
        position: 1,
        title: "Synthetic grammar",
        body: { summary: "Synthetic grammar body." },
        unlockLessonId: "greet",
      },
    ],
  };
}

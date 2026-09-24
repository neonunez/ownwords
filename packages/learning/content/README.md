# Ownwords course packs

`russian-foundations-v1.json` is the first authored course pack for the connected Learning system. It is a deliberately bounded A0 script-and-sound unit followed by early A1 greetings and introductions. It is not a complete A1 syllabus, a proficiency exam, or a claim of official-curriculum coverage.

## Editorial and rights status

- The Russian examples, English explanations, exercises, and selection notes were authored for Ownwords. They were not copied from official curricula, textbooks, production source text, or unknown-license examples.
- Every content item carries `CC-BY-4.0` metadata and an Ownwords provenance record. The pack currently has no audio: `audio` is omitted rather than inventing a recording or URL. Recorded human audio is a separate pre-launch content task and must be checked for quality and rights per item.
- The course description and this file label the material **unreviewed**. A qualified Russian-language teacher (preferably with RKI or equivalent classroom experience) must review the sequence, stress marks, examples, exercise answers, and learner-facing wording before authoritative publication. Review does not make this a certified exam course.
- The pack uses only the existing versioned `ingestCourseVersion` / `publishCourseVersion` operator path. Do not write course rows directly to D1.

## Shape and versioning

The stable course id is `russian-foundations`; this file is version `1`. Published versions are immutable. A correction or expansion must use a new sequential version and preserve learner enrollment on the version they started. Each unit has ordered lessons, each lesson has prerequisite links, and every linked item is introduced by exactly one lesson so course-to-Lexicon export remains deterministic.

Validate and publish locally from the repository root:

```sh
npm run content:validate --workspace @ownwords/learning -- content/russian-foundations-v1.json
npm run content:publish:local --workspace @ownwords/api -- ../../packages/learning/content/russian-foundations-v1.json
```

The local publisher uses the supported operator import and D1 is local only. The connected stack test seeds this same pack through that path.

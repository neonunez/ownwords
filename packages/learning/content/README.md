# Ownwords course packs

`russian-foundations-v1.json` is the first authored course pack for the connected Learning system. It is a deliberately bounded A0 script-and-stress unit followed by early A1 greetings and introductions. It is not a complete A1 syllabus, a proficiency exam, or a claim of official-curriculum coverage. It is a **reading** course: the learner looks at the words, says them aloud, and chooses the right one.

## Editorial and rights status

- The Russian examples, English explanations, exercises, and selection notes were authored for Ownwords. They were not copied from official curricula, textbooks, production source text, or unknown-license examples.
- Every content item carries `CC-BY-4.0` metadata and an Ownwords provenance record. The pack has no audio: `audio` is omitted rather than inventing a recording or URL, and no step is written to promise one.
- The sequence, stress marks, examples, exercise answers, and learner-facing wording were **reviewed by a qualified Russian-language teacher**. Review does not make this a certified exam course.
- The pack uses only the existing versioned `ingestCourseVersion` / `publishCourseVersion` operator path. Do not write course rows directly to D1.

## Why there is no audio, and what is deliberately dormant

Audio was investigated and deferred rather than skipped. The findings, so nobody re-derives them:

- The only slot is `items[].audio`. The A0/A1 course needs 25 recordings, 6 of them multi-word expressions; the open-licensed sources cover 19 of 25 words and **0 of the 6 phrases** that carry the A1 unit. Half a course with sound is worse than none.
- Wikimedia `Ru-*.ogg` (the real source; **Lingua Libre has no Russian corpus at all** — its `-rus` category does not exist) is a dead Shtooka upload: 13 of 19 files name no author, a `rus-nonfree` private-use-only pack exists upstream, and the file pages cannot tell the two apart.
- `Ru-здравствуйте.ogg` came from Forvo (not commercial). `Ru-извините.ogg` cites a Tatoeba sentence that today carries no Russian audio.
- Mozilla Common Voice is CC0 but **forbids re-hosting**, so it cannot ship inside the app.
- Tatoeba licences are per contributor and include NC and "no licence for offsite use"; the v0 API does not expose them.
- A native-speaker listening pass is unavoidable for every route, and the schema cannot even label a machine-generated clip (`kind` is `z.literal("recorded")`).

So the app ships no playback control, no "hear/listen" step, no audio toggle, and no message about a missing recording. The backend keeps `audio_json`, the `/licenses` roll-up, and the `russian_course_audio` profile preference **stored and served but never read by the app**, so a future pack of original recordings (one native-speaker voice, a written release, `audio/mpeg`) needs no migration and no API change. Removing any of that is not part of this decision.

The stored step kind `hear` is a legacy name for the read-aloud step: the value is persisted in a `CHECK` constraint, so it keeps its name while the app calls the step `read`.

## Shape and versioning

The stable course id is `russian-foundations`; this file is version `1`. Published versions are immutable. A correction or expansion must use a new sequential version and preserve learner enrollment on the version they started. Each unit has ordered lessons, each lesson has prerequisite links, and every linked item is introduced by exactly one lesson so course-to-Lexicon export remains deterministic.

Validate and publish locally from the repository root:

```sh
npm run content:validate --workspace @ownwords/learning -- content/russian-foundations-v1.json
npm run content:publish:local --workspace @ownwords/api -- ../../packages/learning/content/russian-foundations-v1.json
```

The local publisher uses the supported operator import and D1 is local only. The connected stack test seeds this same pack through that path.

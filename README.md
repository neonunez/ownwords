# Ownwords

**Practise the words you actually use — in every language you speak — and learn a new one in the same app.**

This repository holds the product definition and the backend implementation now under development (see
[`packages/learning`](packages/learning/README.md) for versioned course content and learner progress).

---

## Purpose

Most vocabulary apps drill somebody else's word list. Ownwords starts from the words and expressions one person
actually uses, keeps them reachable in every language they speak, and — in the same app, on the same collection —
teaches a new language from the alphabet up.

The collection is called the **Lexicon**: not a dictionary written by someone else, but the set of words and
expressions its owner keeps reaching for.

## Two modes

| | **Maintain** | **Learn** |
|---|---|---|
| For | Languages the person already speaks at an intermediate level | A language started from zero. Russian ships first (A0 → first half of A1) |
| Centre of gravity | The personal collection: words **and** expressions, entered by hand | A course of short units, each ending in something sayable |
| Practice | Two tabs, one scheduler: completing the phrase, and flashcards | A practice tab for what is due, plus practice inside every lesson |
| Reference | The collection itself, filtered | Alphabet (its own tab) and Reference: grammar and verbs, phrases, intonation, numbers, course vocabulary |
| Progress | Retention per language, per direction | Can-do milestones along the course |
| Audio | None | **None.** The first course ships without recordings — see [Audio](#audio) |

Both modes share one collection. Every item learned in the course lands in it, which is how a newly learned
language eventually joins maintenance.

## User jobs

1. "I keep saying this in my own language — store it once, give it to me in every language I speak."
2. "I have a few minutes. Pick what I'm about to forget; don't make me choose."
3. "This auto-translation is a false friend. Let me fix it, and remember that I fixed it."
4. "Open the course and show me the next step, not a menu."
5. "I half-remember that letter or that ending — let me look it up in seconds and get back."

## Navigation

Mode, languages, settings, reminders, export and account live in a **side panel** opened from the top-left of any
main screen, which leaves the tab bar for what a person does daily.

| | Tabs |
|---|---|
| **Maintain** | Progress · Lexicon · Practice · Flashcards |
| **Learn** | Course · Practice · Alphabet · Reference |

Four rules hold those bars together:

- A tab says what it does. No tab called "today".
- The tab chooses the **format**; the scheduler chooses the **content** — which entries, which language, which direction.
- No tab crosses into the other mode. Switching modes is the side panel's job.
- A screen pushed from a tab keeps the tab bar, so no screen is ever a dead end.

Four tabs each leaves one seat free for **Speak**, the phase that follows launch.

In Learn mode, **Course** merges the lesson and the path — a resume card on top, the units below — and **Reference**
is the single lookup tab, with grammar and verbs as its first and largest screen. **Alphabet** earns its own tab
because for months it is the page opened most.

## The collection is the source of truth

| Area | Behaviour |
|---|---|
| Entry unit | A meaning the person owns, written in any of their languages, plus an optional note on when they use it — not a translation pair. One word, or a fixed expression. |
| Senses | One entry can hold several senses; each carries its own equivalents. Adding a sense never rewrites another. |
| Per language | Each configured language has its own equivalent(s), editable by hand at any time, with a fit label: exact · broader · narrower · context-only · false friend (kept and marked "not this"). |
| Script-specific data | Items in a learned language carry what that language needs — for Russian: stress marks, gender, aspect pairs, government. Search and answer-checking ignore the stress mark. |
| Mastery | Tracked per language **and** per direction (recognise / produce). Strong in one language and blank in another is the normal case, and the list shows it at a glance. |
| Translation states | suggested (unverified) · confirmed · waiting · failed · typed by hand. Failure offers retry and a manual field; nothing is dropped silently; unverified candidates never enter practice in the language being learned. |
| List behaviour | Add, edit, delete, search (accent- and case-insensitive), filter by language, mastery, "unverified", words vs expressions. |
| Empty state | One line of explanation plus three one-tap starter expressions, so a first practice session is possible on day one. |

## Core feature behaviour

- **Practice (both modes).** The scheduler picks what is due; the person picks the format — completing the phrase, or flashcards. An empty queue offers what is coming next instead of filler.
- **Feedback.** A wrong answer gets a prompt first and the answer second, then returns later in the same session.
- **Adding an entry.** Capture → optional auto-translation into the configured languages → review each candidate → save. The "what do you mean by it?" note is what keeps false friends out.
- **Lesson.** Read it first (words written with the stress marked) → a rule of four lines → use it → a contrast drill. Grammar is one tap away and returns to the same step. Nothing is played: the learner reads and says the words aloud.
- **Alphabet.** An introductory module at the head of the course, then a permanent tab, with explicit treatment of letters that look Latin but are not.
- **Grammar.** Each topic records which unit introduced it, says what is still locked, and offers practice on the spot.
- **Progress.** Retention per language and what is due next. No streaks, XP or card counts.

## First run asks only what changes the content

Sign-up collects the languages and their levels, then **two preferences**: the language of explanations, and whether
translations are suggested when an entry is added. It does not ask for a daily time budget —
a session is sized by what is due — and it does not ask for notification permission, which belongs after install.

## Audio

**The first release has no audio at all, in either mode, and never claims to have any.** No playback button, no
"hear it" or "listen" step, no audio setting, and no message about a missing recording: a course that cannot play
something must not look as though it can. The learner reads the Cyrillic with its stress marks and says the words
aloud, and that is the whole sound content of v1.

| Where audio would go | Status |
|---|---|
| Course items and dialogues | **Deferred.** No source was found that is both commercially clear and complete: the open-licensed word files are a dead upload with unrecorded authors, the phrase files the course actually needs (6 of 25 items) do not exist anywhere open, the best-licensed corpus (Mozilla Common Voice, CC0) forbids re-hosting, and a native-speaker listening pass is mandatory before any of it could ship. |
| Personal entries in maintained languages | **None, permanently.** The only way to voice arbitrary typed text is the device speech engine, whose voice list cannot be relied on to select the right language on iOS. At an intermediate level the pronunciation is already known. |
| Personal entries in the language being learned | **Deferred with the course.** Audio only makes sense once the item is verified and matched to a recorded course item. |

**When audio is next, it is one native-speaker voice and a written release** — original recordings the product owns,
in `audio/mpeg`, which is cheaper in money than clearing a third-party corpus and the only route that scales to the
few hundred items the course will eventually need. That is a content task with a session and one document, not a
feature. Recorded files, when they exist, play like any other sound on a web page and never invoke the device speech
engine, which is the unreliable part. The backend already stores per-item licence, provenance and duration, so
nothing in the data model has to change to receive them.

## Platform requirements

- Installable web app that feels native on the phone: one shared Ownwords visual style on every platform, with platform-specific behaviour (safe areas, standalone display, the back gesture) where the platform expects it. A native app stays a later option.
- Online-first; the desktop browser works but is not a design target.
- Sign-in without passwords: federated sign-in and passkeys, with access by invitation.
- Learning content is versioned; translations are fetched on demand and cached.
- The person's data is exportable on request.
- Built to run within a no-new-recurring-cost budget; a native-speaker recording session and expert review are one-off
  costs, and audio is deferred until then.

## Accessibility rules

- 44 pt minimum for every control — stricter than WCAG 2.2's 24 px minimum — verified with a touch-target overlay.
- `viewport-fit=cover` plus `env(safe-area-inset-*)`; nothing interactive under the notch or home indicator.
- Type in relative units so system text scaling grows text without clipping layout.
- State is always written in words, never colour alone: "false friend", "waiting", "unverified".
- Visible focus ring and real buttons throughout, since an installable web app also opens in a desktop browser.
- Stress marks use combining acute U+0301: ship and verify a font with correct Cyrillic anchors, strip the mark for
  search and answer checking, and never require typing it. Verify on a physical iOS device.
- Web push on iOS needs the app added to the Home Screen; reminders are opt-in after install, and the app works fully
  with notifications refused.

## Non-goals for the first release

- Microphone, recording, pronunciation scoring. The first speaking phase comes immediately after launch, deliberately not in it.
- AI conversation partner; automated pronunciation scores.
- Streaks, XP, leaderboards, time-in-app metrics.
- Offline use; handwriting; content beyond the first half of A1; placement testing.
- Sharing collections between users; desktop-specific layouts.
- Spoken audio for personal entries in maintained languages.
- Any audio in the first release: the app ships none and promises none.

## Later, in order

1. **Speak**: record → compare with the native model → self-rate; then "say it again, faster". The free tab seat is reserved for it.
2. Course audio, when one native-speaker session and a written release make it honest: recordings for the course's own words and phrases, then the dialogues they need.
2. The second half of A1, then A2.
3. The learned language graduates into maintenance alongside the others.
4. A second learning language reusing the same course + reference shape.

## Pace

Short daily sessions — around ten minutes — are the assumed pattern. A standard classroom A1 course assumes roughly
60–90 clock hours, so at that rate a full A1 is a multi-year path. That is the argument for measuring progress in
can-do milestones rather than dates, and for keeping sessions short enough that they actually happen.

## Sources behind the design rules


[WCAG 2.2 · target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) ·
[Apple HIG · layout](https://developer.apple.com/design/human-interface-guidelines/layout) ·
[Apple HIG · tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars) ·
[MDN · safe-area insets](https://developer.mozilla.org/en-US/docs/Web/CSS/env) ·
[WebKit · web push for web apps on iOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) ·
[Safari speech-synthesis limitations](https://weboutloud.io/bulletin/speech_synthesis_in_safari/) ·
[Lingua Libre pronunciation on Wikimedia Commons](https://commons.wikimedia.org/wiki/Commons:Lingua_Libre) ·
[Unicode U+0301](https://unicode-explorer.com/c/0301)

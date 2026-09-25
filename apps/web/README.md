# Ownwords · web

The installable Ownwords app: the Maintain and Learn front end, built from the
Ownwords design system and the product requirements in the repository's root
`README.md`.

It is a TypeScript React application, served as a static bundle and
installable on a phone. Once installed, its shell opens without a network; the
account, the collection, practice, progress and the course are backend data,
and Ownwords is online-first, so reading and changing them needs a connection.
It talks to the Ownwords API (`apps/api`) on its own origin, under `/api`,
through one typed interface — see
[docs/backend-boundary.md](docs/backend-boundary.md).

## Running it

```sh
npm install          # from the repository root; one lockfile for every workspace
cd apps/web
npm run stack        # the connected app on http://localhost:4180, with a local API
npm run dev:demo     # or: the screens alone on sample data, http://localhost:5173
```

Node 24 or newer. `npm run stack` builds the app and serves it in front of the
real API under `wrangler dev`, on a fresh local D1 with every migration, the
authored Russian Foundations course and a set of synthetic accounts; it prints how to sign
in as one from the browser console. Nothing in it needs a credential or leaves
the machine.

To work on the app with hot reload against a local API, run
`npm run db:migrate:local` and `npm run dev:app` in `apps/api` (the API then
trusts `http://localhost:5173`), and `npm run dev` here. Signing in there needs
either Google credentials in `apps/api/.dev.vars` or a session you seed
yourself; `docs/SETUP.md` has both.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload, forwarding `/api` to `OWNWORDS_API_URL` (default `http://127.0.0.1:8787`). No service worker. |
| `npm run dev:demo` | The same, answered by the demo client: sample data, no backend, nothing kept. |
| `npm run build` | Type-check every project, then build the app into `dist/`. |
| `npm run build:demo` | Build the demo into `demo-dist/`, never into `dist/`. |
| `npm run preview` | Serve `dist/` on <http://localhost:4173>, forwarding `/api` the same way. The service worker, the manifest and the real bundle only exist here. |
| `npm run stack` | The connected app, end to end on local state: see above. |
| `npm run typecheck` | Types only. |
| `npm run lint` | ESLint, including the React Hooks and `jsx-a11y` rules. |
| `npm test` | Unit and component tests (Vitest, jsdom). |
| `npm run test:e2e` | Browser tests of the screens (Playwright), against a demo build. |
| `npm run test:stack` | Browser journeys of the connected app against the real API and a fresh local D1 (Playwright). |
| `npm run test:all` | Everything above, in order. |

In production one Cloudflare Worker serves this `dist/` and the API on the same
origin, so the session cookie is first-party and the passkey ceremony runs on
the app's own host. That configuration is
`apps/api/wrangler.production.jsonc.example`; the deploy, Custom Domain and
rollback steps are in `docs/SETUP.md`.

The root `npm run check` and `npm run build`, which CI runs, cover this
package's type-check, unit tests and build; lint and the browser tests run
only from here.

`npm run test:e2e` runs against Chromium in two shapes, a phone and a desktop
window. `npm run test:stack` runs the phone shape against `stack/serve.mjs`:
signing in with seeded sessions, the first run, invitations, the Google
redirect (answered by a stand-in, never Google), passkeys on a virtual
authenticator, the Lexicon, practice, progress, a lesson through to its
Lexicon sync, account isolation, export, sign-out and a cut network. Both use
the browser Playwright has already installed; if it is missing,
`npx playwright install chromium` fetches it.

## How it is put together

```
src/
  styles/            tokens from the design system, the fonts, the shell's CSS
  assets/            the Nunito subsets (OFL) and the brand mark
  design-system/     Button, Chip, TabBar, Card, Sheet, Mascot … in TypeScript
  api/               the one boundary: types.ts, client.ts, http/, demo/
  app/
    session/         the sign-in and first-run gate in front of everything
    shell/           the frame, routing, appearance, toasts, overlays
    screens/         one file per screen, grouped by mode
  lib/               text normalisation, focus handling
  pwa/               the manifest and the update prompt
e2e/                 browser tests of the screens, on a demo build
stack/               browser journeys of the connected app, and its local server
```

**Two modes, one collection.** Maintain and Learn each own four tabs and never
cross into each other; the side panel is the only way between them. A screen
pushed from a tab keeps the tab bar, so no screen is a dead end. `app/navigation.ts`
holds the tab definitions and the rule for which tab owns a given address.

**Screens read through the client.** `useClient()` returns the
`OwnwordsClient`, and `useAsync()` handles the loading and failure states.
Nothing else reaches for data.

**Nothing renders without a session.** `SessionGate` asks the backend who is
signed in. Signed out, it shows sign-in; signed in without a finished first
run, it shows the first run; any `401` later brings the person back to sign
in, saying the session ended.

**The design system is a library, not a theme.** Every colour, size, radius
and duration is a token from `styles/tokens/`. Components take tokens, never
literal colours. Three light-mode stops are darker than the design package
shipped them, so small text clears 4.5:1; the deviation is recorded at the top
of `styles/tokens/colors.css`.

## What the app does today

Connected to the API, end to end:

- **Account** — sign-in with a passkey, or with Google for the first time
  (access by invitation, redeemed on the sign-in screen); the first run
  (languages and their levels, then three preferences); changing languages and
  preferences later; adding a passkey on this device; exporting the account as
  a file; signing out.
- **Maintain** — Progress (retention per language and direction, whether
  practice is due, and when it comes next, with no card counts), Lexicon
  (search, filters by language, stage, "unverified" and words vs expressions,
  paging, per-language mastery), entry capture with optional suggestions and a
  review step whose every row can be confirmed, retried or typed by hand, the
  entry screen (senses, a new sense only once it has a gloss, equivalents,
  fit labels, translation states, "fix this translation", adding a missing
  language by hand, retry after a failure, editing the note and kind, deleting
  with a confirmation), Practice and Flashcards on the real scheduler.
- **Learn** — Course (resume card, units, can-do milestones), the lesson (its
  steps as the course content writes them, read aloud and chosen from, with
  no playback control, carrying on from the step reached, finishing into the
  Lexicon), Learn practice on what the course taught, Alphabet and Reference
  as the course publishes them.
- **Everywhere** — the side panel, light and dark, the installable manifest
  and icons, an offline shell, and a written failure with "Try again" on every
  screen when the backend cannot be reached.

What the backend does not offer yet, the app says plainly rather than
pretending:

- **Translation suggestions** — the provider is switched off until its policy
  is approved, so each language in the review step says so and can be typed
  by hand. Nothing is stored as a suggestion that did not come back.
- **Starter expressions** — the backend defines none, so an empty Lexicon
  offers only "Add your first entry".
- **Complete the phrase** — nothing creates cloze items yet, so that format
  says none are due and offers flashcards.
- **Practising ahead** — the scheduler has no such scope, so it is not offered.
- **Reminders** — shown as "After install"; nothing stores or sends them.
- **Account deletion** — deliberately deferred; see `docs/SETUP.md`.
- **Course content** — the Russian Foundations pack, reviewed by a qualified
  Russian-language teacher and shipped without recordings: the app offers no
  playback, no listening step and no audio preference. See
  `packages/learning/content/README.md`.

## Accessibility

The product's rules, and how they are kept:

- **44px minimum on every control**, verified by a browser test that measures
  every visible button, link and switch on three screens.
- **State is written in words, never colour alone.** `StateLabel` renders
  "false friend", "waiting", "typed by hand"; `MasteryMeter` puts "recognise
  74%, produce not practised yet" in its accessible name.
- **Real controls and a visible focus ring**, since an installable web app
  also opens in a desktop browser. Overlays trap focus, close on Escape, and
  return focus to whatever opened them; the screen behind them is `inert`.
- **Safe areas.** `viewport-fit=cover` plus `env(safe-area-inset-*)`; nothing
  interactive sits under the notch or the home indicator.
- **Relative units** throughout, so system text scaling grows text without
  clipping the layout.
- **Reduced motion** zeroes every duration, including the mascot's.
- **Stress marks** use the combining acute U+0301. Search folds it away along
  with Latin accents; answer checking forgives it but nothing else, because й
  is a letter and not an accented и. Nobody is ever asked to type it.

`npm run test:e2e` runs axe over nine screens plus the side panel, in light
and dark, and expects no violations.

## Installing, and the offline shell

The build emits `manifest.webmanifest` and a Workbox service worker that
precaches the shell. Installed, the app opens standalone and in portrait, and
the shell, the fonts and the icons come from the cache when the network is
gone.

That is all that works offline. Ownwords is online-first and offline use is
not a goal for the first release: the service worker precaches only the built
bundle, caches nothing at runtime, and never serves `/api/` from its fallback,
so no backend answer is ever kept or replayed. Opened without a connection,
the app says Ownwords could not be reached and offers to try again; a screen
that loses the connection later shows its own written failure and a retry, and
the collection, practice, progress and the course come back once the backend
can be reached.

A new build never replaces a running one silently. The waiting worker stays
waiting, the app says "A new version of Ownwords is ready" and offers a
reload, and an installed copy asks the worker again every hour so the offer
cannot be missed for long. Old caches are deleted on activation, so no stale
shell survives.

## Where the design comes from

The visual and behavioural source is the **Ownwords Design System** package —
its `readme.md`, tokens, assets, components and interactive UI kit — read
together with the product requirements in the repository's root `README.md`.
Where the two disagree, the product README wins.

Taken from the package as it stands: the token files in `styles/tokens/`, the
brand mark and app icons in `src/assets/brand/` and `public/icons/`, the
component set and its API, the two-mode information architecture, the copy
rules, and the screen designs the UI kit realises.

Changed on the way in, deliberately:

| Prototype | Here | Why |
| --- | --- | --- |
| Nunito from Google Fonts | Nunito self-hosted, four subsets per style | The app has to draw its own type offline, and load nothing from a third party |
| Lucide from a CDN at runtime | `lucide-react`, pinned to 0.460.0, tree-shaken | Same reason, plus a typo in an icon name is now a type error |
| A device bezel, notch and a 9:41 status bar | Nothing | Imitation chrome belongs in a mock. On a phone the app fills the viewport; a wide browser keeps the phone measure and centres it, for review |
| Screens as globals on `window`, mounted by a polling loop | Modules, routes and a router | Every screen has an address, and the back gesture works because history does |
| `role="tablist"` with no tab panels | `role="radiogroup"` with roving arrow keys | It chooses a format; it does not switch panels |
| Sheets and the side panel inside the scrolling screen | Raised to the app frame, `inert` while closed | Focus and screen readers must not reach a closed overlay |
| Press states via inline mouse handlers | CSS classes on `:active` | Touch, keyboard and reduced motion all behave |
| `--neutral-500`, `--green-500`, `--amber-500` | Three stops darker in light mode | Small text on its own tint was between 3.2:1 and 4.4:1 |

Not imported: the generated review artefacts that ship alongside the package
(the bundled offline HTML, the manifest and adherence files, the pasted
screenshots) and the specimen pages that depend on them.

### One style on every platform

Ownwords keeps one shared visual style on iOS, Android and the desktop
browser. It does not build a Material, or any other platform-native, visual
variant. The design package ships only the iOS-flavoured kit and says the
Material flavouring is not built. For this release that decision replaces the
root README's earlier "iOS styling on iOS, Material styling on Android".

What changes per platform is behaviour, and only where the platform expects
it:

- Safe-area insets, through `viewport-fit=cover` and `env(safe-area-inset-*)`.
- Standalone and fullscreen display when installed, handled by
  `display-mode` media queries.
- The phone's back gesture, which works because every screen is a history
  entry.
- `prefers-reduced-motion` and `prefers-color-scheme`.
- The `theme-color` meta, which follows the theme so the installed window's
  bars match it.

## Data

Everything on screen comes from the Ownwords API through `src/api/http/`.
`src/api/demo/fixtures.ts` holds the sample collection the design package's
UI kit used; it is loaded only by the unit tests and by a demo build
(`npm run dev:demo`, `npm run build:demo`), which says in the side panel that
it keeps nothing. The demo translator returns canned equivalents after a
short, visible wait, so the waiting state can be seen without a provider.

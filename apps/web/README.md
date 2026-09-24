# Ownwords · web

The installable Ownwords app: the Maintain and Learn front end, built from the
Ownwords design system and the product requirements in the repository's root
`README.md`.

It is a TypeScript React application, served as a static bundle and
installable on a phone. Once installed, its shell opens without a network; the
collection, practice, progress and the course are backend data, and Ownwords
is online-first, so reading and changing them needs a connection. It talks to
the backend through one typed interface, which today is answered from local
fixtures — see [docs/backend-boundary.md](docs/backend-boundary.md).

## Running it

```sh
npm install          # from the repository root; one lockfile for every workspace
cd apps/web
npm run dev          # http://localhost:5173
```

Node 24 or newer. While the demo client answers, nothing else is required:
no backend, no account, no keys, no network at runtime. Once the HTTP client
replaces it, every data flow needs the backend and a connection.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload. No service worker. |
| `npm run build` | Type-check every project, then build into `dist/`. |
| `npm run preview` | Serve `dist/` on <http://localhost:4173>. The service worker, the manifest and the real bundle only exist here. |
| `npm run typecheck` | Types only. |
| `npm run lint` | ESLint, including the React Hooks and `jsx-a11y` rules. |
| `npm test` | Unit and component tests (Vitest, jsdom). |
| `npm run test:e2e` | Browser smoke tests (Playwright). Builds and previews first. |
| `npm run test:all` | Everything above, in order. |

The root `npm run check` and `npm run build`, which CI runs, cover this
package's type-check, unit tests and build; lint and the browser tests run
only from here.

`npm run test:e2e` runs against Chromium in two shapes, a phone and a desktop
window, and uses the browser Playwright has already installed. If it is
missing, `npx playwright install chromium` fetches it.

## How it is put together

```
src/
  styles/            tokens from the design system, the fonts, the shell's CSS
  assets/            the Nunito subsets (OFL) and the brand mark
  design-system/     Button, Chip, TabBar, Card, Sheet, Mascot … in TypeScript
  api/               the one boundary: types.ts, client.ts, demo/
  app/
    shell/           the frame, routing, appearance, toasts, overlays
    screens/         one file per screen, grouped by mode
  lib/               text normalisation, focus handling
  pwa/               the manifest and the update prompt
e2e/                 browser smoke tests
```

**Two modes, one collection.** Maintain and Learn each own four tabs and never
cross into each other; the side panel is the only way between them. A screen
pushed from a tab keeps the tab bar, so no screen is a dead end. `app/navigation.ts`
holds the tab definitions and the rule for which tab owns a given address.

**Screens read through the client.** `useClient()` returns the
`OwnwordsClient`, and `useAsync()` handles the loading and failure states.
Nothing else reaches for data.

**The design system is a library, not a theme.** Every colour, size, radius
and duration is a token from `styles/tokens/`. Components take tokens, never
literal colours. Three light-mode stops are darker than the design package
shipped them, so small text clears 4.5:1; the deviation is recorded at the top
of `styles/tokens/colors.css`.

## What the app does today

Both modes are built, with the flows the design package specifies:

- **Maintain** — Progress (retention per language and direction, whether
  practice is due, and what is coming, with no card counts), Lexicon (search,
  filters by language, mastery, "unverified" and words vs expressions,
  per-language mastery, three one-tap starter expressions when it is empty,
  entry capture with optional auto-translation and a review step), the entry
  screen (senses, a new sense only once it has a gloss, equivalents, fit
  labels, translation states, "fix this translation", retry after a failure),
  Practice (complete the phrase, with a prompt before the answer, and practice
  ahead once nothing is due) and Flashcards.
- **Learn** — Course (resume card, units, can-do milestones), the lesson
  (hear it, a rule of four lines, use it, a perception drill), Alphabet (all
  33 letters, with the ones that look Latin but are not marked in words as
  well as in colour) and Reference.
- **Everywhere** — the side panel (mode, languages, preferences, appearance,
  export, account), light and dark, the installable manifest and icons, and an
  offline shell.

Screens that depend on work the backend has not delivered — editing an entry,
adding a language, exporting, signing in, recorded audio — say so plainly when
they are used, rather than pretending to act.

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
so no backend answer is ever kept or replayed. With the HTTP client in place,
a screen opened without a connection shows its written failure and a retry,
and the collection, practice, progress and the course come back once the
backend can be reached.

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

Everything on screen comes from `src/api/demo/fixtures.ts`. It is the sample
collection the design package's UI kit used, written into the typed shapes the
backend will answer, and it lives in memory for one session. Storing a
collection, scheduling practice and keeping progress are the backend's; the
connected flows need it, and nothing entered here is kept. The demo
translator returns canned equivalents after a short, visible wait, so the
waiting state is real rather than decorative.

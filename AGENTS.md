# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- `README.md` is the product definition; keep implementation and deployment details in `docs/SETUP.md`.
- Run `npm run check` and `npm run build` from the repository root before delivery. API tests use local Miniflare/D1 and require no provider credentials; `apps/api/scripts/backup-restore.test.mjs` also spawns real `wrangler dev` servers.
- `apps/api/src/app.ts` is the composition root that mounts the domain packages behind verified sessions. Migration ownership, composition order, identity boundaries, and what is verified versus still needing live credentials are in `docs/SETUP.md`; migration order is enforced by `apps/api/scripts/compose-migrations.mjs`.
- The API consumes `@ownwords/lexicon` from its compiled `dist/`; the API's pre-scripts build it, so run API commands through npm scripts rather than bare `tsc`/`vitest` after changing Lexicon sources.
- Domain packages are independently testable; `packages/lexicon/README.md` documents the Lexicon package commands and integration boundary.
- The front end is `apps/web`. Its `README.md` covers setup, commands and the design provenance; `apps/web/docs/backend-boundary.md` is the seam between it and the backend: each client method's route, and the authored course-content fields the app reads.
- The visual and behavioural source for the front end is the supplied Ownwords Design System package, read together with the product README. Deviations from it are recorded in `apps/web/README.md` and, for the colour tokens, at the top of `apps/web/src/styles/tokens/colors.css`.
- Every screen reads through `apps/web/src/api/client.ts` and nothing else. `src/api/http/` answers it for the app (API on the app's own origin under `/api`); `src/api/demo/` only for unit tests and Vite `demo`-mode builds (`demo-dist/`), never as a fallback.
- Browser tests run only from `apps/web`: `npm run test:e2e` (screens, demo build) and `npm run test:stack` (connected app against real `wrangler dev` + fresh local D1 with synthetic sessions, via `stack/serve.mjs`; also `npm run stack` for manual use).
- Production same-origin hosting is `apps/api/wrangler.production.jsonc.example` (app build as Worker assets, `/api` ahead of the SPA fallback, `workers_dev: false`, no route): the deploy, Custom Domain and rollback steps are in `docs/SETUP.md`, and `npm run check:hosting --workspace @ownwords/api` proves the shape locally. No cloud step in it has been executed.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.

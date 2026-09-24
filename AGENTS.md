# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- `README.md` is the product definition; keep implementation and deployment details in `docs/SETUP.md`.
- Run `npm run check` and `npm run build` from the repository root before delivery. API tests use local Miniflare/D1 and require no provider credentials; `apps/api/scripts/backup-restore.test.mjs` also spawns real `wrangler dev` servers.
- `apps/api/src/app.ts` is the composition root that mounts the domain packages behind verified sessions. Migration ownership, composition order, identity boundaries, and what is verified versus still needing live credentials are in `docs/SETUP.md`; migration order is enforced by `apps/api/scripts/compose-migrations.mjs`.
- The API consumes `@ownwords/lexicon` from its compiled `dist/`; the API's pre-scripts build it, so run API commands through npm scripts rather than bare `tsc`/`vitest` after changing Lexicon sources.
- Domain packages are independently testable; `packages/lexicon/README.md` documents the Lexicon package commands and integration boundary.
- The front end is `apps/web`. Its `README.md` covers setup, commands and the design provenance; `apps/web/docs/backend-boundary.md` is the seam between it and the backend.
- The visual and behavioural source for the front end is the supplied Ownwords Design System package, read together with the product README. Deviations from it are recorded in `apps/web/README.md` and, for the colour tokens, at the top of `apps/web/src/styles/tokens/colors.css`.
- Every screen reads through `apps/web/src/api/client.ts` and nothing else. Swapping the demo implementation for an HTTP one must not change a screen.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.

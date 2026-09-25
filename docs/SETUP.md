# Backend setup

Everything except live provider verification runs locally without external credentials. Do not paste secrets into chat, issues, commits, or logs.

## What the owner must provide later

1. **Cloudflare deploy access:** the target Cloudflare account ID and an account-owned API token restricted to that account. First-time automated setup needs `D1 Write` plus Workers product `Admin` to create the database and Worker. The safer ongoing token is scoped to `D1 Write` and `Editor` on only the created `ownwords-api` Worker; the owner can pre-create the Worker to avoid granting product-level `Admin`. The deploy itself attaches no hostname, so it needs no `Workers Routes Write`; add zone-scoped `Workers Routes Write` only if the owner delegates the Custom Domain attachment to an operator. These are deploy-time credentials only; local work and CI do not need them.
2. **Google OAuth:** a **Web application** OAuth client exists in the `ownwords` Google Cloud project (External,
   Testing), authorised for the JavaScript origin `https://ownwords.neonunez.com` and exactly
   `https://ownwords.neonunez.com/api/auth/callback/google` as its redirect URI; the owner holds its secret. Add
   `http://localhost:5173` and `http://localhost:5173/api/auth/callback/google` only when someone intentionally tests
   Google locally through the app's dev server (`npm run dev:app` below). Store the client ID and client secret as
   Worker secrets, never in Git. A client in Testing status only serves accounts the owner has added as test users.
3. **Authentication secret:** generate locally with `openssl rand -base64 32`. Put it in `apps/api/.dev.vars` for local work and later run `wrangler secret put BETTER_AUTH_SECRET` for the deployed Worker. Do not reuse the example value.
4. **Passkey domain:** chosen and written into the production template: the app, the API and the passkey ceremony
   share the HTTPS origin `https://ownwords.neonunez.com`, with the narrow RP ID `ownwords.neonunez.com`. Serving
   `/api/auth` on the app's own origin is what keeps the WebAuthn ceremony same-origin; a parent RP ID such as
   `neonunez.com` would deliberately share credentials with eligible subdomains and is not used. Local development
   uses origin `http://localhost:8787` and RP ID `localhost`. Real iPhone/PWA validation remains a post-deployment
   device check.
5. **OpenCode:** provider-policy approval is still pending. No translation key or account is requested, and this backend does not call the provider.

## Local development

```sh
npm ci
cp apps/api/.dev.vars.example apps/api/.dev.vars
# Replace BETTER_AUTH_SECRET in the ignored file.
npm run db:migrate:local --workspace @ownwords/api
# Optional: publish the authored Russian Foundations course into the local database.
npm run content:publish:local --workspace @ownwords/api -- ../../packages/learning/content/russian-foundations-v1.json
npm run dev --workspace @ownwords/api
```

`content:publish:local` validates a course pack and publishes it only into the local D1 state that `wrangler dev`
uses; it has no remote mode. Publishing to production is a separate, explicitly confirmed operator run described
under "Publishing course content to production". The API scripts build `@ownwords/lexicon` first because that
package is consumed from its compiled output.

### The app against the local API

The app calls the API on its own origin, under `/api`, so the session cookie is first-party and a passkey ceremony
runs on the relying party's origin. Locally, the app's dev server and preview forward `/api` to `wrangler dev`:

```sh
# The whole connected app on http://localhost:4180, on a fresh local D1 with the
# Russian Foundations course and synthetic accounts. It prints how to sign in as one.
npm run stack --workspace @ownwords/web

# Or, with hot reload: the API trusting the dev server's origin, then the app.
npm run dev:app --workspace @ownwords/api
npm run dev --workspace @ownwords/web
```

`dev:app` is `dev` with `BETTER_AUTH_URL`, `TRUSTED_ORIGINS` and `PASSKEY_RP_ORIGIN` set to `http://localhost:5173`,
the origin the browser sees. Without Google credentials, sign in there with a session you seed yourself, the same
way the tests do: insert a `user`, an `authorized_users` row and a `session` row into the local D1 with
`wrangler d1 execute ownwords-local --local`, then set the cookie `ownwords.session_token=<token>.<signature>` in the
browser, where `<signature>` is the base64 HMAC-SHA256 of the token keyed with `BETTER_AUTH_SECRET`.
`apps/web/stack/serve.mjs` does exactly this.

`npm run db:compose --workspace @ownwords/api` gathers migrations by filename from core (`0001–0099`), Lexicon (`0100–0199`), and Learning (`0200–0299`) into an ignored Wrangler directory. Duplicate or out-of-contract names fail before D1 is touched. The same composed directory is used by local migration commands and deployment tooling.

## Production hosting

One Cloudflare Worker serves the app and the API from one origin, so the session cookie is first-party and the
passkey ceremony runs on the app's own origin. `apps/api/wrangler.production.jsonc.example` is that configuration:
the built app as the Worker's assets, `single-page-application` fallback for client-side routes, `run_worker_first`
for `/api`, `/api/*` and `/health` so the app shell can never answer an API request, and `workers_dev: false` with
no `routes` so a deploy publishes no hostname of its own. The tracked file is a template: its D1 ID is a placeholder,
and no secret is ever in it. `npm run check:hosting --workspace @ownwords/api` builds the app, dry-runs that deploy
and serves it under a real `wrangler dev`, checking the shell, the manifest, the service worker, and that `/api/*`
answers with JSON — including its own 404 — on local state and with no credential.

The checked-in `apps/api/wrangler.jsonc` stays local-only, with a non-deployable placeholder D1 ID. No repository
workflow deploys.

### Deployment (not executed here; every step is the owner's to approve)

Each numbered step is a separate permission boundary. None of them has been run: this repository contains the
configuration, not a deployment.

1. **Create the production database and copy the template.** D1 creation is billable.

   ```sh
   npx wrangler d1 create ownwords-production --location=enam
   cp apps/api/wrangler.production.jsonc.example apps/api/wrangler.production.jsonc
   ```

   The copy is ignored by Git. Put the returned D1 ID in its `database_id`, and leave everything else as the template
   has it: `ENVIRONMENT=production`, and `BETTER_AUTH_URL`, `TRUSTED_ORIGINS`, `PASSKEY_RP_ID` and `PASSKEY_RP_ORIGIN`
   all naming `https://ownwords.neonunez.com` / `ownwords.neonunez.com`. No wildcard, apex, `www`, HTTP or extra
   origin is needed.

2. **Set the secrets interactively**, in an owner-controlled terminal. They are Worker secrets, never config values
   or command-line arguments, and never pasted anywhere:

   ```sh
   npx wrangler secret put BETTER_AUTH_SECRET --config apps/api/wrangler.production.jsonc
   npx wrangler secret put GOOGLE_CLIENT_ID --config apps/api/wrangler.production.jsonc
   npx wrangler secret put GOOGLE_CLIENT_SECRET --config apps/api/wrangler.production.jsonc
   npx wrangler secret put INVITATION_ADMIN_TOKEN --config apps/api/wrangler.production.jsonc
   # Only if course content will be published; see the next section.
   npx wrangler secret put CONTENT_PUBLISH_TOKEN --config apps/api/wrangler.production.jsonc
   ```

3. **Apply the composed migrations**, reviewing the directory and the plan first:

   ```sh
   npm run db:compose --workspace @ownwords/api
   npx wrangler d1 migrations apply ownwords-production --remote --config apps/api/wrangler.production.jsonc
   ```

4. **Build the app, dry-run, then deploy.** Deployment can incur Worker and asset charges. The app's build is the
   asset; `apps/web/demo-dist/` must never be uploaded.

   ```sh
   npm run build --workspace @ownwords/web
   npx wrangler deploy --dry-run --config apps/api/wrangler.production.jsonc
   npx wrangler deploy --config apps/api/wrangler.production.jsonc
   ```

5. **Attach the Custom Domain separately**, in the Cloudflare dashboard or an equally explicit operator action. The
   template has no route, so step 4 leaves `ownwords.neonunez.com` unresolvable on purpose: DNS and the certificate
   are the owner's decision, never a hidden effect of deploying. Then read the deployment back with a plain client:

   ```sh
   curl -fsS -D - -o /dev/null https://ownwords.neonunez.com/
   curl -fsS -D - -o /dev/null https://ownwords.neonunez.com/maintain/lexicon
   curl -fsS -D - -o /dev/null https://ownwords.neonunez.com/manifest.webmanifest
   curl -fsS -D - -o /dev/null https://ownwords.neonunez.com/api/auth/get-session
   curl -fsS -D - -o /dev/null https://ownwords.neonunez.com/api/nope
   ```

   `/` and the app route answer `200 text/html`; the manifest answers JSON; `/api/*` answers from the Worker, and
   `/api/nope` is the API's JSON 404 rather than the app shell.

**Nothing is published to make authentication work.** Deploying and inviting the first account do not publish
course content: the database holds the invited account's own data, and the Russian Foundations pack (teacher-reviewed
and shipped without recordings; `packages/learning/content/README.md`) is only ever loaded by the explicit operator run
below.

**Rollback.** A Worker rollback redeploys the previous version; `npx wrangler deployments list --config
apps/api/wrangler.production.jsonc` names the versions and `npx wrangler rollback --config
apps/api/wrangler.production.jsonc` returns to the one before. It does not reverse D1 writes, so keep Time Travel or
an export. A published course version is immutable — correct content by publishing a new version. An unaccepted
invitation is revoked by ID. Detaching the Custom Domain, or deleting the Worker, is the owner's own cloud action;
nothing in this repository does it.

## Publishing course content to production

Course content reaches the production database only through the deployed API's operator route, never through
`wrangler d1 execute` and never through hand-written course SQL. The route calls the Learning package's own
`ingestCourseVersion` and `publishCourseVersion` against the production D1 binding, so a remote publication is the
same validated importer the local publisher uses, in one atomic batch, and a published version is immutable.

- `GET /api/v1/admin/content/versions?courseId=<id>` lists the versions a course already holds: version, status,
  content hash and publication time. It writes nothing.
- `POST /api/v1/admin/content/publish` takes the course pack, the `expect` block naming the exact course, version and
  64-character content hash, an `editorial` statement, and `dryRun`. `dryRun` defaults to `true`, which validates the
  pack, compares it with `expect`, and answers with the action it would take (`publish`, `resume-draft` or
  `already-published`) without writing. `dryRun: false` performs that one publication.

Authority is the `CONTENT_PUBLISH_TOKEN` Worker secret, a separate 64-hex value from `INVITATION_ADMIN_TOKEN`. It is
absent by default, and an absent, malformed or non-matching value disables publication entirely; no session, role or
other administrative credential opens this route. Provision it with `wrangler secret put CONTENT_PUBLISH_TOKEN
--config apps/api/wrangler.production.jsonc`, generate it with `openssl rand -hex 32`, and keep it out of the PWA,
browser storage, URLs, shell history, logs and exported API collections. Replacing the secret revokes publication
authority.

**This publication has not been run.** `npm run content:publish:remote` refuses to target anything but the copied
production config: the tracked `apps/api/wrangler.jsonc`, the tracked `wrangler.production.jsonc.example`, a config
whose `ENVIRONMENT` is not `production`, a Worker other than `ownwords-api`, an origin other than
`https://ownwords.neonunez.com`, a database other than `ownwords-production`, and a `database_id` that is still the
placeholder or the all-zero local ID are all refused before any request is sent. It also refuses a pack whose computed
hash is not the `--expect-hash` it was given.

From the repository root, in an owner-controlled terminal, with the production config already copied, the real D1 ID
in it, the migrations applied and the Worker deployed:

```sh
npm run content:validate --workspace @ownwords/learning -- content/russian-foundations-v1.json
# Preflight: reads the existing versions and prints the exact plan. Sends no write.
CONTENT_PUBLISH_TOKEN="$(openssl rand -hex 32)" # or read the stored value without echoing it
npm run content:publish:remote --workspace @ownwords/api -- \
  --config apps/api/wrangler.production.jsonc \
  --expect-course russian-foundations \
  --expect-version 1 \
  --expect-hash 6fc73576449e888aa99d519790bf112fca98b35254da649db5a228a42fe6a08b \
  --teacher-reviewed \
  --note "Teacher-reviewed sequence and wording; recorded audio is still being acquired separately." \
  ../../packages/learning/content/russian-foundations-v1.json
```

Re-run that identical command with `--confirm` appended to publish it. The run prints the target Worker, origin,
database name and ID, the course, version, content hash, content counts, how many items carry audio, and the editorial
statement before it sends anything.

**The write is irreversible for that course version.** A published version cannot be edited, replaced or deleted: a
mistake, or a later audio change, is corrected by publishing the next sequential version, which learners who already
started v1 stay on. A Worker rollback does not reverse it either. Nothing else publishes content: `wrangler d1 execute`
with course SQL is not an operator path, and the local publisher stays local.

The Russian Foundations v1 pack has been reviewed by a qualified Russian-language teacher (owner-confirmed; the
reviewer's identity and date are deliberately not recorded in this repository) and currently carries **no recorded
audio**: `audio` is omitted rather than invented, because no complete quality- and rights-cleared recording set
exists, and its acquisition is separately authorized work. Nothing in this repository claims the course is ready for
family use beyond that.

## Invitation administration

The owner provisions `INVITATION_ADMIN_TOKEN` separately from user accounts: generate 32 random bytes with `openssl rand -hex 32` and keep the resulting 64 lowercase hexadecimal characters in an owner-controlled password manager. For local use, set it in ignored `apps/api/.dev.vars`. For production, provision it interactively with `wrangler secret put INVITATION_ADMIN_TOKEN --config apps/api/wrangler.production.jsonc`. There is no checked-in default; absent or malformed configuration disables administration. No first signup, Google claim, session, or client-provided role grants this authority.

An owner-controlled HTTP client sends `Authorization: Bearer <token>` and an exact configured `Origin` to:

- `POST /api/v1/admin/invitations` with JSON `{ "email": "learner@example.com" }`. The lifetime is fixed server-side at seven days and cannot be set by the client; any extra field is rejected with `400`. A `201` response returns `data.id`, `data.code`, the normalized email, and ISO `expiresAt`. The random 256-bit code is returned only here; D1 stores only its SHA-256 hash. Deliver it privately to the intended learner.
- `DELETE /api/v1/admin/invitations/<id>` to revoke an unaccepted invitation. Repeated revocation is idempotent; missing or already accepted invitations return `404`. Revocation invalidates outstanding signup authorizations, not an existing accepted account's sessions.

This lets the owner issue their own initial email invitation through the same protected API before any user account exists. Redeem through `POST /api/v1/invitations/redeem`, then complete Google sign-in for that email. Do not insert users manually or loosen invitation enforcement to bootstrap. Keep the administration token out of the PWA, browser storage, URLs, shell history, request logs and exported API collections. Use HTTPS outside localhost. Cookie sessions never authorize this API; browser cross-origin administration is not enabled by CORS, and mutation requests additionally require a trusted Origin. Replace the Worker secret to rotate or revoke administrative authority. No invitation CLI or admin UI is implemented.

## Integration contract

Core pins Hono `4.13.8`, Better Auth `1.7.5`, and `@better-auth/passkey` `1.7.5`. `createApp` in
[`apps/api/src/app.ts`](../apps/api/src/app.ts) is the composition root:

- `/api/v1/lexicon/*` serves `createLexiconRoutes`, `/api/v1/learning/*` serves `createLearningRoutes`, and
  `/api/v1/account/*` serves core account routes. Each prefix first runs the verified Better Auth session middleware,
  which alone sets the `userId` variable; nothing in a body, query, or header can select an owner. Each prefix also
  caps request bodies at 256 KiB, below which the packages apply their own field limits.
- The course-to-Lexicon importer is created per request from that request's D1 binding and injected into Learning
  as a typed factory. Neither package imports the other or writes the other's tables.
- Learning validates that every item a lesson uses is introduced by exactly one lesson; the Lexicon importer alone
  owns its field limits. Completing a lesson commits the completion and one pending
  sync row per introduced item in one D1 batch, then imports each item under its stable
  `(owner, course, version, item)` key. A failed import returns `202` with `lexiconSync.status: "pending"`; completing
  the lesson again retries only that lesson's pending items and never duplicates an entry.
- Learn-mode practice uses the Lexicon scheduler with `origin=course` on `GET /api/v1/lexicon/practice/due`, which
  limits the queue to course-imported entries. Maintain omits it and practises the whole collection, including personal
  vocabulary in the learned language. Learning itself serves only core curriculum.
- `GET /api/v1/learning/courses/:courseId/versions/:version/licenses` lists each distinct item and recording licence
  once. It is dormant: the authored pack has no recordings and the app calls no attribution surface, because the
  course ships without audio.

**Recorded audio is dormant, not removed.** The `learning_items.audio_json` column, the `russian_course_audio` profile
preference and the licenses route are all stored and served, and no app screen reads any of them: the course is
honestly audio-free, with no playback control, no listening step and no audio toggle. Audio was investigated and
deferred because no commercially clear, complete recording set exists for the course's phrases; the evidence and the
future route (one native-speaker voice, a written release) are in
`packages/learning/content/README.md`. Do not delete the column, the preference or the route to "tidy up", and do not
wire them into the app without that pack.

Migration composition accepts core `0001–0099`, Lexicon `0100–0199`, and Learning `0200–0299` in deterministic
filename order and rejects duplicate numeric IDs even with different filenames.

### What is verified locally

`npm run test:stack --workspace @ownwords/web` drives the production build of the app in Chromium against the real
API under `wrangler dev` and a fresh local D1 (`apps/web/stack/serve.mjs`), with synthetic sessions and no
credentials. Its journeys: the sign-in gate; a wrong and a real invitation; the Google redirect carrying this
origin's callback, answered by a stand-in so nothing reaches Google; the first run; adding a passkey after sign-in
and signing in with it alone, on a Chromium virtual authenticator against the real passkey endpoints; capturing an
entry whose suggestions fail because the provider is off, typing equivalents by hand, search without stress marks,
flashcard practice and the retention it records; finishing a Russian Foundations lesson, carrying on from the step reached,
the Lexicon import and Learn practice; the absence of every audio affordance and listening claim in that published
course and in the side panel; the alphabet and reference; cross-account denial; export; a session ending
mid-use; sign-out that revokes the session; and a cut network with recovery.

`npm run check` runs every package's tests plus the integrated suites in [`apps/api/test`](../apps/api/test), which
execute in the Workers runtime against a local D1 with all composed migrations. They use two or more isolated users
whose sessions are real Better Auth session rows signed with a test secret, and cover: cross-user denial for entries,
senses, equivalents, cloze items, reviews, practice queues, progress, and exports; forged, expired, and uninvited
sessions; spoofed owner fields; version pinning without migration; unsupported version transitions and invalid
prerequisites; export retry after a simulated Lexicon failure; the course-only practice scope; invalid payloads; and
administrator invitation issuance through a complete Google sign-in, driven by a stubbed Google token endpoint and
placeholder client values. [`contentPublication.test.ts`](../apps/api/test/contentPublication.test.ts) drives the
operator publication route against an isolated local D1: a closed route without its secret or with the other
administrative credential, refusals for a pack that is not the named course/version/hash, a preflight that writes
nothing, an atomic publish of exactly that version, an idempotent repeat, an out-of-order version, a resumed
identical draft, and a refusal to replace different published content.
[`backup-restore.test.mjs`](../apps/api/scripts/backup-restore.test.mjs) runs two real
`wrangler dev` servers to rehearse `wrangler d1 export` and restore into a separate local database.
[`production-hosting-routes.test.mjs`](../apps/api/scripts/production-hosting-routes.test.mjs) dry-runs the
production deploy and serves the production template under a real `wrangler dev` with the real app build: the shell
and its client-side routes, the manifest, the service worker and an icon from the assets, and `/api`, `/api/nope`,
`/api/auth/get-session` and a cross-origin write answered by the Worker as JSON, never by the shell's fallback.
[`publish-remote-content.test.mjs`](../apps/api/scripts/publish-remote-content.test.mjs) runs the remote publisher
itself: the accepted production target, every refused configuration (local, template, non-production, wrong worker,
wrong origin, wrong database, placeholder and all-zero IDs, unreadable), a refused pack, a refused missing token, and
the request plan, which contains reads only until the run is confirmed.

### Still unverified until the owner provides credentials

These need the live resources listed at the top of this file; no test here stands in for them.

1. **Google OAuth:** sign in once with the real client against the deployed origin: the consent screen, the registered
   redirect URI, the callback into the app, and a verified Google email that matches an issued invitation. Locally
   only the redirect to Google, with the right callback, is checked.
2. **Passkeys:** after that sign-in, register a passkey from Safari on an iPhone, both in the browser and from the
   Home Screen app, then sign out and sign in with it. Confirm the RP ID and origin match the deployed host. Locally
   the same ceremony is checked only on a Chromium virtual authenticator, which says nothing about Safari, iCloud
   Keychain or the installed app.
3. **Cloudflare:** create the production D1 database, apply the composed migrations remotely, dry-run and deploy the
   Worker and its assets, attach the Custom Domain, then run one remote `wrangler d1 export` and restore it into a
   separate test database. The configuration for this is in the repository and locally tested; the steps are not run.
4. **Course content:** publish the reviewed production course pack to the remote database. `content:publish:remote`
   exists and is exercised locally against an isolated local D1, but nothing has been published: the production
   publication is the owner's own confirmed run of the command in "Publishing course content to production" below.
5. **The app on the deployed origin:** the hosting configuration is in the repository and checked locally, but the
   installed app, the standalone launch, safe areas, the offline shell and the "new version" prompt are still only
   Chromium on a desktop, shaped like a phone. Check them on the iPhone, after a real deployment.

## Backup and restore

Once deployed, export the remote D1 database weekly to an owner-controlled PC:

```sh
npx wrangler d1 export ownwords-production --remote --output "backups/ownwords-$(date -u +%F).sql"
```

To rehearse a restore without touching production, create a separate D1 database, review the SQL export, and import it there with `wrangler d1 execute <restore-test-name> --remote --file <export.sql>`. D1 Time Travel remains the short-window production recovery mechanism. Never rehearse by overwriting the production database.

The local rehearsal test shows the export restores into an empty database with its migration history, immutability
triggers, and every user's data intact, and that the restored API keeps enforcing ownership and version pinning.

## Account export and deletion

`GET /api/v1/account/export` returns one JSON document, `ownwords-account-export/1`, for the signed-in user: the
account, linked sign-in methods and passkey names, onboarding profile, the whole Lexicon including soft-deleted rows
and review history, and Learning enrollment, lesson progress, and export state. Each package reads only its own
tables for that owner. Credentials, session tokens, passkey public keys, the translation cache, and session-scoped
revisit markers are left out. Published course content is not personal data and is not repeated.

Account deletion is deliberately out of scope for this backend and is tracked as separate future work; Better Auth's
raw user-deletion endpoint stays disabled until then. Lexicon and
Learning rows are keyed by owner ID without foreign keys to the auth tables, so deleting only the core user would
leave them behind. Deletion needs ownership-aware delete services in both packages, composed into one authenticated
operation.

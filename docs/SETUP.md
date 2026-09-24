# Backend setup

Everything except live provider verification runs locally without external credentials. Do not paste secrets into chat, issues, commits, or logs.

## What the owner must provide later

1. **Cloudflare deploy access:** the target Cloudflare account ID and an account-owned API token restricted to that account. First-time automated setup needs `D1 Write` plus Workers product `Admin` to create the database and Worker. The safer ongoing token is scoped to `D1 Write` and `Editor` on only the created `ownwords-api` Worker; the owner can pre-create the Worker to avoid granting product-level `Admin`. Add zone-scoped `Workers Routes Write` only when the deployment will create or change a custom domain or route. These are deploy-time credentials only; local work and CI do not need them.
2. **Google OAuth:** create a **Web application** OAuth client. Register the PWA origin as an authorized JavaScript origin and exactly `https://<production-host>/api/auth/callback/google` as an authorized redirect URI. Add `http://localhost:8787` and `http://localhost:8787/api/auth/callback/google` only when someone intentionally tests Google locally. Store the client ID and client secret as Worker secrets/configuration, never in Git.
3. **Authentication secret:** generate locally with `openssl rand -base64 32`. Put it in `apps/api/.dev.vars` for local work and later run `wrangler secret put BETTER_AUTH_SECRET` for the deployed Worker. Do not reuse the example value.
4. **Passkey domain:** choose the final HTTPS browser/auth origin and RP ID. Prefer serving `/api/auth` on the PWA origin so the WebAuthn ceremony is same-origin. For `https://app.example.com`, the narrow RP ID is `app.example.com`; a parent such as `example.com` deliberately shares credentials with eligible subdomains. Local development uses origin `http://localhost:8787` and RP ID `localhost`. Real iPhone/PWA validation remains a post-deployment device check.
5. **OpenCode:** provider-policy approval is still pending. No translation key or account is requested, and this backend does not call the provider.

## Local development

```sh
npm ci
cp apps/api/.dev.vars.example apps/api/.dev.vars
# Replace BETTER_AUTH_SECRET in the ignored file.
npm run db:migrate:local --workspace @ownwords/api
# Optional: publish the synthetic test-author course into the local database.
npm run content:publish:local --workspace @ownwords/api -- ../../packages/learning/test/fixtures/synthetic-russian.json
npm run dev --workspace @ownwords/api
```

`content:publish:local` validates a course pack and publishes it only into the local D1 state that `wrangler dev`
uses; it has no remote mode. The API scripts build `@ownwords/lexicon` first because that package is consumed from its
compiled output.

`npm run db:compose --workspace @ownwords/api` gathers migrations by filename from core (`0001–0099`), Lexicon (`0100–0199`), and Learning (`0200–0299`) into an ignored Wrangler directory. Duplicate or out-of-contract names fail before D1 is touched. The same composed directory is used by local migration commands and deployment tooling.

The checked-in Wrangler configuration is local-only and contains a non-deployable placeholder D1 ID. No repository workflow deploys. Before a first deployment, create the production database with the approved Eastern North America hint, copy the production template, and replace its hostnames and returned D1 ID:

```sh
npx wrangler d1 create ownwords-production --location=enam
cp apps/api/wrangler.production.jsonc.example apps/api/wrangler.production.jsonc
```

The copied file is ignored. Confirm `ENVIRONMENT=production`, the public `BETTER_AUTH_URL`, exact comma-separated `TRUSTED_ORIGINS`, `PASSKEY_RP_ID`, and `PASSKEY_RP_ORIGIN`. Set secrets interactively; never put them in the config or command line:

```sh
npx wrangler secret put BETTER_AUTH_SECRET --config apps/api/wrangler.production.jsonc
npx wrangler secret put GOOGLE_CLIENT_ID --config apps/api/wrangler.production.jsonc
npx wrangler secret put GOOGLE_CLIENT_SECRET --config apps/api/wrangler.production.jsonc
```

Compose and review every core/domain migration, apply them explicitly with `wrangler d1 migrations apply ownwords-production --remote --config apps/api/wrangler.production.jsonc`, and only then run `wrangler deploy --config apps/api/wrangler.production.jsonc`.

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
- Learning validates that every item a lesson uses is introduced by exactly one lesson and fits the Lexicon importer's
  limits, so a published item can always be exported. Completing a lesson commits the completion and one pending
  sync row per introduced item in one D1 batch, then imports each item under its stable
  `(owner, course, version, item)` key. A failed import returns `202` with `lexiconSync.status: "pending"`; completing
  the lesson again retries only that lesson's pending items and never duplicates an entry.
- Learn-mode practice uses the Lexicon scheduler with `origin=course` on `GET /api/v1/lexicon/practice/due`, which
  limits the queue to course-imported entries. Maintain omits it and practises the whole collection, including personal
  vocabulary in the learned language. Learning itself serves only core curriculum.
- `GET /api/v1/learning/courses/:courseId/versions/:version/licenses` lists each distinct item and recording licence
  once, for attribution in Settings rather than beside content.

Migration composition accepts core `0001–0099`, Lexicon `0100–0199`, and Learning `0200–0299` in deterministic
filename order and rejects duplicate numeric IDs even with different filenames.

### What is verified locally

`npm run check` runs every package's tests plus the integrated suites in [`apps/api/test`](../apps/api/test), which
execute in the Workers runtime against a local D1 with all composed migrations. They use two or more isolated users
whose sessions are real Better Auth session rows signed with a test secret, and cover: cross-user denial for entries,
senses, equivalents, cloze items, reviews, practice queues, progress, and exports; forged, expired, and uninvited
sessions; spoofed owner fields; version pinning without migration; unsupported version transitions and invalid
prerequisites; export retry after a simulated Lexicon failure; the course-only practice scope; invalid payloads; and
administrator invitation issuance through a complete Google sign-in, driven by a stubbed Google token endpoint and
placeholder client values. [`backup-restore.test.mjs`](../apps/api/scripts/backup-restore.test.mjs) runs two real
`wrangler dev` servers to rehearse `wrangler d1 export` and restore into a separate local database.

### Still unverified until the owner provides credentials

These need the live resources listed at the top of this file; no test here stands in for them.

1. **Google OAuth:** sign in once with the real client against the deployed origin: the consent screen, the registered
   redirect URI, and a verified Google email that matches an issued invitation.
2. **Passkeys:** after that sign-in, register a passkey from Safari on an iPhone, both in the browser and from the
   Home Screen app, then sign out and sign in with it. Confirm the RP ID and origin match the deployed host.
3. **Cloudflare:** create the production D1 database, apply the composed migrations remotely, dry-run and deploy the
   Worker, then run one remote `wrangler d1 export` and restore it into a separate test database.
4. **Course content:** publish the reviewed production course pack to the remote database. There is no remote
   publishing command yet; `content:publish:local` deliberately refuses anything but local state.

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

Account deletion is still not implemented, and Better Auth's raw user-deletion endpoint stays disabled. Lexicon and
Learning rows are keyed by owner ID without foreign keys to the auth tables, so deleting only the core user would
leave them behind. Deletion needs ownership-aware delete services in both packages, composed into one authenticated
operation.

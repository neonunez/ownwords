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
npm run dev --workspace @ownwords/api
```

`npm run db:compose --workspace @ownwords/api` gathers migrations by filename from core (`0001*`), Lexicon (`0100*`), and Learning (`0200*`) into an ignored Wrangler directory. Duplicate or out-of-contract names fail before D1 is touched. The same composed directory is used by local migration commands and deployment tooling.

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

## Integration contract

Core currently pins Hono `4.13.8`, Better Auth `1.7.5`, and `@better-auth/passkey` `1.7.5`. `@ownwords/api` exports `createApp`, its dependency seams, and the shared `DomainEnv`: D1 is the `DB` binding and authenticated identity is the server-set `userId` variable. Domain route factories remain `createLexiconRoutes` and `createLearningRoutes`, mounted at `/api/v1/lexicon` and `/api/v1/learning` once their actual packages are supplied. Migration composition already accepts only core `0001*`, Lexicon `0100*`, and Learning `0200*` files in deterministic filename order; route mounting is intentionally not faked before those packages land.

## Backup and restore

Once deployed, export the remote D1 database weekly to an owner-controlled PC:

```sh
npx wrangler d1 export ownwords-production --remote --output "backups/ownwords-$(date -u +%F).sql"
```

To rehearse a restore without touching production, create a separate D1 database, review the SQL export, and import it there with `wrangler d1 execute <restore-test-name> --remote --file <export.sql>`. D1 Time Travel remains the short-window production recovery mechanism. Never rehearse by overwriting the production database.

## Remaining account lifecycle scope

Full-account export and deletion intentionally wait for the Lexicon and Learning packages to expose ownership-aware export/delete services. Implementing only the core tables would falsely claim that all user data was handled. Better Auth's raw user deletion endpoint is therefore not enabled yet. The integration must compose every package in one authenticated operation before these features ship.

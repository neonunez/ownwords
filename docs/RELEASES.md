# Releasing to production

Every merge to `main` that passes the repository's own checks is deployed. There is no release button and no
per-release terminal ceremony: `.github/workflows/release.yml` runs the four stages below, in order, and stops with a
printed reason if it cannot prove what it is about to do. The owner's part is a one-time configuration of the
repository, recorded under "One-time configuration" below.

This is a deliberately small release path for a small application with one user. What it does _not_ give up: the
repository's own tests, a scoped credential, an exact proof of the deployment target, and a refusal to touch data it
cannot prove it is changing safely. What it gives up: the human step between a reviewed merge and a live app, and a
terminal ritual for each release.

## The four stages

| Stage     | Command                                               | What it does                                                                                                                                                                                              | What can stop it                                                                                                                                                                                                                                                                                                                                                            |
| --------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config`  | `npm run release --workspace @ownwords/api -- config` | Generates `apps/api/wrangler.production.jsonc` (gitignored) from the tracked `wrangler.production.jsonc.example` plus the release values, then re-reads it through the publisher's own production guards. | A missing release value, a widened hostname, `workers.dev` in the template, a placeholder or all-zero D1 ID, a template that no longer binds `ownwords-production`, anything secret in the config.                                                                                                                                                                          |
| `migrate` | `… -- migrate`                                        | Composes the migrations (`db:compose`), prints Wrangler's own list of what it would apply to the named database, applies the safe ones and verifies each landed in `d1_migrations`.                       | A destructive or unrecognised statement with no matching entry in `apps/api/release/database-authorizations.json`; an applied migration the repository no longer has; a migration that did not land. Nothing is applied when anything is blocked.                                                                                                                           |
| `deploy`  | `… -- deploy`                                         | `wrangler deploy --dry-run`, then the deploy of the Worker with `apps/web/dist` as its assets, then reads the live version's D1 binding back from Cloudflare, then probes the public origin.              | No app build, a `workers_dev` line in Wrangler's output, a Cloudflare refusal (a Custom Domain route the token may not reconcile, most likely), a live version that is not the one this run deployed, a deployed binding that is not the intended database, or a probe that does not answer as the deployment promises. The migrations are already applied when this fails. |
| `publish` | `… -- publish`                                        | Publishes each course version authorized in `apps/api/release/content-releases.json`, through the deployed API's guarded operator route, preflighting first.                                              | A missing `CONTENT_PUBLISH_TOKEN`, a pack that is not the named course/version/hash, an action that is neither publish, resume-draft nor already-published, or a non-2xx answer.                                                                                                                                                                                            |

The stages are ordered so that a failure has the smallest possible blast radius: the database is migrated before the
code that reads it is deployed, and content is published only through a deployment this same run has just proved. The
one consequence of that order is that a `deploy` or `publish` failure can leave this release's migrations applied —
see "One-time configuration" for what that means and why re-running the release is safe.

## One-time configuration

Set once in the repository settings; no value is ever committed, printed in a log, or pasted into a pull request. The
Cloudflare token and the content publication token are encrypted secrets; the account ID and the D1 ID are not
credentials, so they are ordinary repository variables.

```sh
# In a terminal of your own. `gh secret set` prompts with the value hidden and
# it never appears in shell history, in the log, or in the repository.
gh secret set CLOUDFLARE_API_TOKEN
gh secret set CONTENT_PUBLISH_TOKEN

# Not credentials: a Cloudflare account ID names the account, a D1 ID names the
# database. Both are proved against the live deployment before a release uses them.
gh variable set CLOUDFLARE_ACCOUNT_ID      # the account that owns ownwords-production
gh variable set OWNWORDS_D1_DATABASE_ID    # the D1 ID `wrangler d1 info ownwords-production` prints
```

What the token needs, and what it does not:

| Permission                                                              | Scope                                                                   | Why                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Workers Scripts: Edit` (also spelled `Worker:Edit`, the `Editor` role) | the `ownwords-api` Worker                                               | Uploads and deploys a new version. Cloudflare's docs: deploying a Worker needs `Editor` access to it, and "you do not need separate permissions on the bound resources to deploy the Worker" ([Workers roles and permissions](https://developers.cloudflare.com/workers/authorization/workers/)).                                            |
| `D1: Edit` (called `D1: Write` in older docs)                           | the `ownwords-production` database                                      | The release talks to the D1 API directly — `migrations list`, the `d1_migrations` read, `migrations apply` — and "D1:Edit permission is required for any database writes via HTTP API" ([D1 release notes](https://developers.cloudflare.com/d1/platform/release-notes/)). `Edit` includes the reads the release and the binding proof make. |
| `Workers Routes: Write` (dashboard name `Workers Routes: Edit`)         | the `neonunez.com` zone, **only if** a deploy changes the Custom Domain | Cloudflare's docs: "To add, update, or remove Routes or Custom Domains, you need `Editor` access to the Worker and `Workers Routes Write` permission for every affected zone… API tokens need Zone > Workers Routes > Write, scoped to each affected zone." See the note below.                                                              |

Nothing else is needed, and nothing else should be granted: no `Account Settings`, no `Workers KV Storage: Edit`, no
`R2: Edit`, no DNS or billing permission. (Cloudflare's own auto-generated token for a CI deploy
— [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/) — is broader
than this: it also carries account-settings read, KV edit, R2 edit and `Workers Routes` edit for _all_ zones. This
release deliberately asks for less.)

**The Custom Domain question, answered from the documentation.** The generated config carries the live Custom Domain
(`{"pattern": "ownwords.neonunez.com", "custom_domain": true}`) so that a deploy can never silently detach the
hostname. The same page continues: "**After a Route or Custom Domain is configured, you can deploy new Worker versions
with only `Editor` access, as long as the deployment does not add, update, or remove that connection.**"

- _Known:_ a deploy that leaves the Custom Domain connection exactly as it is needs only `Workers Scripts: Edit`.
  Adding, changing or removing it needs zone-scoped `Workers Routes: Write` on `neonunez.com`.
- _Not provable from the documentation:_ whether Wrangler's route reconciliation issues a zone write for a Custom
  Domain that is declared identically to the live one. It compares the declared routes with the live ones and skips
  unchanged ones in the paths we can read, but that is a code reading, not a guarantee, and it has never been run
  against this account.

So the least-privilege token is `Workers Scripts: Edit` + `D1: Edit`, scoped as above. If the first deploy is refused on
the route, add zone-scoped `Workers Routes: Write` for `neonunez.com` to the same token — that is the documented
remedy for exactly that refusal. Do not remove the route from the generated config to make the error go away: that is
the accidental detachment this path exists to prevent.

**If the deploy stage fails, the migration stage has already run.** `migrate` precedes `deploy`, so a deploy-stage
failure — a refused route, a Cloudflare error, a read-back that does not match — can leave the release's migrations
applied. The schema is the additive one the release intended and the previous version of the Worker is still live, so
nothing user-visible has changed and no data was rewritten. Re-running the release is safe and normal: `d1_migrations`
is the record, so an already-applied migration is never applied twice, and the rest of the run proceeds from the same
committed head. Roll back the Worker with `wrangler rollback` only if the failure was _after_ a successful upload; see
"Rollback" below.

If a value is missing, the workflow fails before it installs, migrates, deploys or publishes, and names the value
that is absent. It never guesses, and it never deploys a partially configured release.

## Course content releases

A new or corrected course version is released by editing `apps/api/release/content-releases.json` in a pull request:

```json
{
  "course": "russian-foundations",
  "version": 2,
  "hash": "<the pack's own 64-character sha256, which `npm run content:validate --workspace @ownwords/learning -- content/russian-foundations-v2.json` prints>",
  "pack": "packages/learning/content/russian-foundations-v2.json"
}
```

That is the whole authorization: an exact course, version and content hash, plus the one pack it names, reviewed in
a pull request like any other change. There is no wildcard, no "publish every pack" sweep and no separate operator
command to remember. A release publishes an entry whose version is not yet published, reports an entry that is already
published as done and writes nothing, and refuses anything the pack does not match.

A published course version is immutable: it cannot be edited, replaced or deleted, and a Worker rollback does not
reverse it. A mistake is corrected by publishing the next sequential version, which learners who already started the
earlier version stay on.

## Database migrations

An ordinary backward-compatible addition applies itself on merge, with no human step: `CREATE TABLE`, `CREATE INDEX`,
`CREATE VIEW`, and `ALTER TABLE … ADD COLUMN` that is nullable or has a default. A `CREATE TRIGGER` is an addition
**only** when its whole body is validation-only — one or more `SELECT RAISE(ABORT|FAIL|ROLLBACK|IGNORE, '…')` guards
and nothing else. A trigger that deletes, updates or inserts is refused however it is written, because it rewrites data
on every later write and a Worker rollback does not undo that. The gate reads the composed SQL statement by statement,
so a guard trigger's body is part of its `CREATE TRIGGER` rather than a data change, and a comment, a string literal or
an identifier cannot smuggle one past it.

Anything that could destroy or reinterpret data the deployed code already serves stops the release and names the file
and the statement — `DROP`, `DELETE`, `UPDATE`, `INSERT`, `REPLACE`, a trigger whose body does more than
`SELECT RAISE(...)`, a rename, a dropped column, a `NOT NULL` column with no default, a new foreign key, `VACUUM`, or
any statement it does not recognise. To authorize one, add it to
`apps/api/release/database-authorizations.json` in the same reviewed pull request, naming the exact file, its exact
`sha256`, who authorized it and why:

```json
{
  "migrations": [
    {
      "file": "0300_learning_retention.sql",
      "sha256": "<the full sha256 of the file as it is now, which the refused release prints>",
      "authorizedBy": "captain",
      "note": "why this data change is safe, and what it does to existing rows"
    }
  ]
}
```

Editing an authorized migration withdraws its authorization, because the hash no longer matches. Prefer splitting such
a change into an additive migration that ships with the code and a separate, explicitly authorized one.

## Rollback

A Worker rollback redeploys the previous version; `wrangler deployments list` names the versions and
`wrangler rollback` returns to the one before. It does **not** reverse D1 writes, it does not reverse a published
course version, and it does not reverse a migration the release applied — an applied migration is a schema change, and
a Worker rolled back to a version that predates it may not even run. This is why the migration gate exists, and why
a deploy-stage failure is normally fixed by fixing the cause and re-running the release rather than by rolling back:
the migrations that release applied are the intended ones.

For a bad release, in the order the damage occurs:

0. Nothing to undo, but the run failed: a release stopped in `config` or `migrate` before deploying changed nothing a
   user can see; a release that failed in `deploy` or `publish` may have applied its migrations, which is the intended
   additive schema. Re-run the release from the same commit.
1. A bad deploy: `npx wrangler rollback --config apps/api/wrangler.production.jsonc`, then check the public origin.
2. A bad additive migration: there is no automated reversal. D1 Time Travel and a weekly `wrangler d1 export` are the
   recovery mechanism (`docs/SETUP.md`, "Backup and restore"); rehearse a restore into a separate database, never over
   production.
3. A bad destructive migration applied under an authorization: restore from Time Travel or an export, or add the
   compensating migration by hand. Restoring loses every write since the export.
4. A bad published course version: publish the next sequential version. The bad version stays exactly as it is.

## Verifying a release

The workflow's own log is the audit trail: it prints the target it proved, the plan it read, the version it deployed,
the binding it confirmed and the four probes it read back. To check by hand afterwards:

```sh
npx wrangler deployments list --config apps/api/wrangler.production.jsonc
npx wrangler d1 migrations list ownwords-production --remote --config apps/api/wrangler.production.jsonc
curl -fsS -D - -o /dev/null https://ownwords.neonunez.com/health
curl -fsS -D - -o /dev/null https://ownwords.neonunez.com/api/nope
```

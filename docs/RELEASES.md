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

| Stage     | Command                                               | What it does                                                                                                                                                                                                                                                                                            | What can stop it                                                                                                                                                                                                                                                                                                                                                            |
| --------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config`  | `npm run release --workspace @ownwords/api -- config` | Generates `apps/api/wrangler.production.jsonc` (gitignored) from the tracked `wrangler.production.jsonc.example` plus the release values, then re-reads it through the publisher's own production guards.                                                                                               | A missing release value, a widened hostname, `workers.dev` in the template, a placeholder or all-zero D1 ID, a template that no longer binds `ownwords-production`, anything secret in the config.                                                                                                                                                                          |
| `migrate` | `… -- migrate`                                        | Proves the configured D1 ID is the one Cloudflare names `ownwords-production` and the live Worker is bound to, then composes the migrations (`db:compose`), prints Wrangler's own list of what it would apply to the named database, applies the safe ones and verifies each landed in `d1_migrations`. | A D1 ID that is not `ownwords-production` or not the live Worker's binding; a destructive or unrecognised statement with no matching entry in `apps/api/release/database-authorizations.json`; an applied migration the repository no longer has; a migration that did not land. Nothing is applied when anything is blocked.                                               |
| `deploy`  | `… -- deploy`                                         | The same live-target proof, `wrangler deploy --dry-run`, then the deploy of the Worker with `apps/web/dist` as its assets, then reads the live version's D1 binding back from Cloudflare, then probes the public origin.                                                                                | No app build, a `workers_dev` line in Wrangler's output, a Cloudflare refusal (a Custom Domain route the token may not reconcile, most likely), a live version that is not the one this run deployed, a deployed binding that is not the intended database, or a probe that does not answer as the deployment promises. The migrations are already applied when this fails. |
| `publish` | `… -- publish`                                        | Publishes each course version authorized in `apps/api/release/content-releases.json`, through the deployed API's guarded operator route, preflighting first.                                                                                                                                            | A missing `CONTENT_PUBLISH_TOKEN`, a pack that is not the named course/version/hash, an action that is neither publish, resume-draft nor already-published, or a non-2xx answer.                                                                                                                                                                                            |

The stages are ordered so that a failure has the smallest possible blast radius: the database is migrated before the
code that reads it is deployed, and content is published only through a deployment this same run has just proved. The
one consequence of that order is that a failed run can leave migrations applied, a new version uploaded, or both — see
"A failed run leaves an unknown state" under "One-time configuration" for how to read that state and when re-running
is and is not safe.

## One-time configuration

Set once in the repository settings; no value is ever committed, printed in a log, or pasted into a pull request. The
Cloudflare token and the content publication token are encrypted secrets; the account ID and the D1 ID are not
credentials, so they are ordinary repository variables — but the D1 ID pins _what the release acts on_, it does not
limit _what the token can reach_; see the table below.

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

What the token needs, and — as importantly — what it cannot be narrowed to:

| Permission                                                                                                                                                                                                      | Resource scope that actually exists                                                                                                                                                                                                                                                                              | Why                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `D1: Edit` (called `D1: Write` in older docs)                                                                                                                                                                   | **The account, not one database.** `D1 Edit` is an _account_ permission ([API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)); there is no per-database token resource. Set Account Resources to _Include → this account_, never _All accounts_.                  | The release talks to the D1 API directly — `migrations list`, the `d1_migrations` read, `migrations apply` — and "D1:Edit permission is required for any database writes via HTTP API" ([D1 release notes](https://developers.cloudflare.com/d1/platform/release-notes/)). `Edit` includes the reads the release and the binding proof make. |
| `Editor` on Workers ([granular roles](https://developers.cloudflare.com/workers/authorization/workers/), [changelog](https://developers.cloudflare.com/changelog/post/2026-09-15-granular-worker-permissions/)) | Documented as **one Worker** — "Only selected Workers", and `Editor` "can read, update, deploy, and rename existing Workers… Cannot create or delete Workers" — **but this account's token UI offered no individual-Worker scope**, so the token that was created carries the whole account's Workers authority. | Uploads and deploys a new version of `ownwords-api`. Per-Worker roles apply only to Workers that already exist, so the narrower option is worth using wherever Cloudflare offers it.                                                                                                                                                         |
| `Workers Scripts: Edit` (the legacy equivalent)                                                                                                                                                                 | **The whole account's Workers.** "These legacy permissions and roles were account-level."                                                                                                                                                                                                                        | The form this account's token actually has. Same capability as the row above, wider than one Worker.                                                                                                                                                                                                                                         |
| `Workers Routes: Write` (dashboard name `Workers Routes: Edit`)                                                                                                                                                 | The `neonunez.com` zone, **only if** a deploy changes the Custom Domain                                                                                                                                                                                                                                          | Cloudflare's docs: "To add, update, or remove Routes or Custom Domains, you need `Editor` access to the Worker and `Workers Routes Write` permission for every affected zone… API tokens need Zone > Workers Routes > Write, scoped to each affected zone." See the note below.                                                              |

**The honest limit, stated plainly: this token can reach further than this release ever acts.** Two Cloudflare
properties, not choices this repository makes:

- `D1: Edit` is an **account** permission, so the token can read and write _every_ D1 database in that account, not
  only `ownwords-production`. Cloudflare's permission model offers no per-database token resource.
- The account's token UI offered **no individual-Worker scope**, so the Workers permission covers _every Worker in the
  account_, not only `ownwords-api`. The token can therefore deploy a new version of another Worker in the same account
  if it were ever pointed at one.

What the release actually does is much narrower, and the difference matters when reading this file:

- The token is limited to **one account** (never _All accounts_), which is the only real boundary Cloudflare offered
  here.
- The release **code** can only name one Worker and one hostname. The config is generated from the tracked template,
  every Wrangler call carries `--config` for that generated file, and the target is re-proved against Cloudflare's own
  record before each write: the configured D1 UUID must be the one Cloudflare names `ownwords-production` in this
  account, and it must be the database the live `ownwords-api` version is already bound to
  (`release.test.mjs` pins the Worker name, the single binding and the single hostname).
- Every one of those guards is a **correctness control, not a credential boundary**. They stop a mistake, a stale
  variable, a widened hostname or a config that drifted; none of them can narrow what the token itself is permitted to
  reach. The credential boundary is the account selection above, and the account-wide Workers and D1 authority that
  follows from it is escalated to the owner as a known consequence of granting a release workflow any cloud write at
  all.

Nothing else is needed: no `Account Settings`, no `Workers KV Storage: Edit`, no `R2: Edit`, no DNS or billing
permission. (Cloudflare's own auto-generated token for a CI deploy
— [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/) — is broader
still: it also carries account-settings read, KV edit and R2 edit. This release asks for none of those, and is wider
than the documented minimum in exactly one place: the Workers permission, which this account's token UI did not offer
to narrow below the account.)

**The Custom Domain question, answered from the documentation.** The generated config carries the live Custom Domain
(`{"pattern": "ownwords.neonunez.com", "custom_domain": true}`) so that a deploy can never silently detach the
hostname. The same page continues: "**After a Route or Custom Domain is configured, you can deploy new Worker versions
with only `Editor` access, as long as the deployment does not add, update, or remove that connection.**"

- _Known:_ a deploy that leaves the Custom Domain connection exactly as it is needs only the Workers `Editor` role
  (account-wide with the legacy `Workers Scripts: Edit`, or per-Worker with the granular scope). Adding, changing or
  removing it needs zone-scoped `Workers Routes: Write` on `neonunez.com`.
- _Not provable from the documentation:_ whether Wrangler's route reconciliation issues a zone write for a Custom
  Domain that is declared identically to the live one. It compares the declared routes with the live ones and skips
  unchanged ones in the paths we can read, but that is a code reading, not a guarantee, and it has never been run
  against this account.

So the token is Workers `Editor` at whatever scope the account offers — account-wide here — plus account-scoped
`D1: Edit`, on the one account that holds `ownwords-production`. If the first deploy is refused on the route, add
zone-scoped `Workers Routes: Write` for `neonunez.com` to the same token — that is the documented remedy for exactly
that refusal. Do not remove the route from the generated config to make the error go away: that is the accidental
detachment this path exists to prevent.

**A failed run leaves an unknown state — inspect it, do not assume it.** `migrate` precedes `deploy`, and the deploy
stage's last three steps happen _after_ the upload, so a failed run may have applied migrations, uploaded a new
version, or both. Do not assume the previous version is still live, and do not assume nothing user-visible changed:
even an additive migration can change behaviour, because a new trigger starts refusing writes a previous version
allowed, and a new column or table can change what a write is allowed to be.

Before deciding anything, read the state (all read-only):

```sh
npx wrangler deployments list --config apps/api/wrangler.production.jsonc   # is the new version live?
npx wrangler d1 migrations list ownwords-production --remote --config apps/api/wrangler.production.jsonc
curl -fsS -D - -o /dev/null https://ownwords.neonunez.com/health            # what the origin answers?
```

Then choose deliberately:

- _The deploy was refused before any upload_ (a route or token refusal, a dry-run that printed `workers.dev`): only the
  migrations have been applied, and they are the intended additive schema. Fix the cause and re-run the release;
  `d1_migrations` is the record, so an already-applied migration is never applied twice.
- _The upload succeeded and the read-back or a probe failed_: the new version may already be serving. Read the
  deployment list and the probes, then either leave the new version live if it is serving correctly, or `wrangler
rollback` it deliberately. Do not blind-retry: the second deploy would be a no-op upload at best, and re-running
  `publish` is safe only because an already-published version is reported as done and never written twice.
- _A migration itself failed midway_: the schema may be partially applied, which is the one state this design cannot
  reason about. Stop, do not re-run the release, and recover with D1 Time Travel or an export (see "Rollback").

All four values are required, and the workflow checks all four before it installs, migrates, deploys or publishes, so
a release can never mutate the database with the publication authority missing. It names the value that is absent,
never its value, and it never deploys a partially configured release.

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
**only** when its whole body is validation-only — one or more `SELECT RAISE(ABORT|FAIL|ROLLBACK, '…')` guards and
nothing else. A trigger that deletes, updates or inserts is refused however it is written, because it rewrites data on
every later write and a Worker rollback does not undo that. So is `RAISE(IGNORE)`: it does not refuse a write, it
silently drops it while the statement still reports success. The gate reads the composed SQL statement by statement,
so a guard trigger's body is part of its `CREATE TRIGGER` rather than a data change, and a comment, a string literal or
an identifier cannot smuggle one past it.

Anything that could destroy or reinterpret data the deployed code already serves stops the release and names the file
and the statement — `DROP`, `DELETE`, `UPDATE`, `INSERT`, `REPLACE`, a trigger whose body does more than
`SELECT RAISE(ABORT|FAIL|ROLLBACK, '…')`, a rename, a dropped column, a `NOT NULL` column with no default, a new foreign
key, `VACUUM`, or any statement it does not recognise. To authorize one, add it to
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
a Worker rolled back to a version that predates it may not even run. This is why the migration gate exists. Whether a
failed run is fixed by re-running, by rolling back or by restoring depends on how far it got, which is read from the
live state, never assumed.

For a bad release, in the order the damage occurs:

0. The run failed: read the state first, with the read-only checks in "A failed run leaves an unknown state"
   (`wrangler deployments list`, `wrangler d1 migrations list`, the origin probes), and do not assume nothing changed —
   a failed `migrate` can have applied migrations before it stopped. Then take the matching case there: refused before
   any upload (fix the cause, re-run); failed after the upload (leave the new version live or roll it back, do not
   blind-retry); a migration that failed midway (do not re-run, restore as in item 2).
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

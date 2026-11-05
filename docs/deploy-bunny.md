# Deploying on Bunny

Bunny Edge Scripting runs a script per request on cache miss; the script talks
to Bunny Database (libSQL) over its HTTP interface. This document covers the
bundles, the configuration the script reads, the caching switches, the
write-surface gate and the status endpoints.

A writable deck is three things: an Edge Scripting script, a Bunny Database
database (the deck) and a Bunny Storage zone (its files: uploads, image
renditions and the stylesheet a saved style card compiles). The one-command
provisioning below creates all three, arms the write surface and the
first-run window, and prints the deck's one-time setup link. A read-only
deck needs only the script and the database.

**Costs and energy.** This repository contains no cost measurements and no
energy measurements for any deployment topology. A trial-scale cost
walkthrough was prepared alongside this engine (scripting line only, rates as
published on Bunny's pricing page on 2026-10-01), but it is not included in
this repository; what a real deployment invoices depends on its request
volume, CPU time per request and database usage, and no per-request time
figure in that walkthrough is a measurement.

---

## The two bundles

`tools/bundle-bunny-edge-engine.mjs` builds both scripts in one pass. Each
entry produces a bundle and a request payload wrapping that bundle's text.

| Entry point | Bundle | What it is |
| --- | --- | --- |
| `deploy/bunny-worker-src/bunny-edge-engine-entry.ts` | `deploy/dist/bunny-edge-engine.bundle.js` | The full engine: render and fetch engines over the libSQL driver, the layout shell, and the write surface when it is armed. |
| `deploy/bunny-worker-src/bunny-edge-read-entry.ts` | `deploy/dist/bunny-edge-read.bundle.js` | The read-only engine: anonymous `GET` and `HEAD` only. |

The bundler targets a neutral platform and emits ESM at an ES2022 target with
minification. External dependencies are the platform's own scripting SDK and
the Node built-ins. After the build it fails if the SDK's bare import has
disappeared, refuses any surviving bare package import, and prints the set of
`node:` built-ins the bundle still retains — that list is the boot-risk
inventory, since a retained Node built-in is a module the edge runtime cannot
load.

**Why two bundles.** The platform runs a script only when the cache misses,
so a fresh isolate pays the whole bundle load. The read-only bundle carries
none of the write-path code, which anonymous reads cannot reach, so a read-only
traffic pattern loads roughly a third less code on every cold isolate. The two
bundles share the same engine and the same driver; they differ in the surface
they mount.

### Read-only routing

The read-only script serves anonymous `GET` and `HEAD` and forwards
everything else to the full script. Specifically it forwards:

- every method other than `GET` and `HEAD`;
- any request carrying a session cookie;
- the sign-in, sign-out and first-run setup routes, at any method.

It also rewrites a redirect that names the full script's host back to the host
the request arrived on, so the two scripts are indistinguishable to a browser
sitting in front of them.

---

## Configuration

Configuration is by environment variable name on the script. Values are set
on the script; nothing here is a secret in the repository.

### Database credentials

`deploy/bunny-worker-src/bunny-edge-deck-config.ts` defines the credential
variable names and the order they are tried in. The first pair where both
members are present and non-empty wins; a pair where only one member is set
is an error rather than a silent fallback. A `libsql://` scheme is rewritten
to `https://`.

| First | Second |
| --- | --- |
| `DECKO_DB_URL` | `DECKO_DB_TOKEN` |
| `BUNNY_DATABASE_URL` | `BUNNY_DATABASE_AUTH_TOKEN` |
| `BUNNY_DB_URL` | `BUNNY_DB_TOKEN` |

Where the script runs on a binding rather than plain variables, the status
endpoint reports a binding instead of variable names.

### Gates and switches

| Variable | Effect |
| --- | --- |
| `DECKO_WRITE_PATH` | Arms the write surface. See below. |
| `DECKO_FIRST_RUN` | Arms the first-run setup surface. |
| `DECKO_SETUP_TOKEN` | Optional. An operator-chosen setup token, accepted beside the one the provisioning issues. With neither, `/setup` is refused with a message naming both. |
| `DECKO_EDGE_CACHE` | Arms the response cache headers. |
| `DECKO_EDGE_CACHE_TTL` | Shared-cache lifetime in seconds. Overrides the default when a positive integer. |
| `DECKO_EDGE_CACHE_EPOCH` | The cache epoch value. Changing it invalidates both script-side and global cache tiers. |
| `DECKO_EDGE_GLOBAL_CACHE` | Arms the third cache tier, which stores rendered HTML in the database. |
| `DECKO_EDGE_FULL_URL` | Where the read-only script forwards the requests it does not serve. |
| `DECKO_EDGE_ISOLATE_PROBE` | Arms the measurement probe routes. |
| `DECKO_EDGE_NAME_SCAN` | Primes the lexicon across the whole deck at boot rather than on demand. |
| `DECKO_EDGE_RENDER_BUDGET_MS` | Per-render budget in milliseconds. |
| `DECKO_EDGE_PIPELINE_TIMEOUT_MS` | Per-pipeline database request timeout. |
| `DECKO_LIVE_RENDER` | Arms the live render path. |
| `DECKO_TRUSTED_ORIGINS` | The origins a write or sign-in request may come from. On a two-script deployment this is the read front's own address, on both scripts. |
| `DECKO_ONE_TRIP` | Arms the one-trip payload. See below. |
| `DECKO_ONE_TRIP_STORE` | Path to the derived store, or the inline sentinel. |
| `SPACES_ASSET_HOST` | Host for compiled assets. |
| `DECKO_STORAGE_ZONE` | The Bunny Storage zone that holds the deck's files. |
| `DECKO_STORAGE_PASSWORD` | That zone's password, set as a script secret. Zone and password are a pair: exactly one set is a configuration error. |
| `DECKO_STORAGE_HOST` | The zone's region endpoint host. Default `storage.bunnycdn.com`. |

The origin server has its own set, including the files directory, the token
secret, and a mail capture switch. See
[operations.md](operations.md) for what each of those does.

---

## The write surface gate

`DECKO_WRITE_PATH` set to exactly `1` arms writes; any other value, including
unset, leaves the deployment read-only. The check is a single environment read
and a boolean, so an unarmed script does not boot the deck and issues no
query.

Request dispatch is, in order:

1. the status endpoint, answered ahead of everything else;
2. sign-out, mounted above the write surface and ungated — the route matcher
   would otherwise claim a bare `POST /_signout` as a card creation;
3. the write surface, when the gate is armed or the request is not a read
   verb;
4. for any other non-read request on a read-only deployment, a `403` naming
   the deployment as read-only;
5. the session-aware, cache-wrapped engine path.

`DECKO_FIRST_RUN` arms the setup surface separately. It opens only for a
request carrying the one-time setup token the provisioning issued
(`src/card/auth/setup-token.ts`; the token's SHA-256 lives in
`deck_setup_tokens`, migration `0012`) or the optional `DECKO_SETUP_TOKEN`,
so a public deck cannot be claimed by whoever reaches `/setup` first; with
no valid token it creates nothing and answers `403`. Both together form the
fresh-deck profile: the setup surface without the write path renders a form
whose submission cannot succeed, and the write path without the setup surface
enables writes on a deck with no way to create its first account. See
[operations.md](operations.md) for what that profile does and does not cover.

---

## Files and the periodic sweep

`deploy/bunny-worker-src/bunny-edge-files.ts` puts the deck's files in the
Storage zone named by `DECKO_STORAGE_ZONE`, under the same attachment store
the Cloudflare host uses over R2, and serves `GET`/`HEAD /files/...` back from
it behind each card's read rule. With no zone configured, uploads fail with
the engine's named rejection.

Bunny Edge Scripting has no cron trigger and no queue, so the sweep the
Cloudflare deploy runs daily (expired sign-in sessions, upload drafts older
than a day; `src/server/edge-delayed-work.ts`) runs here on the first
write-surface request (any non-`GET`/`HEAD`) an isolate serves, and then at
most once a day per isolate. Reads never run it. The sweep is idempotent, so
two isolates sweeping on the same day do redundant work, not wrong work, and
a failed sweep is logged without failing the request that carried it. Bunny
Storage lists one directory level, and drafts sit one level below `tmp/`, so
the sweep's listing walks those directories through the Storage API.
`tests/server/bunny-edge-files.test.ts` covers this against the local mock of
the Storage API.

---

## Caching

Three tiers sit behind one flag.

**Response headers.** `DECKO_EDGE_CACHE` arms them. Responses are classified as
cacheable HTML, cacheable JSON, or uncacheable, and cacheable responses carry
`public, max-age=0, s-maxage=<ttl>`. The status endpoints and any non-200
response are uncacheable; card API responses are cacheable JSON.

**Script-side content cache.** Rendered content cached through the platform's
own cache API, keyed by the cache epoch from `DECKO_EDGE_CACHE_EPOCH`.

**Global render cache.** `DECKO_EDGE_GLOBAL_CACHE` arms a store of rendered
HTML in the database itself, using the same epoch value. Lookups are bounded
in time; writes are write-through, and clearing the previous epoch happens in
the same request. Any error degrades to a plain render rather than failing the
request.

Signed-in requests bypass every tier in both directions, so one viewer's
rendered HTML can never be served to another.

**Invalidating.** There is no invalidation endpoint. The primary mechanism is a
full-zone purge through the CDN provider's purge API; the shared-cache lifetime
is the backstop for content the purge does not cover. The cache epoch exists
for the script-side tiers, so bumping `DECKO_EDGE_CACHE_EPOCH` invalidates both
without a provider call. See [operations.md](operations.md) for the procedure.

---

## Status endpoints

| Route | Response |
| --- | --- |
| `GET /_status` | Engine, runtime, database health and card count, the credential **variable names** in use (never their values), and which of the credential pairs supplied them, or a binding name where the deployment uses one. `500` when credentials are missing, `503` when the database is unreachable. |
| `GET /api/status` | Lighter status: engine, runtime and a notes list. |
| `/_probe/cpu`, `/_probe/db` | Measurement probes. Answer only when `DECKO_EDGE_ISOLATE_PROBE` is armed. |

Every response carries a `Server-Timing` header; see
[operations.md](operations.md) for what its fields measure.

---

## The one-trip payload

`DECKO_ONE_TRIP` set to exactly `1` arms the payload, which computes the rows
a page needs and seats them so the render makes one round trip instead of one
per nest level. Any other value, including unset, is the default, and the
default path is unchanged.

`DECKO_ONE_TRIP_STORE` names the derived store. It is required when the gate
is armed; without it the payload is inert and logs one warning. It may also
be set to an inline sentinel, which means the derived tables have been
materialized into the serving database itself rather than attached from a
side file — the edge posture, since an edge isolate has no filesystem path to
attach.

**The boot requirement.** When the gate is armed, the deck boot must raise the
temporary-cache key threshold from its default to 200,000. Seating a page
writes roughly three and a half thousand keys; at the default cap a multi-page
session crosses the threshold mid-session and the wholesale reset evicts
primed state. The threshold is raised only when the gate is armed, so an
unarmed boot is unchanged.

**How it fails.** Every failure mode falls back to the unchanged path. A
missing store file, a store that cannot be attached, or a page whose closure
cannot be described produces no seating rather than an error. Seating is
memoized per fetcher per page key before the attempt, so a page that fails to
seat stays failed for that engine until the freshness stamp moves. The
payload is an optimization and never a correctness dependency.

**Freshness.** `deck_data_version` is read in the same round trip as the
payload and compared against the last seen value; a mismatch recomputes before
seating. On a read-only deployment the derived store stays valid
indefinitely. On a deck that accepts writes, content changes make the store
stale for the affected pages, which costs a re-fetch and not wrong bytes. The
write-time invalidation protocol that would clear staleness eagerly is designed
and separately tested but is not wired into the write path.

---

## Deploying

**With one command.** `deploy/provisioning/` automates the steps below:
open `one-key-provisioning-page.html`, make your choices, download the
payload, and run `provision-bunny-deck.mjs` with one Bunny API key. It
creates the database, builds the schema, seeds your deck, and creates and
publishes TWO scripts, as a live deployment is wired: a read-only front
(`<script_name>-read`, the 1.6 MB read bundle) that answers anonymous page
reads, and the full engine (the 7.5 MB bundle) it forwards sign-in, writes,
`/setup` and every request carrying a session cookie to. The front holds a
read-only database token; the full engine holds the payload's. Each script has
its own pull zone. It checks `/_status` on both. A cold Bunny isolate loads
only the bundle its request needs, which is why the front exists: a single
7.5 MB script answered empty HTTP 400s on heavier pages under cold starts.
`--teardown` removes both scripts, both zones, the database and the group.

**Served identity (the site's look and asset config).** Pass it with
`--served <file.json>`: one object of `"DECKO_NAME": "value"` pairs, the loose
variables listed in section 3b of `deploy/bunny-edge-deployment-runbook.md`.
Bunny stores at most **2 KB per script variable value** and 128 variables per
script (bunny.net/docs/scripting/limits, read 2026-10-14). The runner refuses
any value over 2 KB in the plan, before any account write, and names the
variable and its size. This is why the one-variable `DECKO_SERVED_DELTAS` blob
is not the form to use on Bunny: a real deck's identity is 3.6 KB as one blob,
and such a script answered HTTP 400 on every request on 2026-10-14, while the
same values as loose variables (the largest 1.6 KB) served correctly. For a writable deck
(`write_path` in the payload and `--allow-write-path` on the command line) it
also creates the Storage zone and sets its variables, arms
`DECKO_WRITE_PATH` and `DECKO_FIRST_RUN`, and, once the deck answers, issues
the setup token and prints the link as the last thing in its output:

    First-run setup link (one use; it creates your deck's owner account):
      https://<the deck's hostname>/setup?token=...

Open it to create the owner account. Run the script without a mode flag first
to see the plan; nothing is contacted. The plan and the token SQL are covered
offline by `tests/deploy/bunny-provision-writable.test.ts`; the live run
itself needs a Bunny account and has not been exercised by that test. See
`deploy/provisioning/README-one-key-provisioning.md`.

**By hand:**

1. Build both bundles and their request payloads with
   `tools/bundle-bunny-edge-engine.mjs`, checking the reported sizes against
   the script size limit and reading the retained `node:` built-in list.
2. Create the Bunny Database and set its URL and token on each script as the
   credential pair of your choice.
3. Apply the schema and the deck you intend to serve. Migrations live under
   `deploy/migrations/`.
4. Create the scripts and upload each payload to its script endpoint.
5. Set the gates you want: the write path and first-run variables only for a
   deployment that serves writes, the storage-zone variables for its files,
   the cache variables only for a deployment that wants them.
6. For a writable deck, issue the setup token: store the SHA-256 of a random
   token in `deck_setup_tokens` (the provisioning script's `setupTokenIssue`
   produces the SQL) and open `/setup?token=<token>`.
7. Check `GET /_status` on the deployed host and confirm the card count is the
   one you seeded.

An origin server, if you need one, lives in the project's deployment
tooling (the server script, an nginx configuration, a Caddy configuration and a
systemd unit), which is not included in this repository; what this repository
ships for the Bunny path is the edge worker under `deploy/bunny-worker-src/`.
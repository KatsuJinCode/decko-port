# Local migration commands in this package

This guide describes the source this package is built from. The commands
below are templates. They have not been run against this exported package, so
check each one against it before relying on it. The current canonical Ruby
reference is Decko 0.20.0 / card 1.110.0 on Ruby 3.2.3 on a Linux machine; no
other Ruby version or deployment is assumed.

These commands operate on copies and fresh output paths. Keep the original
source, uploaded files and any failed migration target intact. These are local
tools, not authorization to change a running site, credentials, hosted storage
or application configuration. Every report's failures and omissions matter.

## SQLite source to a fresh SQLite target

```sh
node tools/migrate/migrate-generalized.mjs --source <source.sqlite> --out <new-target.sqlite> --verify --strict
```

The importer inventories the source and maps rows into the target schema, then
checks per-table counts and checksums. Mapping, missing-table behavior and
special engine-owned tables are implemented in generalized-import.mjs and
schema-map.mjs. A source or target that is missing expected data does not become
compatible merely because a command exited successfully; read the emitted
migration and round-trip reports. Do not use --append for a first migration.

## SQL dump or seed to local import material

```sh
node tools/migrate/import-deck.mjs --dump <mysqldump.sql> --out-dir <new-chunk-directory> --strict
```

The same command accepts --source for SQLite or --seed for deck INSERT SQL,
one source form at a time. It writes local chunks and a validation report.
The optional --apply path invokes a separate provider tool; it is outside
the local commands described here. No current or hosted migration is
established here. PostgreSQL-related source is present in the toolkit but
requires its own source/database qualification rather than an inferred
support claim. Engine concurrency is a separate result: an earlier
development tree passed the runtime matrix 5 of 5 against a PostgreSQL 16.15
server from the `postgres:16-alpine` container image on a Linux machine, with
the original assertions run under `node:test` rather than Vitest (see
[VERIFICATION.md](../VERIFICATION.md)), while migration onto PostgreSQL is not
qualified: the `pg_dump` import is tested on synthetic input only.

## Snapshot and restore

Pause both database and upload writers before taking a snapshot. Keep them
paused until it finishes; SQLite's backup does not coordinate a separate
upload-file store.

```sh
node tools/migrate/recover-deck.mjs snapshot --database <copy.sqlite> --files <copy-files-directory> --out <new-snapshot-directory>
node tools/migrate/recover-deck.mjs restore --snapshot <snapshot-directory> --out <new-restored-directory>
```

The command records and verifies the database and upload hashes, refuses
existing restore destinations and does not change the application's configured
database. See ../migration-recovery.md for the exact recovery contract. Writes
made after the snapshot require reconciliation against the preserved failed
target. Restoring a pre-upgrade snapshot also restores its credential/session
state; Ruby cannot verify a later PBKDF2 password record. A shared
Ruby/TypeScript deck therefore needs its documented legacy-sha1 policy until
that transition is deliberately completed.

During development, disposable snapshot and restore checks on synthetic data
were observed to pass on an earlier version of the port, with the restored
database bytes matching exactly. That is a development observation: no
record of it ships with this package, it is not one of the results in
[VERIFICATION.md](../VERIFICATION.md), it is not a test of this package's source and it
does not qualify a migration. Even a passing local check of this kind would
not establish original-user passwords, private attachments, native MySQL or
PostgreSQL migration, a hosted backend, full mod execution or a production
cutover. Engine concurrency (5 of 5 against PostgreSQL 16.15 from the
`postgres:16-alpine` container image on a Linux machine, under `node:test`) is
a separate result; migration remains untested.
Measurements made on private decks are not part of this package and are not a
substitute for checks that can be reproduced from it.

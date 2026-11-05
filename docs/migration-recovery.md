# Migration recovery on isolated SQLite decks

Pause the application's database and upload writers before creating a recovery
package. Keep them paused until snapshot creation completes. SQLite's backup
API captures committed WAL data; it does not coordinate database writes with
separate upload-file writes. This tool does not claim an atomic live backup of
both stores and does not control a running application.

The local command is `tools/migrate/recover-deck.mjs`:

```text
snapshot --database <deck.sqlite> --files <upload-directory> --out <new-snapshot-directory>
restore --snapshot <snapshot-directory> --out <new-recovery-directory>
```

The snapshot contains `deck.sqlite`, an upload tree in `files`, and a
`manifest.json` recording database and individual upload SHA-256 hashes. Upload
paths are part of that manifest: the package is private whenever the source is
private. Do not commit it. Empty upload directories are retained. Links and
special files are refused. Database snapshots use SQLite's backup API, switch
the completed copy to DELETE journaling, and run SQLite's integrity check.

Restore validates the complete inventory and hashes before creating output.
It refuses journal sidecars, unsafe paths, corrupt/missing files and any
existing output directory, including an empty one. It copies the validated
database bytes, checks the restored hash and SQLite integrity, then copies and
checks the uploads. Errors exit nonzero. A partial package has no completed
manifest; a failed restore must not be selected as an application database.
The tool leaves partial output available for diagnosis and never removes it.

Recovery deliberately creates a fresh database and file tree. It never writes
over the failed migration, changes application configuration, publishes, or
starts a second production writer. Keep the application stopped while choosing
which database and file tree it will serve. Reconcile writes made after the
snapshot from the preserved failed target before returning to production;
they are not merged automatically. Reversing a PBKDF2 password upgrade also
reverses credentials to their snapshot state. Sessions created after the
snapshot are absent after rollback.

## Checks

The tests named in this section are in the development repository; they are
not included in the exported source package.

`tests/migrate/recovery.test.ts` (development repository; not included) covers committed WAL content, database and
upload restoration, empty directories, existing destinations, corrupt database
and upload data, unsafe paths, linked roots and journal sidecars, including the
command's nonzero failure exit.

`tests/migrate/migration-acceptance.test.ts` (development repository; not
included) migrates a synthetic Ruby-shaped
deck, signs in with its original test password, upgrades its SHA-1 hash, writes
through the action engine, restores a pre-upgrade snapshot, then signs in and
writes again. It checks member/guest permissions, the bundled Markdown mod,
history attribution, retained uploads, and a delayed job executed into a
capture function with no external delivery. It checks that the post-snapshot
target remains intact for reconciliation.

`tests/migrate/private-deck-recovery.test.ts` (development repository; not
included) is opt-in with
`DECKO_MIGRATION_SOURCE_SQLITE`. `DECKO_MIGRATION_REPORT` optionally writes an
aggregate-only result. The private fixture is not shipped. The test compares
selected stored fields of every card and all account-field counts, inventories
retained job payloads, and checks a copied account's sign-in, password upgrade,
restore and a database write. Its password is deliberately invented and set
only in the copy: it does not prove possession of an original user's password.
Its upload tree is empty. It does not qualify real attachments, custom mod
source, hosted runtimes, mail delivery, or a production cutover.

SQLite backup semantics: [SQLite Online Backup API](https://www.sqlite.org/backup.html).

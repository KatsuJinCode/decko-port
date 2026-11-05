# deploy/migrations

These SQL migrations are applied to a provisioned Cloudflare D1 database
by the development repository's external deploy runner using
`wrangler d1 migrations apply`. Its package scripts and `wrangler.toml`
configuration, including `migrations_dir`, are development-repository
dependencies and do not ship in this package. The package's import tools
that invoke Wrangler likewise require that external configuration.

## The numbering is load-bearing — do not renumber

Two things about the numbering look like mistakes and are not. Both are
declared, with the full reasoning, in `src/server/deploy-migrations.ts`, which
is the contract for this directory: the canonical order, the applied-set alias,
and a drift guard that fails if the files here stop matching that order.

**Two files numbered `0003`.** `0003-deck-data-version-stamp.sql` is the
freshness-stamp backfill for databases provisioned before the stamp existed (a
fresh database gets it from the regenerated `0001`). `0003-demo-seed.sql` is
the generated demo deck. They apply in lexical filename order, which is the
order the manifest declares.

**No `0007`.** The number is held back deliberately: some provisioned
databases recorded the stamp backfill under an earlier name,
`0007-deck-data-version-stamp.sql`, and a second `0007` in this directory
would make those ledgers ambiguous to read. The applied-set check is
alias-complete for that name — a ledger recording the old name counts as
having the stamp migration applied — so no database is re-run the backfill.

The runner records applied migrations in `d1_migrations` by **full filename**,
deduped by exact filename, and applies any file whose name is not recorded.
So every filename in this directory is a bookkeeping key on deployed
databases, and renaming a file — including to resolve the `0003` collision —
re-keys those ledgers and re-applies the file under its new name. The
collision is left in place for exactly that reason.

New migrations take the next number that is neither taken nor reserved
(currently `0014`), and their entry is added to `DEPLOY_MIGRATION_ORDER` in
`src/server/deploy-migrations.ts`.
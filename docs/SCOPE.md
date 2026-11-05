# Port Scope and Architecture Boundaries

The exact package and engine source commits are recorded as `sourceCommit` and `engineCommit` in `HANDOVER-MANIFEST.json`. This document defines the architectural scope of the TypeScript implementation, what features are included, and the boundaries of the port. Detailed test execution and verification results are documented in [VERIFICATION.md](../VERIFICATION.md).

The canonical reference runtime is Decko 0.20.0 / card 1.110.0 on Ruby 3.2.3 on Linux. This package is an independent TypeScript implementation licensed under GPL-3.0-or-later (see [NOTICE](../NOTICE) and [LICENSE](../LICENSE)).

---

## 1. Core Engine Implementation

The port includes complete TypeScript implementations of the Decko core architecture:
- **Card Names & Inflection:** Hierarchical name algebra, inflections, junctions, and codenames (`src/card/name/`).
- **Data Access & Storage:** SQL drivers for SQLite, MySQL, PostgreSQL, and Edge HTTP database backends (`src/server/driver.ts`, `src/server/drivers/`).
- **Query Engine:** Card Query Language (CQL) lexer, parser, query planner, and SQL translator (`src/cql/`).
- **Rendering & View Chains:** TypeScript view functions and mod registration pipelines replacing Ruby set-module / HAML methods (`src/card/render/`).
- **Card Lifecycle & Events:** Multi-stage save pipeline (prepare, stage, validate, commit, integrate) with transaction rollback and event hooks (`src/card/actions/`).
- **Authentication & Security:** Legacy SHA-1 hash support with automatic PBKDF2 upgrade path, session tokens, constant-time comparisons, and rule-based permissions (`src/card/auth/`, `src/card/rules/`).
- **Attachments & Blobs:** Storage drivers for local filesystem, memory, AWS S3/Cloudflare R2, and Edge HTTP storage (`src/blob/`, `src/card/attachments/`).
- **Mod System:** Built-in ports of all standard mods shipped with Decko 0.20.0 / card 1.110.0 (`src/card/mod-loader/`).

---

## 2. Four-Category Compatibility Contract

Compatibility is verified across four distinct, independent categories:
1. **Persistence:** State changes across database transactions, action logging, and history records.
2. **Semantics:** Card naming rules, inflections, permissions, CQL queries, and filter operations.
3. **Rendering:** Card view transformations, slot nesting, HAML translation, and layout structure.
4. **Side Effects:** Outgoing mail generation, notification formatting, and delayed job scheduling.

Passing a check in one category (e.g. rendering) does not imply equivalence in another (e.g. notifications or transactional persistence). Verification tallies for all four categories are reported in [VERIFICATION.md](../VERIFICATION.md).

---

## 3. Mod System and Extension Boundaries

- Every standard mod included with Decko 0.20.0 / card 1.110.0 has been ported to TypeScript and is shipped in `src/card/mod-loader/`.
- Third-party Ruby mods must be ported to TypeScript for production deployment, as edge execution runtimes do not execute Ruby.
- The repository also includes an experimental WebAssembly loader capable of evaluating Ruby set definitions via WebAssembly; however, production edge hosts run native TypeScript handlers.
- The TypeScript mod DSL supports declared synchronous format helpers, view permission predicates, and set-scoped registration (`src/card/mod-loader/mod-dsl.ts`).

---

## 4. Multi-Database Architecture

The engine abstracts database operations behind a standard driver interface:
- **SQLite (`better-sqlite3`):** Default for local development and testing.
- **PostgreSQL (`pg`):** Production client for PostgreSQL 16+.
- **MySQL (`mysql2`):** Production client for MySQL 8.4+.
- **PGlite:** Embedded WebAssembly single-session engine for embedded scenarios.
- **Edge Drivers:** HTTP-based drivers for Cloudflare D1 and Edge database protocols.

Detailed multi-backend conformance matrices are documented in [VERIFICATION.md](../VERIFICATION.md#runtime-database-matrices).

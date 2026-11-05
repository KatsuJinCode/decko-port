# Decko TypeScript Port

An independent TypeScript port of Decko (targeting card 1.110.0 and decko 0.20.0), providing a modern JavaScript/TypeScript runtime with pluggable storage, multi-database support, and edge platform compatibility.

---

## Headline Verification Results

Verification of this port is backed by in-tree test records, execution ledgers, and raw reports stored in `verification/`. Detailed test specifications, per-case tables, and provenance are consolidated in [VERIFICATION.md](VERIFICATION.md).

- **Synthetic Fixture Parity (Synthetic-v1):**
  - **Rendering:** 1,754 / 1,754 (100%)
  - **Semantics:** 2,389 / 2,389 (100%)
  - **Persistence:** 16 / 16 (100%)
  - **Side Effects:** 19 / 19 (100%)
  - *Receipt:* [verification/synthetic-v1.json](verification/synthetic-v1.json)
- **Canonical Browser Journeys:**
  - **52 / 52** passed (100%), **0** failed, **0** owed
  - *Receipts:* [verification/browser-gate-52.json](verification/browser-gate-52.json), [verification/browser-ledger.jsonl](verification/browser-ledger.jsonl)
- **Runtime Database Matrices:**
  - **PostgreSQL 16.15:** 5 / 5 passed
  - **MySQL 8.4.11:** 5 / 5 passed
  - **SQLite:** 5 / 5 passed
  - **PGlite WebAssembly:** 3 / 5 passed (2 concurrency assertions skipped by design)
  - **Edge Database:** 5 / 5 passed
  - *Receipts:* [verification/database-matrix.json](verification/database-matrix.json), [verification/database-matrix.log](verification/database-matrix.log)
- **Full Test Suite:**
  - Initial VM baseline: 12,072 passed / 75 failed / 194 skipped
  - Close-out progression: 466 / 470 passed, final 4 / 4 passed
  - *Receipts:* [verification/suite-run-provenance.json](verification/suite-run-provenance.json), [verification/closeout-part1.xml](verification/closeout-part1.xml)

For complete verification methodologies, build attributions, and the excluded-inputs ledger, see [VERIFICATION.md](VERIFICATION.md).

---

## Running Tests

This release includes the complete port test suite (218 test files across 188 test suites in `tests/`) and gate runner tools.

- **Vitest:** `npx vitest run`
- **Test Gate Runner:** `node tools/test-gates.mjs run full`
- **52-Journey Verification Gate:** `node verify-52-of-52-no-owed-list-gate.mjs`

Detailed instructions and prerequisites are in [TESTING.md](TESTING.md).

---

## License

- Licensed under the **GNU General Public License v3.0 or later (GPL-3.0-or-later)**.
- See [NOTICE](NOTICE) and [LICENSE](LICENSE) for copyright attribution and full license terms.
- Bundled third-party source in `third-party-source/` contains TinyMCE 5.10.7 licensed under the **GNU Lesser General Public License v2.1 (LGPL-2.1)** (see `third-party-source/tinymce-5.10.7/LICENSE.txt`).

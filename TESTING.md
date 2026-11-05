# Testing the Decko TypeScript Port

This package ships the complete TypeScript test suite (`tests/`, 218 test files across 188 test suites) and test gate tooling (`tools/test-gates.mjs`) used during port development and verification.

---

## 1. Prerequisites

- **Node.js:** Node.js v20+ (recommended v22 or v24).
- **Package Manager:** npm v10+.
- **Dependencies:** Installed via `npm install` (or offline using existing `node_modules`).

```sh
npm install
```

---

## 2. Running the Test Suite

### Running via Vitest
The primary test runner is Vitest:

```sh
# Run all unit and integration tests
npx vitest run

# Run tests in watch mode
npx vitest

# Run tests in a specific subsystem
npx vitest run tests/card/name
npx vitest run tests/query
npx vitest run tests/render
```

### Running Test Gates (`tools/test-gates.mjs`)
The `tools/test-gates.mjs` tool provides structured gating to run specific categories of tests:

```sh
# List all defined gates and test file counts
node tools/test-gates.mjs list

# Verify all test files are classified into a gate
node tools/test-gates.mjs check

# Run the core correctness gate
node tools/test-gates.mjs run correctness

# Run the full test gate
node tools/test-gates.mjs run full
```

---

## 3. Running the 52-Journey Verification Gate

To verify the 52 canonical browser journeys against the authoritative verification ledger:

```sh
node verify-52-of-52-no-owed-list-gate.mjs
```

This verifies that:
1. All 52 canonical browser journeys defined in `verification/synthetic-v1.json` are present in `verification/browser-ledger.jsonl`.
2. Every journey has an explicit `passed` verdict.
3. Zero journeys are owed, pending, failed, or deferred.

---

## 4. Multi-Database Matrix Testing

The test suite includes database matrix tests for multiple database backends:

- **SQLite (In-Memory / File):** Runs out of the box using `better-sqlite3`.
- **PostgreSQL:** Configured via `DECKO_DATABASE_URL=postgres://user:pass@host:5432/decko`.
- **MySQL:** Configured via `DECKO_DATABASE_URL=mysql://user:pass@host:3306/decko`.
- **PGlite:** In-process single-session WebAssembly PostgreSQL engine.

Test results across backends are documented in [VERIFICATION.md](VERIFICATION.md#runtime-database-matrices) with receipts in `verification/database-matrix.json`.

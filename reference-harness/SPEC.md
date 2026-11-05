# Decko reference harness

A language-neutral way to prove that a Decko engine behaves like Ruby Decko.
Any engine, in any language, implements one small adapter; the harness drives
it with the same operations it drove stock Ruby Decko with, and grades the
answers on four kinds of parity:

| kind | what is compared |
|---|---|
| rendering | the HTML of a full page (`GET /<card>`) and of a card view, per actor |
| semantics | answers that are data, not HTML: card identity, set membership, rule lookup, permission verdicts, search results, name algebra |
| persistence | the rows a write leaves in Decko's card tables |
| side effects | what a write or sign-in causes beyond the rows: saved or refused, the errors shown, the mail sent, the identity signed in |

Ruby Decko is the oracle. Its answers are recorded once per fixture under
`fixtures/<name>/expected/` and committed, so grading an engine needs Node
and the engine, not Ruby.

This harness is one instrument among several. What it measures, what the
other instruments cover, and what nothing in the public package measures
(browser journeys, PBKDF2 storage of a newly set password, hosted database
writes) is inventoried in the coverage inventory, `docs/coverage-inventory.md`
(development repository; not included).

Some paths this document cites are tools and fixtures of the development
repository that this package does not include; each is marked "(development
repository; not included)". Of `reference-harness/`, the package includes
`runner/` (with its tests), `adapters/ts/`, `fixtures/synthetic-v1/`,
`fixtures/write-battery-v1/` (without its `withheld/` set),
`browser/lib/journey-provenance.mjs`, this document and
NORMALIZATION-EVIDENCE.md.

## Layout

```
reference-harness/
  SPEC.md                    this document
  corpus/                    fixture generators (deck.json, operation lists); development repository; not included
  fixtures/<name>/
    deck.json                the deck, as plain data
    files/                   files the deck uploads
    deck/deck.sqlite3        the built deck (Decko's schema), and deck/files/
    ops/                     render.jsonl, semantics.jsonl, scenarios.json
    expected/                the oracle's answers, one JSON line per operation
    withheld/                operations and answers kept out of the package (section 6), when present
  oracle/                    the Ruby oracle: stock Decko app, deck builder, adapter, Dockerfile; development repository; not included
  adapters/<engine>/adapter.json   how to start an engine's adapter; only adapters/ts/ is included
  runner/                    run.mjs (drive an adapter), grade.mjs (compare), normalisation
  browser/                   browser scenarios: journeys, engine servers, runner, comparison (section 8); development repository; not included, except browser/lib/journey-provenance.mjs
```

## 1. Fixtures

A fixture is plain data. Nothing in it is specific to one engine.

### deck.json

```json
{
  "format": "decko-reference-deck/1",
  "name": "synthetic-v1",
  "base": { "seed": "decko setup", "decko": "0.20.0", "card": "1.110.0" },
  "clock": "2026-09-19T12:00:00Z",
  "environment": { "origin": "http://deck.example", "default_html_view": "titled" },
  "actors": {
    "anonymous": { "card": "Anonymous" },
    "member": { "card": "Mira Member", "email": "...", "password": "..." },
    "admin": { "card": "Ada Admin", "email": "...", "password": "..." }
  },
  "cards": [
    { "name": "Topic", "type": "Cardtype" },
    { "name": "Topic+*type+*structure", "type": "RichText", "content": "{{+summary}}" },
    { "name": "Mira Member", "type": "User", "fields": { "+*account": { "fields": { "+*email": "..." } } } },
    { "name": "Report 1", "type": "File", "file": "files/report-1.txt" }
  ]
}
```

- `base` is the stock seed the cards are applied to (`decko setup` at the
  named versions).
- `cards` are applied in order, as Decko Bot, through the engine's own create
  path. An entry whose card the seed already holds updates it. `type` is a
  type name and may be omitted (the deck's rules then decide). `fields` are
  subcards (`"+name": "content"` or `"+name": {"fields": {...}}`). `file`
  uploads a file from the fixture directory.
- `clock` is the instant every reference output was produced at. Engines
  run with their clock pinned to it.
- `environment` holds the deck's process configuration: `origin` is
  `Cardio.config.deck_origin`, `default_html_view` is
  `Cardio.config.default_html_view`. No other configuration is allowed.
- `actors` name the cards operations act as. `anonymous` is the signed-out
  visitor. Passwords are fixture values for a throwaway deck.

### The built deck

`oracle/build-deck.sh <fixture>` (development repository; not included) seeds a stock deck, restamps the seed's
timestamps to `clock`, applies `deck.json` under the frozen clock, compiles
the script and style asset outputs, and writes `deck/deck.sqlite3` and
`deck/files/`. The built deck is committed: it is the exact starting state
every engine and every expected output refers to. An engine reads Decko's
SQLite schema directly; that schema is the persistence contract.

### Operations

Every operation has an `id`, unique within its file, and an `op`:

| op | fields | result |
|---|---|---|
| `render` | `actor`, `card`, optional `view` | `{ "html": "..." }`. Without `view`: the page `GET /<card>` serves (layout included); a card that does not exist renders as Decko renders an unknown card. With `view`: that view of the card, as a fragment. |
| `ask` | `actor`, `q`, and the question's fields | see below |
| `write` | `actor`, `action` (`create`, `update`, `delete`), `card`, `fields` | `{ "saved": bool, "errors": [{"field","message"}], "card": {"name","id"} or null, "mail": [{"to": [..sorted], "subject", "text"}] }` |
| `signin` | `email`, `password` | `{ "signed_in": bool, "actor": "<card name of the current user afterwards>" }` |

`write` fields: `type` (type name), `content`, `name` (a rename, on update),
`fields` (subcards, `{"+name": "content"}`).

`ask` questions:

| `q` | fields | answer |
|---|---|---|
| `card` | `card` | `{exists:false}` or `{exists, id, name, key, type, codename, left, right, read_rule}` (`read_rule`: the name of the card's stored read rule) |
| `permissions` | `card` | `{read, create, update, delete}`: the actor's verdict for each task on the card (a new card if it does not exist) |
| `set_names` | `card` | `{sets: [...]}`: the card's sets, most specific first |
| `rule` | `card`, `setting` | `{rule: "<rule card name>" or null}`: the rule that governs `setting` for the card |
| `search` | `query` (CQL) | `{names: [...]}`, or `{count: n}` when `query.return` is `"count"`; filtered by what the actor may read |
| `name` | `name` | `{s, key, url_key, parts, simple, left, right, trunk, tag}` |

Files: `ops/render.jsonl` and `ops/semantics.jsonl` (one operation per
line, all run in one session on one deck copy), and `ops/scenarios.json`
(`{"scenarios": [{"id", "steps": [operation, ...]}]}`: each scenario runs in a
fresh session on a fresh deck copy, steps in order; steps carry no `id`).

## 2. Adapter protocol

An adapter is a process the runner starts once per session. It is described
by `adapters/<engine>/adapter.json`:

```json
{ "name": "decko-ts", "command": ["node", "adapter.mjs"] }
```

`command` runs in the manifest's directory. The runner sets:

| variable | meaning |
|---|---|
| `HARNESS_DECK` | the session's private copy of `deck.sqlite3`; the adapter may write it |
| `HARNESS_FILES` | the session's copy of the deck's files directory |
| `HARNESS_DECK_JSON` | the fixture's `deck.json` (clock, environment, actors) |
| `HARNESS_WORK` | an empty directory the adapter may use for caches |

Paths use forward slashes.

Transport: one JSON object per line. stdout carries protocol lines only
(lines that do not start with `{` are ignored and logged); diagnostics go to
stderr.

1. On start, after loading the deck, the adapter writes
   `{"ready": true, "protocol": 1, "engine": "<name>", "version": {...}}`.
2. The runner writes requests `{"id": n, "op": ..., ...}`, one at a time, and
   waits for the answer.
3. The adapter answers `{"id": n, "ok": true, "result": {...}}`, or
   `{"id": n, "ok": false, "error": {"class", "message"}}` when it could not
   answer at all. A refused write is not an error: it is a result with
   `saved: false`.
4. `{"op": "quit"}` ends the session; the adapter flushes its writes and
   exits.

Each request is a request boundary: per-request state is reset and the
actor is signed in before the operation runs, exactly as a new HTTP request
would. A write must be committed to `HARNESS_DECK` before its answer is sent,
because the runner reads the deck file between steps.

Every answer must come from the engine's own entry points. An adapter routes
requests and shapes results; it must not compute an answer itself.

## 3. Runner and grading

```
node runner/run.mjs --adapter adapters/<engine>/adapter.json \
     --fixture fixtures/<name> --out <resultsDir> [--kinds render,semantics,scenarios] [--filter <regex>] [--limit <n>]
node runner/grade.mjs --fixture fixtures/<name> --actual <resultsDir> \
     --candidate-commit <full captured source commit> \
     [--expected <expectedDir>] [--report report.json] [--allow-partial]
```

### What a run records

`run.mjs` copies the built deck per session, runs the operations, and writes
`render.jsonl`, `semantics.jsonl` and `scenarios.jsonl` plus `run-meta.json`
(results format 2).

`run-meta.json` holds one record per kind under `runs`, written when the kind
starts (`complete: false`) and again when it ends, so an interrupted run never
claims completion. Each record names: `started`, `finished`, `complete`,
`selection` (the `--filter`/`--limit` used, or null), `ops_total` (the
fixture's count) and `ops_run`, the adapter's name, its ready line
(`engine`), its source checkout (`adapter_checkout`: commit and whether it had
uncommitted changes), and the fixture digest the run used with any
disagreement between the fixture and its manifest (`fixture_problems`). The
ready line is where the environment a capture ran in is recorded: the Ruby
oracle names `ruby`, `ruby_platform` and `ruby_engine` there, so a set of
recorded bytes always carries the interpreter and platform that produced it
(section 4, N3). A read
kind also records `session_writes`: every row of every table the session
changed, raw. A run that ends because the adapter exited is incomplete.

Each adapter session also records `adapter_diagnostics` under the run output
directory. Its `diagnostics.json` identifies the command, owned PID, source
checkout, ready message, process outcome and raw `stdout.bin`/`stderr.bin`
paths with byte counts and SHA-256. Stdout includes protocol and nonprotocol
bytes; these files retain original line endings, invalid UTF-8 and partial
lines. They survive removal of the staged deck. No arbitrary environment
variables are copied. Console diagnostics are full decoded UTF-8 lines/text,
not authoritative byte copies; decoding invalid UTF-8 can show replacement
characters. The raw files are authoritative. An unfinished manifest explicitly
describes a checkpoint; only drained streams receive `streams_complete: true`.
Controlled interruption closes the owned adapter and records its reason;
capture I/O failure remains incomplete and fails the run. These records add
diagnostic evidence, not permission to bypass source or result-inventory gates.

Candidate source qualification also requires `source_binding` on each run kind.
The runner inventories the complete committed tree and the visible worktree
before starting adapters and after all owned adapters close. It reads raw file
bytes and computes Git blob identities directly; assume-unchanged and
skip-worktree index flags are not evidence that bytes match. The saved commit
object and complete tree inventory bind these observations to the externally
requested commit. A missing, changed, untracked, unreadable or redirected source
file leaves the capture available for diagnosis but prevents qualification.

The supported execution witness is a direct Node file entry under that committed
source root. The effective command explicitly uses the runner's Node runtime and
a runner-owned `--import` observer. Its runtime and observer hashes, requested and
effective commands, entry identity and owned PID are recorded. Node's synchronous
module hooks observe loaded file-module bytes without changing returned source;
the grader checks those bytes against the pinned inventory. It rejects an entry
or loaded dependency outside that inventory, a changed or transformed loaded
module, an incomplete witness, or source that changes during the observation
window. This includes a dependency temporarily changed and then restored.

Shell/eval/preload command recipes, inherited `NODE_OPTIONS`, unrecognized module
loaders, generated/non-file modules and unwitnessed child/worker/VM execution are
not proven by the direct-file witness. Loading their execution interfaces
conservatively leaves a direct-file capture unqualified. Ruby and other unsupported invocation recipes still run
and retain their native observations; they do not gain candidate qualification
from an unrelated clean working directory. This is recorded source evidence,
not a sandbox or an attestation against a malicious engine rewriting its own
evidence. Existing result inventory, explicit candidate pins and diagnostic-mode
rules remain separate requirements. Older status-only records require a new
capture for candidate qualification and remain usable in diagnostic mode.

The one additional supported recipe is the canonical
`reference-harness/adapters/ts/adapter.mjs` registering this instrument's exact
`tools/oracle/typescript-source-loader.mjs`. It requires the recognized entry,
loader and transform-observer bytes in the pinned candidate tree, and exactly
the expected registration. An observer registered before that loader records
the loader/toolchain modules actually consumed in its worker. CommonJS compiler
input is observed at its content argument where Node's asynchronous compatibility
bridge otherwise exposes no source. Each TypeScript transform records the actual
input passed to `transformWithOxc` and the returned JavaScript; the main witness
then identifies the output loaded by Node. On a cache hit, the existing cached
program still executes, and a fresh transform independently checks whether its
bytes match. Missing receipts, transient changed inputs, poisoned cached output
and additional arbitrary loader registrations prevent qualification.

For this canonical recipe, installed runtime/toolchain modules are recorded
separately from candidate Git source: actual module input hashes and installed
package manifests must match a name/version declared in the committed dependency
lock. This identifies the installed artifacts used; it is not authentication of
their publisher or proof that a local installation matches a registry archive.
Secondary execution interfaces are observed at their actual calls, including
builtin lookup and the child-process prototype path. Unwitnessed child, worker
and VM executions still run but leave the capture unqualified. No other custom
loader gains admission from its filename or from before/after file hashes alone.

The main adapter also has an in-process V8 compilation observer. It reads
`Debugger.scriptParsed` / `scriptFailedToParse` notifications and the actual
generated script source, without replacing `eval` or `Function`. Unbound anonymous or
non-file generated programs, including programs claiming a file through a
`sourceURL` comment, remain unqualified. Their complete source strings and
compiler metadata are retained in the source audit; the program still executes
with its original lexical scope. The observer opens no inspector listener,
sets no breakpoints, skips pauses and disconnects its own session at exit.
Missing, incomplete or failed observations prevent candidate qualification.

Module observations accumulate in memory between the initial incomplete
checkpoint and an atomic final publication. A failed publication retains its
real error and leaves the primary checkpoint incomplete. Raw stdout/stderr
continue to be retained immediately by the independent diagnostic journal.
Worker and transformation journals use shared observed/retained/error counters,
so an I/O failure cannot disappear when a journal becomes writable again.

Two specific runtime producers can bind generated programs in the canonical
recipe: better-sqlite3 13.0.3's row projection and long 5.3.2's UMD integer Wasm
literal. Admission requires the exact inspected producer implementation hash,
its actual V8 module source, the matching same-process consumed module input,
and the lock-admitted package identity. The grader independently reconstructs
the complete generated program: JSON-quoted data keys mapped to sequential
arguments for the SQLite projection, or every static Wasm byte for long. Calls,
extra expressions, changed producer code, spoofed sourceURLs or different binary
bytes do not match those rules. A filename, package name or stack frame alone
does not bind generated code. Other eval/Function programs remain unqualified.

For every scenario step the runner snapshots the deck before and after and
records the raw row delta: `rows` for Decko's card tables (`cards`,
`card_acts`, `card_actions`, `card_changes`, `card_references`,
`card_virtuals`), and `other_tables` for any other table the step changed.
Raw means ids, timestamps and every other column exactly as stored.

### What the grader refuses

`grade.mjs` first checks that the results are a grade at all. Any of these
makes the verdict **not a grade** (exit 2), and no pass rate is printed:

1. `run-meta.json` missing, unreadable, in another results format, or naming
   another fixture; a kind's record missing a field listed above.
2. A kind not run, not complete, run with a selection, or with a different
   operation count from the fixture's.
3. An operation with no result line, a result line twice, a result id the
   fixture does not have, or a scenario with fewer steps than the fixture's.
4. The fixture tree not matching its `MANIFEST.json`; results recorded on
   another fixture digest, or on a fixture that did not match its manifest.
5. The expected outputs without a `MANIFEST.json`, captured on another
   fixture digest, holding a file that differs from or is missing from their
   manifest, or naming an oracle variant inconsistent with their directory
   (section 5).
6. Kinds answered by different adapters, engine versions or commits; missing,
   malformed or dirty source identities; any source not matching the external
   `--candidate-commit` constraint. Every required kind must name that exact
   clean source. The constraint is not inferred from saved metadata or the
   current checker's HEAD.

`--allow-partial` grades a filtered or partial run on what it holds, for
development; its verdict is `partial` and it still exits 2. An explicitly
requested `--diagnostic` comparison has `diagnostic-pass` or
`diagnostic-fail`, always exits 2, and establishes no candidate acceptance.
It cannot be combined with a candidate constraint. Omitting both modes
refuses the grade. Each report records `source_qualification` and content
hashes for the checker separately from the captured runtime source. A newer
checker can regrade unchanged observations from an earlier pinned runtime.

### What the grader compares

Each item is compared with the expected outputs after normalisation
(section 4) and passes only if equal. Results are tallied per kind and per
group (page or view and actor; question type; write action). Scenario steps
are graded on every kind they exercise: a write's answer is a side-effect
item, its `rows` a persistence item, a render or question after a write a
rendering or semantics item.

An item whose oracle answer is itself a failure is graded on what kind of
thing the oracle recorded. A capture-side fault (the `CAPTURE_ERROR` sentinel
the capture scripts record when their own machinery threw) says nothing about
the site: it is reported as an oracle capture fault and not graded. A recorded
upstream failure - the oracle raised while serving, and its capture holds the
error record - is the upstream behavior the port must reproduce: the engine's
answer must be the same failure under N8 (the class's host naming
canonicalized) with the message byte-exact, and a match is counted as a
**reproduced upstream failure**, its own success category: where the original
is broken and the copy breaks the same way, that is the port succeeding. Any
other answer on such an item - a different
failure, or a render where the oracle failed - fails it.

**Reads write only what the oracle's reads wrote.** Each read session's
`session_writes`, and each non-write scenario step's `rows` and
`other_tables` (renders, questions, sign-ins), must equal the oracle's for the
same session or step, which on `synthetic-v1` is nothing. These are reported
as their own line, `read writes`, and any failure fails the grade even when
every answer matches.

**A write changes only the tables the oracle's write changed.** Each write
step's `other_tables` (every table outside Decko's card tables the step
changed) must equal the oracle's for the same step; they are recorded truths
like the `rows`. A difference fails the grade unless it is declared:
`--declared-other-tables` names a JSON map keyed on step id then table name,
`{"create-then-render#1": {"sessions": "why"}}`, of differences an engine is
known to make (its own bookkeeping tables, say). A declared difference is
graded as declared, recorded in the report (`other_tables`, with its why),
and does not fail; an undeclared one fails the grade even when every answer
matches. Every write step whose non-card tables changed is listed in the
report (`other_table_writes`), with its verdict: pass, declared, or fail.
Declared differences are counted in their own field, never in the pass
count, and a declaration that no longer occurs is stale and fails the grade:
a (step, table) pair whose table matches the oracle, or that names no write
step of the grade, and a declared divergence that masked no value on either
side (report fields `stale_declarations`, `stale_divergences`), like the
sibling comparator's `declared-difference-absent` check
(`tools/persistence/compare-persist.mjs`, development repository; not
included). On a `--allow-partial` selection
a declaration whose step was not graded is not judged stale.

The comparison covers every table that exists in the oracle's schema, read
from the fixture's built deck (`deck/deck.sqlite3`). A table only the
engine's schema has holds no row the oracle reads or writes; its changes are
not compared, matched or declared, and are listed in the report's
`engine_only_tables` field (`tables`, and `writes` with each step's id, table
and row delta).

**A declared divergence masks one named kind of value, nothing more.** An
engine configuration that differs from Ruby on purpose in a stored value Ruby
cannot produce names that divergence with `--declared-divergences`, a JSON map
of divergence name to why. Each name is defined in `runner/divergences.mjs`;
the grader masks exactly the values it describes in the expected and actual
row deltas alike, compares everything else as usual, and lists every masked
value in the report (`declared_divergences`). A divergence that masked no
value in the grade is stale and fails it, like a stale (step, table) pair. The one defined divergence is
`password-digest`, and it is one column wide: `cards.db_content` of a
`+*password` card when the value is a password digest of either scheme. An
update of such a row whose only changed column is that digest is left with no
change and dropped. That is how the `adapters/ts-pbkdf2` configuration (development repository;
not included; the
port's default PBKDF2 password policy) passes the sign-in steps: Ruby writes
nothing at sign-in, the port rewrites the digest, and the grade says only that
the rewrite changes the digest and nothing else. Nothing else is masked; a
write that sets a new password still differs from Ruby in its `card_changes`
history row and would fail.

Exit status: 0 every item passes; 1 a valid grade with failures; 2 not a
grade.

Any results file may be stored gzipped (`render.jsonl.gz`); the fixture's
large reference renders are. `node runner/causes.mjs report.json [kind]`
groups a report's failures by the shape of their first difference, so one
root cause reads as one line. Persistence and read-write failures also list
every differing value (`differences`).

The runner and grader need Node 22.5 or later and nothing else
(`node:sqlite`). Their tests, including a negative control for every refusal
above, run with `node --test "reference-harness/runner/test/*.test.mjs"`.

## 4. Normalisation

Two instruments normalise, and each has its own namespace so that one
instrument's rule names never read as another's:

- **`N1`-`N9`** — the **corpus instrument**: `runner/normalize.mjs`, which
  grades this harness's op results and is the instrument every figure in a
  grade report names. These are the rules the committed expected outputs are
  compared under, and `normalize.mjs:1-18` is their prose form.
- **`B1`-`B5`** — the **browser-journeys instrument**: `browser/lib/observe.mjs`
  (development repository; not included),
  which normalises what a user sees when a journey runs against a live page,
  plus the two forms `browser/compare-journeys.mjs` (development repository;
  not included) applies at compare time.
  It is a different instrument on a different recording shape (a page
  observation rather than an op result), so its rules carry the `B` prefix.

A `B` rule and an `N` rule that look alike are not the same rule. Where the
journeys comparator borrows one of the harness's forms it names the borrowed
rule at the call site rather than renumbering it.

### 4.1 The browser-journeys instrument's rules (`B1`-`B5`, plus two at compare time)

`observe.mjs` normalises each observation as it is captured, so both engines'
observations are in the same canonical form before anything is compared:

1. **B1.** Text is the page's rendered text (`innerText`), whitespace collapsed.
2. **B2.** Dates, durations, timestamps and relative ages remain exact. Text
   matching cannot establish whether a value is literal card content or a
   generated clock value. Control clocks at capture or investigate the
   difference; do not erase it before comparison.
3. **B3.** Structure is the element tree of the main area as tag plus sorted
   classes; ids, data attributes and inline styles are left out, and the
   classes Decko draws at random per render are masked to `RAND`.
4. **B4.** Fields are the visible form controls of the page by name and type.
5. **B5.** The URL is compared as path and query, decoded, without the host;
   the server's own address inside text becomes `<origin>`.

`compare-journeys.mjs` then applies exactly one more form, borrowed rather
than renumbered:

- **`stable`** from `runner/normalize.mjs` — the harness's **N2**: JSON object
  key order never counts and array order always does, and the per-journey
  server port in an absolute URL the deck itself builds is compared as
  `127.0.0.1:PORT`.

### 4.2 The corpus instrument's rules (`N1`-`N9`)

These are the rules a grade report names in its `normalization` field, and
they are the ones the committed expected outputs were captured under. A grade
over `synthetic-v1` applies **N1, N2 and N3** and reports exactly those three;
N4 and N6 through N9 exist because `synthetic-v2` (`fixtures/synthetic-v2`,
development repository; not included) carries values this fixture does not
(collapse ids, debug-page frame lists, capture-host content in debug pages,
error class names and object addresses in inspect text), and they are applied
when a comparison reaches them. N5 is retired (item 5 below). Nothing outside
that list is normalised.

Two kinds of rule:

- A **mask** erases a value. It is allowed only for a field shown to vary
  between two complete runs of the same oracle on the same fixture, and only
  in that field's exact shape. Two exceptions: N6, because a backtrace reports
  the raising engine's own call stack, which no other engine can reproduce
  honestly even though it does not vary between oracle runs; and N9, whose
  value varies between processes exactly as the N1 slot id does but names the
  raising process's heap, which no other engine can reproduce honestly.
- A **canonical form** compares the same value in another encoding and
  erases nothing.

1. **N1 (mask).** In rendered HTML, a `data-slot-id` attribute in attribute
   position — between `<` and `>` of one tag, a whitespace-preceded name
   followed by `=` and a quoted value — holding exactly 20 lowercase hex
   digits has its value replaced by `SLOT`; the quote character is kept. The
   same text anywhere else (element content, comments, attribute values,
   script and style bodies) is compared exactly: the mask touches only real
   attribute tokens. Ruby Decko draws slot ids at random per render.
2. **N2 (canonical form).** JSON object key order never counts; array order
   always does. String leaves remain exact, including localhost ports in
   literal documentation, rendered HTML and semantic values. Generated test
   origins require an explicitly identified capture field; key ordering does
   not establish origin provenance.
3. **N3 (canonical form).** Inside a real `class` attribute — in attribute
   position, as for N1, so element text, comments, another attribute's value
   and raw text bodies are untouched — the class tokens are compared as a set:
   both sides are read as their whitespace-separated tokens and sorted. The
   token set, the token count and the tokens themselves all still count; a
   different set is a different attribute, and only the order is canonicalised.
   The whitespace between tokens is the attribute's separator rather than
   content, so runs of it collapse to one space, and the quote character is
   kept exactly as N1 keeps it.

   The rule exists because Ruby's own environment decides the order: stock
   Linux Ruby and stock Windows Ruby emit the same tokens in a different
   order (section 5, "The oracle's environment is part of the contract"). The
   committed expected outputs were captured on Windows, where the order is
   already the sorted order the engine emits, so N3 changes nothing about
   them; it is what lets a Linux capture be graded against the same fixture.

   `grade.mjs --no-class-token-order` grades with N3 off, which is how the raw
   class-token order counts on its own. Every report names the rules it ran
   under in `normalization`.

4. **N4 (canonical form over a volatile value).** In rendered HTML, the
   numeric context of a `card-<safe-key>-<n>-collapse-id` token — the
   accordion collapse id `admin.rb:96` seeds with Ruby's `title.hash` — is
   replaced per html string by `N4#k` in first-appearance order, so the
   accordion button's `data-bs-target` and its panel `id` must still agree.
   Ruby hashes strings with a per-process seed; the digits are process noise.
   The literal contexts (`files`, `depends_on`, view names) hold no digits
   and never match.
5. **N5 (retired).** Duration word shape does not identify a generated age.
   The former rule erased ordinary trial durations, tooltips and link targets.
   Rendered durations and dates now remain exact. An explicit request for
   N5 throws `RetiredRelativeTimeNormalization`; historical reports naming it
   are not evidence of current literal-content equivalence.
6. **N6 (mask over the raising engine's call stack).** In rendered HTML,
   inside a render-error span's debug-page title, the whole content of the
   div that follows the message paragraph — the frame list Ruby's
   `exception.backtrace * "<br>\n"` embeds — becomes the single placeholder
   `N6#frames` on both sides. A backtrace is the call stack of the engine
   that raised, so it is engine-specific by definition: the oracle's is
   Ruby's (`path:line:in \`method'`, including the frames of the capture
   process's boot and of the harness), a port's is its own language's. Its
   frame text and its frame count describe the engine, not the behaviour the
   oracle defines, and no port can honestly emit another engine's stack.
   The div itself, the heading, the error message (with N7) and every byte
   outside the div still compare byte for byte. On `synthetic-v2` the rule
   acts on the debug-page operations — the eight withheld admin error-view
   operations and the public debug-page operations, which raise errors that
   are not security-related — and changes their grade; see
   NORMALIZATION-EVIDENCE.md.

   The rule, stated whole: a backtrace is the call stack of whichever engine
   raised; its frames name that engine's own files and cannot be produced by
   a second implementation without fabrication. The comparison therefore
   masks the backtrace frame list on both sides and compares everything else
   in the error page byte for byte: the error class, the message, and the
   surrounding page. A port must not fabricate frames to match.
7. **N7 (canonical form over capture-host content).** In rendered HTML,
   inside a render-error span's `title` attribute that begins with the Ruby
   debug page marker (`&lt;h3&gt;Error message (visible to admin only)
   &lt;/h3&gt;`), absolute paths (drive-letter, forward or back slashes) and
   hexadecimal heap addresses become `N7#path` / `N7#addr`. The debug pages
   embed the capture host's backtrace frames — the Ruby install, gem home
   and harness checkout of the machine that recorded the capture — which
   are that machine's filesystem, not the oracle's semantics. Every byte
   outside such a title, and the error message inside it, still count. The
   frame list itself is masked by N6 above.
8. **N8 (canonical form over the host language's class naming).** On an
   operation whose recorded result IS the failure (section 3, "What the
   grader compares"), the error record's class name canonicalizes to its
   name proper: the terminal `::` segment of the Ruby path
   (`Card::Error::CodenameNotFound` -> `CodenameNotFound`), with one
   trailing `Error` suffix — the JS subclass convention
   (`CodenameNotFoundError` -> `CodenameNotFound`) — dropped from either
   side. A class name is the host language's identity in the same class as
   N7's and N6's content: no port can emit the other language's naming.
   Everything else in the record counts: the message compares byte-exact,
   and a different name proper is a different failure, which fails the
   item.
9. **N9 (canonical form over the address inside a default object inspect).**
   Anywhere in a compared value — a render's HTML (text regions and quoted
   attribute values) or an error record's message — the sixteen hex digits of a
   default object inspect's address become the single placeholder `N9#addr`, and
   only there: `#<Class:0x` followed by exactly sixteen hex digits and the end of
   the address (`>`, or a space before the attributes). Ruby's default inspect
   embeds the object's memory address (`#<Cardio::Mod:0x000001bd38e4f4c0 ...>`),
   which differs on every process, like the N1 slot id; no port has a Ruby heap
   to reproduce it. The class name, the attributes after the address and every
   other byte compare byte for byte, and the mask is applied on both sides. In a
   render this reaches the render-error span's debug title; in an error record
   it reaches the receiver text of a `NoMethodError` message. N9 runs before N7
   inside a debug title, so the address is attributed to N9 and N7's heap-address
   rule never claims it.

Everything else is compared exactly: every byte of HTML, every field of a
write answer (the new card's id and every byte of mail text included), every
column of every row (ids and timestamps as stored).

**Evidence.** `node runner/compare-runs.mjs <runA> <runB>` compares two runs
item by item, raw, and reports every difference no mask explains and, per
mask, how many of the values it matched actually differed. For `synthetic-v1`
two complete stock-oracle runs differ in 1,351 of 4,156 items, all in slot
ids: 9,061 of 9,061 slot ids differ, and nothing else does. The result is in
the expected outputs' manifest (`provenance.nondeterminism`), and a test
checks that it covers exactly the masks `normalize.mjs` applies. A new mask
needs the same evidence on the fixture that needs it.

The evidence for N4 through N9 on `synthetic-v2` is in
[NORMALIZATION-EVIDENCE.md](NORMALIZATION-EVIDENCE.md): for each rule, the
values it canonicalizes, the measured facts behind it, and the commands that
reproduce them from the development repository's files. N4 (collapse ids) is evidenced by two
complete stock-oracle runs over the operations that carry the token. N6
through N8 are canonical forms over values that do not vary between two runs
of one oracle, so their evidence is oracle-versus-engine pairs on the fixture.
Two findings there bear on this section. The composed adapter freezes the
capture clock; the historical N5 rule is nevertheless retired because it
could erase unrelated literal meaning. The
debug-page operations that N6 and N7 act on are the fixture's withheld set
(`fixtures/synthetic-v2/withheld`, development repository; not included) and
the public debug-page operations; the
public operations are graded in every checkout,
and a checkout that holds the withheld set re-measures the rest with the
commands given there.

N3 is not a mask and needs no nondeterminism evidence — it erases nothing,
and it canonicalises rather than hides. Its evidence is the environment
comparison of section 5 instead: the class-token order is what changes
between two Rubies of the same version on different operating systems, and
nothing else does.

Rules the first version applied and no longer does, because no oracle run
varies in them: hexadecimal object addresses (never present in any recorded
output), dropping a write answer's card id and trimming mail whitespace (no
verdict depended on them), and rewriting new rows' ids symbolically and
comparing timestamps as instants (the oracle's ids and timestamp text are
identical between runs; an engine that stores another text form, or assigns
other ids, differs from Ruby).

## 5. The Ruby oracle

The oracle and its adapters (`oracle/`, `adapters/ruby/`, `adapters/ruby-docker/`,
`adapters/ruby-mysql/`) are in the development repository and not included in
this package; this section describes how the committed expected outputs were
produced.

`oracle/` (development repository; not included) is a stock Decko application (`decko` 0.20.0, `card` 1.110.0, the
versions in `app/Gemfile.lock`, no local patches) plus three scripts:

- `build-deck.sh` / `build-deck.rb`: builds a fixture's deck (section 1).
- `run-adapter.sh` / `adapter.rb`: the reference adapter, under `decko runner`.
- `lib/harness_env.rb`: the frozen clock (`travel_to` the fixture clock), the
  fixture environment, local file storage, recaptcha off, no network, and the
  request boundary (`Card::Env.reset`, cache renewal, mail store cleared,
  `Card::Auth.signin`).

Renders run with `Rails.env` reporting production, as a served page does
(inline render errors without debug detail); asset outputs are never
recompiled during a session.

### The oracle contract

`oracle/contract.json` (development repository; not included) lists every way the oracle's process differs from a
stock deck served through Decko's controller, each with where it is set and a
class: `determinism` (pins a value that would vary between runs),
`configuration` (a value a deck operator sets), `request` (makes the runner
behave as one served request), `capture` (records mail instead of sending
it), `platform` (a host workaround that reaches no recorded byte), `fixture`
(a fixture data choice applied through Decko's own write path), and `patch`
(changes what Decko does). The stock oracle has no `patch` entry.

### The oracle's environment is part of the contract

Ruby Decko is the oracle, and **the operating system it runs on is part of
what the oracle is**. The same Decko at the same version renders the same
answers on stock Windows and on stock Linux **except** for the order of the
tokens inside a `class` attribute. Measured on `synthetic-v1`: of the
fixture's 1,752 render operations, **678** differ that way and **nothing else
differs** — every semantics operation and every scenario is byte-identical
after N1. (`tools/ruby-version-variance/evidence/class-order-linux-vs-committed.json`,
development repository; not included).

This is why a capture records its environment. `oracle/adapter.rb`
(development repository; not included) puts
`ruby`, `ruby_platform` and `ruby_engine` in its ready line, which
`run.mjs` copies into `run-meta.json` under `runs.<kind>.engine`, so every set
of recorded answers names the interpreter and platform behind it.

The canonical reference runtime is **Ruby 3.2.3 on a Linux machine**. The committed
`synthetic-v1` expected outputs keep their historical provenance: they were
captured on **Windows** (`ruby 3.3.12 [x64-mingw-ucrt]`), and changing the
reference does not recapture them. That historical capture is why the TS
engine matched them byte for byte and why N3 changes nothing about them. A capture on Linux Ruby is the
same fixture with the class-token order in the other order; N3 is what lets
the two be compared.

Note what a Linux capture does **not** give you for free: the deck it builds
is a different fixture. Decko's compiled asset files concatenate their parts
in a different order on Linux, so `deck/deck.sqlite3` and `deck/files/*` hash
differently and the fixture digest changes. Under this section's versioning
rule that is a new fixture name (`synthetic-v2`) with its own capture, not a
recapture of `synthetic-v1` — so the Linux answers were compared answer by
answer with the classifier rather than graded. What the engine must reproduce
is the answers modulo the three named normalisations, not one operating
system's choice of token order.

### Stock and patched expectations

`fixtures/<name>/expected/` holds the stock oracle's outputs, always. An
oracle that changes what Decko does (a gem patch, a changed mod
configuration, a monkey patch) is a **patched variant**: its outputs go in
`fixtures/<name>/expected-patched/<variant>/`, with every patch listed, and
are graded only by naming that directory (`--expected`). The grader labels
such a grade `PATCHED ORACLE "<variant>"` and records the variant in the
report; a stock grade is always available beside it.

Each expected directory has a `MANIFEST.json`
(`node runner/manifest.mjs expected <fixtureDir> <expectedDir> [--variant <name> --patches <file>]`):
the fixture digest it was captured on; the oracle's variant, patches and
contract (with its sha256); the engine's ready line and the per-kind run
records; the sha256 of every stored file and of its uncompressed content; and
its provenance (when and how it was captured, the hashes of any files it
supersedes, and the nondeterminism evidence of section 4). The grader
refuses expected outputs whose files do not match it.

Run natively (the reference runtime is Ruby 3.2.3; the historical
`synthetic-v1` capture used Ruby 3.3.12; `bundle install` in `oracle/app`) through
`adapters/ruby/adapter.json`, or in Docker (`oracle/`, `adapters/ruby/` and
`adapters/ruby-docker/` are in the development repository; not included).
The commands run from the root of a development repository checkout, written
`<repo>` where a command names a development-only path:

```
docker build -t decko-reference-oracle:0.20.0 <repo>/reference-harness/oracle
docker run --rm -v "$PWD/reference-harness/fixtures/synthetic-v1:/fixture" \
  decko-reference-oracle:0.20.0 bash /oracle/build-deck.sh /fixture
node reference-harness/runner/run.mjs --adapter <repo>/reference-harness/adapters/ruby-docker/adapter.json \
  --fixture reference-harness/fixtures/synthetic-v1 --out reference-harness/fixtures/synthetic-v1/expected
node reference-harness/runner/manifest.mjs expected reference-harness/fixtures/synthetic-v1 \
  reference-harness/fixtures/synthetic-v1/expected
```

## 6. Versioning

- **Protocol** (`"protocol": 1` in the ready line): bumped when a request or
  answer shape changes incompatibly. A runner refuses an adapter on another
  protocol.
- **Deck format** (`"format": "decko-reference-deck/1"`): bumped when
  deck.json's meaning changes.
- **Results format** (`"results_format": 2` in `run-meta.json`): bumped when
  what the runner records changes. The grader reads one format.
- **Fixture**: a fixture is immutable once its expected outputs are
  published. Its `MANIFEST.json`
  (`node runner/manifest.mjs fixture <fixtureDir>`, checked with `check`)
  lists the sha256 of every input file (deck.json, the built deck and its
  files, the upload sources, the operation lists) and one digest over them;
  results and expected outputs record that digest. A changed generator or
  operation list makes a new fixture name (`synthetic-v2`), so a pass rate
  always names exactly what it was measured on.
  **Declared re-pin.** One exception exists to "immutable", and it is for a
  deck that must change for privacy or packaging reasons, not for a deck
  whose answers changed. A fixture's built deck may be modified after its
  expected outputs are published when, and only when, all five of the
  following hold:

  1. **The change is out of the graded surface.** It removes content nothing
     grades — a table the operation list never reads or writes, a row the
     scenario steps never touch. It never alters a card, a render input, or an
     operation list.
  2. **A committed script performs it**, and is the record of what was done.
     Re-running the script on a deck it has already processed is a no-op, so
     the change is auditable rather than asserted.
  3. **The manifest is re-pinned to the new fixture digest** in the same change,
     by `manifest.mjs fixture` as above, so the tree and its digest never
     disagree.
  4. **The expected directory's manifest carries a `provenance.repin` entry**
     naming the date, what changed, why, and the **previous fixture digest**,
     so a reader can tell a re-pinned fixture from a recaptured one. Re-pinning
     is not re-capture: the `captured` field still describes when the oracle's
     answers were captured, and the two dates are not the same event.
  5. **The grade is re-run against the re-pinned fixture**, and the passing
     result is what the public figure quotes. The grader's refusal 5 (this
     section) means a run recorded against the old digest is not a grade at
     all, so a re-pin without a re-run leaves the fixture ungraded rather than
     quietly graded.

  A re-pin that changes a graded input is not a re-pin; it is a new fixture
  (`synthetic-v2`) with its own capture. The one re-pin this repository has
  made is `synthetic-v1`
  (`reference-harness/corpus/drop-private-app-tables-from-fixture-decks.mjs`,
  development repository; not included), described under `provenance.repin` in that fixture's `expected/MANIFEST.json`;
  it dropped eight unused, empty tables from the deck file's schema; no
  operation reads or writes them. The grade re-run against the re-pinned fixture is
  1,754 / 1,754 renders and 2,389 / 2,389 semantics comparisons, the figures
  the coverage inventory (`docs/coverage-inventory.md`, development repository;
  not included) quotes. The fixture's operation files hold 1,752 render and
  2,388 semantics operations; the grade counts one more of each kind for every
  scenario step that is itself a render (two) or an `ask` (one), so 2,388
  operations become 2,389 graded semantics comparisons.

  **Declared withholding.** A recorded answer that cannot ship publicly (it
  carries the capturing machine's filesystem, say) is never rewritten. The
  whole operation and its whole recorded answer move, lines byte-identical,
  into the fixture's `withheld/` set: `withheld/ops/<kind>.jsonl`,
  `withheld/<expected dir>/<kind>.jsonl[.gz]` and `withheld/withheld.json`
  (`{label, why}`). `withheld/` is excluded from every exported source package. The
  fixture manifest pins the set under `withheld` (its label, operation counts
  and file hashes, which also enter the digest, so the fixture's identity is
  the same with the set or without it), and the move is re-pinned like a
  re-pin above, disclosed under `provenance.withheld` in the expected
  manifest. With the set present the runner runs its operations after the
  public ones and the grader grades them against its recorded answers;
  absent, the runner, the grader and `manifest.mjs check` print
  `[withheld: <label>] NOT RUN: <n> ops (<path>)`, and a run made
  with the set is refused by a grader without it, and the reverse. Re-pin with
  the set present (`manifest.mjs fixture` reads it from disk; without it the
  previous declaration is kept, unverified). `synthetic-v2` withholds eight
  admin error-view renders this way (`[withheld: machine-specific
  backtraces]`): card-mod-format's `set/all/html/error.rb` shows an admin
  the exception backtrace, so their recorded bytes carry machine paths.
- **Oracle**: expected outputs record the oracle's versions, variant and
  contract in their manifest. Capturing against another Decko release makes a
  new fixture name.
- **Lane expectations** (`expected-lanes/<lane>/`): for database lanes other
  than SQLite (MySQL, PostgreSQL), expected answers come from Ruby Decko
  running on that same database. Where Ruby's SQL leaves row order to the
  database (no ORDER BY, or ties under an ORDER BY), the order the database
  returns is Ruby's real behaviour on that lane. Lane expectations are
  recorded by running the oracle on that database, and are never copied from
  the port.

  A lane's overlay lives in `fixtures/<fixture>/expected-lanes/<lane>/`, in
  the expected-output shape (`<kind>.jsonl[.gz]`, `run-meta.json`,
  `MANIFEST.json`), recorded by running the stock oracle on that database. The
  overlay holds every op whose lane result differs from the base expectation
  under the grader; every op it does not hold falls back to the base
  expectation. Its manifest carries `lane.name`, `lane.db` (the database engine
  and version), `lane.oracle_tables` (the oracle's tables on that database, read
  from the lane's own schema; the grader compares those tables and reports every
  other table as engine-only), and a `provenance.lane` block naming the oracle,
  the run it came from, the rule for which ops it holds and the measured causes.
  `manifest.mjs expected --lane <name> --lane-db <engine/version>` writes it.
  The grader takes the lane from `run-meta.json` (recorded from the adapter's
  `lane` field) or from `--lane`, refuses a `--lane` that disagrees with the
  recording, validates the overlay against its own manifest, the fixture digest
  and its file hashes, and reports `lane.overlay_ops` per kind.

  The overlay is a lane's expectations, not a lane's excuses: an operation the
  port answers differently from the oracle on the same database still fails. A
  port difference is a finding, never an overlay entry.

  `synthetic-v1` has a `mysql` lane (`expected-lanes/mysql/`), recorded on
  MySQL 8.4.11 with the Ruby 3.3.12 oracle of the historical capture
  (the canonical reference runtime is now Ruby 3.2.3 on a Linux machine)
  (`reference-harness/adapters/ruby-mysql`, development repository; not
  included). It holds 6 render, 3 semantics and
  11 scenario ops: the `Not Topics` search's ties (6 render, 3 semantics) and
  the id allocation of the scenario writes (MySQL's auto-increment hands out
  ids the SQLite recording does not; the port's own id allocation on that lane
  diverges and is recorded in `KNOWN_FAILURES.md`, development repository;
not included).

## 7. Writing an adapter for another engine

1. Read `HARNESS_DECK_JSON`; pin the engine's clock to `clock` and apply
   `environment`.
2. Open `HARNESS_DECK` (Decko's SQLite schema) and serve files from
   `HARNESS_FILES`.
3. Print the ready line, then answer requests until `quit`.
4. Run `run.mjs` with your manifest, then `grade.mjs`.

Python and Go need only a JSON library, a line reader, and the engine.

## 8. Browser scenarios

The adapter protocol asks an engine questions directly. Browser scenarios ask
what a user sees: a hidden browser clicks through each engine's own pages,
served over HTTP, and the engines are compared on the result.

The browser scenario tools under `browser/` (journeys, engine servers,
runners, comparison, the Capybara driver and the cucumber app) are in the
development repository and not included in this package; of `browser/`, the
package includes only `browser/lib/journey-provenance.mjs`.

### Journeys

`browser/journeys/<fixture>.json` (development repository; not included)
lists journeys as plain data:
`{"id", "covers": [...], "steps": [...]}`. Each journey runs on a fresh copy of
the built deck, a freshly started server and a fresh browser profile. A step
is one object with one key:

| step | meaning |
|---|---|
| `visit` | load a path |
| `signin` | sign in as an actor of `deck.json`, through the sign-in form |
| `click`, `fill`, `type`, `check`, `uncheck`, `select`, `upload` | act on a target: `{link}` or `{button}` (visible text), `{css}`, `{name}`, `{field}` (a Decko field by card name, found the way Decko's own steps find it), `{text}`; optional `within` (css). `fill` and `type` take `value`, `select` takes `option`, `upload` takes `file` (from `browser/files/`) |
| `editor` | set an editor's content by field name, as Decko's own steps do (ace, then TinyMCE, then the plain field) |
| `press` | press a key in the focused element |
| `wait` | wait for `{text}` or `{css}` |
| `window`, `close_window` | open or switch to a named second window (same cookies); close it |
| `mail_link` | follow a link from the latest mail whose subject matches |
| `observe` | record what the user sees, under a label |

After each action the runner waits until the page has loaded and jQuery has no
request in flight. A failing step ends the journey; the page at that moment is
recorded as an observation.

### Engine servers

`browser/engines/<engine>.json` (development repository; not included) names a command that serves a deck copy on
`127.0.0.1:$HARNESS_PORT` (environment as in section 2, plus `HARNESS_PORT`)
and answers `GET /__harness/ready` and `GET /__harness/mail` (the mail sent
since the last call, drained). The Ruby server is the stock oracle app behind
Decko's own controller, with the deck origin set to the server's own address
and a fixture secret for account tokens (a deployed deck's credentials). The
TS server is the port's own Node host (`vm-staging-server.mjs`) in its stock
deck profile (`DECKO_DECK_PROFILE=stock`): flat engine views with no bound mod
loader, as the edge hosts render; no production asset rewriting; Decko's
routes for new cards, the sign-in card's own form, ajax requests answered
without the layout, and the mods' public files served from
`DECKO_MOD_PUBLIC_DIR` (the oracle app's `public/`, development repository;
not included; the same files Ruby serves). Both sign tokens with the same fixture secret.

### What is compared

Per journey: completion (every step ran); which editor (TinyMCE, ace or the
plain field) took each `editor` step's content; every observation on four
aspects (address: path, query and HTTP status; text; structure; form fields);
the mail sent; and the row delta in Decko's card tables, compared under the
borrowed harness form N2 (`stable`, section 4.1), with timestamps and password
digests masked, because a browser session cannot pin both engines' clocks. Observations are normalised by B1-B5 (`browser/lib/observe.mjs`,
development repository; not included):
rendered text with whitespace collapsed and dates, durations and relative ages preserved;
the main area's element tree as tags and sorted classes, with per-render random
classes masked; the visible form controls; the URL without its host.

A journey that fails on the reference is a broken journey: reported, never
graded.

### Running

Everything, one engine at a time (Ruby journeys, TS journeys, the comparison,
then Decko's own cucumber browser scenarios on stock Ruby; every script below
is in the development repository and not included). The commands run from the
root of a development repository checkout, written `<repo>` where a command
names a development-only path:

```
node <repo>/reference-harness/browser/run-all.mjs --out <dir> --decko <decko git checkout>
```

Or step by step:

```
node <repo>/reference-harness/browser/run-journeys.mjs --engine <repo>/reference-harness/browser/engines/ruby.json \
  --fixture reference-harness/fixtures/synthetic-v1 \
  --journeys <repo>/reference-harness/browser/journeys/synthetic-v1.json --out <rubyDir>
node <repo>/reference-harness/browser/run-journeys.mjs --engine <repo>/reference-harness/browser/engines/ts.json ... --out <tsDir> [--signin direct]
node <repo>/reference-harness/browser/compare-journeys.mjs --expected <rubyDir> --actual <tsDir> --report report.json
```

`--signin direct` sends Decko's sign-in request without the form, so the rest
of a journey still runs on an engine whose sign-in page differs. `--html 1`
also saves every observed page's DOM under `<out>/<journey>/`. The TS server
needs the port built into `dist/` (`npm run build:engine`).

The browser is an installed Chrome, Edge or Chromium driven through
playwright-core (`HARNESS_CHROME`, `HARNESS_PLAYWRIGHT_CORE`), headless, with
a throwaway profile; nothing is downloaded. Requests to hosts other than this
machine are refused, except the public script and font CDNs a stock Decko
layout links (jQuery, jquery-ujs, ace, select2, icon fonts), without which
Decko's editors do not run on any engine; `HARNESS_OFFLINE=1` refuses those
too.

`browser/capybara/` (development repository; not included) holds a Capybara driver over the same browser, so Decko's
own cucumber features run without a WebDriver binary, from a development
repository checkout written `<repo>`:
`cucumber -r <decko>/features -r <repo>/reference-harness/browser/capybara/register.rb`.
`browser/cucumber/run-features.mjs --decko <checkout> --out <dir>`
(development repository; not included) runs the
`@javascript` features of the release (`--ref`, default `v0.20.0`) on the
installed, unpatched gems: `browser/cucumber/app` is a stock deck in the
cucumber environment whose database, cache, files and mod public files live in
a work directory removed on exit. It records every scenario's result in
`<dir>/summary.json`.

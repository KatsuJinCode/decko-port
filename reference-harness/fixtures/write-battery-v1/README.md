# write-battery-v1 — the synthetic deck the write batteries run on

One committed synthetic deck plus the Ruby reference's recordings beside it.
It is the starting state for two deep write-parity instruments:

- the 70-operation write probe — `tests/tools/persist-write-probe.test.ts`
  (development repository; not included), comparing every operation's row
  delta with `expected/persist-steps/`;
- the 90-step side-effects scenario battery —
  `tests/tools/side-effects-scenario-battery.test.ts` (development repository;
  not included), comparing the engine's trace with
  `expected/side-effects-ruby.json` through
  `tools/parity-side-effects/compare.mjs` (development repository; not
  included).

Everything here is synthetic: invented names, example.com addresses,
fixture passwords, a generated deck on top of a stock Decko seed.

The two batteries are not included in this package; they live in the
development repository. What this package gives you is the input data: the
built deck as a starting state and the Ruby reference's recorded answers for
it. Another engine can load the deck, apply the same write operations, and
compare its own row deltas and side-effect trace with the recordings here.
Reading or using the data needs no Ruby install and no private deck.

## Layout

| path | what it is |
| --- | --- |
| `deck.json` | the fixture's plain-data deck description (generator output) |
| `deck/deck.sqlite3`, `deck/files/` | the built deck: a stock `decko setup` seed with `deck.json` applied by the Ruby reference's deck builder, assets pre-compiled |
| `expected/persist-steps/step-NN.json` | the Ruby reference's state after each public write operation (every step the withheld set does not claim) |
| `expected/persist-steps/ruby-outside-delta.json` | the rows the operations wrote outside the probe's own records (Ruby's whole-deck delta) |
| `expected/persist-steps/deliberate-differences.json` | the declared engine differences on this deck (step 7, and step 67) |
| `expected/side-effects-ruby.json` | the Ruby reference's recorded trace of the public scenario steps |
| `withheld/steps.json` | the withheld probe steps, and why (not included) |
| `withheld/persist-steps/` | the Ruby reference's recording of the full 70-step op list, made with the withheld set present (not included) |
| `withheld/side-effects-ruby-steps.json` | the Ruby reference's recording of the withheld scenario-battery steps, cut from the full-list trace (not included) |
| `MANIFEST.json` | the sha256 of every public file above and how each recording was made |

## The withheld step set

Some write steps are withheld from this package because they reproduce a
known upstream security issue. They live in `withheld/`, which this package
does not include.

The probe loads `withheld/steps.json` only when it is present. Absent it — the
packaged case — the probe runs the public op list and prints
`[withheld until disclosure] NOT RUN: <n> steps (<path>)`. Present it, the
probe runs all 70 steps and compares them against `withheld/persist-steps/`.

That is why the public recording is a separate cut. Every recorded dump
carries the whole deck state, so a step that stores withheld content would
leave it in all fifty later dumps. The public recording is therefore made over
the public list, not trimmed out of the full one; re-record it the way
section 4 below describes, with `withheld/steps.json` moved aside.

## How it was built and recorded

All three steps run under the Ruby reference, stock decko 0.20.0 / card
1.110.0 (`reference-harness/oracle/`, development repository; not included);
the exact commands and durations are
recorded in `MANIFEST.json`'s `provenance`. The scripts and the Ruby
reference application these steps use are `reference-harness/corpus/`,
`reference-harness/oracle/`, `tools/parity-side-effects/ruby/` and
`tools/persistence/` (development repository; not included). The commands
run from the root of a development repository checkout, written `<repo>`.

1. Generate and build the deck:

       node <repo>/reference-harness/corpus/generate-write-battery-deck.mjs reference-harness/fixtures/write-battery-v1
       bash <repo>/reference-harness/oracle/build-deck.sh reference-harness/fixtures/write-battery-v1

2. Load the data that the account and email mods declare into the built
   deck with `tools/parity-side-effects/ruby/seed.rb` (development
   repository; not included), which uses the same
   loader as `decko update`. The stock seed's template cards lack that
   data: the email stylesheet card is RichText instead of SCSS, so every
   notification mail fails to render. The loaded copy becomes the fixture
   deck:

       cd <repo>/reference-harness/oracle/app
       bundle exec ruby <repo>/tools/parity-side-effects/ruby/seed.rb . \
         <repo>/reference-harness/fixtures/write-battery-v1/deck/deck.sqlite3 <work dir>
       # <work dir>/ruby-deck.sqlite3, checkpointed, is committed as
       # deck/deck.sqlite3

3. Record the 90-step scenario trace (the drive's own setup finds the baked
   accounts and adds nothing, so the start deck it writes is byte-identical
   to the committed deck):

       cd <repo>/reference-harness/oracle/app
       bundle exec ruby <repo>/tools/parity-side-effects/ruby/drive.rb . \
         <repo>/reference-harness/fixtures/write-battery-v1/deck/deck.sqlite3 <work dir>
       # stdout is the trace committed as expected/side-effects-ruby.json

   The drive boots the Ruby reference under `RAILS_ENV=production` with the stock
   production configuration, as a deployed Decko site runs: rescue_all in
   the controller and no developer exception page, so a failed step records
   the public "Wild Card!" page and no backtrace; the first request's asset
   refresh (`asset_refresh :cautious`); and minified script assets
   (`compress_assets true`, Uglifier). The trace's `environment` field
   records those settings, and the drive refuses to run without them. The
   trace records no exception messages or backtraces at all, so it carries
   no machine path.

4. Record the 70 write operations (one `decko runner` process per step):

       bash <repo>/tools/persistence/run-ruby-steps.sh <repo>/reference-harness/oracle/app \
         reference-harness/fixtures/write-battery-v1/deck/deck.sqlite3 <out dir> 70

Rebuilding the deck reproduces it row for row: the generator is deterministic
and the builder freezes the deck.json clock, so even the account salts are
stable. The manifest pins the recorded bytes.

The build path recorded above and in `MANIFEST.json`'s `provenance` is the
stock Ruby reference (`reference-harness/oracle/build-deck.sh`, then
`seed.rb`; development repository; not included) against decko 0.20.0 /
card 1.110.0, and that path creates only the tables stock Decko creates. An
earlier copy of the committed deck file's schema also contained some unused,
empty tables. A committed script
(`reference-harness/corpus/drop-private-app-tables-from-fixture-decks.mjs`,
development repository; not included) removed them, so the committed deck is
now what the recorded build produces. No operation or recording ever read or
wrote those tables.

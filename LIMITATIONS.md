# PHASE TWO ROADMAP: capabilities beyond parity

Prepared 2026-11-03 from the round-two review of release source
`0c86df99d08f3e665573fcc77348d6c62c8538ae`.

## TWO PHASES

**PHASE ONE — PARITY: the source package shipping now.** Recorded development
comparisons matched the synthetic deck across rendering, semantics,
persistence and side effects, and the recorded browser journeys. Hosted
Bunny (bunny.net) verification now also includes an in-Edge transaction matrix,
real account and follower mail delivery, and request-driven cleanup. The
application comparison and exact source scope are recorded in
[VERIFICATION.md](VERIFICATION.md). These are the measured successes described
in [VERIFICATION.md](VERIFICATION.md). The full test gate ran on earlier development
source with failures and skips, followed by targeted corrections; it is not
a fresh complete passing run of this export. This document does not certify
zero-stale packaging or turn those scoped receipts into complete parity
for every real deck.

**PHASE TWO — OPTIMIZATION ROADMAP: tracked post-release work.** The 22 items
below retain their named capability and verification limits. They organize
the next phase; they are not a demand to finish every item before this
private release. Placing a limit in phase two does not establish a capability
or a check that has not been demonstrated.

1. **One-click setup is not delivered in this package.** It ships developer commands. It does not contain the promised Cloudflare deployment configuration or the Bunny browser configuration and provisioning flow. Bunny deployment uses tools kept outside this release.

2. **Automatic recreation of an entire deployment is not delivered.** The promised provisioning payload that also serves as a complete disaster-recovery artifact is not included. Local database-and-file recovery tools are included.

3. **Free or roughly $1-per-month hosting is not demonstrated.** There is no representative workload measurement establishing that price, including database usage, files, mail and other services. The limited hosted checks do not establish an ongoing operating cost.

4. **The speed and resource-saving promises are not established.** The release does not demonstrate faster responses, lower cold-start time, lower CPU or memory use, or the claimed energy reduction. Existing development measurements of database requests do not establish those other benefits.

5. **Constant database requests regardless of nesting depth is not a general result.** Batching exists, but its benefit depends on the page and available reference information. Development records show depth-dependent fallback paths. The benchmark and Ruby-versus-TypeScript comparison tools do not ship.

6. **"Compatible with every provider" remains unproven.** Database adapter code and selected tests exist. That does not establish complete applications on every named provider. Native Bun, Deno, Fastly and general hosted libSQL deployment are not qualified by this package's evidence.

7. **Bunny evidence covers the named isolated checks.** The in-Edge database matrix, actual account and follower mail, request-driven session and draft cleanup, and application comparison are described in VERIFICATION.md with their source identities. These results do not establish every page or operation on arbitrary decks, separate-isolate contention, or sustained performance and cost.

8. **Cloudflare verification is narrower still.** A real D1 database driver test passed. A complete application deployed on Workers—with realistic pages, writes, files and operating-cost measurements—has not been demonstrated. D1 testing is not equivalent to testing the whole Cloudflare deployment.

9. **"Same data, no migration required" is not established.** Passing database tests does not prove that the port can take over an arbitrary existing Decko database unchanged. Database rules differ, and the port has its own session and data-version mechanisms.

10. **Seamless migration of existing decks is not established.** Importer source exists, but the release does not prove complete migration of real users, original passwords, attachments, revisions, references, permissions, custom mods and integrations. The original large-deck migration claim cannot be presented as proven compatibility.

11. **Safe live comparison and cutover are not a delivered workflow here.** Development shadow-routing tools exist, but they are excluded from this package. The release does not demonstrate a complete production transition between Ruby and TypeScript without duplicated writes or side effects.

12. **Recovery has practical limits.** The supplied recovery tools work with isolated SQLite database and file copies. Writers must be paused. Changes made after the snapshot require reconciliation; restoring a snapshot does not automatically merge them. A complete hosted recovery and rollback procedure is not established.

13. **Existing Ruby mods do not run unchanged.** Third-party Ruby mods require porting. The experimental Ruby loader is not used by the supplied hosts and does not establish compatibility with arbitrary Ruby libraries, Rails extensions or templates.

14. **The TypeScript extension language does not reproduce every Ruby capability.** Some Ruby-generated accessor methods, arbitrary method overrides and asynchronous helper patterns are not supported by the declared interface. There is no published, measured compatibility rate for the wider mod ecosystem.

15. **The promised first-class Ruby offering is not included in this delivery.** Ruby remains the reference implementation. Ruby batching improvements and shared comparison tooling exist in the development project, but the Ruby gem and Ruby-side adapters are excluded from this release.

16. **Complete behavioral equivalence is not proven.** The recorded comparisons cover selected synthetic inputs and browser journeys. They do not establish every query, permission combination, name, view, format, mod, event or real deck. Some comparisons use settings that differ from the normal deployment defaults. The browser comparison also does not inspect every output attribute.

17. **There are deliberate behavior differences.** These include sign-in errors and protections, session invalidation, password storage, handling of certain Ruby crashes, generated asset names and optional notification behavior. Ruby's request-order-dependent view-cache behavior is not reproduced. Some database ID and rollback behavior differs. Stronger password storage can prevent Ruby from reading subsequently upgraded passwords. These differences are documented; they still qualify the original "same behavior" promise.

18. **Mail and background work have specific demonstrated mechanisms.** The tested Bunny host delivers mail over authenticated HTTPS and runs session/draft cleanup on requests. Delivery to its persistent test receiver, actual account links, and cleanup were observed. This does not establish delivery to mailbox providers, a general delayed-job queue, or recovery after process failure. The supplied Node host still captures mail for testing or sends nothing unless a host integrates a transport.

19. **The supplied local host is not a finished public-site setup.** Writes and initial owner setup need configuration. Mail, public addresses and editor assets also need configuration. The current corrected export passed the documented health, Home-page and graceful-shutdown check on Windows with Node 24.22.1; that local check does not establish a public-site configuration.

20. **The final package has not passed a fresh complete test suite.** The full run and later correction runs are genuine, but concern identified development versions. They are not a new all-green run of this export. Private-input checks remain unavailable. The recorded browser and synthetic comparisons likewise do not certify every behavior of the final package.

21. **Recipients do not receive the complete verification system.** The package includes synthetic fixtures and a comparison runner, but excludes the full development suite, browser-journey definitions, run records, Ruby comparison environment and upstream Gherkin feature files. Its `npm test` is a small packaging-and-rendering check.

22. **The promised production-proven handoff is not established.** The evidence does not show that this exact release has operated flawlessly as a complete production replacement. It supports a substantial implementation for developer evaluation, with narrower measured successes.

These conclusions come from the inspected package and its evidence, deployment instructions, declared differences and retained development records. They do not imply that the unproven capabilities necessarily fail. What you can accurately deliver: a substantial TypeScript port with working comparison tools, recorded compatibility results, database checks and the documented isolated Bunny application results—with the above shortcomings stated plainly. That is meaningful work. It is a smaller delivery than the turnkey, broadly compatible replacement described in issue 1282.

The existing private-disclosure condition in [docs/CHANGES-FROM-RUBY.md](docs/CHANGES-FROM-RUBY.md)
still applies before publication.

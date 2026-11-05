# Architectural Differences and Changes from Ruby Decko

The TypeScript implementation is an independent port with modern runtime and storage abstractions, not an in-place Ruby interpreter replacement. This document registers the intentional architectural differences and behavioral distinctions between this port and upstream Ruby Decko (0.20.0 / card 1.110.0).

Detailed verification results are documented in [VERIFICATION.md](../VERIFICATION.md). Fine-grained per-module citations and difference annotations are inventoried in [RUBY-MAP.md](../RUBY-MAP.md).

---

## Summary of Differences

| Area | Architectural Difference & Rationale | Affected Modules |
| --- | --- | --- |
| **Name Algebra** | ActiveSupport inflection rules and Cardname parsing are implemented in TypeScript. Unicode handling and casing match canonical specifications. | `src/card/name/` |
| **Rendering** | Views are pure TypeScript functions with mod composition chains rather than Ruby HAML dynamic method synthesis, enabling execution on V8 and edge runtimes. | `src/card/render/`, `src/card/mod-loader/` |
| **SQL Abstraction** | Pluggable SQL driver interfaces replace ActiveRecord. Drivers provide connection pooling, transaction lifecycle management, and dialect generation. | `src/server/driver.ts`, `src/server/drivers/` |
| **Save Pipeline** | Transactions report unknown outcomes explicitly on unacknowledged writes rather than presuming rollback, preventing duplicate side effects. | `src/card/actions/save-outcome.ts` |
| **Attachments & Storage** | Pluggable blob storage adapters (local, memory, S3/R2, Edge HTTP) replace direct Ruby filesystem writes. | `src/card/attachments/`, `src/blob/` |
| **Authentication & Hashes** | Verifies legacy SHA-1 passwords and automatically upgrades stored credentials to PBKDF2 on successful authentication. | `src/card/auth/password-hash.ts` |
| **Security & Sessions** | Constant-time credential comparisons, sign-in rate limiting, and explicit token revocation harden account security. | `src/card/auth/` |
| **Jobs & Notifications** | Edge delayed work adapters handle scheduling and delivery. Notification links omit the extraneous redirect suffix to match upstream behavior. | `src/card/delayed-job/`, `src/card/notify/` |
| **Strict Parity Flags** | Five optional flags (`DECKO_STRICT_PARITY_*`) allow choosing between hardened behavior (default) and exact upstream Ruby response formats. | `src/card/parity/strict-parity-flags.ts` |
| **Mod DSL** | TypeScript Mod DSL uses explicit typing, synchronous format helpers, and registered view predicates. | `src/card/mod-loader/mod-dsl.ts` |

---

## Strict Parity Configuration Flags

The engine provides five configuration switches to control strict compatibility behavior:

1. `DECKO_STRICT_PARITY_MAIL_UNFOLLOW_REFUSAL` (Default: `on`):
   When enabled, mail unsubscribe clicks refuse unauthenticated requests with HTTP 403, matching recorded reference behavior.
2. `DECKO_STRICT_PARITY_SIGNIN_DETAILED_ERRORS` (Default: `off`):
   When disabled, returns hardened uniform error messages for failed sign-ins. When enabled, produces per-field error messages matching Ruby Decko.
3. `DECKO_STRICT_PARITY_REVISION_RESTORE_500` (Default: `off`):
   When disabled, handles invalid revision restorations gracefully. When enabled, replicates upstream 500 error on invalid file revision restore.
4. `DECKO_STRICT_PARITY_SKIN_CREATE_500` (Default: `off`):
   When disabled, returns standard validation errors on invalid skin parents. When enabled, replicates upstream 500 error.
5. `DECKO_STRICT_PARITY_SCRIPT_BUNDLE_CLOCK_NAMES` (Default: `off`):
   When disabled, bundle filenames derive deterministically from asset content hashes. When enabled, replicates Ruby wall-clock second naming.

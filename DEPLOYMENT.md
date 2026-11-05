# Deployment configuration

Hosts read these settings from their environment when the deck boots. Each is
independent of the others. A value a setting does not accept is refused with
an error rather than ignored, except where a table below says otherwise.

## Settings for a comparison with a running Ruby Decko site

A comparison of a deployed port with a running Ruby Decko site of Card
1.110.0 / Decko 0.20.0 (on a Linux machine with Ruby 3.2.3), used as the
comparison reference, needs these two settings:

| Setting | Accepted values | Default | Value for this comparison | Reason |
| --- | --- | --- | --- | --- |
| `DECKO_SERIALIZER_ERA` | `stock` or `live` | Unset means `stock`; the Node host also treats a blank value as unset | `live` | `live` selects the newer slot output: the slot's `show` option is emitted only when it has something to list, and bar classes are emitted in the reference's newer order. `stock` keeps the older output. |
| `DECKO_HAML_SLOT_STYLE` | `hash` or `separate` | `hash` (any value other than `separate`, including unset, means `hash`) | `hash` | The reference's stock Haml bar template includes the slot ID in its data hash, producing single-quoted attributes. `separate` emits the slot ID as its own double-quoted attribute, which matches a different site's template. |

The 52 browser journeys in [VERIFICATION.md](VERIFICATION.md) passed against a live
Ruby 3.2.3 reference with `DECKO_SERIALIZER_ERA` at its default, `stock`,
because the journey checker compares page structure as element tags with
their class tokens sorted, and leaves data attributes out (rule B3 in
reference-harness/browser/lib/observe.mjs at the measured tree; development
repository; not included), so neither of the two
differences `live` selects (the order of class tokens, and the slot's `show`
option, which is carried in a data attribute) can reach it. A byte-for-byte
comparison of pages does see them.

Set both explicitly for this comparison. They are independent of the deck's
data, origin, assets, permissions and strict behavior switches. They do not
change global defaults or establish compatibility for another deployment.
Keep credentials outside the source package. Before sending comparison
requests, confirm that the serving build was made from a clean, identified
commit.

During development, RichText pages on a hosted deployment of the port on the
Bunny (bunny.net) edge platform, served with `DECKO_SERIALIZER_ERA=live` and
`DECKO_HAML_SLOT_STYLE=hash` from a clean, identified build, were observed to
match the reference in both full and core views under the existing N1/N3
normalization. That earlier RichText observation used a development build;
its record remains in the development repository and is not included here.
It covers only those pages and settings.

Separately, on 2026-11-03, the database conformance and matrix suites passed
against real Bunny Database using development source. The hosted page
comparison used the exact release engine bytes, with all 364 release `src/`
files hash-verified into the deployment inputs, and matched its local render
except six generated slot IDs. These are distinct source attributions;
[VERIFICATION.md](VERIFICATION.md) records both and their limits. Deploying to Bunny
uses `docs/deploy-bunny.md` (development repository; not included);
this package ships the engine without a provisioner by design.

Subsequent hosted application, transaction, mail and cleanup evidence is in
[VERIFICATION.md](VERIFICATION.md). The canonical browser journeys are in [verification/synthetic-v1.json](verification/synthetic-v1.json).

## Ruby's view cache

Comparisons of the behavior the port and Ruby Decko share are made with Ruby
view caching turned off. The TypeScript renderer produces fresh context
instead of reproducing Ruby's historical cached placeholders. With Ruby view
caching on, a request for the titled view made first can leave
`name_context` in a later core response; requesting the core view first can
leave empty context in a later titled response. Ruby's cache key omits that
context while the cached placeholder retains it.

This mechanism was observed during development in Ruby runs on a Linux
machine, each in a fresh process with its own cache: a fresh process asked
for the core view first omits `name_context`, and Ruby adds it only after a
full page has filled its view cache. Those are development observations:
their records are kept in the development repository, no record of them
ships with this package, and they are not among the results in
[VERIFICATION.md](VERIFICATION.md).

This request-order-dependent behavior with the cache on is a known difference
the port does not reproduce. A match on views rendered with an empty cache,
or a match with Ruby's view cache turned off, does not show that the port
matches Ruby with the cache on. Do not add a context member to every core
slot or change normalization to conceal this difference.

## Other deployment settings

These rows describe this package's Node host (vm-staging-server.mjs) and the
engine modules it calls; a host outside this package may read them
differently.

| Setting | Accepted values | Default | Purpose |
| --- | --- | --- | --- |
| `DECKO_PASSWORD_HASH` | `pbkdf2` or `legacy-sha1` | Unset or blank means `pbkdf2`, except that the Node host (vm-staging-server.mjs) chooses `legacy-sha1` when it detects a database shared with Ruby Decko | How newly set passwords are stored. `pbkdf2` stores PBKDF2-HMAC-SHA256 and upgrades older digests when a user signs in. `legacy-sha1` stores Ruby Decko's own digest and upgrades nothing; a deck that Ruby Decko also serves needs it, because Ruby cannot verify a PBKDF2 record. |
| `DECKO_DECK_ORIGIN` | An absolute `http://` or `https://` origin with no user name, password, path, query or fragment (one trailing slash is accepted) | Unset: no origin is configured, and links the engine builds are root-relative (for example `/User`), as Ruby Decko's are with no `deck_origin` and no request | The site address the renderer puts in front of the links it builds, matching Ruby's `deck_origin` setting. |
| `DECKO_PUBLIC_PAGE_SHELL_FILE` | The path of a JSON file with `version` 1, a `header` string that is one `<header>…</header>` element, a `footer` string that is one `<footer>…</footer>` element, and a `headers` object of HTTP response headers | Unset: pages keep the header and footer the engine renders, and no headers are added | Gives anonymous HTML page views (GET requests from visitors who are not signed in) a deployment's own header and footer, and adds the listed response headers to those pages. |
| `DECKO_SERVED_FOOTER_VERSION_PIN` | A version such as `1.2.3` or `1.2.3-rc.1` | Unset or blank: the footer is left as written | Replaces the version in the shell footer's "Decko v…" link text. It applies only when `DECKO_PUBLIC_PAGE_SHELL_FILE` is set. |
| `DECKO_LEGACY_ASSETS_FILE` | The path of a JSON file with `version` 1, an `assetOrigin` (an `http://` or `https://` origin), and optionally `stylesheetPath` and `scriptPath` (each `<cardId>/<revision>.css` or `.js`), `footerSlotId` (20 lowercase hexadecimal digits) and `revisions` (a map from one served asset path to another revision of the same card) | Unset: the page shell links no main stylesheet or script, no asset revision is rewritten, each footer gets a fresh random slot ID, and a placeholder asset origin is used | For a deployment that presents an existing site's pages: names the site's main stylesheet and script asset cards, the origin its asset files are served from, the asset revisions to serve in place of stored ones, and the footer slot ID the site printed. |

## Host, account, mail and file settings

These rows also describe this package's Node host (vm-staging-server.mjs) and
the engine modules it calls. A setting marked "Node host" is read by that host
only; a host outside this package may read it differently or not at all.

| Setting | Accepted values | Default | Purpose |
| --- | --- | --- | --- |
| `DECKO_WRITE_PATH` | `1` turns it on; any other value is off | Off: the deck database is opened read-only and card create, update and delete requests are refused (405) | Turns on saving cards through the site. The account links the deck emails (verification and password reset) keep working while it is off. |
| `DECKO_FIRST_RUN` | `1` turns it on; any other value is off | Off: the `/setup` page does not exist (404) | Opens the `/setup` page where the first owner account is created, while the deck has no owner. It needs `DECKO_WRITE_PATH=1` as well. On the Node host, a completely empty deck is also given Decko's default cards at start. The page closes for good once an owner exists. |
| `DECKO_SETUP_TOKEN` | Any non-blank text | Unset: the Node host generates a one-time token at each start and prints it once on its console; a restart generates a new one | The token `/setup` requires before it creates the owner, so reaching a new deck first is not enough to own it. Only used while `DECKO_FIRST_RUN=1`. |
| `DECKO_TOKEN_SECRET` | Any text; use a long random value | Unset: a new random secret at every start (Node host) | Signs the account verification and password-reset links the deck emails. With it unset, links emailed before a restart stop working after the restart. The Node host uses a blank value as given rather than replacing it, so never set it blank. Keep it out of the source package. |
| `DECKO_CSRF_SECRET` | Not read | Not applicable | Not read by this package. Earlier versions signed form tokens with it; the write path now carries no form token and checks the request's origin instead (`DECKO_ORIGIN_CHECK`), so setting it has no effect. |
| `DECKO_COOKIE_SECURE` | `auto`, `always` or `never` | `auto` (unset or blank) | Whether the session cookie is marked Secure (sent only over HTTPS). `auto` marks it when the request arrived over HTTPS, either directly or with `X-Forwarded-Proto: https` from a proxy; `always` marks it on every response, for a proxy that forwards no scheme; `never` never marks it, for local HTTP testing. |
| `DECKO_ORIGIN` | An absolute address such as `https://deck.example.org`; the Node host does not check it | `http://127.0.0.1:<port>`, the Node host's own loopback address | The site address put in front of the links the deck emails (account verification, password reset, follow notifications) and of the account-link redirects. A public deployment must set it to its public HTTPS address, or emailed links point at the server's loopback address. It is separate from `DECKO_DECK_ORIGIN` above, which governs links in rendered pages. |
| `DECKO_ORIGIN_CHECK` | `on` or `off` | `on` (unset or blank) | Refuses state-changing requests (saves, sign-in, sign-out, account forms, `/setup`) that a browser sent from another site, judged from the `Sec-Fetch-Site`, `Origin` or `Referer` headers; requests without any of them, such as scripts, pass. `off` restores Ruby Decko's behaviour, which has no such check. |
| `DECKO_TRUSTED_ORIGINS` | Comma-separated `http://` or `https://` origins | None | Other sites allowed to send state-changing requests through the origin check. An entry that is not an `http` or `https` origin stops the host from starting. |
| `DECKO_SIGNIN_THROTTLE` | `on` or `off` | `on` (unset or blank) | Counts failed sign-ins per account and per client address in the deck's own database, and locks a scope that reaches its limit. `off` restores Ruby Decko's behaviour. |
| `DECKO_SIGNIN_MAX_FAILURES` | A whole number, at least 1 | `5` | Failed sign-ins within one window that lock an account. |
| `DECKO_SIGNIN_MAX_ADDRESS_FAILURES` | A whole number, at least 1 | `50` | Failed sign-ins within one window that lock a client address. |
| `DECKO_SIGNIN_LOCKOUT_SECONDS` | A whole number, at least 1 | `900` (15 minutes) | The length of the counting window and of the lock, in seconds. |
| `DECKO_SIGNIN_UNIFORM_FAILURE` | `on` or `off` | `on` (unset or blank) | An unknown address, an inactive account and a wrong password all get the same answer, so the answer does not reveal whether an address has an account. `off` restores Ruby Decko's answers. `DECKO_STRICT_PARITY_SIGNIN_DETAILED_ERRORS=on` also turns it off. |
| `DECKO_SESSION_REVOCATION` | `on` or `off` | `on` (unset or blank) | A signed-in session stops working once its account's password changes after it was issued, or once the account is no longer active. `off` restores Ruby Decko's behaviour. |
| `DECKO_PASSWORD_PBKDF2_ITERATIONS` | A whole number, at least 100000 | `600000`, or a lower limit a runtime declares (the Cloudflare Workers entries declare one) | The PBKDF2 iteration count for newly stored passwords under `DECKO_PASSWORD_HASH=pbkdf2`. A count below 100000 or above the runtime's limit is refused with an error. |
| `DECKO_SMTP_HOST`, `DECKO_SMTP_PORT`, `DECKO_SMTP_USER`, `DECKO_SMTP_PASS`, `DECKO_SMTP_FROM` | Host name; port number; mailbox user; SMTP password or app token; From address | Host `smtp.mail-synthetic.example` (a placeholder, not a real server); port `587`; no user; no password; From `no-reply@deck.example` | Real mail delivery through SMTP submission with STARTTLS (port 465 implicit TLS is not supported). Without `DECKO_SMTP_PASS` nothing is sent; a password without a user is refused. These are read by the engine's `transportFromEnv()` (src/card/notify/smtp-transport.ts). This package's Node host does not call it: on the Node host, mail is either captured (`DECKO_MAIL_CAPTURE=1`) or not sent. A host that must send real mail has to wire `transportFromEnv()` itself. |
| `DECKO_MAIL_CAPTURE` | `1` turns it on; any other value is off | Off: the Node host sends no mail | Node host: keeps outgoing mail in memory and serves it at `GET /_mail-log`, which returns and clears it for anyone who can reach the host, password-reset links included. For testing only; never turn it on for a public site. |
| `DECKO_RECAPTCHA_SITE_KEY`, `DECKO_RECAPTCHA_SECRET_KEY` | reCAPTCHA keys | Unset or blank: no anti-spam check | Anti-spam check on anonymous saves, matching Ruby Decko's reCAPTCHA mod. The check runs only when both keys are set. |
| `DECKO_RECAPTCHA_MINIMUM_SCORE` | A number | `0.5` | The lowest reCAPTCHA score accepted. While a key is set, a value that is not a number stops the host from starting. |
| `DECKO_RECAPTCHA_VERIFY_URL` | An address | Google's reCAPTCHA verification address | Where answers are verified; normally left unset. |
| `DECKO_FILES_DIR` | A directory path | A `files` directory beside the deck's database file | Node host: where uploaded files are stored and served from. It must be writable when `DECKO_WRITE_PATH=1`. |
| `DECKO_DECK_PROFILE` | `stock`; any other value is the same as unset | Unset: the host keeps its behaviour for a migrated site with its own legacy assets | Node host: `stock` serves a deck the way stock Decko serves it: every gem mod's views, no legacy-site asset settings, the `*signin` card's own sign-in page, and Ruby's page for a card that does not exist (the new-card form, or Not Found). Use `stock` for a new deck rather than a migrated one. |
| `DECKO_MOD_PUBLIC_DIR` | A directory path | Unset: nothing is served under `/mod/` | Node host: the directory holding the mods' public files, served at `/mod/<mod>/` (for example TinyMCE's editor theme and the code editor's modes). Each entry is either a mod's public directory or a mod checkout with its files under `public/`. Without it, the rich-text editor cannot load its theme. |

## Strict-parity switches

Where the port deliberately improves on Ruby Decko's behaviour, each of these
switches selects Ruby's recorded behaviour instead. Each accepts `on` or
`off`; unset or blank takes the default, and any other value is refused with
an error naming the setting.

| Setting | Default | `on` | `off` |
| --- | --- | --- | --- |
| `DECKO_STRICT_PARITY_SIGNIN_DETAILED_ERRORS` | `off` | Sign-in and forgot-password failures name the field that failed, as Ruby does; this also turns `DECKO_SIGNIN_UNIFORM_FAILURE` off | Every failure gets the same answer |
| `DECKO_STRICT_PARITY_REVISION_RESTORE_500` | `off` | Restoring an old version of a File or Image card fails with a server error (500), as Ruby does | The old version is restored |
| `DECKO_STRICT_PARITY_SKIN_CREATE_500` | `off` | Creating a Bootswatch skin whose parent is not a skin fails with a server error (500), as Ruby does | The create is refused with a validation error (422) |
| `DECKO_STRICT_PARITY_SCRIPT_BUNDLE_CLOCK_NAMES` | `off` | Compiled asset bundle files are named by the clock, as Ruby names them | They are named by their content, so an address changes only when the content does |
| `DECKO_STRICT_PARITY_MAIL_UNFOLLOW_REFUSAL` | `on` | The account dashboard write that a notification mail's unfollow link points to is refused (403), as Ruby's standard rules refuse it, and creating a follow rule checks the permissions of each part it creates (422 where one is denied) | The owner's unfollow write is permitted and lands, and the follow rule is created |

The unfollow link itself carries Ruby's bytes with either value of the last
switch.

## Optional deployment-specific mods

The deck-local class-sections mod is not part of this package.

See [VERIFICATION.md](VERIFICATION.md#9-excluded-test-inputs-and-environmental-limits) for the unavailable private inputs
and remaining execution limits of this source snapshot.

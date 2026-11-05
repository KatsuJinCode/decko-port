import http from "node:http";
import { installDemoShutdownReceiver } from "./scripts/demo-scratch-copy/demo-child-lifecycle.mjs";
import {configureDeploymentSerializerEra} from "./dist/src/card/render/deployment-follow-live-config.js";
configureDeploymentSerializerEra(process.env.DECKO_SERIALIZER_ERA?.trim() || undefined);
import {readPublicPageShellConfig, applyConfiguredPublicPageShell} from "./configured-public-page-shell.mjs";
const publicPageShellConfig = readPublicPageShellConfig(process.env.DECKO_PUBLIC_PAGE_SHELL_FILE,
  {footerVersionPin: process.env.DECKO_SERVED_FOOTER_VERSION_PIN});
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import { readFileSync, existsSync, watch as watchDirectory } from "node:fs";
import {validateDeploymentLegacyAssets, rewriteDeploymentLegacyAssetRevisions} from "./dist/src/server/deployment-legacy-assets.js";
const deploymentLegacyAssets = validateDeploymentLegacyAssets(process.env.DECKO_LEGACY_ASSETS_FILE
  ? JSON.parse(readFileSync(process.env.DECKO_LEGACY_ASSETS_FILE, "utf8")) : undefined);
import {validateDeploymentDeckOrigin} from "./dist/src/server/deployment-deck-origin.js";
import {setDeckEnvironment} from "./dist/src/card/render/deck-origin.js";
const deploymentDeckOrigin = validateDeploymentDeckOrigin(process.env.DECKO_DECK_ORIGIN);
if (deploymentDeckOrigin !== undefined) setDeckEnvironment({origin: deploymentDeckOrigin});

import { LocalSqliteDriver } from "./dist/src/server/drivers/local-sqlite.js";
import { nodeAfterResponse } from "./dist/src/card/delayed-job/delayed-job.js";
import { delayingFromEnv, hostDelayedJobs } from "./dist/src/card/delayed-job/host.js";
import { FetchEngine } from "./dist/src/card/fetch.js";
import { RenderEngine } from "./dist/src/card/render.js";
import { setRaiseAllRenderingErrors } from "./dist/src/card/render/format.js";
import { serveFontAwesomeAsset } from "./dist/src/server/font-awesome-assets.js";
import { serveBootstrapFontAsset } from "./dist/src/server/bootstrap-font-assets.js";
import { serveModStyleAsset } from "./dist/src/server/mod-style-assets.js";
import { handleAttachmentRoute } from "./dist/src/server/file-routes.js";
import { jsonViewSearchParams, mapRenderError, isDeprecatedAssetRoute, deprecatedAssetStubResponse } from "./dist/src/server/worker-shared-surface.js";
import{configureMaterialIconsMode,materialIconsHeadTag} from "./dist/src/card/render/material-icons.js";
import { resolveReadAuthenticators } from "./dist/src/server/request-authenticators.js";
import { signinFromApiKey } from "./dist/src/card/auth/api-key-lookup.js";
import { homeMarkContent } from "./dist/src/card/render/page.js";
import { configureFontAwesomeMode, fontAwesomeHeadTag } from "./dist/src/card/render/font-awesome.js";
setRaiseAllRenderingErrors(false);
import { DeckoName } from "./dist/src/card/name.js";
import { renderFormatShow } from "./dist/src/card/render/format-families.js";
import {
  isRegisteredRouteFormat,
  registeredFormatDefaultView,
  renderRegisteredFormat,
  splitRegisteredFormatSuffix,
} from "./dist/src/server/registered-format-route.js";
import { recordAsMain } from "./dist/src/card/name/environment.js";
import { serverErrorArm } from "./dist/src/server/server-error-debugger-arm.js";
import { debugServerErrorView } from "./dist/src/card/render/debug-server-error.js";
import { lastDraftContent } from "./dist/src/card/mod-loader/mods/card-mod-history.js";
import { isUpstreamMatchError } from "./dist/src/card/render/errors.js";
import { applyDeckInflections } from "./dist/src/card/name/inflect.js";
import { CARD_GEM_INITIALIZER_INFLECTIONS } from "./dist/src/card/name/oracle-deck-inflections.js";
import { sqliteRegexpUdf } from "./dist/src/cql/sqlite-regexp.js";
import { firstRunEnabled, handleFirstRunRequest, SETUP_PATH } from "./dist/src/server/first-run-routes.js";
import { armGeneratedSetupToken } from "./dist/src/card/auth/setup-token.js";

function editorWireParamsFromQuery(searchParams) {
  const out = {};
  for (const key of ["tinymce_id", "tm_snippet_raw", "tm_snippet_start"]) {
    const value = searchParams.get(key);
    if (value !== null) out[key] = value;
  }
  return out;
}
import { checkRequestOrigin, CROSS_ORIGIN_MESSAGE, defaultOriginPolicy } from "./dist/src/server/request-origin.js";
const ORIGIN_POLICY = defaultOriginPolicy();
import { bootstrapFreshDeck, corpusShippedAccountHolderIds } from "./dist/src/card/auth/boot-seed.js";
import { loadDefaultsSeedCorpusAsset } from "./dist/src/card/auth/defaults-seed-corpus-asset.js";
import { createVirtualCardLookup } from "./dist/src/card/fetch/virtual-cards.js";
import { newSlotId } from "./dist/src/card/render/slot-html.js";
import { readActiveSkinCard, readCardIdByCodename, readDefaultCardType, readFooterCardIdentity, readSiteBootValues } from "./dist/src/server/staging-deck-identity.js";
import { renderNavbarDropdownItems } from "./dist/src/server/staging-navbar-dropdown.js";
import { cardWallClockNow } from "./dist/src/card/wall-clock.js";
import { renderPageBytes, renderPageWithStatus } from "./dist/src/card/render/page.js";
import { compileScriptBundle } from "./dist/src/card/assets/compiled-script-bundle.js";
import { uglifyHarmonyCompile, uglifyHarmonySyntaxError } from "./dist/src/card/assets/uglify-harmony-compile-engine.js";
import { defaultDeckLoader } from "./dist/src/card/mod-loader/default-mod-deck.js";
import { openSameDatabase, passwordHashModeFor } from "./dist/src/server/same-database.js";
import { readNestIndexMarker } from "./dist/src/card/nest-index.js";
import {
  handleWriteRequest,
  writePathEnabled,
  readSessionCookie,
  sessionCookieHeader,
  clearedSessionCookieHeader,
  sessionCookieSecure,
} from "./dist/src/server/write-routes.js";
import { emptyVisitorSession, pageViewCookie, visitorSessionCookie, previousLocation, readVisitorSession } from "./dist/src/card/session/visitor-session.js";
import { withVisitorEnabledRoles, permissionViewerKey } from "./dist/src/card/session/enabled-roles.js";
import { recaptchaConfigFromHostEnv } from "./dist/src/server/staging-server-recaptcha-env-config.js";
import { prepareDeploymentMigration } from "./dist/src/server/deployment-migration-config.js";
const migrationDeployment = prepareDeploymentMigration(process.env);
import {
  applyOracleSecurityResponseHeaders,
} from "./dist/src/server/oracle-security-response-headers.js";
import { LocalAttachmentStore } from "./dist/src/card/attachments/attachment-store.js";
import { CardActionEngine } from "./dist/src/card/actions/card-action-engine.js";
import { createReadAssetRefresh } from "./dist/src/card/actions/asset-read-refresh.js";
import { libsassProcessCompiler } from "./dist/src/server/libsass-process.js";
import { coffeeNpmCompiler } from "./dist/src/server/coffee-npm-compiler.js";
import { expireRenderCachesAfterSave } from "./dist/src/server/post-save-cache-expiry.js";
import {
  structureRuleUniverseStatement,
  structureUniverseFromResults,
  structureRuleTypesFromResults,
} from "./dist/src/card/rules/structure.js";
import {
  SessionStore,
  runAuthMigrations,
  signinAccount,
  signoutAccount,
} from "./dist/src/card/auth/index.js";

import {
  applyNewAccountPassword,
  buildAccountTokenUrl,
  confirmPasswordReset,
  confirmAccountVerification,
  sendResetPasswordToken,
} from "./dist/src/card/auth/account-verify-reset-flows.js";
import {
  CaptureTransport,
  NoopTransport,
} from "./dist/src/card/notify/transport.js";

applyDeckInflections(CARD_GEM_INITIALIZER_INFLECTIONS);

const SHARED_LEX_STORE = new Map();
const sharedStore = {
  read(key) { return SHARED_LEX_STORE.get(key); },
  write(key, value) { SHARED_LEX_STORE.set(key, value); },
  exist(key) { return SHARED_LEX_STORE.has(key); },
  delete(key) { SHARED_LEX_STORE.delete(key); },
};

const SPACES_HOST = deploymentLegacyAssets?.assetOrigin ?? "https://production-storage.r1.cdn.objectstore.example";

const STOCK_DECK = migrationDeployment.environment.DECKO_DECK_PROFILE === "stock";

const MOD_PUBLIC_DIR = migrationDeployment.environment.DECKO_MOD_PUBLIC_DIR || undefined;
const MOD_PUBLIC_TYPES = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".gif": "image/gif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

async function serveModPublicFile(pathname) {
  const root = path.resolve(MOD_PUBLIC_DIR, "mod");
  let rel;
  try {
    rel = decodeURIComponent(pathname.slice("/mod/".length));
  } catch {
    return htmlResponse(400, "<h1>Bad request</h1>", "Bad request");
  }
  const segs = rel.split("/").filter((s) => s !== "" && s !== "." && s !== "..");
  const candidates =
    segs.length === 0 ? [] : [path.resolve(root, ...segs), path.resolve(root, segs[0], "public", ...segs.slice(1))];
  for (const file of candidates) {
    if (file !== root && !file.startsWith(root + path.sep)) continue;
    try {
      const bytes = await fs.readFile(file);
      return {
        status: 200,
        headers: {
          "Content-Type": MOD_PUBLIC_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
          "Cache-Control": "no-store",
        },
        body: bytes,
      };
    } catch {
    }
  }
  return htmlResponse(404, "<h1>Not found</h1>", "Not found");
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

const COMPILED_ASSETS_DIR =
  migrationDeployment.environment.COMPILED_ASSETS_DIR ?? path.join(HERE, "tmp", "compiled-assets");

const MAIN_STYLESHEET_PATH = deploymentLegacyAssets?.stylesheetPath;
const MAIN_SCRIPT_PATH = deploymentLegacyAssets?.scriptPath;
const MAIN_STYLESHEET_CARD_ID = MAIN_STYLESHEET_PATH === undefined ? undefined : Number(MAIN_STYLESHEET_PATH.split("/")[0]);
const MAIN_SCRIPT_CARD_ID = MAIN_SCRIPT_PATH === undefined ? undefined : Number(MAIN_SCRIPT_PATH.split("/")[0]);

const COMPILED_ASSET_FILES = {
  ...(MAIN_STYLESHEET_CARD_ID === undefined ? {} : { [`${MAIN_STYLESHEET_CARD_ID}:css`]: "all-style.css" }),
  ...(MAIN_SCRIPT_CARD_ID === undefined ? {} : { [`${MAIN_SCRIPT_CARD_ID}:js`]: "all-script.js" }),
};

const ASSEMBLED_SCRIPT_FIXTURE = path.join(
  HERE,
  "fixtures",
  "captured",
  "all-script-assembled-input.js",
);

let mainScriptAssetOutputCache;
async function mainScriptAssetOutput() {
  if (mainScriptAssetOutputCache !== undefined) return mainScriptAssetOutputCache;
  const { rows } = await driver.query(
    "SELECT out_card.id AS id, out_card.db_content AS db_content" +
      " FROM cards all_card" +
      " JOIN cards rule ON rule.left_id = all_card.id AND rule.trash = 0" +
      " JOIN cards setting ON rule.right_id = setting.id AND setting.trash = 0" +
      " JOIN cards out_card ON out_card.left_id = rule.id AND out_card.trash = 0" +
      " JOIN cards out_setting ON out_card.right_id = out_setting.id" +
      " WHERE all_card.codename = 'all' AND all_card.trash = 0" +
      " AND setting.codename = 'script'" +
      " AND out_setting.codename = 'asset_output'",
    [],
  );
  mainScriptAssetOutputCache = rows[0] ?? null;
  return mainScriptAssetOutputCache;
}

let compiledBundlePromise;
function compiledMainScriptBundle() {
  if (compiledBundlePromise === undefined) {
    compiledBundlePromise = (async () => {
      const deployedPath = path.join(COMPILED_ASSETS_DIR, "all-script.js");
      try {
        const bytes = await fs.readFile(deployedPath);
        return { bytes, note: "compiled-bytes", source: deployedPath };
      } catch (err) {
        if (err && err.code !== "ENOENT") {
          console.warn(
            `[vm-staging] compiled asset read failed ${deployedPath}: ` +
              (err instanceof Error ? err.message : String(err)),
          );
        }
      }
      try {
        const assembled = await fs.readFile(ASSEMBLED_SCRIPT_FIXTURE, "utf8");
        const startedAt = Date.now();
        const bundle = compileScriptBundle(assembled);
        console.log(
          `[vm-staging] compiled *all+*script bundle in process: ${bundle.length} chars ` +
            `in ${Date.now() - startedAt}ms from ${ASSEMBLED_SCRIPT_FIXTURE}`,
        );
        return {
          bytes: Buffer.from(bundle, "utf8"),
          note: "compiled-in-process-from-assembled-input",
          source: ASSEMBLED_SCRIPT_FIXTURE,
        };
      } catch (err) {
        console.warn(
          `[vm-staging] in-process script compile unavailable: ` +
            (err instanceof Error ? err.message : String(err)),
        );
        return null;
      }
    })();
  }
  return compiledBundlePromise;
}

const dbPath = process.argv[2];
const port = Number.parseInt(process.argv[3] ?? "3100", 10);

if (!dbPath) {
  console.error(
    "usage: node vm-staging-server.mjs <path-to-corpus.sqlite> [port]\n" +
      "  port defaults to 3100 (bind on 127.0.0.1; nginx fronts with basic auth).",
  );
  process.exit(2);
}
if (!Number.isFinite(port) || port <= 0 || port > 65535) {
  console.error(`invalid port: ${process.argv[3]}`);
  process.exit(2);
}

console.log(`[vm-staging] db: ${dbPath}`);
console.log(`[vm-staging] port: ${port}`);

const driver = new LocalSqliteDriver({ path: dbPath, readonly: !writePathEnabled() });
driver.registerFunction("regexp", sqliteRegexpUdf, { deterministic: true });

const authDriver = new LocalSqliteDriver({ path: dbPath, readonly: false });
const DECKO_FILES_DIR =
  migrationDeployment.environment.DECKO_FILES_DIR ?? path.join(path.dirname(dbPath), "files");
const attachmentStore = new LocalAttachmentStore(DECKO_FILES_DIR);
const scssCompiler =
  migrationDeployment.environment.DECKO_SASSC !== undefined && migrationDeployment.environment.DECKO_SASSC !== ""
    ? libsassProcessCompiler(migrationDeployment.environment.DECKO_SASSC)
    : undefined;
const coffeeCompiler = coffeeNpmCompiler();
const compressAssets = migrationDeployment.environment.DECKO_COMPRESS_ASSETS !== "false";
const scriptCompressor = uglifyHarmonyCompile;
const javascriptValidator = uglifyHarmonySyntaxError;
const ASSET_REFRESH_MODES = new Set(["eager", "cautious", "never"]);
const assetRefreshMode = migrationDeployment.environment.DECKO_ASSET_REFRESH ?? "cautious";
if (!ASSET_REFRESH_MODES.has(assetRefreshMode)) {
  throw new Error("DECKO_ASSET_REFRESH must be eager, cautious or never");
}

const STOP_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "vm-staging.stop");
const assetReadRefresh = createReadAssetRefresh({
  mode: assetRefreshMode,
  sharedCache: true,
  refresh: () =>
    new CardActionEngine(fetcher, {
      actor: null,
      ipAddress: "127.0.0.1",
      attachmentStore,
      scssCompiler,
      coffeeCompiler,
      compressAssets,
      scriptCompressor,
      javascriptValidator,
    }).refreshReadAssetInputs(),
});
const recaptchaConfig = migrationDeployment.antiSpamDisabled ? {} :
  recaptchaConfigFromHostEnv(migrationDeployment.environment) ?? {
    siteKey: "6Lc3c-EoAAAAALnzfnHIWb5Rqy-rNui8l8qsguYG",
    secretKey: "6Lc3c-EoAAAAAEg9K_IAUNgx73eTbtBucCGnOQqf",
  };
const { setRenderRecaptchaConfig } = await import(
  "./dist/src/card/render/render-recaptcha-config.js"
);
setRenderRecaptchaConfig(recaptchaConfig);
const sameDatabase = await openSameDatabase(authDriver, { authMigrationsDir: path.join(HERE, "db", "migrations") });
const passwordMode = passwordHashModeFor(sameDatabase.rubyDatabase, process.env.DECKO_PASSWORD_HASH);
if (passwordMode !== undefined) process.env.DECKO_PASSWORD_HASH = passwordMode;
console.log(
  `[vm-staging] database: ${sameDatabase.rubyDatabase ? "Ruby Decko schema, served as it is" : "port schema"}; ` +
    `added ${sameDatabase.created.length === 0 ? "nothing" : sameDatabase.created.join(", ")}; password hash ${passwordMode ?? "pbkdf2"}`,
);

let defaultsSeedCorpus;
let corpusShippedHolders = [];
if (firstRunEnabled()) {
  defaultsSeedCorpus = loadDefaultsSeedCorpusAsset();
  corpusShippedHolders = corpusShippedAccountHolderIds(defaultsSeedCorpus.cards);
}
if (firstRunEnabled() && writePathEnabled()) {
  const cardsCount = await authDriver.query("SELECT COUNT(*) AS n FROM cards", []);
  if (Number(cardsCount.rows[0]?.n ?? 0) === 0) {
    const seeded = await bootstrapFreshDeck({ driver: authDriver, defaultsCorpus: defaultsSeedCorpus });
    console.log(
      `[boot-seed] fresh deck seeded: ` +
        `${seeded.defaultsRowsInserted?.cards ?? seeded.coreRowsInserted} fixture cards ` +
        `(${seeded.defaultsRowsInserted ? "defaults corpus" : "core fixture"}), ` +
        `${seeded.modCardsCreated.length} account-system cards created ` +
        `(${seeded.modCardsUpdated.length} updated on re-run)`,
    );
  }
}
if (firstRunEnabled()) {
  const setupToken = armGeneratedSetupToken();
  console.log(
    setupToken === undefined
      ? "[first-run] /setup requires the token set in DECKO_SETUP_TOKEN"
      : `[first-run] /setup requires this one-time setup token: ${setupToken}`,
  );
}
const sessions = new SessionStore({ driver: authDriver });

const mailTransport =
  migrationDeployment.environment.DECKO_MAIL_CAPTURE === "1"
    ? new CaptureTransport("capture")
    : new NoopTransport();

async function resolveSiteTitle() {
  for (const column of ["db_content", "content"]) {
    try {
      const result = await authDriver.query(
        `SELECT ${column} AS title FROM cards WHERE codename = 'title' AND trash = 0 LIMIT 1`,
        [],
      );
      const title = result.rows[0]?.title;
      if (typeof title === "string" && title !== "") return title;
      return title ?? "";
    } catch {
    }
  }
  return "";
}

const SITE_TITLE = await resolveSiteTitle();

const DECKO_ORIGIN = migrationDeployment.environment.DECKO_ORIGIN ?? `http://127.0.0.1:${port}`;

const flowsFetcher = new FetchEngine(authDriver);
function accountFlowCtx() {
  return {
    driver: authDriver,
    fetcher: flowsFetcher,
    sessions,
    transport: mailTransport,
    token: TOKEN_CONFIG,
    origin: DECKO_ORIGIN,
    siteTitle: SITE_TITLE,
  };
}

function accountFlowResponse(status, body) {
  return { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, body: JSON.stringify(body) };
}

function expireFlowWrittenName(mark) {
  const name = decodeURIComponent(mark).replace(/_/g, " ");
  if (name === "") return;
  fetcher.expireName(name);
  render.expireRenderCard(name);
  for (const engine of signedInEngines.values()) {
    engine.expireRenderCard(name);
  }
}

async function handleResetRequest(req) {
  let raw;
  try {
    raw = await readRequestBody(req);
  } catch (error) {
    return accountFlowResponse(400, { ok: false, message: `unreadable request body: ${error}` });
  }
  let email = "";
  const contentType = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (contentType === "application/json" || raw.trimStart().startsWith("{")) {
    try {
      email = String(JSON.parse(raw)?.email ?? "");
    } catch {
      email = "";
    }
  } else {
    email = new URLSearchParams(raw).get("email") ?? "";
  }
  const outcome = await sendResetPasswordToken(accountFlowCtx(), email);
  if (!outcome.ok) {
    return accountFlowResponse(422, { ok: false, message: outcome.message });
  }
  return accountFlowResponse(200, { ok: true, sentTo: outcome.sentTo });
}

function parseAccountFlowLink(pathname, searchParams) {
  const match = /^\/update\/([^/]+)$/.exec(pathname);
  if (match === null) return null;
  const trigger = searchParams.get("card[trigger]");
  const token = searchParams.get("token");
  if ((trigger !== "reset_password" && trigger !== "verify_and_activate") || token === null) {
    return null;
  }
  return { accountMark: decodeURIComponent(match[1]), trigger, token };
}

async function handleAccountFlowLink(flow, req) {
  if (flow.trigger === "reset_password") {
    const outcome = await confirmPasswordReset(accountFlowCtx(), flow.accountMark, flow.token);
    if (outcome.ok) {
      return withSessionCookie(
        successRedirect(outcome.redirectTo.name, outcome.redirectTo.view, req),
        outcome.session.token,
        req,
      );
    }
    return accountFlowErrorResponse(outcome, flow.accountMark);
  }
  const outcome = await confirmAccountVerification(accountFlowCtx(), flow.accountMark, flow.token);
  if (outcome.ok) {
    return withSessionCookie(
      successRedirect(outcome.redirectTo.name, undefined, req),
      outcome.session.token,
      req,
    );
  }
  return accountFlowErrorResponse(outcome, flow.accountMark);
}

function withSessionCookie(response, sessionToken, req) {
  return {
    ...response,
    headers: { ...response.headers, "Set-Cookie": sessionCookieHeader(sessionToken, nodeCookieSecure(req)) },
  };
}

function nodeCookieSecure(req) {
  return sessionCookieSecure({ scheme: req.socket?.encrypted ? "https" : "http", headers: req.headers });
}

function accountFlowErrorResponse(outcome, accountMark) {
  if (outcome.kind === "token_invalid") {
    return renderAccountFlowDenialPage();
  }
  if (outcome.kind === "account_not_found") {
    return renderDeckoErrorPage(accountMark, "not_found");
  }
  return renderAccountFlowAlertPage(
    422,
    accountMarkName(accountMark),
    "CONTENT",
    outcome.message,
  );
}

function escapeHtmlRails(text) {
  return escapeHtml(text).replace(/'/g, "&#39;");
}

function accountMarkName(accountMark) {
  return String(accountMark).replace(/_/g, " ");
}

async function renderChromedAccountFlowPage(mainSlotHtml, opts) {
  const boot = await readSiteBootValues(driver, SPACES_HOST, SITE_TITLE_DEFAULT);
  const layout = await resolveDefaultLayout();
  const body = applyServedEnvironmentDeltas(
    await wrapWithLayout(opts.cardName ?? "*signin", mainSlotHtml, layout, {
      titleText: opts.titleText,
      headExtraLine: opts.headExtraLine,
      bodyExtraHtml: opts.bodyExtraHtml,
    }),
  );
  return {
    status: opts.status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Connection": "close",
      "Keep-Alive": "timeout=0",
    },
    body,
  };
}

function buildAccountFlowDenialSlotHtml() {
  const slotJson =
    `{"view":"denial","nest_name":"_main","nest_syntax":"_main|titled",` +
    `"hide":["menu","help"],"main":true,"home_view":"denial","main_view":true,` +
    `"layout":"Default Layout"}`;
  return (
    `<div id="-denial-view" class="card-slot denial-view ALL TYPE-rich_text" ` +
    `data-card-name="" data-card-type-id="2" data-card-type-name="RichText" ` +
    `data-card-link-name="" data-slot-id="${newSlotId()}" ` +
    `data-slot="${escapeHtml(slotJson)}">` +
    `<div class="d0-card-frame card">` +
    `<div class="d0-card-header card-header">` +
    `<h1 class="d0-card-header-title">` +
    `<span class="card-title" title=""></span></h1></div>\n` +
    `\n` +
    `<div class="d0-card-body card-body card-text"><h1>Sorry!</h1>\n` +
    `<div><div>Please <a class="signin-link known-card" href="/*signin/titled">sign in</a> or ` +
    `<a class="signup-link known-card" href="/new/Sign_up">sign up</a> to do that.</div></div>` +
    `</div></div></div>`
  );
}

async function renderAccountFlowDenialPage() {
  const boot = await readSiteBootValues(driver, SPACES_HOST, SITE_TITLE_DEFAULT);
  return renderChromedAccountFlowPage(buildAccountFlowDenialSlotHtml(), {
    status: 403,
    titleText: boot.siteTitle,
  });
}

function buildAccountFlowAlertSlotHtml(cardDisplayName, attributeLabel, message) {
  return (
    `<div class="alert alert-warning alert-dismissible  card-error-msg" role="alert">` +
    `<button type="button" data-bs-dismiss="alert" class="btn-close" aria-label="Close"></button>\n` +
    `<h4 class="alert-heading error">Problems with ${escapeHtmlRails(cardDisplayName)}</h4>\n` +
    `<p><strong>${attributeLabel}:</strong> ${escapeHtmlRails(message)}</p></div>`
  );
}

async function renderAccountFlowAlertPage(status, cardDisplayName, attributeLabel, message) {
  const boot = await readSiteBootValues(driver, SPACES_HOST, SITE_TITLE_DEFAULT);
  return renderChromedAccountFlowPage(
    buildAccountFlowAlertSlotHtml(cardDisplayName, attributeLabel, message),
    {
      status,
      titleText: `${cardDisplayName} - ${boot.siteTitle}`,
    },
  );
}

function buildResetPasswordSuccessSlotHtml(signinCardId) {
  const slotJson =
    `{"view":"reset_password_success","nest_name":"_main","nest_syntax":"_main|titled",` +
    `"hide":["help"],"main":true,"home_view":"reset_password_success","main_view":true,` +
    `"layout":"Default Layout"}`;
  return (
    `<div id="Xsignin-reset_password_success-view" ` +
    `class="card-slot reset_password_success-view ALL TYPE-rich_text STAR SELF-Xsignin" ` +
    `data-card-id="${signinCardId}" data-card-name="*signin" data-card-type-id="2" ` +
    `data-card-type-name="RichText" data-card-link-name="*signin" ` +
    `data-slot-id="${newSlotId()}" data-slot="${escapeHtml(slotJson)}">` +
    `<div class="d0-card-frame card">` +
    `<div class="d0-card-header card-header">` +
    `<h1 class="d0-card-header-title">` +
    `<span class="card-title" title="Sign In">Sign In</span></h1></div>\n` +
    `\n` +
    `<div class="d0-card-body card-body card-text">Check your email for a link to reset your password</div>` +
    `</div></div>`
  );
}

async function renderResetPasswordSuccessPage() {
  const signinRecord = await fetchCardByName("*signin");
  return renderChromedAccountFlowPage(
    buildResetPasswordSuccessSlotHtml(signinRecord?.id ?? ""),
    { status: 200 },
  );
}

function buildForgotPasswordModalHtml(signinCardId) {
  const slotJson =
    `{"view":"edit","hide":["help","save_button"],"main":true,"main_view":true,` +
    `"edit_structure":[["+*email",{"title":"email","view":"titled","nest_name":"+*email",` +
    `"skip_perms":true,"home_view":"titled"}]],"title":"Forgot Password"}`;
  return (
    `<div class='modal fade _modal-slot' id='modal-container' role='dialog'>\n` +
    `<!-- /, "data-backdrop": "static"} -->\n` +
    `<div class='modal-dialog modal-dialog-centered modal-lg'>\n` +
    `<div class='modal-content'>\n` +
    `<div class='modal-header'>\n` +
    `<span class="card-title" title="Forgot Password">Forgot Password</span>\n` +
    `<div class="modal-menu _modal-menu ms-auto">` +
    `<a class="_close-modal btn-close" data-bs-dismiss="modal" href=""><i class="notranslate material-icons">close</i></a>\n` +
    `<a rel="nofollow" class="board-link _confirm slotter" title="Advanced"` +
    ` data-bs-toggle="tooltip" data-bs-placement="bottom" data-slotter-mode="modal-replace"` +
    ` data-confirm-msg="Unsaved changes will be lost. Do you want to proceed?"` +
    ` href="/*signin/board" data-remote="true">` +
    `<i class="notranslate material-icons">space_dashboard</i> </a></div>\n` +
    `</div>\n` +
    `<div class='modal-body'>\n` +
    `<div id="Xsignin-edit-view" class="card-slot edit-view ALL TYPE-rich_text STAR SELF-Xsignin" ` +
    `data-card-id="${signinCardId}" data-card-name="*signin" data-card-type-id="2" ` +
    `data-card-type-name="RichText" data-card-link-name="*signin" ` +
    `data-slot-id="${newSlotId()}" data-slot="${escapeHtml(slotJson)}">` +
    `<div id="Xsignin-edit_type_row-view" class="card-slot edit_type_row-view ALL TYPE-rich_text STAR SELF-Xsignin d-flex form-group row" data-card-id="${signinCardId}" data-card-name="*signin" data-card-type-id="2" data-card-type-name="RichText" data-card-link-name="*signin" data-slot-id="${newSlotId()}" data-slot="{&quot;view&quot;:&quot;edit_type_row&quot;,&quot;show&quot;:[&quot;edit_form&quot;,&quot;edit_type_row&quot;],&quot;hide&quot;:[&quot;board_link&quot;,&quot;help&quot;,&quot;save_button&quot;,&quot;type_form&quot;],&quot;home_view&quot;:&quot;edit_type_row&quot;,&quot;edit_structure&quot;:[[&quot;+*email&quot;,{&quot;title&quot;:&quot;email&quot;,&quot;view&quot;:&quot;titled&quot;,&quot;nest_name&quot;:&quot;+*email&quot;,&quot;skip_perms&quot;:true}]],&quot;title&quot;:&quot;Forgot Password&quot;}">` +
    `<div class='col-2 text-start'>\n<label>\nType\n</label>\n</div>\n` +
    `<div class='col-8'>\n<a class="known-card" href="/RichText">RichText</a>\n</div>\n` +
    `<div class='col-2 text-end'>\n<a rel="nofollow" class="ms-2 edit-link slotter" data-cy="edit-link" href="/*signin/board_type_formgroup" data-remote="true"><i class="notranslate material-icons">edit</i></a>\n</div>\n</div>` +
    `<form class="card-form slotter autosave" id="edit_card_${signinCardId}" data-slot-selector="modal-origin" data-slot-error-selector=".card-slot" action="/update/*signin" accept-charset="UTF-8" data-remote="true" method="post">` +
    `<input name="utf8" type="hidden" value="&#x2713;" autocomplete="off" />` +
    `<input type="hidden" name="_method" value="patch" autocomplete="off" />` +
    `<input name="utf8" type="hidden" value="&#x2713;" autocomplete="off" />` +
    `<input type="hidden" name="_method" value="patch" autocomplete="off" />` +
    `<input type="hidden" name="success[view]" id="success_view" value="reset_password_success" autocomplete="off" />` +
    `<input type="hidden" name="card[trigger]" id="card_trigger" value="send_reset_password_token" autocomplete="off" />` +
    `<fieldset class="card-editor editor">` +
    `<div class="form-group card-editor RIGHT-Xemail" data-card-name="*signin+*email" data-card-link-name="*signin+*email">` +
    `<label for="card_subcards___email_content"><span class="card-title" title="email">email</span></label>\n` +
    `<div class="editor content-editor">` +
    `<input class="d0-card-content form-control" placeholder="" type="text" value="" name="card[subcards][+*email][content]" id="card_subcards___email_content" />\n` +
    `</div></div></fieldset>\n` +
    `<button name="button" type="submit" class="_close-modal-on-success btn btn-primary">Reset password</button></form>\n` +
    `<!-- decko-ts staging: renders the full card-mod-edit ` +
    `form machinery here (rails remainder); this honest form posts Ruby's ` +
    `exact inputs to /update/*signin. -->\n` +
    `</div>\n` +
    `</div>\n` +
    `</div>\n` +
    `</div>\n`
  );
}

async function renderForgotPasswordPage() {
  const signinRecord = await fetchCardByName("*signin");
  const modalHtml = buildForgotPasswordModalHtml(signinRecord?.id ?? "");
  return renderChromedAccountFlowPage(buildSigninSlotHtml(), {
    status: 200,
    bodyExtraHtml: modalHtml,
  });
}

async function handleForgotPasswordSubmit(req, startedAt = Date.now()) {
  let raw;
  try {
    raw = await readRequestBody(req);
  } catch (error) {
    return accountFlowResponse(400, { ok: false, message: `unreadable request body: ${error}` });
  }
  let email = "";
  let trigger = "";
  const contentType = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (contentType === "application/json" || raw.trimStart().startsWith("{")) {
    try {
      const parsed = JSON.parse(raw);
      email = String(parsed?.email ?? "");
      trigger = String(parsed?.trigger ?? "");
    } catch {
      email = "";
    }
  } else {
    const params = new URLSearchParams(raw);
    email = params.get("card[subcards][+*email][content]") ?? params.get("email") ?? "";
    trigger = params.get("card[trigger]") ?? "";
  }
  if (trigger !== "send_reset_password_token") {
    if (writePathEnabled()) {
      const writeResponse = await dispatchWriteRequest(req, FORGOT_PASSWORD_SUBMIT_PATH, raw);
      if (writeResponse !== null) {
        await applyWriteResponseTail(writeResponse, startedAt, req.method, FORGOT_PASSWORD_SUBMIT_PATH);
        return withVisitorSessionCookie(writeResponse);
      }
    }
    return jsonResponse(405, { error: "method not allowed" });
  }
  const outcome = await sendResetPasswordToken(accountFlowCtx(), email);
  if (!outcome.ok) {
    const attributeLabel = outcome.reason === "not_active" ? "ACCOUNT" : "EMAIL";
    return renderAccountFlowAlertPage(422, "*signin", attributeLabel, outcome.message);
  }
  if (req.headers["x-requested-with"] === "XMLHttpRequest") {
    const signinRecord = await fetchCardByName("*signin");
    return {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      body: buildResetPasswordSuccessSlotHtml(signinRecord?.id ?? ""),
    };
  }
  const host = String(req.headers.host ?? "").trim();
  const origin = host !== "" ? `http://${host}` : ensureBootValuesOrigin();
  return {
    status: 303,
    headers: { Location: `${origin}/*signin/reset_password_success`, "Cache-Control": "no-store" },
    body: "",
  };
}

function ensureBootValuesOrigin() {
  const configured = migrationDeployment.environment.DECKO_ORIGIN;
  return typeof configured === "string" && configured !== "" ? configured : "http://127.0.0.1";
}

function successRedirect(name, view, req) {
  const host = String(req?.headers?.host ?? "").trim();
  const origin = host !== "" ? `http://${host}` : ensureBootValuesOrigin();
  if (name === "") {
    return { status: 303, headers: { Location: `${origin}/`, "Cache-Control": "no-store" }, body: "" };
  }
  const target = `${origin}/${DeckoName.parse(name).urlKey}${view ? `/${view}` : ""}`;
  return { status: 303, headers: { Location: target, "Cache-Control": "no-store" }, body: "" };
}

async function handleAccountPassword(req) {
  const sessionToken = readSessionCookie(req.headers.cookie);
  const actor = sessionToken !== null ? await sessions.lookupSession(sessionToken) : null;
  if (actor === null) {
    return accountFlowResponse(401, { ok: false, message: "sign in first (session cookie required)" });
  }
  let raw;
  try {
    raw = await readRequestBody(req);
  } catch (error) {
    return accountFlowResponse(400, { ok: false, message: `unreadable request body: ${error}` });
  }
  let password = "";
  let accountMark = `${actor.name}+*account`;
  const contentType = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (contentType === "application/json" || raw.trimStart().startsWith("{")) {
    try {
      const parsed = JSON.parse(raw);
      password = String(parsed?.password ?? "");
      if (typeof parsed?.account === "string" && parsed.account !== "") accountMark = parsed.account;
    } catch {
      password = "";
    }
  } else {
    const params = new URLSearchParams(raw);
    password = params.get("password") ?? "";
    const account = params.get("account");
    if (account !== null && account !== "") accountMark = account;
  }
  const outcome = await applyNewAccountPassword(
    { driver: authDriver, fetcher: flowsFetcher, actor },
    accountMark,
    password,
  );
  if (!outcome.ok) {
    return accountFlowResponse(422, { ok: false, message: outcome.message });
  }
  expireFlowWrittenName(accountMark);
  return accountFlowResponse(200, { ok: true, noOp: outcome.noOp });
}

function handleMailLog() {
  if (!(mailTransport instanceof CaptureTransport)) {
    return accountFlowResponse(404, { error: "mail capture is off (boot with DECKO_MAIL_CAPTURE=1)" });
  }
  return accountFlowResponse(200, { messages: mailTransport.drain() });
}

const TOKEN_SECRET =
  migrationDeployment.environment.DECKO_TOKEN_SECRET ?? crypto.randomBytes(32).toString("hex");

const TOKEN_CONFIG = {
  secret: TOKEN_SECRET,
  now: () => Math.floor(cardWallClockNow().getTime() / 1000),
};

const fetcher = new FetchEngine(driver, { sharedStore, database: "decko" });
defaultDeckLoader();
const render = new RenderEngine(fetcher);
render.fontAwesomeAssetMode = configureFontAwesomeMode(migrationDeployment.environment.DECKO_FONT_AWESOME);
render.materialIconsAssetMode=configureMaterialIconsMode(migrationDeployment.environment.DECKO_MATERIAL_ICONS);
render.tokenConfig = TOKEN_CONFIG;
render.imageCdnHost = STOCK_DECK ? undefined : SPACES_HOST;
if (STOCK_DECK) render.renderAbsentCards = true;

const HOME_CARD_NAME = "Home";
const OPEN_VIEW = "open";

await primeEngine(fetcher);

const HEADER_SETTING_NAME = "*header";
const FOOTER_SETTING_NAME = "*footer";

const MAIN_CSS_URL = MAIN_STYLESHEET_PATH === undefined ? undefined : `${SPACES_HOST}/files/${MAIN_STYLESHEET_PATH}`;
const MAIN_JS_URL = MAIN_SCRIPT_PATH === undefined ? undefined : `${SPACES_HOST}/files/${MAIN_SCRIPT_PATH}`;
const FOOTER_SLOT_ID = deploymentLegacyAssets?.footerSlotId;
const MISSING_LEGACY_SETTINGS = [
  ...(MAIN_STYLESHEET_PATH === undefined ? ["stylesheetPath (no main stylesheet link)"] : []),
  ...(MAIN_SCRIPT_PATH === undefined ? ["scriptPath (no main script link)"] : []),
  ...(FOOTER_SLOT_ID === undefined ? ["footerSlotId (random footer slot id per page)"] : []),
];
if (!STOCK_DECK && MISSING_LEGACY_SETTINGS.length > 0) {
  console.warn(
    `[vm-staging] DECKO_LEGACY_ASSETS_FILE does not set: ${MISSING_LEGACY_SETTINGS.join(", ")}`,
  );
}

const STYLE_MOD_ASSETS = MAIN_CSS_URL === undefined ? [] : [MAIN_CSS_URL];

const ASSET_OUTPUT_FILE_CARD_IDS = [];

async function primeEngine(engine) {
  await engine.codenames.ensureLoaded();
  const codenameRegistration = await driver.query(
    "SELECT id, codename FROM cards WHERE codename IN ('type','by_name','members') AND trash = 0",
    [],
  );
  const codehashValue = engine.codenames.codehashValue;
  if (codehashValue !== undefined) {
    for (const row of codenameRegistration.rows) {
      codehashValue.c2i.set(row.codename, row.id);
      codehashValue.i2c.set(row.id, row.codename);
    }
  }
  const { rows } = await driver.query(
    "SELECT id, name, left_id, right_id FROM cards WHERE trash = 0",
    [],
  );
  const byId = new Map();
  const idToName = new Map();
  const keyToId = new Map();
  for (const row of rows) {
    byId.set(row.id, row);
    if (row.name !== null && row.name !== "") {
      const name = DeckoName.parse(row.name);
      idToName.set(row.id, name.s);
      keyToId.set(name.key, row.id);
    }
  }
  const composing = new Set();
  const composedName = (id) => {
    const direct = idToName.get(id);
    if (direct !== undefined) return direct;
    if (composing.has(id)) return undefined;
    const row = byId.get(id);
    if (row === undefined || row.left_id === null || row.right_id === null) {
      return undefined;
    }
    composing.add(id);
    try {
      const left = composedName(row.left_id);
      const right = composedName(row.right_id);
      if (left === undefined || right === undefined) return undefined;
      const joined = `${left}${DeckoName.JOINT}${right}`;
      idToName.set(id, joined);
      return joined;
    } finally {
      composing.delete(id);
    }
  };
  for (const row of rows) {
    const name = composedName(row.id);
    if (name !== undefined) keyToId.set(DeckoName.parse(name).key, row.id);
  }
  fetcher.installNameEnvironment();
  for (const row of rows) {
    if (row.left_id !== null && row.right_id !== null) {
      const joined = composedName(row.id);
      if (joined === undefined) continue;
      fetcher.lexicon.write(row.id, DeckoName.parse(joined), [row.left_id, row.right_id]);
    } else if (row.name !== null && row.name !== "") {
      const name = DeckoName.parse(row.name);
      fetcher.lexicon.write(row.id, name, row.name);
    }
  }
  await inspectOptionalNestCache(driver);
  {
    const [universeResult] = await driver.batch([structureRuleUniverseStatement()]);
    fetcher.virtualCardLookup = createVirtualCardLookup(fetcher, {
      contents: structureUniverseFromResults(universeResult),
      ruleTypeIds: structureRuleTypesFromResults(universeResult),
    });
  }
  try {
    await render.render(HOME_CARD_NAME, OPEN_VIEW);
  } catch (warmError) {
    console.warn(
      `[vm-staging] warm render of ${HOME_CARD_NAME} failed: ${warmError instanceof Error ? warmError.message : String(warmError)}`,
    );
  }
}

async function inspectOptionalNestCache(databaseDriver) {
  const marker = await readNestIndexMarker(databaseDriver);
  if (marker.state !== "current") {
    console.warn(`[vm-staging] optional nest cache ${marker.state}; serving with canonical references and parser fallback; run the explicit nest-index preparation step to build hints`);
  }
  return marker;
}

const fileCardsById = new Map();
{
  const { rows } = await driver.query(
    "SELECT id, name, db_content FROM cards WHERE type_id = 18 AND trash = 0",
    [],
  );
  for (const row of rows) {
    fileCardsById.set(Number(row.id), {
      id: Number(row.id),
      name: row.name,
      dbContent: row.db_content ?? "",
    });
  }
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "\u0026amp;")
    .replace(/</g, "\u0026lt;")
    .replace(/>/g, "\u0026gt;")
    .replace(/"/g, "\u0026quot;");
}

function htmlResponse(status, body, title = "decko-ts staging") {
  return {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Connection": "close",
    },
    body: `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>` +
      `<body>${body}</body></html>`,
  };
}

function jsonResponse(status, body) {
  return {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Connection": "close",
    },
    body: JSON.stringify(body, null, 2),
  };
}

function decodeName(raw) {
  try {
    return decodeURIComponent(raw).replace(/_/g, " ");
  } catch {
    return undefined;
  }
}

async function renderCardSlot(name, view, opts = {}) {
  const candidates = [view, "content", "open", "closed", "core"];
  let lastErr = null;
  for (const v of candidates) {
    try {
      return await render.render(name, v);
    } catch (err) {
      lastErr = err;
    }
  }
  if (opts.fallbackToDb) {
    try {
      const { rows } = await driver.query(
        "SELECT db_content FROM cards WHERE name = ? AND trash = 0 LIMIT 1",
        [name],
      );
      const raw = rows[0]?.db_content;
      if (typeof raw === "string") return raw;
    } catch {}
  }
  throw lastErr ?? new Error(`render failed for ${name}:${view}`);
}

async function expandNestTokens(html) {
  if (typeof html !== "string" || html.length === 0) return html;
  const tokenRe = /\{\{:([^+}]+?)\|([^}]+?)\}\}/g;
  const tokens = new Map();
  for (const m of html.matchAll(tokenRe)) {
    const matchIdx = m.index ?? 0;
    const ctx = classifyTokenContext(html, matchIdx);
    const name = String(m[1]).trim();
    const viewOpts = String(m[2]).trim();
    const view = viewOpts.split(";")[0].trim();
    const key = `${name}|${view}|${ctx}`;
    if (!tokens.has(key)) tokens.set(key, { name, view, ctx });
  }
  const rendered = new Map();
  for (const [key, { name, view, ctx }] of tokens) {
    if (ctx === "attr") {
      const url = await resolveAttributeNest(name, view);
      if (typeof url === "string") rendered.set(key, url);
    } else {
      const viewOrder = [view, "core", "title", "content", "closed", "open"];
      let best = "";
      for (const v of viewOrder) {
        try {
          const html = await renderCardSlot(name, v, { fallbackToDb: false });
          if (html.length > best.length) best = html;
        } catch {
        }
      }
      if (best.length === 0) {
        try {
          const { rows } = await driver.query(
            "SELECT db_content FROM cards WHERE name = ? AND trash = 0 LIMIT 1",
            [name],
          );
          const raw = rows[0]?.db_content;
          if (typeof raw === "string") best = raw;
        } catch {}
      }
      if (best.length > 0) rendered.set(key, best);
    }
  }
  return html.replace(tokenRe, (whole, name, viewOpts, offset) => {
    const view = String(viewOpts).split(";")[0].trim();
    const ctx = classifyTokenContext(html, offset);
    const key = `${name.trim()}|${view}|${ctx}`;
    const sub = rendered.get(key);
    return typeof sub === "string" ? sub : whole;
  });
}

function classifyTokenContext(html, tokenOffset) {
  const before = html.slice(0, tokenOffset);
  const openerRe = /=\s*["']/g;
  const closerRe = /["']/g;
  let lastOpener = -1;
  let m;
  while ((m = openerRe.exec(before)) !== null) {
    lastOpener = m.index + m[0].length - 1;
  }
  let lastCloser = -1;
  while ((m = closerRe.exec(before)) !== null) {
    if (m.index > lastOpener) {
      lastCloser = m.index;
      break;
    }
  }
  return lastOpener > lastCloser ? "attr" : "body";
}

async function resolveAttributeNest(name, view) {
  const baseName = name.startsWith(":") ? name.slice(1) : name;
  if (
    baseName === "home" &&
    (view === "home_path" || view === "home_url")
  ) {
    return "/";
  }
  const urlViews = [view, "home_path", "home_url", "url", "url_link"];
  for (const v of urlViews) {
    try {
      const out = await renderCardSlot(baseName, v, { fallbackToDb: false });
      if (typeof out === "string" && out.length > 0 && out.length < 4096 && !out.includes("<")) {
        return out;
      }
    } catch {
    }
  }
  return undefined;
}

async function safeRenderSetting(name, preferredView, fallbackView) {
  const errorMark = (msg) =>
    `<div class="card-slot card-error" data-error="${escapeHtml(msg)}" data-setting="${escapeHtml(name)}"></div>`;
  const errors = [];
  for (const view of [preferredView, fallbackView]) {
    try {
      return await render.render(name, view);
    } catch (err) {
      errors.push(
        `${view}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  try {
    const { rows } = await driver.query(
      "SELECT db_content FROM cards WHERE name = ? AND trash = 0 LIMIT 1",
      [name],
    );
    const raw = rows[0]?.db_content;
    if (typeof raw === "string" && raw.length > 0) {
      return await expandNestTokens(raw);
    }
  } catch (lookupErr) {
    errors.push(
      `db lookup: ${lookupErr instanceof Error ? lookupErr.message : String(lookupErr)}`,
    );
  }
  return errorMark(errors.join(" | "));
}

const SITE_TITLE_DEFAULT = "Example Site";

async function resolveCardStoredName(slugName) {
  try {
    const norm = (s) => s.replace(/[_ ]/g, " ").replace(/\?$/, "").toLowerCase();
    const want = norm(slugName);
    const { rows } = await driver.query(
      "SELECT name FROM cards WHERE trash = 0",
      [],
    );
    for (const r of rows) {
      if (typeof r.name === "string" && norm(r.name) === want) {
        return r.name;
      }
    }
  } catch {
  }
  return slugName;
}

async function renderNavbarLinks(boot) {
  const mainMenuContent = await fetchCardDbContent("*main menu");
  const items = parseWikiLinkList(mainMenuContent);
  const pointerTypeId = await readCardIdByCodename(driver, "pointer");
  const parts = [`<ul class="navbar-nav">`];
  for (const item of items) {
    const targetType = await fetchCardTypeId(item.target);
    const isPointer = pointerTypeId !== null && targetType === pointerTypeId;
    if (item.target.startsWith("*") && isPointer) {
      const childContent = await fetchCardDbContent(item.target);
      const children = parseDropdownList(childContent);
      parts.push(
        `<li class="nav-item"><li class="nav-item dropdown"><a href="#" class="nav-link dropdown-toggle" data-bs-toggle="dropdown"><span class="card-title" title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</span></a>\n`,
      );
      parts.push(`<div class="dropdown-menu">`);
      parts.push(await renderNavbarDropdownItems(children, anonymousCanReadCardNamed));
      parts.push(`</div></li></li>\r\n`);
    } else {
      const hrefKey = item.target.replace(/ /g, "_").replace(/\$/g, "_");
      parts.push(
        `<li class="nav-item"><a class="nav-link known-card" href="/${escapeHtml(hrefKey)}"><span class="card-title" title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</span></a></li>`,
      );
    }
  }
  parts.push(`</ul>`);
  return parts.join("");
}

async function anonymousCanReadCardNamed(name) {
  let record;
  try {
    record = await render.fetcher.fetchByName(name);
  } catch (error) {
    if (mapRenderError(error instanceof Error ? error.message : String(error)).status === 404) return true;
    throw error;
  }
  if (record === undefined || record.name === undefined) return true;
  const typeRecord = record.typeId !== undefined ? await render.fetcher.fetchById(record.typeId) : undefined;
  return render.canReadCard(record, typeRecord?.name?.s);
}

async function fetchCardTypeId(name) {
  try {
    const { rows } = await driver.query(
      "SELECT type_id FROM cards WHERE name = ? AND trash = 0 LIMIT 1",
      [name],
    );
    if (rows.length > 0 && rows[0].type_id !== null) return Number(rows[0].type_id);
  } catch {}
  return undefined;
}

function parseWikiLinkList(content) {
  const out = [];
  if (typeof content !== "string") return out;
  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const m = /^\[\[([^\]\[|]+?)(?:\|([^\]\[]+?))?\]\]$/.exec(line);
    if (m === null) continue;
    out.push({ target: m[1].trim(), label: (m[2] ?? m[1]).trim() });
  }
  return out;
}

function parseDropdownList(content) {
  const out = [];
  if (typeof content !== "string") return out;
  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (line === "*dropdown divider") {
      out.push({ kind: "divider" });
      continue;
    }
    const wl = /^\[\[([^\]\[|]+?)(?:\|([^\]\[]+?))?\]\]$/.exec(line);
    if (wl !== null) {
      const target = wl[1].trim();
      const label = (wl[2] ?? target).trim();
      out.push({ kind: "link", target, label });
      continue;
    }
    const ext = /^(https?:\/\/\S+)\|(\S.*)$/.exec(line);
    if (ext !== null) {
      out.push({ kind: "external", target: ext[1], label: ext[2].trim() });
      continue;
    }
    out.push({ kind: "link", target: line, label: line });
  }
  return out;
}

async function fetchCardDbContent(name) {
  try {
    const { rows } = await driver.query(
      "SELECT db_content FROM cards WHERE name = ? AND trash = 0 LIMIT 1",
      [name],
    );
    if (rows.length > 0 && typeof rows[0].db_content === "string") {
      return rows[0].db_content;
    }
  } catch {}
  return "";
}

async function fetchCardByName(name) {
  try {
    const { rows } = await driver.query(
      "SELECT id, name, db_content, type_id, left_id, right_id FROM cards WHERE name = ? AND trash = 0 LIMIT 1",
      [name],
    );
    if (rows.length > 0) return rows[0];
  } catch {}
  return undefined;
}

function parseMainViewFromLayoutBody(body) {
  if (typeof body !== "string" || body.length === 0) return "content";
  const m = /\{\{_\s*main\s*\|\s*([A-Za-z0-9_]+)/.exec(body);
  if (m !== null && typeof m[1] === "string" && m[1].length > 0) return m[1];
  return "content";
}

async function renderFooterContent() {
  const creditImage = await fetchCardDbContent("*credit_image");
  const version = "0.19.1";
  const svg = (creditImage.length > 0 ? creditImage : "").replace(/\n$/, "");
  const body =
    `<div class="d-flex justify-content-center align-items-center">\n` +
    `  ${svg}\n` +
    `<a href="http://decko.org">Decko v${escapeHtml(version)}</a>\n` +
    `\n` +
    `</div>`;
  const slot = {
    view: "content",
    nest_name: "*footer",
    nest_syntax: ":footer|content",
    show: ["content"],
    home_view: "content",
  };
  const footer = await readFooterCardIdentity(driver, FOOTER_SETTING_NAME);
  if (footer === null) return body;
  const slotId = FOOTER_SLOT_ID ?? newSlotId();
  return (
    `<div id="Xfooter-content-view" class="card-slot content-view ALL TYPE-html STAR SELF-Xfooter d0-card-content" data-card-id="${escapeHtml(footer.id)}" data-card-name="*footer" data-card-type-id="${escapeHtml(footer.typeId ?? "")}" data-card-type-name="${escapeHtml(footer.typeName ?? "")}" data-card-link-name="*footer" data-slot-id="${slotId}" data-slot="${escapeHtml(JSON.stringify(slot))}">${body}</div>`
  );
}

async function wrapWithLayout(cardName, viewHtml, layout, pageOpts = {}) {
  const boot = await readSiteBootValues(driver, SPACES_HOST, SITE_TITLE_DEFAULT);
  const storedName = await resolveCardStoredName(cardName);
  const rawHeaderHtml = await fetchCardDbContent(HEADER_SETTING_NAME);
  const footerHtml = await renderFooterContent();
  const headerHtml = await substituteHeaderTokens(rawHeaderHtml, boot);
  const bodyProcessed = viewHtml;
  const pageTitle = pageOpts.titleText ?? `${storedName} - ${boot.siteTitle}`;
  const cssUrl = MAIN_CSS_URL;
  const jsUrl = MAIN_JS_URL;
  if (typeof layout?.layoutBody !== "string" || layout.layoutBody.length === 0) {
    throw new Error(
      `layout body missing or empty for card ${cardName} (layout: ${layout?.layoutName ?? "unresolved"}); ` +
        `live serves an error page for empty layouts, so no Default-Layout body is imported`,
    );
  }
  const bodyTagMatch = /<body(\s[^>]*)?>/.exec(layout.layoutBody);
  if (bodyTagMatch === null) {
    throw new Error(
      `layout body for ${layout.layoutName} carries no <body> tag; cannot build the shell`,
    );
  }
  const bodyOpenEnd = bodyTagMatch.index + bodyTagMatch[0].length;
  const bodyCloseStart = layout.layoutBody.lastIndexOf("</body>");
  if (bodyCloseStart < bodyOpenEnd) {
    throw new Error(
      `layout body for ${layout.layoutName} carries no closing </body>; cannot build the shell`,
    );
  }
  const layoutInner = layout.layoutBody.slice(bodyOpenEnd, bodyCloseStart);
  const renderedInner = layoutInner
    .replace(/\{\{:header\|core\}\}/g, () => headerHtml)
    .replace(/\{\{:footer\|content\}\}/g, () => footerHtml)
    .replace(/\{\{\*foot\|core\}\}/g, () => "")
    .replace(
      /\{\{_main(?:\s*\|\s*([A-Za-z0-9_]+))?\}\}/g,
      () => `<div id="main">${bodyProcessed}</div>`,
    );
  const unresolvedTokens = renderedInner.match(/\{\{[^}]*\}\}/g);
  if (unresolvedTokens !== null) {
    console.warn(
      `[vm-staging] layout ${layout.layoutName} carries tokens the shell builder does not resolve: ${unresolvedTokens.join(", ")}`,
    );
  }
  return (
    `      <!DOCTYPE HTML>\n` +
    `      <html class="h-100">\n` +
    `        <head>\n` +
    `          <title>${escapeHtml(pageTitle)}</title>\n` +
    `<meta charset='UTF-8'>\n` +
    `<meta content='width=device-width, initial-scale=1.0' name='viewport'>\n` +
    (pageOpts.headExtraLine ?? "") +
    `\n` +
    (boot.faviconUrl === null ? "" : `<link rel="shortcut icon" href="${escapeHtml(boot.faviconUrl)}" />\n`) +
    materialIconsHeadTag(render.materialIconsAssetMode) + `\n` +
    (cssUrl === undefined ? "" : `<link media="all" rel="stylesheet" type="text/css" href="${escapeHtml(cssUrl)}" />\n`) +
    `\n` +
    `<!-- mod: format (remote) -->\n` +
    `<script src="https://code.jquery.com/jquery-3.5.1.min.js" crossorigin="anonymous" integrity="sha256-9/aliU8dGd2tb6OSsuzixeV4y/faTqgFtohetphbbj0="></script>\n` +
    `<script src="https://cdnjs.cloudflare.com/ajax/libs/jquery-ujs/1.2.3/rails.min.js" crossorigin="anonymous" integrity="sha512-yDJWVxuRSkQa1u9/Zif6Gh93Gk0Urboz98JLEPcERMQ+pTHz/c27d0Xz08G+lgutFyKklB9UILtnhG6bth6B4A==" referrerpolicy="no-referrer"></script>\n` +
    `<!-- mod: ace editor (remote) -->\n` +
    `<script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.18.0/ace.min.js" crossorigin="anonymous" integrity="sha512-xcE2qpHHeRGdUixQ0W0CRrb5RcfFLPol+7Kbix/fxXMnB+Dg4ECW3pldd3gY3bOOqcKQ3wv4IHJKUbSlgn83Qw=="></script>\n` +
    `<!-- mod: bootstrap (remote) -->\n` +
    `<script src="https://cdnjs.cloudflare.com/ajax/libs/select2/4.0.6-rc.1/js/select2.full.min.js" crossorigin="anonymous" integrity="sha512-Y4+u+T/6DpDb2AkTrxs3eJiN9o/u+l8pLNt0lSRKnJe2wIDVCwd7N8afy+70Pmr5FtmoX5IXmwK6H7Jlb8Nx8A==" referrerpolicy="no-referrer"></script>\n` +
    fontAwesomeHeadTag(render.fontAwesomeAssetMode) + `\n` +
    `<!-- MAIN DECKO JAVASCRIPT -->\n` +
    (jsUrl === undefined ? "" : `<script src="${escapeHtml(jsUrl)}"></script>\n`) +
    `<script>\n` +
    `//<![CDATA[\n` +
    `decko.rootUrl='https://example.org/';\n` +
    `decko.doubleClick='signed_in';\n` +
    (cssUrl === undefined ? "" : `decko.cssPath='${escapeHtml(cssUrl)}';\n`) +
    `decko.signed_in=false;\n` +
    `\n` +
    `//]]>\n` +
    `</script>\n` +
    `<script>\n` +
    `//<![CDATA[\n` +
    `decko.setAceConfig('{\\n  \\"default\\": {\\n  \\"showGutter\\": true,\\n  \\"theme\\": \\"ace/theme/github\\",\\n  \\"printMargin\\": false,\\n  \\"tabSize\\": 2,\\n  \\"useSoftTabs\\": true,\\n  \\"maxLines\\": 30\\n  }\\n}\\n')\n` +
    `\n` +
    `decko.setTinyMCEConfig('{\\n  \\"theme\\": \\"silver\\",\\n  \\"menubar\\": \\"edit view insert format table\\",\\n  \\"plugins\\": \\"autoresize code lists hr link autolink table\\",\\n  \\"toolbar1\\": \\"formatselect | bold italic strikethrough forecolor backcolor | deckolink nest |   | numlist bullist outdent indent  | removeformat\\",\\n  \\"width\\":\\"100%\\",\\n  \\"auto_resize\\":true,\\n  \\"autoresize_max_height\\": 500,\\n  \\"relative_urls\\":false,\\n  \\"extended_valid_elements\\":\\"a[name|href|target|title|onclick],img[class|src|border=0|alt|title|hspace|vspace|width|height|align|onmouseover|onmouseout|name],hr[class|width|size|noshade],font[face|size|color|style],span[class|align|style]\\"\\n }\\n')\n` +
    `\n` +
    `$('document').ready(function() { $('.card-slot').trigger('decko.slot.ready'); })\n` +
    `//]]>\n` +
    `</script>\n` +
    `        </head>\n` +
    `        ${layout.layoutBody.slice(bodyTagMatch.index, bodyOpenEnd)}${renderedInner}${pageOpts.bodyExtraHtml ?? ""}</body>\n` +
    `      </html>\n`
  );
}

async function substituteHeaderTokens(headerHtml, boot) {
  if (typeof headerHtml !== "string" || headerHtml.length === 0) return headerHtml;
  let out = headerHtml.replace(/\{\{:home\|home_path\}\}/g, "/");
  out = out.replace(
    /\{\{:logo\|core;size:small\}\}/g,
    boot.logoUrl === null ? "" : `<img alt="*logo" src="${escapeHtml(boot.logoUrl)}" />`,
  );
  out = out.replace(/\{\{:title\|core\}\}/g, escapeHtml(boot.siteTitle));
  const navLinks = await renderNavbarLinks(boot);
  out = out.replace(/\{\{:main_menu\|navbar_links\}\}/g, navLinks);
  out = out.replace(
    /\{\{:search\|search_box\}\}/g,
    `<div class='d0-search-box'>\n` +
      `<form role="search" class="search-box-form" action="/*search" accept-charset="UTF-8" method="get"><input name="utf8" type="hidden" value="&#x2713;" autocomplete="off" /><input type="text" name="query[keyword]" id="query_keyword" class="_search-box search-box form-control w-100" autocomplete="off" data-completepath="/*search/search_box_complete.json" placeholder="Search" /></form>\n` +
      `</div>\n`,
  );
  out = out.replace(
    /\{\{:account_links\|navbar_links\}\}/g,
    `<ul class="navbar-nav"><li class="nav-item"><a class="nav-link signup-link known-card" href="/new/Sign_up">Sign up</a></li>\n` +
      `<li class="nav-item"><a class="nav-link signin-link known-card" href="/*signin">Sign in</a></li></ul>`,
  );
  return out;
}

const NOT_FOUND_FALLBACK_TYPE = { id: "", name: "Basic", classToken: "basic" };

function notFoundSlotOptionsJson() {
  return JSON.stringify({
    view: "titled",
    nest_name: "_main",
    nest_syntax: "_main|titled",
    hide: ["menu", "help"],
    main: true,
    home_view: "titled",
    main_view: true,
    layout: "Default Layout",
  });
}

function buildNotFoundSlotHtml(displayName, nameKey, urlKey, defaultType) {
  const slotJson = notFoundSlotOptionsJson();
  const type = defaultType === null
    ? NOT_FOUND_FALLBACK_TYPE
    : { id: String(defaultType.id), name: defaultType.name, classToken: defaultType.classToken };
  return (
    `<div id="${escapeHtml(`${nameKey}-not_found-view`)}" ` +
    `class="card-slot not_found-view ALL TYPE-${escapeHtml(type.classToken)}" ` +
    `data-card-name="${escapeHtml(displayName)}" ` +
    `data-card-type-id="${escapeHtml(type.id)}" ` +
    `data-card-type-name="${escapeHtml(type.name)}" ` +
    `data-card-link-name="${escapeHtml(urlKey)}" ` +
    `data-slot-id="${newSlotId()}" ` +
    `data-slot="${escapeHtml(slotJson)}">` +
    `<div class="d0-card-frame card">` +
    `<div class="d0-card-header card-header">` +
    `<h1 class="d0-card-header-title">` +
    `<span class="card-title" title="Not Found">Not Found</span></h1></div>\n` +
    `\n` +
    `<div class="d0-card-body card-body card-text"><h2>\n` +
    `Could not find\n` +
    `<em>\n` +
    `${escapeHtml(displayName)}\n` +
    `</em>\n` +
    `</h2>\n` +
    `\n` +
    `<div>Please <a class="signin-link known-card" href="/*signin/titled">sign in</a> or ` +
    `<a class="signup-link known-card" href="/new/Sign_up">sign up</a> to create it.</div>` +
    `</div></div></div>`
  );
}

function buildServerErrorSlotHtml() {
  return (
    `<div class='border border-danger text-center p-3'>\n` +
    `<h1>Wild Card!</h1>\n` +
    `<h2 class='alert-danger'>500 Server Error</h2>\n` +
    `<h4 class='p-3'>\n` +
    `Yuck, sorry about that.\n` +
    `</h4>\n` +
    `</div>\n`
  );
}

function urlDisplayNameForSlug(slugName) {
  return slugName.replace(/_/g, " ");
}

async function resolveDefaultLayout() {
  let ruleRow;
  try {
    const { rows } = await driver.query(
      "SELECT rule.id AS id, rule.db_content AS db_content" +
        " FROM cards rule" +
        " JOIN cards all_card ON rule.left_id = all_card.id AND all_card.trash = 0" +
        " JOIN cards setting ON rule.right_id = setting.id AND setting.trash = 0" +
        " WHERE all_card.codename = 'all' AND setting.codename = 'layout' AND rule.trash = 0 LIMIT 1",
      [],
    );
    ruleRow = rows[0];
  } catch {}
  const layoutName =
    typeof ruleRow?.db_content === "string" && ruleRow.db_content.length > 0
      ? ruleRow.db_content
      : "Default Layout";
  let layoutBody = "";
  try {
    const layoutRow = await fetchCardByName(layoutName);
    if (typeof layoutRow?.db_content === "string") {
      layoutBody = layoutRow.db_content;
    }
  } catch {}
  if (typeof layoutBody !== "string" || layoutBody.length === 0) {
    throw new Error(
      `default layout "${layoutName}" has no body in the corpus; cannot build the error page chrome`,
    );
  }
  return {
    ruleId: ruleRow?.id ?? null,
    layoutName,
    layoutBody,
    mainView: parseMainViewFromLayoutBody(layoutBody),
    source: "all-fallback",
  };
}

async function renderDeckoErrorPage(cardName, kind) {
  try {
    const layout = await resolveDefaultLayout();
    const isNotFound = kind === "not_found";
    const displayName = urlDisplayNameForSlug(cardName);
    const boot = await readSiteBootValues(driver, SPACES_HOST, SITE_TITLE_DEFAULT);
    let viewHtml;
    let pageOpts;
    if (isNotFound) {
      const parsed = DeckoName.parse(displayName);
      viewHtml = buildNotFoundSlotHtml(displayName, parsed.key, parsed.urlKey, await readDefaultCardType(driver));
      pageOpts = {
        headExtraLine: `<meta content='noindex' name='robots'>\n`,
        titleText: `${displayName} - ${boot.siteTitle}`,
      };
    } else {
      const arm = await serverErrorArm(stagingDebuggerReader());
      serverErrorStatus = arm.status;
      viewHtml = arm.view === "debug_server_error"
        ? buildDebugServerErrorSlotHtml()
        : buildServerErrorSlotHtml();
      pageOpts = {};
    }
    const body = await wrapWithLayout(cardName, viewHtml, layout, pageOpts);
    return {
      status: isNotFound ? 404 : serverErrorStatus,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Connection": "close",
        "Keep-Alive": "timeout=0",
      },
      body,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[vm-staging] error page build failed for ${cardName} (${kind}): ${message}; serving minimal stub`,
    );
    if (kind === "not_found") {
      return htmlResponse(
        404,
        `<h1>Card not found</h1><pre>${escapeHtml(`card not found: ${cardName}`)}</pre>` +
          `<p><a href="/">Home</a> · <a href="/_status">status</a></p>`,
        "Card not found",
      );
    }
    return htmlResponse(
      serverErrorStatus,
      `<h1>Render error</h1><pre>${escapeHtml(message)}</pre>`,
      "Render error",
    );
  }
}

let serverErrorStatus = 500;

function stagingDebuggerReader() {
  return {
    hasDebuggerCodename() {
      return render.fetcher.codenames.peekId("debugger") !== undefined;
    },
    async debuggerCardContent() {
      const name = render.fetcher.codenames.peekName("debugger");
      if (name === undefined) return undefined;
      const record = await render.fetcher.bracket(name);
      return record?.dbContent ?? undefined;
    },
  };
}

function buildDebugServerErrorSlotHtml() {
  return debugServerErrorView({});
}

const SERVED_ASSET_HOST_PREFIX = "http://s3.amazonaws.com//files/";
function storedAssetRevision(cardId) {
  if (cardId === undefined) return undefined;
  const stored = (fileCardsById.get(cardId)?.dbContent ?? "").trim();
  const match = /^(?:\([^)\/\s]*\)\/|~)([0-9]+\/[^\/\s]+)$/.exec(stored);
  return match !== null && match[1].startsWith(`${cardId}/`) ? match[1] : undefined;
}
const SERVED_CSS_REVISION = storedAssetRevision(MAIN_STYLESHEET_CARD_ID);
const SERVED_CSS_REVISION_LIVE = MAIN_STYLESHEET_PATH;
const SERVED_SCRIPT_INTEGRITY = [
  {
    src: `<script src="https://code.jquery.com/jquery-3.5.1.min.js" crossorigin="anonymous"></script>`,
    withIntegrity: `<script src="https://code.jquery.com/jquery-3.5.1.min.js" crossorigin="anonymous" integrity="sha256-9/aliU8dGd2tb6OSsuzixeV4y/faTqgFtohetphbbj0="></script>`,
  },
  {
    src: `<script src="https://cdnjs.cloudflare.com/ajax/libs/jquery-ujs/1.2.3/rails.min.js" crossorigin="anonymous" referrerpolicy="no-referrer"></script>`,
    withIntegrity: `<script src="https://cdnjs.cloudflare.com/ajax/libs/jquery-ujs/1.2.3/rails.min.js" crossorigin="anonymous" integrity="sha512-yDJWVxuRSkQa1u9/Zif6Gh93Gk0Urboz98JLEPcERMQ+pTHz/c27d0Xz08G+lgutFyKklB9UILtnhG6bth6B4A==" referrerpolicy="no-referrer"></script>`,
  },
  {
    src: `<script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.18.0/ace.min.js" crossorigin="anonymous"></script>`,
    withIntegrity: `<script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.18.0/ace.min.js" crossorigin="anonymous" integrity="sha512-xcE2qpHHeRGdUixQ0W0CRrb5RcfFLPol+7Kbix/fxXMnB+Dg4ECW3pldd3gY3bOOqcKQ3wv4IHJKUbSlgn83Qw=="></script>`,
  },
  {
    src: `<script src="https://cdnjs.cloudflare.com/ajax/libs/select2/4.0.6-rc.1/js/select2.full.min.js" crossorigin="anonymous" referrerpolicy="no-referrer"></script>`,
    withIntegrity: `<script src="https://cdnjs.cloudflare.com/ajax/libs/select2/4.0.6-rc.1/js/select2.full.min.js" crossorigin="anonymous" integrity="sha512-Y4+u+T/6DpDb2AkTrxs3eJiN9o/u+l8pLNt0lSRKnJe2wIDVCwd7N8afy+70Pmr5FtmoX5IXmwK6H7Jlb8Nx8A==" referrerpolicy="no-referrer"></script>`,
  },
];
function applyServedEnvironmentDeltas(engineHtml) {
  if (STOCK_DECK) return engineHtml;
  let body = engineHtml;
  body = body.split(SERVED_ASSET_HOST_PREFIX).join(`${SPACES_HOST}/files/`);
  if (SERVED_CSS_REVISION !== undefined && SERVED_CSS_REVISION_LIVE !== undefined) {
    body = body.split(SERVED_CSS_REVISION).join(SERVED_CSS_REVISION_LIVE);
  }
  body = rewriteDeploymentLegacyAssetRevisions(body, SPACES_HOST, deploymentLegacyAssets?.revisions ?? {});
  for (const { src, withIntegrity } of SERVED_SCRIPT_INTEGRITY) {
    body = body.split(src).join(withIntegrity);
  }
  body = body.split(`>Decko v</a>`).join(`>Decko v0.19.1</a>`);
  if (!body.endsWith("\n")) body += "\n";
  return body;
}

class CardRouteBadRequestError extends Error {
  constructor() {
    super("Malformed encoded card route");
    this.name = "CardRouteBadRequestError";
  }
}

function parseNewCardRoute(segs, query) {
  let typeName;
  let mark;
  if (segs.length === 2 && segs[0] === "new" && segs[1] !== "") {
    typeName = decodeName(segs[1]);
    if (typeName === undefined) throw new CardRouteBadRequestError();
  } else if (segs[0] === "card" && segs[1] === "new" && segs.length <= 3) {
    mark = segs[2] ? decodeName(segs[2]) : undefined;
    if (segs[2] && mark === undefined) throw new CardRouteBadRequestError();
  } else {
    return null;
  }
  return { name: mark ?? query.get("card[name]") ?? "", mark, typeName };
}

async function newCardRenderParams(mark, query, routeType) {
  const newCard = {};
  const name = query.get("card[name]") ?? (mark ? mark.replace(/_/g, " ") : undefined);
  if (name !== undefined) newCard.name = name;
  const cardType = query.get("card[type]");
  const requestType = routeType ?? query.get("type");
  const typeName = cardType ?? requestType;
  if (typeName !== undefined && typeName !== null) {
    const typeCard = typeName === "" ? undefined : await fetcher.fetchByName(typeName);
    if (typeCard?.id !== undefined) newCard.typeId = typeCard.id;
    newCard.typeName = typeName;
    newCard.typePreset = requestType !== undefined && requestType !== null;
  }
  const content = query.get("card[content]");
  if (content !== null) newCard.content = content;
  return { newCard };
}

async function renderCardPage(cardName, renderEngine = render, requestedView, renderParams, pageOpts = {}) {
  recordAsMain(pageOpts.mainParam, cardName);
  if (pageOpts.assignPresent === true && pageOpts.cardTypeParam !== undefined) {
    renderParams = { ...(renderParams ?? {}), assignedType: pageOpts.cardTypeParam };
  }
  if (pageOpts.editDraftPresent === true) {
    const draftCard = await renderEngine.fetcher.fetchByName(cardName);
    if (draftCard?.id !== undefined) {
      const draft = await lastDraftContent(fetcher.driver, draftCard.id);
      if (draft !== undefined) {
        renderParams = { ...(renderParams ?? {}), contentOverride: draft };
      }
    }
  }
  try {
    if (pageOpts.bare) {
      const view = requestedView ?? renderEngine.defaultHtmlViewConfig();
      renderEngine.pageErrorStatus = undefined;
      const slotParams = pageOpts.slotParams;
      const slotShow = slotParams?.show;
      const bareRenderParams =
        slotShow === undefined
          ? renderParams
          : {
              ...(renderParams ?? {}),
              viewOpts: { ...(renderParams?.viewOpts ?? {}), show: slotShow },
            };
      if (slotParams?.main === "true") {
        const { html, status } = await renderPageWithStatus(
          renderEngine,
          cardName,
          view,
          bareRenderParams,
          {
            nest_name: "_main",
            nest_syntax: `_main|${view}`,
            main: true,
            home_view: slotParams.home_view ?? view,
          },
        );
        return {
          status,
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
          body: html,
        };
      }
      const html = await renderEngine.render(cardName, view, bareRenderParams);
      return {
        status: renderEngine.pageErrorStatus ?? 200,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
        body: html,
      };
    }
    const { html: engineHtml, status } = await renderPageWithStatus(
      renderEngine, cardName, requestedView, renderParams,
    );
    const body = applyServedEnvironmentDeltas(engineHtml);
    return {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Connection": "close",
        "Keep-Alive": "timeout=0",
      },
      body,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof Error && error.name === "UnsupportedViewError") {
      return htmlResponse(
        422,
        `<pre>${escapeHtml(message)}</pre>`,
        "Error (unsupported view)",
      );
    }
    if (STOCK_DECK && !pageOpts.bare && isUpstreamMatchError(error)) {
      try {
        const { html } = await renderPageWithStatus(renderEngine, cardName, "server_error", {});
        return {
          status: 500,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "Connection": "close",
            "Keep-Alive": "timeout=0",
          },
          body: applyServedEnvironmentDeltas(html),
        };
      } catch (pageError) {
        const pageMessage = pageError instanceof Error ? pageError.message : String(pageError);
        console.error(`[vm-staging] server_error page render failed for ${cardName}: ${pageMessage}`);
      }
    }
    if (/^card not found: /.test(message)) {
      return renderDeckoErrorPage(cardName, "not_found");
    }
    console.error(`[vm-staging] render 500 on ${cardName}: ${message}\n${error instanceof Error ? error.stack : ""}`);
    return renderDeckoErrorPage(cardName, "server_error");
  }
}

async function renderCardView(cardName, view, renderEngine = render) {
  const headers = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Connection": "close",
    "Keep-Alive": "timeout=0",
  };
  try {
    const html = await renderEngine.render(cardName, view);
    return { status: 200, headers, body: html };
  } catch (error) {
    const cls = error instanceof Error ? error.name : "Error";
    const message = error instanceof Error ? error.message : String(error);
    return { status: 200, headers, body: `CAPTURE_ERROR: ${cls}: ${message}` };
  }
}

async function nameMatchJsonResponse(url, renderEngine) {
  const rawTerm = (url.searchParams.get("term") ?? url.searchParams.get("query[keyword]") ?? "").trim();
  const view = url.searchParams.get("view");
  const names = await matchingCardNames(renderEngine, rawTerm.toLowerCase(), view !== "name_complete");
  return {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    body: JSON.stringify(names),
  };
}

async function matchingCardNames(renderEngine, term, contains) {
  const limit = 8;
  const like = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
  const names = [];
  const scope = await renderEngine.cqlPermissionOptions();
  const readRuleSql = scope.alwaysOk ? "" : ` and read_rule_id in (${scope.readRuleIds.map(() => "?").join(",") || "NULL"})`;
  const pick = async (pattern) => {
    const excluded = [...names];
    const notIn = excluded.length > 0 ? ` and name not in (${excluded.map(() => "?").join(",")})` : "";
    let offset = 0;
    while (names.length < limit) {
      const result = await renderEngine.fetcher.driver.query(
        `select id, name from cards where trash = 0 and name is not null and lower(name) like ? escape '\\'${readRuleSql}${notIn} order by name limit ? offset ?`,
        [pattern, ...(scope.alwaysOk ? [] : scope.readRuleIds), ...excluded, limit, offset],
      );
      for (const row of result.rows) {
        const record = await renderEngine.fetcher.fetchById(row.id);
        if (record !== undefined && await renderEngine.canReadCard(record)) names.push(row.name);
        if (names.length === limit) break;
      }
      if (result.rows.length < limit) break;
      offset += result.rows.length;
    }
  };
  await pick(`${like(term)}%`);
  if (contains && term !== "" && names.length < limit) await pick(`%${like(term)}%`);
  return names;
}

function isRssRequest(pathname, searchParams) {
  const segments = pathname.replace(/\/+$/, "").replace(/^\/+/, "").split("/").filter(Boolean);
  if (segments.length > 3) return false;
  if (segments.length === 3 && segments[1] !== "view") {
    return false;
  }
  return pathname.endsWith(".rss") || searchParams.get("format") === "rss";
}

async function rssFormatResponse(url, renderEngine) {
  const pathname = url.pathname;
  const segmentsRaw = pathname.replace(/\/+$/, "").replace(/^\/+/, "").split("/").filter(Boolean);
  const threeSegmentViewArm = segmentsRaw.length === 3 && segmentsRaw[1] === "view";
  const suffix = (segmentsRaw.length <= 2 || threeSegmentViewArm) && pathname.endsWith(".rss");
  const normalized = suffix ? pathname.slice(0, -".rss".length) : pathname;
  const segments = normalized.replace(/\/+$/, "").replace(/^\/+/, "").split("/").filter(Boolean);
  const mark = decodeName(segments[0] ?? "");
  if (mark === undefined || mark === "") {
    return jsonResponse(404, { error: "card not found", name: "" });
  }
  const view = segments.length > 1
    ? segments[threeSegmentViewArm ? 2 : 1]
    : url.searchParams.get("view") || url.searchParams.get("v") || "feed";
  const fetcherForDeck = renderEngine.fetcher;
  const emptyRss = () => ({
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    body: "",
  });
  let record;
  try {
    record = await fetcherForDeck.fetchByName(mark);
  } catch (error) {
    if (mapRenderError(error instanceof Error ? error.message : String(error)).status !== 404) throw error;
    return emptyRss();
  }
  if (record === undefined || record.name === undefined) {
    return emptyRss();
  }
  const typeRecord = record.typeId !== undefined
    ? await fetcherForDeck.fetchById(record.typeId) : undefined;
  if (!await renderEngine.canReadCard(record, typeRecord?.name?.s)) {
    return jsonResponse(403, { error: "permission denied", name: mark });
  }
  const body = view === undefined || view === "feed"
    ? await renderFormatShow({
      fetchRenderCard: name => renderEngine.fetchRenderCard(name),
      prepareItemForRender: name => renderEngine.prepareItemForRender(name),
      render: (name, v) => renderEngine.render(name, v),
      codenameById: id => fetcherForDeck.codenames.nameForId(id),
    }, record.name.s, "rss", { rssEnabled: false })
    : await renderEngine.render(record.name.s, view, {
      format: "rss", requestUrl: url.href, focalRoot: true,
    });
  return {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body,
  };
}

function registeredFormatRoute(pathname, searchParams) {
  const segments = pathname.replace(/\/+$/, "").replace(/^\/+/, "").split("/").filter(Boolean);
  if (segments.length === 0 || segments.length > 3) return undefined;
  const split = splitRegisteredFormatSuffix(segments[segments.length - 1]);
  if (split === undefined) return undefined;
  const format = split.format;
  if (segments.length === 1) {
    const name = decodeName(split.base);
    if (name === undefined || name === "") return undefined;
    const requested = searchParams.get("view") || searchParams.get("v") || undefined;
    return { name, view: requested ?? registeredFormatDefaultView(format), format };
  }
  if (segments.length === 2) {
    const name = decodeName(segments[0]);
    const view = decodeViewSegmentJson(split.base);
    if (name === undefined || view === undefined || name === "" || view === "") return undefined;
    return { name, view, format };
  }
  if (segments[1] !== "view") return undefined;
  const name = decodeName(segments[0]);
  const view = decodeViewSegmentJson(split.base);
  if (name === undefined || view === undefined || name === "" || view === "") return undefined;
  return { name, view, format };
}

async function registeredFormatResponse(route, url, renderEngine = render) {
  const fetcherForDeck = renderEngine.fetcher;
  const record = await fetcherForDeck.fetchByName(route.name);
  if (record === undefined || record.name === undefined) {
    return jsonResponse(404, { error: "card not found", name: route.name });
  }
  const answer = await renderRegisteredFormat(
    {
      render: (name, view, params) => renderEngine.render(name, view, params),
      renderCsvFormat: async (name) => await renderFormatShow({
        fetchRenderCard: n => renderEngine.fetchRenderCard(n),
        prepareItemForRender: n => renderEngine.prepareItemForRender(n),
        render: (n, v) => renderEngine.render(n, v),
        codenameById: id => fetcherForDeck.codenames.nameForId(id),
      }, name, "csv", {}),
    },
    record.name.s,
    route.format,
    route.view,
    url.href,
    url.searchParams.get("disposition"),
  );
  return {
    status: answer.status,
    headers: { "Content-Type": answer.contentType, "Cache-Control": "no-store" },
    body: answer.body,
  };
}

async function cardRecordJson(cardName, renderEngine = render) {
  let record;
  try {
    record = await fetcher.fetchByName(cardName);
  } catch (error) {
    if (mapRenderError(error instanceof Error ? error.message : String(error)).status !== 404) throw error;
    return jsonResponse(404, { error: "card not found", name: cardName });
  }
  if (record === undefined || record.name === undefined) {
    return jsonResponse(404, { error: "card not found", name: cardName });
  }
  const typeRecord =
    record.typeId !== undefined ? await fetcher.fetchById(record.typeId) : undefined;
  const readable = await renderEngine.canReadCard(record, typeRecord?.name?.s);
  if (!readable) {
    return jsonResponse(403, { error: "permission denied", name: cardName });
  }
  return jsonResponse(200, {
    id: record.id ?? null,
    name: record.name.s,
    key: record.name.key ?? null,
    type_id: record.typeId ?? null,
    type_name: typeRecord?.name?.s ?? null,
    codename: record.codename ?? null,
    left_id: record.leftId ?? null,
    right_id: record.rightId ?? null,
    trash: record.trash,
    created_at: record.createdAt ?? null,
    updated_at: record.updatedAt ?? null,
    creator_id: record.creatorId ?? null,
    updater_id: record.updaterId ?? null,
    db_content:
      record.name?.rightName?.key === "*password" ? "encrypted" : (record.dbContent ?? null),
  });
}

function decodeViewSegmentJson(raw) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}

async function renderCardViewJson(cardName, view, url, renderEngine = render) {
  const search = jsonViewSearchParams(url.searchParams);
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Connection": "close",
  };
  try {
    const body = await renderEngine.render(cardName, view, {
      ...(search !== undefined ? { search } : {}),
      format: "json",
      requestUrl: url.href,
      ...(url.searchParams.has("compress") ? { compress: url.searchParams.get("compress") } : {}),
    });
    return { status: 200, headers, body };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof Error && error.name === "UnsupportedViewError") {
      return {
        status: 422,
        headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
        body: message,
      };
    }
    return jsonResponse(500, { error: message });
  }
}

const CARD_FORMAT_CONTENT_TYPES = {
  rss: "text/html; charset=utf-8",
  csv: "text/comma-separated-values; charset=utf-8",
};

const CARD_FORMAT_CACHE_CONTROL = "max-age=0, private, must-revalidate";

function cardFormatRequest(pathname, searchParams) {
  const queryFormat = searchParams.get("format");
  if (queryFormat !== null && queryFormat in CARD_FORMAT_CONTENT_TYPES) {
    const suffix = /\.(json|rss|csv)$/i.exec(pathname);
    if (suffix === null) {
      const mark = pathname === "/" ? "" : pathname.slice(1);
      return mark.includes("/") ? undefined : { mark, format: queryFormat };
    }
  }
  const match = /\.(rss|csv)$/i.exec(pathname);
  if (match === null) return undefined;
  const mark = pathname.slice(0, match.index).slice(1);
  if (mark === "" || mark.includes("/")) return undefined;
  return { mark, format: match[1].toLowerCase() };
}

function stagingFormatEngineSurface(renderEngine, fetchEngine) {
  return {
    fetchRenderCard: (name) => renderEngine.fetchRenderCard(name),
    prepareItemForRender: (name) => renderEngine.prepareItemForRender(name),
    render: (name, view) => renderEngine.render(name, view),
    codenameById: async (id) => await fetchEngine.codenames.nameForId(id),
  };
}

async function cardFormatShowResponse(mark, format, renderEngine = render, fetchEngine = fetcher, options = {}) {
  const home = mark === "";
  let record;
  try {
    record = home
      ? await fetchEngine.fetchByName(HOME_CARD_NAME)
      : await fetchEngine.fetchByName(decodeName(mark));
  } catch (error) {
    if (mapRenderError(error instanceof Error ? error.message : String(error)).status === 404) {
      record = undefined;
    } else {
      throw error;
    }
  }
  const contentType = CARD_FORMAT_CONTENT_TYPES[format];
  if (record === undefined || record.name === undefined) {
    if (format === "rss") {
      return {
        status: 200,
        headers: { "Content-Type": contentType, "Cache-Control": "no-cache", "Connection": "close" },
        body: "",
      };
    }
    const name = record?.name?.s ?? decodeName(mark);
    return {
      status: 404,
      headers: { "Content-Type": contentType, "Cache-Control": "no-cache", "Connection": "close" },
      body: `Could not find ${name}.`,
    };
  }
  const typeRecord = record.typeId === undefined ? undefined : await fetchEngine.fetchById(record.typeId);
  if (!(await renderEngine.canReadCard(record, typeRecord?.name?.s))) return undefined;
  try {
    const body = format === "rss" && options.view && options.view !== "feed"
      ? await renderEngine.render(record.name.s, options.view, {format: "rss", requestUrl: options.requestUrl, focalRoot: true})
      : await renderFormatShow(
      stagingFormatEngineSurface(renderEngine, fetchEngine),
      record.name.s,
      format,
      {
        rssEnabled: false,
      },
    );
    return {
      status: 200,
      headers: { "Content-Type": contentType, "Cache-Control": CARD_FORMAT_CACHE_CONTROL, "Connection": "close" },
      body,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (format === "rss" && options.view) {
      const mapped = mapRenderError(message);
      return jsonResponse(mapped.status, {error: mapped.title, message});
    }
    return {
      status: 500,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Connection": "close" },
      body: `<h1>Render error</h1><pre>${escapeHtml(message)}</pre>`,
    };
  }
}

async function status() {
  try {
    const { rows } = await driver.query("SELECT COUNT(*) AS n FROM cards", []);
    return jsonResponse(200, {
      ok: true,
      engine: "decko-ts",
      runtime: "node-vm-staging",
      view: "open-view, read-only browsing",
      database: { ok: true, driver: "LocalSqliteDriver", card_count: rows[0]?.n ?? 0 },
      deck: { booted_at: new Date().toISOString(), path: dbPath },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse(503, {
      ok: false,
      engine: "decko-ts",
      database: { ok: false, error: message },
    });
  }
}

const MAX_SIGNED_IN_ENGINES = 2;
const signedInEngines = new Map();

async function engineForActor(actorId, cookieHeader) {
  const viewer = await withVisitorEnabledRoles(fetcher, { signedIn: true, actorId }, cookieHeader,
    () => render.ensureFreshness());
  const key = permissionViewerKey(viewer);
  let engine = signedInEngines.get(key);
  if (engine === undefined) {
    engine = new RenderEngine(fetcher);
    engine.imageCdnHost = render.imageCdnHost;
    engine.fontAwesomeAssetMode = render.fontAwesomeAssetMode;
    engine.materialIconsAssetMode=render.materialIconsAssetMode;
    engine.renderAbsentCards = render.renderAbsentCards;
    engine.tokenConfig = TOKEN_CONFIG;
    engine.viewer = viewer;
    engine.pageSession = engine.viewer;
    if (signedInEngines.size >= MAX_SIGNED_IN_ENGINES) {
      signedInEngines.delete(signedInEngines.keys().next().value);
    }
    signedInEngines.set(key, engine);
  }
  return engine;
}

function authJsonResponse(status, body, extraHeaders) {
  const base = jsonResponse(status, body);
  return { ...base, headers: { ...base.headers, ...extraHeaders } };
}

function readRequestBody(req, limitBytes = 65536) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > limitBytes) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseSigninBody(raw, contentTypeHeader) {
  const contentType = String(contentTypeHeader ?? "").split(";")[0].trim().toLowerCase();
  if (contentType === "application/json" || (contentType === "" && raw.trimStart().startsWith("{"))) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed === null || typeof parsed !== "object") return null;
      return {
        identifier: typeof parsed.identifier === "string" ? parsed.identifier
          : typeof parsed.email === "string" ? parsed.email : "",
        password: typeof parsed.password === "string" ? parsed.password : "",
      };
    } catch {
      return null;
    }
  }
  if (contentType === "application/x-www-form-urlencoded" || contentType === "") {
    const params = new URLSearchParams(raw);
    const identifier = params.get("identifier") ?? params.get("email") ?? "";
    const password = params.get("password") ?? "";
    return { identifier, password };
  }
  return null;
}

async function handleSignin(req) {
  let raw;
  try {
    raw = await readRequestBody(req);
  } catch (error) {
    return jsonResponse(400, {
      ok: false,
      error: `unreadable request body: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  const parsed = parseSigninBody(raw, req.headers["content-type"]);
  if (parsed === null) {
    return jsonResponse(400, {
      ok: false,
      error: "unsupported content type — send application/json or form-urlencoded with identifier + password",
    });
  }
  const outcome = await signinAccount(driver, sessions, parsed.identifier, parsed.password, {
    clientAddress: req.headers["x-forwarded-for"] ?? req.socket?.remoteAddress,
  });
  if (!outcome.ok) {
    return jsonResponse(401, { ok: false, error: outcome.message });
  }
  return authJsonResponse(
    200,
    { ok: true, name: outcome.actor.name },
    { "Set-Cookie": sessionCookieHeader(outcome.session.token, nodeCookieSecure(req)) },
  );
}

async function handleSignout(req) {
  const token = readSessionCookie(req.headers.cookie);
  const revoked = await signoutAccount(sessions, token);
  return authJsonResponse(200, { ok: true, revoked }, { "Set-Cookie": clearedSessionCookieHeader(nodeCookieSecure(req)) });
}

function buildSigninSlotHtml() {
  return (
    `<div class="d0-card-frame card">` +
    `<div class="d0-card-header card-header">` +
    `<h1 class="d0-card-header-title">` +
    `<span class="card-title" title="Sign In">Sign In</span></h1></div>\n` +
    `\n` +
    `<div class="d0-card-body card-body card-text">\n` +
    `<form action="/_signin" method="post" class="signin-form">\n` +
    `<div class="form-group">\n` +
    `<label for="signin_identifier">Email or name</label>\n` +
    `<input type="text" name="identifier" id="signin_identifier" class="form-control" autocomplete="username" />\n` +
    `</div>\n` +
    `<div class="form-group">\n` +
    `<label for="signin_password">Password</label>\n` +
    `<input type="password" name="password" id="signin_password" class="form-control" autocomplete="current-password" />\n` +
    `</div>\n` +
    `<button type="submit" class="btn btn-primary">Sign in</button>\n` +
    `</form>\n` +
    `<!-- decko-ts staging: renders the *signin card's own form at this route (set/self/signin.rb, rails); this staging form posts to /_signin. -->\n` +
    `</div></div>`
  );
}

function handleShutdownRequest() {
  console.log("[vm-staging] POST /_shutdown received, answering 200 then shutting down");
  setTimeout(() => beginShutdown("shutdown request"), 50);
  return jsonResponse(200, { ok: true, message: "shutting down" });
}

async function renderSigninPage() {
  const boot = await readSiteBootValues(driver, SPACES_HOST, SITE_TITLE_DEFAULT);
  const layout = await resolveDefaultLayout();
  const body = applyServedEnvironmentDeltas(
    await wrapWithLayout("*signin", buildSigninSlotHtml(), layout, {
      titleText: `Sign In - ${boot.siteTitle}`,
    }),
  );  return {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Connection": "close",
      "Keep-Alive": "timeout=0",
    },
    body,
  };
}

const SIGNIN_PAGE_PATHS = new Set(STOCK_DECK ? ["/_signin"] : ["/_signin", "/*signin", "/*signin/titled"]);

const FORGOT_PASSWORD_SUBMIT_PATH = "/update/*signin";

const FILES_PATTERN = /^\/files\/~(\d+)\/(\d+)\.([a-z0-9]+)$/i;

async function handleAssetFile(pathname) {
  const match = FILES_PATTERN.exec(pathname);
  if (match === null) return null;
  const [, cardIdStr, actionIdStr, ext] = match;
  const cardId = Number(cardIdStr);
  const actionId = Number(actionIdStr);
  const extLower = ext.toLowerCase();
  const fileCard = fileCardsById.get(cardId);
  const compiledName = COMPILED_ASSET_FILES[`${cardId}:${extLower}`];
  if (compiledName !== undefined) {
    const compiledPath = path.join(COMPILED_ASSETS_DIR, compiledName);
    try {
      const bytes = await fs.readFile(compiledPath);
      const contentType =
        extLower === "css" ? "text/css; charset=utf-8" :
        extLower === "js" ? "application/javascript; charset=utf-8" :
        "application/octet-stream";
      return {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "no-store",
          "Connection": "close",
          "Content-Length": String(bytes.length),
          "X-Decko-Asset-Source": `compiled:${compiledPath}`,
          "X-Decko-Asset-Note": "compiled-bytes",
        },
        body: bytes,
      };
    } catch (err) {
      if (err && err.code !== "ENOENT") {
        console.warn(
          `[vm-staging] compiled asset read failed ${compiledPath}: ` +
          (err instanceof Error ? err.message : String(err)),
        );
      }
    }
  }
  {
    const row = fileCard ?? (
      await driver.query("SELECT db_content FROM cards WHERE id = ? AND trash = 0", [cardId])
    ).rows[0];
    const dbContent = row?.db_content ?? "";
    const localMatch = /^~(\d+)\/(\d+)(\.[A-Za-z0-9]+)$/.exec(dbContent);
    if (
      localMatch !== null &&
      Number(localMatch[1]) === cardId &&
      Number(localMatch[2]) === actionId &&
      localMatch[3].toLowerCase() === `.${extLower}`
    ) {
      const localPath = path.join(DECKO_FILES_DIR, String(cardId), `${actionId}.${extLower}`);
      try {
        const bytes = await fs.readFile(localPath);
        const contentType =
          extLower === "css" ? "text/css; charset=utf-8" :
          extLower === "js" ? "application/javascript; charset=utf-8" :
          extLower === "png" || extLower === "jpg" || extLower === "jpeg" || extLower === "gif" ?
            `image/${extLower === "jpg" ? "jpeg" : extLower}` :
          extLower === "svg" ? "image/svg+xml" :
          "application/octet-stream";
        return {
          status: 200,
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "no-store",
            "Connection": "close",
            "Content-Length": String(bytes.length),
            "X-Decko-Asset-Source": `local:${localPath}`,
            "X-Decko-Asset-Note": "local-upload",
          },
          body: bytes,
        };
      } catch (err) {
        if (err && err.code !== "ENOENT") {
          console.warn(
            `[vm-staging] local upload read failed ${localPath}: ` +
            (err instanceof Error ? err.message : String(err)),
          );
        }
        if (err && err.code === "ENOENT") {
          const originalPath = path.join(DECKO_FILES_DIR, String(cardId), `${actionId}-original.${extLower}`);
          try {
            const bytes = await fs.readFile(originalPath);
            return {
              status: 200,
              headers: {
                "Content-Type":
                  extLower === "png" || extLower === "jpg" || extLower === "jpeg" || extLower === "gif" ?
                    `image/${extLower === "jpg" ? "jpeg" : extLower}` :
                  extLower === "svg" ? "image/svg+xml" :
                  "application/octet-stream",
                "Cache-Control": "no-store",
                "Connection": "close",
                "Content-Length": String(bytes.length),
                "X-Decko-Asset-Source": `local:${originalPath}`,
                "X-Decko-Asset-Note": "local-upload-original-rendition",
              },
              body: bytes,
            };
          } catch (originalErr) {
            if (originalErr && originalErr.code !== "ENOENT") {
              console.warn(
                `[vm-staging] local upload original-rendition read failed ${originalPath}: ` +
                (originalErr instanceof Error ? originalErr.message : String(originalErr)),
              );
            }
          }
        }
      }
    }
  }
  if (MAIN_STYLESHEET_CARD_ID !== undefined && cardId === MAIN_STYLESHEET_CARD_ID && extLower === "css") {
    const compiledSkinPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "vm-skin-compiled.css");
    if (existsSync(compiledSkinPath)) {
      return {
        status: 200,
        headers: {
          "Content-Type": "text/css; charset=utf-8",
          "Cache-Control": "no-store",
          "Connection": "close",
          "X-Decko-Asset-Source": `card:${cardId}`,
          "X-Decko-Asset-Note": "compiled-from-scss-source",
        },
        body: readFileSync(compiledSkinPath),
      };
    }
    const skin = await readActiveSkinCard(driver);
    if (skin !== null) {
      const banner =
        `/* decko-ts staging: serving the SCSS source for card ${skin.id} ` +
        `(<skin>) at /files/~${cardId}/${actionId}.${ext}. ` +
        `The compiled CSS bytes live in the deployment's asset bucket ` +
        `and are not in this deck. */\n`;
      return {
        status: 200,
        headers: {
          "Content-Type": "text/css; charset=utf-8",
          "Cache-Control": "no-store",
          "Connection": "close",
          "X-Decko-Asset-Source": `card:${skin.id}`,
          "X-Decko-Asset-Note": "scss-source-not-compiled",
        },
        body: banner + skin.dbContent,
      };
    }
  }
  if (extLower === "js") {
    const mainOut = await mainScriptAssetOutput();
    if (mainOut !== null && mainOut.id === cardId) {
      const compiled = await compiledMainScriptBundle();
      if (compiled !== null) {
        return {
          status: 200,
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "no-store",
            "Connection": "close",
            "Content-Length": String(compiled.bytes.length),
            "X-Decko-Asset-Source": `*all+*script compile (${compiled.source})`,
            "X-Decko-Asset-Note": compiled.note,
          },
          body: compiled.bytes,
        };
      }
    }
    const manifestRow = (
      await driver.query(
        "SELECT rule.id AS id, rule.db_content AS db_content" +
          " FROM cards all_card" +
          " JOIN cards rule ON rule.left_id = all_card.id AND rule.trash = 0" +
          " JOIN cards setting ON rule.right_id = setting.id AND setting.trash = 0" +
          " WHERE all_card.codename = 'all' AND all_card.trash = 0" +
          " AND setting.codename = 'script'",
        [],
      )
    ).rows[0];
    const manifest = manifestRow?.db_content ?? "";
    const manifestCardId = manifestRow?.id ?? "absent";
    const header =
      `/* decko-ts staging: serving the *all+*script manifest (card ${manifestCardId}) ` +
      `at /files/~${cardId}/${actionId}.${ext}. ` +
      `The compiled JS bytes live in the deployment's asset bucket and are ` +
      `not in this deck. */\n`;
    return {
      status: 200,
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-store",
        "Connection": "close",
        "X-Decko-Asset-Source": `card:${manifestCardId}(*all+*script)`,
        "X-Decko-Asset-Note": "manifest-source-not-compiled",
      },
      body: header + manifest,
    };
  }
  if (fileCard === undefined) {
    return {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Connection": "close" },
      body: `Asset not in corpus: file card id=${cardId} is absent or trashed.\n`,
    };
  }
  return {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Connection": "close" },
    body: `Compiled asset bytes not available in this deck for file card ${cardId} (db_content=${fileCard.dbContent}).\n`,
  };
}

const SIGNIN_POST_PATHS = new Set(["/_signin", "/_signout"]);

const ACCOUNT_POST_PATHS = new Set(["/_reset-request", "/_account-password"]);

const SHUTDOWN_PATH = "/_shutdown";

let followMailContext;

const DELAYING = delayingFromEnv(migrationDeployment.environment.DECKO_DELAYING);
let delayedJobsHost;
function delayedJobsForWrites() {
  if (!DELAYING || !writePathEnabled()) return undefined;
  if (delayedJobsHost === undefined) {
    const log = (line) => process.stderr.write(`[delayed_job] ${line}\n`);
    delayedJobsHost = hostDelayedJobs({
      driver,
      fetcher,
      delaying: true,
      afterResponse: nodeAfterResponse(log),
      engineOptions: { notifyTransport: mailTransport, followMail: followMailContext },
      workerName: `host:${migrationDeployment.environment.HOSTNAME ?? "localhost"} pid:${process.pid}`,
      log,
    });
    delayedJobsHost.worker.start(5000);
  }
  return delayedJobsHost.config;
}

async function dispatchWriteRequest(req, pathname, preReadBody) {
  let body = preReadBody;
  let bodyBytes;
  const contentTypeHeader = String(req.headers["content-type"] ?? "");
  if (typeof body !== "string" || /^multipart\/form-data/i.test(contentTypeHeader)) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    if (/^multipart\/form-data/i.test(contentTypeHeader)) {
      bodyBytes = new Uint8Array(raw);
      body = "";
    } else {
      body = raw.toString("utf8");
    }
  }
  const cookieToken = readSessionCookie(req.headers.cookie);
  const cookieActor = cookieToken !== null ? await sessions.lookupSession(cookieToken) : null;
  if (followMailContext === undefined) {
    const botEmail = await fetcher.fetchByName("Decko Bot+*email").catch(() => undefined);
    followMailContext = { origin: DECKO_ORIGIN, deckoBotEmail: botEmail?.dbContent ?? "" };
  }
  return handleWriteRequest(
    {
      driver,
      fetcher,
      attachmentStore,
      accountMail: {
        transport: mailTransport,
        token: TOKEN_CONFIG,
        origin: DECKO_ORIGIN,
        siteTitle: SITE_TITLE,
      },
      followMail: followMailContext,
      ...((delayedJobs) => (delayedJobs === undefined ? {} : { delayedJobs }))(delayedJobsForWrites()),
      ...(scssCompiler === undefined ? {} : { scssCompiler }),
      coffeeCompiler,
      compressAssets,
      scriptCompressor,
      javascriptValidator,
      ...(recaptchaConfig === undefined ? {} : { recaptcha: recaptchaConfig }),
      notifyTransport: mailTransport,
      renderSlot:
        cookieActor !== null
          ? async (name, view, subcardNames) => {
              fetcher.expireName(name);
              const actorEngine = await engineForActor(cookieActor.id, req.headers.cookie);
              actorEngine.expireRenderCard(name);
              for (const sub of subcardNames ?? []) {
                if (!sub) continue;
                fetcher.expireName(sub);
                actorEngine.expireRenderCard(sub);
              }
              try {
                await actorEngine.render(name, view ?? "titled");
              } catch {
              }
              const slotCard = actorEngine.fetchRenderCard(name);
              if (slotCard === undefined) return actorEngine.render(name, view ?? "titled");
              const { RenderFormat } = await import("./dist/src/card/render/format.js");
              const slotView = view ?? "titled";
              return new RenderFormat(slotCard, actorEngine, { main: true, nestQuietErrors: true }).renderView(
                slotView,
                {
                  nest_name: "_main",
                  nest_syntax: `_main|${slotView}`,
                  main: true,
                  home_view: slotView,
                },
                null,
              );
            }
          : undefined,
      renderErrorPage: async (name, view) => {
        const actorEngine = cookieActor !== null ? await engineForActor(cookieActor.id, req.headers.cookie) : render;
        actorEngine.pageLoudDenialTaskPhrase = "do that";
        try {
          const { html } = await renderPageWithStatus(actorEngine, name, view, {});
          return html;
        } finally {
          actorEngine.pageLoudDenialTaskPhrase = undefined;
        }
      },
      renderPreviewEditor:
        cookieActor !== null
          ? async ({ name, opts }) => {
              fetcher.expireName(name);
              const actorEngine = await engineForActor(cookieActor.id, req.headers.cookie);
              actorEngine.expireRenderCard(name);
              const { RenderFormat } = await import("./dist/src/card/render/format.js");
              try {
                await actorEngine.render(name, "preview_editor");
              } catch {
              }
              const previewCard = actorEngine.fetchRenderCard(name);
              if (previewCard === undefined) {
                throw new Error(`preview_editor render could not seat the card: ${name}`);
              }
              return new RenderFormat(previewCard, actorEngine, { nestQuietErrors: true }).renderView(
                "preview_editor",
                opts,
              );
            }
          : undefined,
    },
    {
      method: req.method,
      pathname,
      search: new URL(req.url ?? "/", "http://localhost").search,
      host: req.headers.host,
      ...(req.socket?.encrypted ? { scheme: "https" } : {}),
      headers: req.headers,
      body,
      bodyBytes,
    },
  );
}

async function dispatchFirstRunRequest(req, pathname, startedAt) {
  let body = "";
  if (req.method === "POST") {
    try {
      body = await readRequestBody(req);
    } catch (error) {
      return jsonResponse(400, {
        ok: false,
        error: `unreadable request body: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  const firstRunResponse = await handleFirstRunRequest(
    {
      driver,
      fetcher,
      corpusShippedAccountHolderIds: corpusShippedHolders,
    },
    {
      method: req.method,
      pathname,
      host: req.headers.host,
      headers: req.headers,
      body,
      search: new URL(req.url ?? "/", "http://localhost").search,
    },
  );
  if (firstRunResponse === null) {
    return jsonResponse(404, { error: "not found" });
  }
  await applyWriteResponseTail(firstRunResponse, startedAt, req.method, pathname);
  return firstRunResponse;
}

async function applyWriteResponseTail(writeResponse, startedAt, method, pathname) {
  expireRenderCachesAfterSave(
    {
      fetcher,
      renderEngine: render,
      signedInEngines: signedInEngines.values(),
    },
    writeResponse,
  );
  console.log(
    `[vm-staging] ${method} ${pathname} -> ${writeResponse.status} (${Date.now() - startedAt}ms)`,
  );
}

function withVisitorSessionCookie(response) {
  const cookie = response?.visitorCookie;
  if (cookie === undefined || cookie === null) return response;
  const headers = { ...response.headers };
  const existing = headers["Set-Cookie"];
  headers["Set-Cookie"] =
    existing === undefined ? [cookie] : [...(Array.isArray(existing) ? existing : [existing]), cookie];
  return { ...response, headers };
}

const server = http.createServer(async (req, res) => {
  const startedAt = Date.now();
  const rawWriteHead = res.writeHead.bind(res);
  res.writeHead = (status, headers) =>
    rawWriteHead(status, applyOracleSecurityResponseHeaders(headers));
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const vendorRequest = new Request(url, { method: req.method });
  const vendorAsset = serveFontAwesomeAsset(vendorRequest) ?? serveBootstrapFontAsset(vendorRequest) ?? serveModStyleAsset(vendorRequest);
  if (vendorAsset !== undefined) {
    res.writeHead(vendorAsset.status, Object.fromEntries(vendorAsset.headers));
    res.end(req.method === "HEAD" ? undefined : Buffer.from(await vendorAsset.arrayBuffer()));
    return;
  }
  const requestedView =
    url.searchParams.get("view")?.trim() || url.searchParams.get("v")?.trim() || undefined;
  const slotParams = {};
  for (const [key, value] of url.searchParams) {
    const m = /^slot\[(.+)\]$/.exec(key);
    if (!m || m[1] === "layout") continue;
    if (m[1] === "show][") {
      const show = slotParams["show"];
      if (Array.isArray(show)) show.push(value);
      else slotParams["show"] = [value];
      continue;
    }
    slotParams[m[1]] = value;
  }
  const pageOpts = {
    bare: STOCK_DECK && req.headers["x-requested-with"] === "XMLHttpRequest" && !url.searchParams.has("layout"),
    slotParams,
    mainParam: url.searchParams.get("main") ?? undefined,
    editDraftPresent: url.searchParams.has("edit_draft"),
    assignPresent: url.searchParams.has("assign"),
    cardTypeParam: url.searchParams.get("card[type]") ?? undefined,
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    const verdict = checkRequestOrigin({ headers: req.headers, host: req.headers.host }, ORIGIN_POLICY);
    if (!verdict.ok) {
      req.resume();
      const refused = jsonResponse(403, {
        error: { code: "cross-origin", message: `${CROSS_ORIGIN_MESSAGE} (${verdict.reason})` },
      });
      res.writeHead(refused.status, refused.headers).end(refused.body);
      console.log(`[vm-staging] ${req.method} ${pathname} -> 403 cross-origin (${Date.now() - startedAt}ms)`);
      return;
    }
  }

  if (req.method === "GET" && writePathEnabled() && !pathname.startsWith("/_") && !pathname.startsWith("/files/") &&
      !(firstRunEnabled() && pathname === SETUP_PATH)) {
    try {
      await assetReadRefresh.beforeRead({ explicitFile: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[vm-staging] asset read refresh failed for ${pathname}: ${message}`);
      const failed = htmlResponse(500, `<h1>Server error</h1><pre>${escapeHtml(message)}</pre>`);
      res.writeHead(failed.status, failed.headers).end(failed.body);
      return;
    }
  }

  let actor = null;
  if (req.method === "GET") {
    const tokenAuth = await resolveReadAuthenticators(
      { authorization: req.headers.authorization, "x-api-key": req.headers["x-api-key"] },
      url.searchParams,
      TOKEN_CONFIG,
      (apiKey) => signinFromApiKey(authDriver, apiKey),
    );
    if (tokenAuth.kind === "denied") {
      const denied = await renderAccountFlowDenialPage();
      res.writeHead(denied.status, denied.headers).end(denied.body);
      return;
    }
    if (tokenAuth.kind === "actor") {
      actor = { id: tokenAuth.actorId };
    } else if (tokenAuth.kind === "anonymous") {
      actor = null;
    } else {
      const sessionToken = readSessionCookie(req.headers.cookie);
      if (sessionToken !== null) {
        actor = await sessions.lookupSession(sessionToken);
      }
    }
  } else if (
    req.method === "POST" &&
    (SIGNIN_POST_PATHS.has(pathname) ||
      ACCOUNT_POST_PATHS.has(pathname) ||
      pathname === SHUTDOWN_PATH ||
      pathname === FORGOT_PASSWORD_SUBMIT_PATH ||
      (firstRunEnabled() && pathname === SETUP_PATH))
  ) {
  } else if (parseAccountFlowLink(pathname, url.searchParams) !== null) {
  } else {
    if (writePathEnabled()) {
      const writeResponse = await dispatchWriteRequest(req, pathname);
      if (writeResponse !== null) {
        const committed = withVisitorSessionCookie(writeResponse);
        res.writeHead(committed.status, committed.headers).end(committed.body);
        expireRenderCachesAfterSave(
          {
            fetcher,
            renderEngine: render,
            signedInEngines: signedInEngines.values(),
          },
          writeResponse,
        );
        console.log(
          `[vm-staging] ${req.method} ${pathname} -> ${writeResponse.status} (${Date.now() - startedAt}ms)`,
        );
        return;
      }
    }
    const body = jsonResponse(405, { error: "method not allowed" });
    res.writeHead(body.status, body.headers).end(body.body);
    console.log(
      `[vm-staging] ${req.method} ${pathname} -> ${body.status} (${Date.now() - startedAt}ms)`,
    );
    return;
  }
  let requestEngine;

  let response;
  const registeredRoute = registeredFormatRoute(pathname, url.searchParams);
  let servedCardName;
  try {
    requestEngine = actor !== null ? await engineForActor(actor.id, req.headers.cookie) : render;
    if (req.method === "GET" || req.method === "HEAD") await requestEngine.ensureFreshness();
    const readPathSegments = pathname.replace(/\/+$/, "").replace(/^\/+/, "").split("/");
    const isAssetActionRoute =
      (readPathSegments[0] === "asset" && readPathSegments.length === 2) ||
      (readPathSegments[0] === "card" && readPathSegments[1] === "asset" && readPathSegments.length <= 3);
    if (
      (req.method === "GET" || req.method === "HEAD") &&
      (isDeprecatedAssetRoute(readPathSegments) || isAssetActionRoute)
    ) {
      const assetStub = deprecatedAssetStubResponse();
      res.writeHead(assetStub.status, Object.fromEntries(assetStub.headers));
      res.end(req.method === "HEAD" ? undefined : Buffer.from(await assetStub.arrayBuffer()));
      console.log(`[vm-staging] ${req.method} ${pathname} -> ${assetStub.status} (deprecated asset route, ${Date.now() - startedAt}ms)`);
      return;
    }
    const flowLinkCandidate = parseAccountFlowLink(pathname, url.searchParams);
    if (
      flowLinkCandidate === null &&
      req.method === "GET" &&
      writePathEnabled()
    ) {
      const writeResponse = await dispatchWriteRequest(req, pathname);
      if (writeResponse !== null) {
        const committed = withVisitorSessionCookie(writeResponse);
        expireRenderCachesAfterSave(
          {
            fetcher,
            renderEngine: render,
            signedInEngines: signedInEngines.values(),
          },
          writeResponse,
        );
        console.log(
          `[vm-staging] ${req.method} ${pathname} -> ${writeResponse.status} (${Date.now() - startedAt}ms)`,
        );
        res.writeHead(committed.status, committed.headers).end(committed.body);
        return;
      }
    }
    const flowLink = flowLinkCandidate;
    if (
      req.method !== "GET" &&
      flowLink === null &&
      !(
        req.method === "POST" &&
        (SIGNIN_POST_PATHS.has(pathname) ||
          ACCOUNT_POST_PATHS.has(pathname) ||
          pathname === FORGOT_PASSWORD_SUBMIT_PATH ||
          (firstRunEnabled() && pathname === SETUP_PATH) ||
          pathname === SHUTDOWN_PATH)
      )
    ) {
      response = jsonResponse(405, { error: "method not allowed" });
    } else if (flowLink !== null) {
      req.resume();
      response = await handleAccountFlowLink(flowLink, req);
      if (response.status >= 200 && response.status < 400) {
        expireFlowWrittenName(flowLink.accountMark);
      }
    } else if (req.method === "POST" && pathname === "/_signin") {
      response = await handleSignin(req);
    } else if (req.method === "POST" && pathname === SHUTDOWN_PATH) {
      response = handleShutdownRequest();
    } else if (req.method === "POST" && pathname === "/_signout") {
      response = await handleSignout(req);
    } else if (req.method === "POST" && pathname === "/_reset-request") {
      response = await handleResetRequest(req);
    } else if (req.method === "POST" && pathname === "/_account-password") {
      response = await handleAccountPassword(req);
    } else if (req.method === "POST" && pathname === FORGOT_PASSWORD_SUBMIT_PATH) {
      response = await handleForgotPasswordSubmit(req, startedAt);
    } else if (firstRunEnabled() && (req.method === "GET" || req.method === "POST") && pathname === SETUP_PATH) {
      response = await dispatchFirstRunRequest(req, pathname, startedAt);
    } else if (req.method === "GET" && pathname === "/*signin/reset_password_success") {
      response = await renderResetPasswordSuccessPage();
    } else if (
      req.method === "GET" &&
      (pathname === "/*signin/edit" ||
       (pathname === "/*signin" && url.searchParams.get("view") === "edit"))
    ) {
      const slotRequested =
        [...url.searchParams.keys()].some((k) => k.startsWith("slot[")) ||
        req.headers["x-requested-with"] === "XMLHttpRequest";
      if (slotRequested) {
        const signinRecord = await fetchCardByName("*signin");
        response = {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
          body: buildForgotPasswordModalHtml(signinRecord?.id ?? ""),
        };
      } else {
        response = await renderForgotPasswordPage();
      }
    } else if (
      STOCK_DECK &&
      writePathEnabled() &&
      req.method === "GET" &&
      req.headers["x-requested-with"] === "XMLHttpRequest" &&
      /^\/(card\/)?(create|update|delete)\/[^/]+$/.test(pathname) &&
      !/^\/(card\/)?delete\/\*signin$/i.test(pathname)
    ) {
      const verb = /\/(create|update|delete)\//.exec(pathname)[1];
      const writeReq = Object.assign(Object.create(req), {
        method: verb === "delete" ? "DELETE" : "POST",
        headers: req.headers,
        url: req.url,
      });
      response = withVisitorSessionCookie((await dispatchWriteRequest(writeReq, pathname, "")) ?? jsonResponse(404, { error: "no write route" }));
      expireRenderCachesAfterSave(
        { fetcher, renderEngine: render, signedInEngines: signedInEngines.values() },
        response,
      );
    } else if (STOCK_DECK && req.method === "GET" && /^\/(card\/)?delete\/\*signin$/i.test(pathname)) {
      const token = readSessionCookie(req.headers.cookie);
      await signoutAccount(sessions, token);
      response = {
        status: 302,
        headers: {
          Location: "/*signin",
          "Set-Cookie": [clearedSessionCookieHeader(nodeCookieSecure(req)), visitorSessionCookie(emptyVisitorSession())],
          "Cache-Control": "no-store",
        },
        body: "",
      };
    } else if (req.method === "GET" && pathname === "/_mail-log") {
      response = handleMailLog();
    } else if (pathname === "/_status") {
      response = await status();
    } else if (cardFormatRequest(pathname, url.searchParams) !== undefined) {
      const formatRequest = cardFormatRequest(pathname, url.searchParams);
      const formatResponse = await cardFormatShowResponse(
        formatRequest.mark,
        formatRequest.format,
        requestEngine,
        requestEngine.fetcher,
        {view: url.searchParams.get("view") || url.searchParams.get("v"), requestUrl: url.href},
      );
      if (formatResponse !== undefined) {
        res.writeHead(formatResponse.status, formatResponse.headers).end(formatResponse.body);
        console.log(
          `[vm-staging] ${req.method} ${pathname} -> ${formatResponse.status} ${formatRequest.format} (${Date.now() - startedAt}ms)`,
        );
        return;
      }
      response = await renderCardPage(
        decodeName(formatRequest.mark === "" ? HOME_CARD_NAME : formatRequest.mark),
        requestEngine,
        url.searchParams.get("view"),
        undefined,
      );
    } else if (pathname === "/") {
      const markQuery = url.searchParams.get("mark");
      const homeMarkName = markQuery === null
        ? await homeMarkContent(render)
        : (markQuery.replace(/_/g, " ") || "Home");
      response = await renderCardPage(homeMarkName, requestEngine, requestedView, undefined, pageOpts);
      servedCardName = homeMarkName;
    } else if (STOCK_DECK && MOD_PUBLIC_DIR !== undefined && pathname.startsWith("/mod/")) {
      response = await serveModPublicFile(pathname);
    } else if (pathname.startsWith("/files/")) {
      const assetResp = await handleAssetFile(pathname);
      if (assetResp !== null) {
        response = assetResp;
      } else {
        const actorRender = actor !== null ? await engineForActor(actor.id, req.headers.cookie) : render;
        await actorRender.ensureFreshness();
        const codedResponse = await handleAttachmentRoute(new Request(url, { method: req.method }), {
          driver, fetchEngine: fetcher, attachmentStore,
          createEngine: () => { throw new Error("file GET does not create an action engine"); },
          canReadCard: async id => {
            const record = await fetcher.fetchById(id);
            if (!record) return false;
            const type = record.typeId !== undefined ? await fetcher.fetchById(record.typeId) : undefined;
            return actorRender.canReadCard(record, type?.name?.s);
          },
        });
        if (codedResponse !== null) {
          res.writeHead(codedResponse.status, Object.fromEntries(codedResponse.headers));
          res.end(req.method === "HEAD" ? undefined : Buffer.from(await codedResponse.arrayBuffer()));
          return;
        }
        response = htmlResponse(
          404,
          `<h1>Not found</h1><pre>No asset for ${escapeHtml(pathname)}</pre>`,
          "Not found",
        );
      }
    } else if (isRssRequest(pathname, url.searchParams)) {
      try {
        response = await rssFormatResponse(url, requestEngine);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const mapped = mapRenderError(message);
        response = jsonResponse(mapped.status, {error: mapped.title, message});
      }
    } else if (registeredRoute !== undefined) {
      response = await registeredFormatResponse(registeredRoute, url, requestEngine);
    } else if (pathname.endsWith(".json") &&
               ["name_match", "name_complete"].includes(url.searchParams.get("view") ?? "")) {
      response = await nameMatchJsonResponse(url, requestEngine);
    } else if (pathname.endsWith(".json")) {
      const raw = pathname.slice(0, -".json".length).replace(/^\//, "");
      const name = decodeName(raw);
      if (name === undefined || name === "") {
        response = jsonResponse(400, { error: "empty card name" });
      } else if (raw.includes("/")) {
        const slash = raw.indexOf("/");
        const markName = decodeName(raw.slice(0, slash));
        const viewName = decodeViewSegmentJson(raw.slice(slash + 1));
        if (markName === undefined || markName === "" || viewName === undefined || viewName === "") {
          response = jsonResponse(400, { error: "empty card name" });
        } else {
          response = await renderCardViewJson(markName, viewName, url, requestEngine);
        }
      } else {
        const queryView = url.searchParams.get("view");
        if (queryView !== null && queryView.trim() !== "") {
          response = await renderCardViewJson(name, queryView.trim(), url, requestEngine);
        } else {
          response = await cardRecordJson(name, requestEngine);
        }
      }
    } else if (SIGNIN_PAGE_PATHS.has(pathname)) {
      response = await renderSigninPage();
    } else if (!pathname.slice(1).includes("/")) {
      const senderResponse = await handleAttachmentRoute(new Request(url, { method: req.method }), {
        driver, fetchEngine: fetcher, attachmentStore,
        createEngine: () => { throw new Error("file GET does not create an action engine"); },
        canReadCard: async id => {
          const record = await fetcher.fetchById(id);
          if (!record) return false;
          const type = record.typeId !== undefined ? await fetcher.fetchById(record.typeId) : undefined;
          const actorRender = actor !== null ? await engineForActor(actor.id, req.headers.cookie) : render;
          return actorRender.canReadCard(record, type?.name?.s);
        },
      });
      if (senderResponse !== null) {
        res.writeHead(senderResponse.status, Object.fromEntries(senderResponse.headers));
        res.end(req.method === "HEAD" ? undefined : Buffer.from(await senderResponse.arrayBuffer()));
        console.log(`[vm-staging] ${req.method} ${pathname} -> ${senderResponse.status} (file sender)`);
        return;
      }
      const name = decodeName(pathname.slice(1));
      const requestedView = url.searchParams.get("view");
      const shadowViewLane = migrationDeployment.environment.DECKO_SHADOW_VIEW_LANE === "1";
      if (name === "*previous" || name === ":previous") {
        const previousVisit = readVisitorSession(req.headers.cookie);
        const previousTarget = new URL(previousLocation(previousVisit), `http://${req.headers.host ?? "127.0.0.1"}`).toString();
        if (req.headers["x-requested-with"] === "XMLHttpRequest") {
          const xhrBody = JSON.stringify({ redirect: previousTarget });
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(xhrBody);
        } else {
          res.writeHead(302, { Location: previousTarget, "Cache-Control": "no-store" });
          res.end();
        }
        console.log(`[vm-staging] ${req.method} ${pathname} -> 302 *previous (${Date.now() - startedAt}ms)`);
        return;
      }
      if (name === "read") {
        const readHomeName = await homeMarkContent(requestEngine);
        response = await renderCardPage(readHomeName, requestEngine, requestedView, undefined, pageOpts);
        servedCardName = readHomeName;
      } else if (name === "asset") {
        const assetActionStub = deprecatedAssetStubResponse();
        res.writeHead(assetActionStub.status, Object.fromEntries(assetActionStub.headers));
        res.end(req.method === "HEAD" ? undefined : Buffer.from(await assetActionStub.arrayBuffer()));
        console.log(`[vm-staging] ${req.method} ${pathname} -> ${assetActionStub.status} (card#asset action, ${Date.now() - startedAt}ms)`);
        return;
      } else if (name === undefined || name === "") {
        response = jsonResponse(400, { error: "empty card name" });
      } else if (shadowViewLane && requestedView !== null && requestedView !== "") {
        response = await renderCardView(name, requestedView, requestEngine);
      } else {
        const pageRenderParams = await newCardRenderParams(name, url.searchParams);
        const searchReqSingle = jsonViewSearchParams(url.searchParams);
        const editorParamsSingle = editorWireParamsFromQuery(url.searchParams);
        response = actor === null && searchReqSingle?.offset > 1000
          ? htmlResponse(403, "<h1>Forbidden</h1><pre>limit parameter exceeds maximum for anonymous users (1000)</pre>", "Forbidden")
          : await renderCardPage(
          name,
          requestEngine,
          requestedView,
          {
            ...(pageRenderParams ?? {}),
            ...(searchReqSingle !== undefined
              ? {
                  search: searchReqSingle,
                }
              : {}),
            ...(Object.keys(editorParamsSingle).length > 0
              ? {
                  editorParams: editorParamsSingle,
                }
              : {}),
          },
          pageOpts,
        );
        servedCardName = name;
      }
    } else {
      const segs = pathname.slice(1).split("/");
      const stripFormat = (s) => s.replace(/\.[A-Za-z0-9]+$/, "");
      let routeName;
      let routeView;
      let renderParams;
      const searchOffsetRaw = url.searchParams.get("offset");
      const searchOffset =
        searchOffsetRaw !== null && /^\d+$/.test(searchOffsetRaw) && Number(searchOffsetRaw) > 0
          ? Number(searchOffsetRaw)
          : undefined;
      if (
        searchOffset !== undefined &&
        actor === null &&
        searchOffset > 1000
      ) {
        response = htmlResponse(
          403,
          `<h1>Forbidden</h1><pre>limit parameter exceeds maximum for anonymous users (1000)</pre>`,
          "Forbidden",
        );
        res.writeHead(response.status, response.headers).end(response.body);
        console.log(`[vm-staging] ${req.method} ${pathname} -> 403 anonymous offset (${Date.now() - startedAt}ms)`);
        return;
      }
      const searchReq = jsonViewSearchParams(url.searchParams);
      const editorWireParams = editorWireParamsFromQuery(url.searchParams);
      const hasEditorWireParams = Object.keys(editorWireParams).length > 0;
      const newCardRoute = parseNewCardRoute(segs, url.searchParams);
      const typeRoute = segs.length === 2 && segs[0] === "type" && segs[1] !== "";
      const readActionRoute =
        (segs.length === 2 && segs[0] === "read" && segs[1] !== "") ||
        (segs.length === 3 && segs[0] === "card" && segs[1] === "read" && segs[2] !== "");
      const marklessCardRead = segs.length === 2 && segs[0] === "card" && segs[1] === "read";
      if (newCardRoute !== null) {
        routeName = newCardRoute.name;
        routeView = "new";
        renderParams = await newCardRenderParams(newCardRoute.mark, url.searchParams, newCardRoute.typeName);
        if (hasEditorWireParams) renderParams = { ...renderParams, editorParams: editorWireParams };
      } else if (typeRoute) {
        routeName = await homeMarkContent(requestEngine);
        renderParams = await newCardRenderParams(routeName, url.searchParams, decodeName(segs[1]));
        if (hasEditorWireParams) renderParams = { ...(renderParams ?? {}), editorParams: editorWireParams };
      } else if (readActionRoute) {
        routeName = decodeName(segs[0] === "read" ? segs[1] : segs[2]);
        routeView = undefined;
      } else if (marklessCardRead) {
        routeName = await homeMarkContent(requestEngine);
        routeView = undefined;
      } else if (segs.length === 2 && segs[0] !== "" && segs[1] !== "") {
        routeName = segs[0];
        routeView = stripFormat(segs[1]);
      } else if (segs.length === 3 && segs[1] === "view" && segs[0] !== "" && segs[2] !== "") {
        routeName = segs[0];
        routeView = stripFormat(segs[2]);
      } else if (
        segs.length === 3 &&
        segs[0] === "card" &&
        (segs[1] === "new" || segs[1] === "edit") &&
        segs[2] !== ""
      ) {
        routeName = segs[2];
        routeView = segs[1];
      }
      if (newCardRoute !== null) {
        response = await renderCardPage(routeName, requestEngine, routeView, renderParams, pageOpts);
      } else if ((typeRoute || readActionRoute || marklessCardRead) && routeName !== undefined) {
        response = await renderCardPage(routeName, requestEngine, url.searchParams.get("view"), renderParams, pageOpts);
        servedCardName = routeName;
      } else if (routeName !== undefined && routeView !== undefined) {
        const name = decodeName(routeName);
        if (name === undefined || name === "") {
          response = jsonResponse(400, { error: "empty card name" });
        } else {
          response = await renderCardPage(
            name,
            requestEngine,
            routeView,
            searchReq || hasEditorWireParams
              ? { ...(searchReq ? { search: searchReq } : {}), ...(hasEditorWireParams ? { editorParams: editorWireParams } : {}) }
              : undefined,
            pageOpts,
          );
          servedCardName = name;
        }
      } else {
        const wildcardSegments = pathname.replace(/\/+$/, "").replace(/^\/+/, "").split("/").filter(Boolean);
        const wildcardParts = [];
        let wildcardDecodeFailed = false;
        for (const wildcardSegment of wildcardSegments) {
          const decoded = decodeName(wildcardSegment);
          if (decoded === undefined || decoded === "") {
            wildcardDecodeFailed = true;
            break;
          }
          wildcardParts.push(decoded);
        }
        if (wildcardParts.length === 0 || wildcardDecodeFailed) {
          response = htmlResponse(
            404,
            `<h1>Not found</h1><pre>No route for ${escapeHtml(pathname)} — try /<card-name> or /<card-name>.json</pre>`,
            "Not found",
          );
        } else {
          const wildcardName = wildcardParts.join("+");
          response = await renderCardPage(wildcardName, requestEngine, "bad_address", undefined, pageOpts);
        }
      }
    }
    if (
      req.method === "GET" &&
      servedCardName !== undefined &&
      response.status === 200 &&
      String(response.headers["Content-Type"] ?? "").includes("text/html") &&
      req.headers["x-requested-with"] !== "XMLHttpRequest" &&
      String(req.headers.accept ?? "").includes("text/html") &&
      !SIGNIN_PAGE_PATHS.has(pathname)
    ) {
      const knownRecord = await requestEngine.fetcher.fetchByName(servedCardName).catch(() => undefined);
      if (knownRecord?.id !== undefined) {
        const setCookie = pageViewCookie(req.headers.cookie, `http://${req.headers.host}${url.pathname}${url.search}`, {
          known: true,
          html: true,
          ajax: false,
          codename: knownRecord.codename,
        });
        if (setCookie !== undefined && response.headers["Set-Cookie"] === undefined) {
          response.headers["Set-Cookie"] = setCookie;
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const badRequest = error instanceof CardRouteBadRequestError;
    response = htmlResponse(badRequest ? 400 : 500,
      `<h1>${badRequest ? "Bad request" : "Server error"}</h1><pre>${escapeHtml(message)}</pre>`);
  }

  try {
    response = applyConfiguredPublicPageShell(response, {config: publicPageShellConfig, method: req.method, signedIn: actor !== null});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    response = htmlResponse(500, `<h1>Server error</h1><pre>${escapeHtml(message)}</pre>`);
  }
  res.writeHead(response.status, response.headers).end(response.body);
  console.log(
    `[vm-staging] ${req.method} ${pathname} -> ${response.status} (${Date.now() - startedAt}ms)`,
  );
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[vm-staging] listening on http://127.0.0.1:${port}`);
});

let shutdownStarted = false;
let shutdownClosed = false;
let shutdownTimer = null;
const failures = [];
function beginShutdown(reason, initialError, hasInitialError = initialError !== undefined) {
  const recordFailure = (phase, error) => {
    failures.push({phase, message: typeof error?.message === "string" ? error.message : String(error)});
  };
  if (hasInitialError) recordFailure("stop control", initialError);
  if (shutdownStarted) return;
  shutdownStarted = true;
  const incomplete = () => {
    console.error(JSON.stringify({event: "staging-shutdown-incomplete", outcome: "unknown",
      requestOutcome: "unknown", databaseOutcome: "unknown", primaryError: failures[0] ?? null,
      cleanupErrors: failures.slice(1)}));
    process.exit(1);
  };
  console.log(`[vm-staging] ${reason} received, shutting down`);
  shutdownTimer = setTimeout(incomplete, 5000);
  shutdownTimer.unref();
  try {
    server.close(async error => {
      if (shutdownClosed) return;
      shutdownClosed = true;
      if (error) recordFailure("request drain", error);
      let databaseClosed = true;
      for (const [role, ownedDriver] of [["browse", driver], ["auth", authDriver]]) {
        try {
          await ownedDriver.close();
        } catch (cleanupError) {
          databaseClosed = false;
          recordFailure(`${role} database cleanup`, cleanupError);
        }
      }
      clearTimeout(shutdownTimer);
      shutdownTimer = null;
      if (failures.length) {
        console.error(JSON.stringify({event: "staging-shutdown-failed", outcome: "failed",
          requestOutcome: "unknown", databaseOutcome: "unknown", databaseClosed,
          primaryError: failures[0], cleanupErrors: failures.slice(1)}));
        process.exit(1);
      } else process.exit(0);
    });
  } catch (error) {
    recordFailure("request drain", error);
    incomplete();
  }
}
installDemoShutdownReceiver(beginShutdown);
process.on("SIGTERM", () => beginShutdown("SIGTERM"));
process.on("SIGINT", () => beginShutdown("SIGINT"));

const stopWatch = watchDirectory(path.dirname(STOP_FILE), async (_event, filename) => {
  if (filename?.toString() !== path.basename(STOP_FILE)) return;
  try {
    await fs.unlink(STOP_FILE);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    beginShutdown("stop file", error, true);
    return;
  }
  beginShutdown("stop file");
});
stopWatch.on("error", error => beginShutdown("stop file watcher", error, true));
fs.unlink(STOP_FILE).then(() => beginShutdown("existing stop file"), error => {
  if (error?.code !== "ENOENT") beginShutdown("existing stop file", error, true);
});

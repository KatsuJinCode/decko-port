import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { LocalSqliteDriver } from "../../../src/server/drivers/local-sqlite.js";
import { openSameDatabase } from "../../../src/server/same-database.js";
import { MysqlDriver } from "../../../src/server/drivers/mysql.js";
import type { SQLDatabaseDriver } from "../../../src/server/driver.js";
import { defaultDeckLoader } from "../../../src/card/mod-loader/default-mod-deck.js";
import { getDefaultModLoader } from "../../../src/card/mod-loader.js";
import { FetchEngine } from "../../../src/card/fetch.js";
import { RenderEngine } from "../../../src/card/render.js";
import { setRaiseAllRenderingErrors } from "../../../src/card/render/format.js";
import { CardActionEngine } from "../../../src/card/actions/card-action-engine.js";
import { coffeeNpmCompiler } from "../../../src/server/coffee-npm-compiler.js";
import { uglifyHarmonySyntaxError } from "../../../src/card/assets/uglify-harmony-compile-engine.js";
import { libsassWasmCompiler } from "../../../src/server/libsass-wasm.js";
import type { CreateCardInput, UpdateCardInput } from "../../../src/card/actions/types.js";
import { DeckoName } from "../../../src/card/name.js";
import type { CardRecord } from "../../../src/card/fetch/card-record.js";
import { createVirtualCardLookup } from "../../../src/card/fetch/virtual-cards.js";
import {
  structureRuleUniverseStatement,
  structureRuleTypesFromResults,
  structureUniverseFromResults,
} from "../../../src/card/rules/structure.js";
import { setCaptureWallClock } from "../../../src/card/wall-clock.js";
import { setDeckEnvironment } from "../../../src/card/render/deck-origin.js";
import {
  deckoBotAccountEmail,
  observedModEventRuntime,
  jsonErrorsViewHash,
} from "../../../src/server/write-routes.js";
import { CardActionError } from "../../../src/card/actions/types.js";
import { findRule } from "../../../src/card/rules/lookup.js";
import { patternsForCard } from "../../../src/card/set-patterns/card-patterns.js";
import { settingCardNameForCode } from "../../../src/card/set-patterns/rule-names.js";
import type { PatternCardInput } from "../../../src/card/set-patterns/types.js";
import { ruleWalkPatternInput } from "../../../src/card/actions/rule-content-walk.js";
import {
  canReadByStoredRule,
  readPermissionStateFromViewerResults,
  readPermissionStatements,
  type ReadPermissionState,
  type ReadViewer,
} from "../../../src/card/permissions/read-rules.js";
import {
  allTaskVerdictsForCard,
  viewTaskPermissionStatements,
  viewTaskStateFromResults,
  type ViewTaskState,
} from "../../../src/card/permissions/view-task-rules.js";
import { readPermissionOverride, updatePermissionOverride } from "../../../src/card/permissions/read-override.js";
import { executeCount, executeQuery, parseOptionsWithLexicon } from "../../../src/cql/execute.js";
import { CaptureTransport } from "../../../src/card/notify/transport.js";
import { authenticateAccount } from "../../../src/card/auth/signin.js";
import { actorBot } from "../../../src/card/auth/actor.js";
import { setPreparedSetupVerdict } from "../../../src/card/auth/first-run-setup-verdict-seam.js";
import { applyDeckInflections } from "../../../src/card/name/inflect.js";
import { CARD_GEM_INITIALIZER_INFLECTIONS } from "../../../src/card/name/oracle-deck-inflections.js";
import { strictParityFlags } from "../../../src/card/parity/strict-parity-flags.js";
import { observeRuntimeProfile, PROFILE_PREFIX } from "../../runner/adapter-runtime-profile.mjs";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Req = Record<string, any>;

const spec = JSON.parse(readFileSync(process.env.HARNESS_DECK_JSON!, "utf8"));
const scssCompiler = libsassWasmCompiler();
const passwordHash = process.env.DECKO_HARNESS_PASSWORD_HASH ?? "legacy-sha1";
if (passwordHash !== "legacy-sha1" && passwordHash !== "pbkdf2") {
  throw new Error(`DECKO_HARNESS_PASSWORD_HASH must be "legacy-sha1" or "pbkdf2", got ${JSON.stringify(passwordHash)}`);
}
process.env.DECKO_PASSWORD_HASH = passwordHash;
process.env.DECKO_SIGNIN_UNIFORM_FAILURE = "off";
process.env.DECKO_SIGNIN_THROTTLE = "off";
process.env.DECKO_SESSION_REVOCATION = "off";
process.env.DECKO_STRICT_PARITY_MAIL_UNFOLLOW_REFUSAL ??= "on";
applyDeckInflections(CARD_GEM_INITIALIZER_INFLECTIONS);
const clock = new Date(spec.clock);
setCaptureWallClock(clock);
setDeckEnvironment({
  origin: spec.environment?.origin,
  defaultHtmlView: spec.environment?.default_html_view,
});
setRaiseAllRenderingErrors(false);

const out = process.stdout;
const emit = (obj: unknown): void => {
  out.write(JSON.stringify(obj) + "\n");
};
console.log = (...args: unknown[]) => process.stderr.write(args.map(String).join(" ") + "\n");
console.info = console.log;
console.warn = console.log;

const driver: SQLDatabaseDriver = process.env.HARNESS_MYSQL_DATABASE
  ? await MysqlDriver.connect({
      database: process.env.HARNESS_MYSQL_DATABASE,
      port: Number(process.env.HARNESS_MYSQL_PORT ?? 3306),
    })
  : new LocalSqliteDriver({ path: process.env.HARNESS_DECK!, readonly: false });
await openSameDatabase(driver);

if (process.env.DECKO_HARNESS_MOD_LOADER !== "off" && getDefaultModLoader() === undefined) {
  defaultDeckLoader();
}

let fetcher: FetchEngine;
const engines = new Map<string, RenderEngine>();

async function boot(): Promise<void> {
  fetcher = new FetchEngine(driver);
  fetcher.installNameEnvironment();
  const ids = (await driver.query<{ id: number }>("SELECT id FROM cards WHERE trash = 0", [])).rows.map((r) =>
    Number(r.id),
  );
  await fetcher.warmLexicon(ids);
  const [universe] = await driver.batch([structureRuleUniverseStatement()]);
  fetcher.virtualCardLookup = createVirtualCardLookup(fetcher, {
    contents: structureUniverseFromResults(universe),
    ruleTypeIds: structureRuleTypesFromResults(universe),
  });
  await prepareSetupVerdictSeam();
  engines.clear();
}

async function prepareSetupVerdictSeam(): Promise<void> {
  try {
    const [bot, accountRow] = await Promise.all([
      actorBot(driver),
      driver.query<{ id: number }>(
        "SELECT id FROM cards WHERE codename = 'account' AND trash = 0 ORDER BY id LIMIT 1",
        [],
      ),
    ]);
    const accountId = accountRow.rows[0]?.id;
    if (accountId === undefined) {
      setPreparedSetupVerdict({ open: false, accountCount: undefined });
      return;
    }
    const result = await driver.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM cards
       WHERE right_id = ? AND trash = 0 AND (creator_id IS NULL OR creator_id != ?)`,
      [accountId, bot.id],
    );
    const count = Number(result.rows[0]?.n ?? 0);
    setPreparedSetupVerdict({ open: count === 0, accountCount: count });
  } catch {
    setPreparedSetupVerdict({ open: false });
  }
}

async function actorRecord(actor: string | undefined): Promise<CardRecord | undefined> {
  const cardName = actor === undefined || actor === "anonymous" ? "Anonymous" : spec.actors?.[actor]?.card;
  if (cardName === undefined) throw new Error(`unknown actor ${actor}`);
  return fetcher.fetchByName(cardName);
}

async function viewerFor(actor: string | undefined): Promise<ReadViewer> {
  if (actor === undefined || actor === "anonymous") {
    const anon = await actorRecord("anonymous");
    return { signedIn: false, actorId: anon?.id };
  }
  const rec = await actorRecord(actor);
  if (rec === undefined) throw new Error(`actor card missing for ${actor}`);
  return { signedIn: true, actorId: rec.id };
}

async function engineFor(actor: string | undefined): Promise<RenderEngine> {
  const key = actor ?? "anonymous";
  let engine = engines.get(key);
  if (engine === undefined) {
    engine = new RenderEngine(fetcher);
    engine.renderAbsentCards = true;
    const viewer = await viewerFor(actor);
    engine.viewer = viewer;
    engine.pageSession = viewer.signedIn ? viewer : undefined;
    engines.set(key, engine);
  }
  return engine;
}

async function nameOf(rec: CardRecord): Promise<string> {
  if (rec.leftId !== undefined && rec.leftId !== null && rec.rightId !== undefined && rec.rightId !== null) {
    const composed = await fetcher.lexicon.composeName(rec.leftId, rec.rightId);
    if (composed !== undefined) return composed.s;
  }
  const raw = rec.name as unknown;
  return raw instanceof DeckoName ? raw.s : String(raw ?? "");
}

async function liveRecord(name: string): Promise<CardRecord | undefined> {
  const rec = await fetcher.fetchByName(name);
  return rec === undefined || rec.trash || rec.isNew ? undefined : rec;
}

async function patternInput(name: string): Promise<PatternCardInput> {
  const rec = await liveRecord(name);
  return ruleWalkPatternInput(fetcher, {
    name: DeckoName.parse(rec === undefined ? name : await nameOf(rec)),
    id: rec?.id,
    isNew: rec === undefined,
    typeId: rec?.typeId ?? null,
  } as never);
}

async function opRender(req: Req): Promise<Json> {
  const engine = await engineFor(req.actor);
  engine.resetRequestSession();
  const params = req.format && req.format !== "html" ? { format: req.format } : {};
  const html = req.view
    ? await engine.renderRaw(req.card, req.view, params)
    : await engine.renderPage(req.card);
  return { html };
}

async function permissionState(actor: string | undefined): Promise<{ read: ReadPermissionState; task: ViewTaskState }> {
  const viewer = await viewerFor(actor);
  const read = readPermissionStateFromViewerResults((await driver.batch(readPermissionStatements(viewer))) as never, viewer);
  const task = viewTaskStateFromResults((await driver.batch(viewTaskPermissionStatements())) as never, read);
  return { read, task };
}

async function opAsk(req: Req): Promise<Json> {
  switch (req.q) {
    case "card": {
      const rec = await liveRecord(req.card);
      if (rec === undefined) return { exists: false };
      const name = DeckoName.parse(await nameOf(rec));
      const type = rec.typeId == null ? undefined : await fetcher.fetchById(rec.typeId);
      const readRule = rec.readRuleId == null ? undefined : await fetcher.fetchById(rec.readRuleId);
      return {
        exists: true,
        id: rec.id,
        name: name.s,
        key: rec.key ?? name.key,
        type: type === undefined ? "" : await nameOf(type),
        codename: rec.codename ?? null,
        left: name.isSimple ? null : name.leftName!.s,
        right: name.isSimple ? null : name.rightName!.s,
        read_rule: readRule === undefined ? null : await nameOf(readRule),
      };
    }
    case "permissions": {
      const { read, task } = await permissionState(req.actor);
      const input = await patternInput(req.card);
      const rec = await liveRecord(req.card);
      const viewerRec = await actorRecord(req.actor);
      const viewerKey = viewerRec?.key ?? undefined;
      let readOk: boolean;
      if (read.alwaysOk) readOk = true;
      else if (rec === undefined) {
        const engine = await engineFor(req.actor);
        readOk = await engine.canReadCard({ name: DeckoName.parse(req.card), isNew: true } as never);
      } else {
        const override = await readPermissionOverride(DeckoName.parse(await nameOf(rec)), {
          viewerKey,
          fetchByKey: (key) => fetcher.fetchByKey(key),
          fetchById: (id) => fetcher.fetchById(id),
          leftReadVerdict: async (leftName) => {
            const left = await fetcher.fetchByName(leftName.s);
            return left?.readRuleId == null ? undefined : canReadByStoredRule(left.readRuleId, read);
          },
        });
        readOk = override ?? (rec.readRuleId == null ? false : canReadByStoredRule(rec.readRuleId, read));
      }
      const verdicts = await allTaskVerdictsForCard(fetcher, input, task);
      let update = verdicts.update ?? false;
      if (!task.alwaysOk) {
        const override = await updatePermissionOverride(DeckoName.parse(String(input.name)), {
          viewerKey,
          fetchByKey: (key) => fetcher.fetchByKey(key),
          fetchById: (id) => fetcher.fetchById(id),
        });
        if (override !== undefined) update = override;
      }
      return { read: !!readOk, create: !!verdicts.create, update: !!update, delete: !!verdicts.delete };
    }
    case "set_names":
      return { sets: patternsForCard(await patternInput(req.card)).map((p) => p.setName) };
    case "rule": {
      const found = await findRule(fetcher, await patternInput(req.card), settingCardNameForCode(req.setting));
      return { rule: found === undefined ? null : await nameOf(found.rule) };
    }
    case "search": {
      const engine = await engineFor(req.actor);
      const options = { parse: parseOptionsWithLexicon(fetcher.lexicon), ...(await engine.cqlPermissionOptions()) };
      const query = req.query as Record<string, unknown>;
      if (query.return === "count") return { count: await executeCount(driver, query, options) };
      const result = await executeQuery(driver, { ...query, return: "name" }, options);
      if ("count" in result) return { count: result.count as number };
      const names: string[] = [];
      for (const row of result.rows as unknown as Array<{ name: string | null; left_id: number | null; right_id: number | null }>) {
        if (row.left_id != null) names.push((await fetcher.lexicon.composeName(row.left_id, row.right_id!))?.s ?? "");
        else names.push(row.name ?? "");
      }
      return { names };
    }
    case "name": {
      const n = DeckoName.parse(req.name);
      return {
        s: n.s,
        key: n.key,
        url_key: n.urlKey,
        parts: n.parts,
        simple: n.isSimple,
        left: n.isSimple ? null : n.left,
        right: n.isSimple ? null : n.right,
        trunk: n.trunk,
        tag: n.tag,
      } as Json;
    }
    default:
      throw new Error(`unknown question ${req.q}`);
  }
}

function subcardsFrom(hash: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(hash).map(([k, v]) => {
      if (v === null || typeof v !== "object") return [k, { content: String(v) }];
      const o = v as Record<string, unknown>;
      const sub: Record<string, unknown> = {};
      if (o.content !== undefined) sub.content = String(o.content);
      if (o.fields !== undefined) sub.subcards = subcardsFrom(o.fields as Record<string, unknown>);
      return [k, sub];
    }),
  );
}

class MissingWriteTargetError extends Error { readonly rubyClass = "ArgumentError"; }

async function opWrite(req: Req): Promise<Json> {
  const actorRec = await actorRecord(req.actor);
  const actor =
    req.actor === undefined || req.actor === "anonymous" ? null : { id: actorRec!.id, name: await nameOf(actorRec!) };
  const transport = new CaptureTransport("harness");
  const engine = new CardActionEngine(fetcher, {
    coffeeCompiler: coffeeNpmCompiler(),
    javascriptValidator: uglifyHarmonySyntaxError,
    scssCompiler,
    actor,
    ipAddress: null,
    now: () => clock,
    notifyTransport: transport,
    modEvents: await observedModEventRuntime({ driver }),
    followMail: {
      origin: spec.environment?.origin ?? "http://deck.example",
      deckoBotEmail: await deckoBotAccountEmail(driver),
    },
  });
  const fields = (req.fields ?? {}) as Record<string, unknown>;
  const input: Record<string, unknown> = {};
  if (fields.type !== undefined) input.typeName = fields.type;
  if (fields.content !== undefined) input.content = fields.content;
  if (fields.fields !== undefined) {
    input.subcards = subcardsFrom(fields.fields as Record<string, unknown>);
  }
  let saved = true;
  let errors: Json[] = [];
  let card: Json = null;
  try {
    let result: unknown;
    let fetchedTargetId: number | undefined;
    if (req.action === "create") {
      result = await engine.createCard({ name: req.card, ...input } as CreateCardInput);
    } else {
      const rec = await liveRecord(req.card);
      if (rec === undefined) throw new MissingWriteTargetError(`no such card ${req.card}`);
      fetchedTargetId = rec.id;
      if (req.action === "update") {
        if (fields.name !== undefined) input.name = fields.name;
        result = await engine.updateCard({ cardId: rec.id, ...input } as UpdateCardInput);
      } else if (req.action === "delete") {
        result = await engine.deleteCard({ cardId: rec.id });
      } else throw new Error(`unknown write action ${req.action}`);
    }
    const id =
      (result as { cardId?: number })?.cardId ?? (result as { card?: { id?: number } })?.card?.id ?? fetchedTargetId;
    if (id !== undefined) {
      await boot();
      const rec = await fetcher.fetchById(id, { lookInTrash: true });
      card = rec === undefined ? null : { name: await nameOf(rec), id };
    }
  } catch (error) {
    if (error instanceof MissingWriteTargetError) throw error;
    saved = false;
    const e = error as Error & {
      code?: string;
      field?: string;
      errorsByAttribute?: Record<string, string>;
    };
    if (e.errorsByAttribute !== undefined && Object.keys(e.errorsByAttribute).length > 0) {
      errors = Object.entries(e.errorsByAttribute).map(([field, message]) => ({ field, message }));
    } else if (e.code === "recaptcha") {
      errors = [{ field: "recaptcha", message: e.message }];
    } else if (e instanceof CardActionError) {
      const hash = jsonErrorsViewHash(e, actor !== null);
      const entries = Object.entries(hash);
      if (entries.length > 0) {
        errors = entries.map(([field, message]) => ({ field, message }));
      } else {
        errors = [{ field: String(e.code), message: e.message }];
      }
    } else if (Array.isArray((e as { errors?: unknown[] }).errors)) {
      const list = (e as { errors: Array<{ field?: string; message?: string }> }).errors;
      errors = list.map((x) => ({ field: String(x.field ?? ""), message: String(x.message ?? "") }));
    } else if (e.code !== undefined) {
      errors = [{ field: e.code, message: e.message }];
    } else if ((e.constructor?.name ?? "").startsWith("Card::Error")) {
      errors = [{ field: "exception", message: `${e.constructor?.name ?? "Error"}: ${e.message}` }];
    } else {
      throw error;
    }
    const denied = req.action === "create" ? undefined : await liveRecord(req.card).catch(() => undefined);
    card =
      denied === undefined
        ? null
        : { name: await nameOf(denied), id: denied.id };
  }
  await boot();
  const mail = transport.captured().map((m) => ({
    to: String(m.to).split(",").map((s) => s.trim()).filter(Boolean).sort(),
    subject: m.subject,
    text: m.textBody,
  }));
  return { saved, errors, card, mail } as Json;
}

async function opSignin(req: Req): Promise<Json> {
  const result = await authenticateAccount(driver, String(req.email ?? ""), String(req.password ?? ""));
  if (result.ok) return { signed_in: true, actor: result.account.holder.name };
  return { signed_in: false, actor: "Anonymous" };
}

const HANDLERS: Record<string, (req: Req) => Promise<Json>> = {
  render: opRender,
  ask: opAsk,
  write: opWrite,
  signin: opSignin,
};

await boot();
process.stderr.write(PROFILE_PREFIX + JSON.stringify(observeRuntimeProfile(strictParityFlags)) + "\n");
emit({ ready: true, protocol: 1, engine: "decko-ts", version: { package: "decko-ts", password_hash: passwordHash, mail_unfollow_refusal: process.env.DECKO_STRICT_PARITY_MAIL_UNFOLLOW_REFUSAL } });

const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  if (line.trim() === "") continue;
  const req = JSON.parse(line) as Req;
  if (req.op === "quit") break;
  try {
    const handler = HANDLERS[req.op];
    if (handler === undefined) throw new Error(`unknown op ${req.op}`);
    emit({ id: req.id, ok: true, result: await handler(req) });
  } catch (error) {
    const e = error as Error;
    emit({ id: req.id, ok: false, error: { class: (e as { rubyClass?: string } | undefined)?.rubyClass ?? e?.constructor?.name ?? "Error", message: String(e?.message ?? e).slice(0, 500) } });
  }
}
await driver.close?.();
process.exit(0);

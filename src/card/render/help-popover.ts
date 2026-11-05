import { DeckoName } from "../name.js";
import { h } from "./slot-html.js";
import type { SQLStatement } from "../../server/driver.js";
import type { CardsRow } from "../../server/schema.js";
import { composeCardRecord, type CardRecord } from "../fetch/card-record.js";
import type { DbLexicon } from "../fetch/lexicon.js";
import type { FetchEngine } from "../fetch.js";
import { ruleNamesForCard } from "../set-patterns/rule-names.js";
import type { PatternCardInput } from "../set-patterns/types.js";
import { registeredSettingHelpText } from "./setting-help-text.js";
import type { HelpRulesApi, RenderCard, RenderFormat } from "./format.js";

export type { HelpRulesApi };

interface RenderEngineHelpHost {
  fetchRenderCard(name: string): RenderCard | undefined;
  isDenied(card: RenderCard): boolean;
  cacheFetchedRecord(record: CardRecord): Promise<unknown>;
  ruleTypeIds: { setting?: number; set?: number; user?: number } | undefined;
  readPermission?: {
    readonly readableRuleIds: ReadonlySet<number>;
    readonly alwaysOk: boolean;
  };
}

export function processHelpContent(fmt: RenderFormat, raw: string): string {
  let out = "";
  let i = 0;
  while (i < raw.length) {
    const brace = raw.indexOf("{{", i);
    const bracket = raw.indexOf("[[", i);
    if (brace === -1 && bracket === -1) {
      out += raw.slice(i);
      break;
    }
    if (bracket !== -1 && (brace === -1 || bracket < brace)) {
      out += fmt.processContent(raw.slice(i, bracket));
      const match = /^\[\[([^\]]+)\]\]/.exec(raw.slice(bracket));
      if (match === null) {
        out += raw.slice(bracket, bracket + 2);
        i = bracket + 2;
        continue;
      }
      out += renderLinkChunk(fmt, match[1]);
      i = bracket + match[0].length;
    } else {
      const end = bracket === -1 ? raw.length : bracket;
      out += fmt.processContent(raw.slice(i, end));
      i = end;
    }
  }
  return out;
}

function setModuleRawHelpText(
  card: RenderCard,
  engine: RenderEngineHelpHost,
): string | undefined {
  const rightKey = card.name.rightName?.key;
  if (rightKey !== "*variable" && rightKey !== "*variables") return undefined;
  const leftKey = card.name.leftName?.key;
  if (leftKey === undefined) return undefined;
  const left = engine.fetchRenderCard(leftKey);
  if (left === undefined) return undefined;
  if (left.typeCode !== "bootswatch_skin" && left.typeName !== "BootswatchSkin") {
    return undefined;
  }
  return (
    "    Override bootstrap [[https://github.com/twbs/bootstrap/blob/v5.1.3/scss/_variables.scss|variables]]\n"
  );
}

function dividerIndex(rawSyntax: string): number {
  if (!rawSyntax.includes("|")) return -1;
  let masked = rawSyntax;
  for (const incl of rawSyntax.match(/\{\{[^}]*\}\}/g) ?? []) {
    masked = masked.split(incl).join("x".repeat(incl.length));
  }
  return masked.indexOf("|");
}

function renderLinkChunk(fmt: RenderFormat, rawSyntax: string): string {
  const divider = dividerIndex(rawSyntax);
  const target = (divider === -1 ? rawSyntax : rawSyntax.slice(0, divider)).trim();
  const label = divider === -1 ? undefined : rawSyntax.slice(divider + 1).trim() || undefined;
  if (target === "") return "";
  if (/^(\/|https?:|mailto:)/.test(target)) {
    return explicitLinkBytes(target, label);
  }
  const title = label ?? (DeckoName.parse(target).fullyStripped?.s ?? target);
  return fmt.nest({
    syntax: `{{${rawSyntax}}}`,
    name: target,
    options: { view: "link", title, extra: {} },
    comment: undefined,
  });
}

function explicitLinkBytes(target: string, label: string | undefined): string {
  const type = /^https?:/.test(target)
    ? "external-link"
    : /^\//.test(target)
      ? "internal-link"
      : "email-link";
  const text = label ?? target;
  const targetAttr = type === "external-link" ? ' target="_blank"' : "";
  return `<a${targetAttr} class="${type}" href="${h(target)}">${h(text)}</a>`;
}

export class HelpRulesResolver implements HelpRulesApi {
  private readonly engine: RenderEngineHelpHost;
  private readonly fetcher: FetchEngine;
  private prepared = false;
  private canaryKey: string | undefined;
  private setTypeId: number | undefined;
  private settingTypeId: number | undefined;
  private userTypeId: number | undefined;
  private readonly ruleCounts = new Map<number, number>();

  constructor(engine: RenderEngineHelpHost, fetcher: FetchEngine) {
    this.engine = engine;
    this.fetcher = fetcher;
  }

  async prepare(): Promise<void> {
    if (this.prepared && this.canaryWarm()) return;
    this.prepared = true;
    this.canaryKey = undefined;
    this.ruleCounts.clear();
    await this.fetcher.codenames.ensureLoaded();
    const setTypeId = this.fetcher.codenames.peekId("set");
    const settingTypeId = this.fetcher.codenames.peekId("setting");
    if (setTypeId === undefined || settingTypeId === undefined) return;
    this.setTypeId = setTypeId;
    this.settingTypeId = settingTypeId;
    this.userTypeId = this.fetcher.codenames.peekId("user");
    const host = this.engineHost();
    if (host.ruleTypeIds === undefined) {
      host.ruleTypeIds = {
        setting: settingTypeId,
        set: setTypeId,
        user: this.fetcher.codenames.peekId("user"),
      };
    }
    const results = await this.fetcher.driver.batch([
      helpRuleSidesStatement(setTypeId, settingTypeId),
      settingRuleCountsStatement(
        setTypeId,
        settingTypeId,
        host.readPermission?.alwaysOk
          ? "all"
          : host.readPermission?.readableRuleIds ?? new Set<number>(),
        host.readPermission?.alwaysOk === true,
      ),
    ]);
    const counts = results[1];
    for (const row of (counts?.rows ?? []) as Array<{ sid: number; c: number }>) {
      this.ruleCounts.set(Number(row.sid), Number(row.c));
    }
    const rows = (results[0]?.rows ?? []) as CardsRow[];
    await this.composeAndCache(rows, host);
  }

  menuHelpContentBytes(fmt: RenderFormat): string {
    const card = fmt.card;
    if (card.unknown === true) return "";
    const isRule = this.isRuleCard(card);
    let text = this.ruleBasedHelp(fmt, card);
    if (isRule) text = `${text} ${this.settingLinkBytes(card)}`;
    const ruleCard = this.helpRuleCard(card);
    if (ruleCard !== undefined) {
      text = `<span class='d-none'>${this.ruleEditLinkBytes(ruleCard)}</span>${text}`;
    }
    return rubyBlank(text) ? "" : text;
  }

  ruleBasedHelp(fmt: RenderFormat, card: RenderCard): string {
    const raw = this.rawHelpText(card);
    if (raw === undefined) return "";
    return processHelpContent(fmt, raw);
  }

  ruleBasedHelpForCard(fmt: RenderFormat, card: RenderCard): string {
    return this.ruleBasedHelp(fmt, card);
  }

  private rawHelpText(card: RenderCard): string | undefined {
    const staticHelp = this.isRuleCard(card) && !this.isStandardRuleCard(card)
      ? undefined
      : registeredSettingHelpText(card.record.codename, this.rightPartCodename(card));
    if (staticHelp !== undefined) return staticHelp;
    const setModuleHelp = setModuleRawHelpText(card, this.engine);
    if (setModuleHelp !== undefined) return setModuleHelp;
    const ruleCard = this.helpRuleCard(card);
    return ruleCard === undefined ? undefined : ruleCard.dbContent;
  }

  private helpRuleCard(card: RenderCard): RenderCard | undefined {
    if (card.unknown === true) return undefined;
    for (const candidate of this.ruleCandidateNames(card)) {
      const record = this.engine.fetchRenderCard(candidate);
      if (record === undefined) continue;
      if (this.engine.isDenied(record)) continue;
      return record;
    }
    return undefined;
  }

  private ruleCandidateNames(card: RenderCard): string[] {
    const input: PatternCardInput = {
      name: card.name.s,
      id: card.id,
      typeId: card.typeId,
      typeName: card.typeName,
    };
    if (card.name.isCompound) {
      const leftKey = card.name.leftName?.key;
      const left = leftKey !== undefined ? this.engine.fetchRenderCard(leftKey) : undefined;
      input.leftTypeName = left?.typeName;
    }
    return ruleNamesForCard(input, "*help");
  }

  private isRuleCard(card: RenderCard): boolean {
    if (this.settingTypeId === undefined) return false;
    if (!card.name.isCompound) return false;
    const rightKey = card.name.rightName?.key;
    const leftKey =
      card.name.parts.length > 1
        ? DeckoName.parse(card.name.parts.slice(0, -1).join("+")).key
        : undefined;
    if (rightKey === undefined || leftKey === undefined || leftKey === "") return false;
    const right = this.engine.fetchRenderCard(rightKey);
    if (right === undefined) return false;
    if (right.record.typeId !== this.settingTypeId) return false;
    const left = this.engine.fetchRenderCard(leftKey);
    if (left !== undefined && left.record.typeId === this.setTypeId) return true;
    if (card.name.parts.length <= 2) return false;
    const trunkKey = DeckoName.parse(card.name.parts.slice(0, -2).join("+")).key;
    if (trunkKey === "") return false;
    const trunk = this.engine.fetchRenderCard(trunkKey);
    if (trunk === undefined || trunk.record.typeId !== this.setTypeId) return false;
    const prefererKey = DeckoName.parse(card.name.parts[card.name.parts.length - 2] ?? "").key;
    if (prefererKey === "") return false;
    const preferer = this.engine.fetchRenderCard(prefererKey);
    if (preferer === undefined) return false;
    if (this.userTypeId !== undefined && preferer.record.typeId === this.userTypeId) return true;
    return preferer.record.codename === "all";
  }

  private isStandardRuleCard(card: RenderCard): boolean {
    const leftKey =
      card.name.parts.length > 1
        ? DeckoName.parse(card.name.parts.slice(0, -1).join("+")).key
        : undefined;
    if (leftKey === undefined || leftKey === "") return false;
    const left = this.engine.fetchRenderCard(leftKey);
    return left !== undefined && this.setTypeId !== undefined && left.record.typeId === this.setTypeId;
  }

  private settingLinkBytes(card: RenderCard): string {
    const settingName = card.name.rightName?.s ?? "";
    const settingKey = card.name.rightName?.key;
    const settingRecord = settingKey !== undefined ? this.engine.fetchRenderCard(settingKey) : undefined;
    const known = settingRecord !== undefined && settingRecord.unknown !== true;
    const count = settingRecord?.id !== undefined ? (this.ruleCounts.get(settingRecord.id) ?? 0) : 0;
    const title = settingName.replace(/\*/g, "");
    const href = `/${h(DeckoName.parse(settingName).urlKey)}`;
    return (
      `<div class="ms-auto"><a class="text-muted ${known ? "known-card" : "wanted-card"}"` +
      ` href="${href}"> (${count} ${h(title)} rules)</a></div>`
    );
  }

  ruleHelpTextBytes(fmt: RenderFormat): string {
    const card = fmt.card;
    if (card.unknown === true) return "";
    if (!this.isRuleCard(card)) return "";
    const text = this.ruleBasedHelp(fmt, card);
    return `${text} ${this.settingLinkBytes(card)}`.trimStart();
  }

  private ruleEditLinkBytes(ruleCard: RenderCard): string {
    const href = `/${h(ruleCard.name.urlKey)}/rule_edit`;
    return (
      `<a rel="nofollow" class="edit-link slotter" title="Edit" data-bs-toggle="tooltip"` +
      ` data-bs-placement="bottom" data-slotter-mode="modal" data-modal-class="modal-lg"` +
      ` href="${href}" data-remote="true"><i class="notranslate material-icons">edit</i> </a>`
    );
  }

  private rightPartCodename(card: RenderCard): string | undefined {
    if (!card.name.isCompound) return undefined;
    const rightKey = card.name.rightName?.key;
    if (rightKey === undefined) return undefined;
    return this.engine.fetchRenderCard(rightKey)?.record.codename;
  }

  peekStaticHelpTextFor(card: RenderCard): string | undefined {
    return registeredSettingHelpText(card.record.codename, this.rightPartCodename(card));
  }

  private canaryWarm(): boolean {
    return this.canaryKey === undefined || this.engine.fetchRenderCard(this.canaryKey) !== undefined;
  }

  private engineHost(): RenderEngineHelpHost {
    return this.engine;
  }

  private async composeAndCache(rows: CardsRow[], host: RenderEngineHelpHost): Promise<void> {
    const byId = new Map<number, CardsRow>();
    for (const row of rows) byId.set(row.id, row);
    const lexicon = this.fetcher.lexicon;
    const names = new Map<number, DeckoName>();
    for (const row of byId.values()) {
      if (row.name !== null) names.set(row.id, DeckoName.parse(row.name));
    }
    let pending = [...byId.values()];
    for (let pass = 0; pass < 64 && pending.length > 0; pass++) {
      const still: CardsRow[] = [];
      for (const row of pending) {
        const composed = await this.tryComposeName(row, names, lexicon);
        if (composed !== undefined) names.set(row.id, composed);
        else still.push(row);
      }
      if (still.length === pending.length) break;
      pending = still;
    }
    let firstRuleKey: string | undefined;
    const composed: CardRecord[] = [];
    for (const row of byId.values()) {
      const name = names.get(row.id);
      if (name === undefined) continue;
      if (row.name !== null) lexicon.write(row.id, name, row.name);
      else if (row.left_id !== null && row.right_id !== null) {
        lexicon.write(row.id, name, [row.left_id, row.right_id]);
      }
    }
    for (const row of byId.values()) {
      if (names.get(row.id) === undefined) continue;
      composed.push(await composeCardRecord(row, lexicon));
    }
    for (const record of composed) this.fetcher.writeToCache(record);
    for (const record of composed) {
      await host.cacheFetchedRecord(record);
      if (firstRuleKey === undefined && record.key?.includes("+*help") === true) {
        firstRuleKey = record.key;
      }
    }
    if (firstRuleKey !== undefined) this.canaryKey = firstRuleKey;
  }

  private async tryComposeName(
    row: CardsRow,
    names: Map<number, DeckoName>,
    lexicon: DbLexicon,
  ): Promise<DeckoName | undefined> {
    if (row.name !== null) return DeckoName.parse(row.name);
    if (row.left_id === null || row.right_id === null) return undefined;
    const left = await this.sideName(row.left_id, names, lexicon);
    const right = await this.sideName(row.right_id, names, lexicon);
    if (left === undefined || right === undefined) return undefined;
    return DeckoName.parse(`${left.s}+${right.s}`);
  }

  private async sideName(
    id: number,
    names: Map<number, DeckoName>,
    lexicon: DbLexicon,
  ): Promise<DeckoName | undefined> {
    const local = names.get(id);
    if (local !== undefined) return local;
    try {
      const viaLexicon = await lexicon.name(id);
      return viaLexicon !== undefined && viaLexicon.s !== "" ? viaLexicon : undefined;
    } catch {
      return undefined;
    }
  }
}

function rubyBlank(s: string): boolean {
  return /^\s*$/.test(s);
}

export function helpRuleSidesStatement(setTypeId: number, settingTypeId: number): SQLStatement {
  const ruleJoin =
    "FROM cards rules\n" +
    "  JOIN cards sets ON rules.left_id = sets.id\n" +
    "  JOIN cards settings ON rules.right_id = settings.id\n" +
    "WHERE sets.type_id = ? AND settings.type_id = ? AND settings.codename = 'help'\n" +
    "  AND rules.trash = 0 AND sets.trash = 0 AND settings.trash = 0";
  return {
    sql:
      "WITH RECURSIVE reached(id) AS (\n" +
      `  SELECT rules.id ${ruleJoin}\n` +
      "  UNION\n" +
      "  SELECT j.left_id FROM reached r\n" +
      "    JOIN cards j ON j.id = r.id AND j.trash = 0\n" +
      "    WHERE j.left_id IS NOT NULL\n" +
      "  UNION\n" +
      "  SELECT j.right_id FROM reached r\n" +
      "    JOIN cards j ON j.id = r.id AND j.trash = 0\n" +
      "    WHERE j.right_id IS NOT NULL\n" +
      "  UNION\n" +
      "  SELECT j.type_id FROM reached r\n" +
      "    JOIN cards j ON j.id = r.id\n" +
      "    WHERE j.type_id IS NOT NULL\n" +
      ")\n" +
      "SELECT c.* FROM cards c WHERE c.trash = 0 AND c.id IN (SELECT id FROM reached)",
    params: [setTypeId, settingTypeId],
  };
}

export function settingRuleCountsStatement(
  setTypeId: number,
  settingTypeId: number,
  readableRuleIds: ReadonlySet<number> | "all",
  alwaysOk = false,
): SQLStatement {
  const all = readableRuleIds === "all";
  const readableIds = all ? [] : Array.from(readableRuleIds);
  const hasFilter = readableIds.length > 0;
  const readableParams: number[] = hasFilter && !alwaysOk ? readableIds : [];
  const sql =
    "SELECT settings.id AS sid, COUNT(*) AS c\n" +
    "FROM cards rules\n" +
    "  JOIN cards sets ON rules.left_id = sets.id\n" +
    "  JOIN cards settings ON rules.right_id = settings.id\n" +
    "WHERE sets.type_id = ? AND settings.type_id = ?\n" +
    "  AND rules.trash = 0 AND sets.trash = 0 AND settings.trash = 0\n" +
    (alwaysOk
      ? ""
      : hasFilter
      ? "  AND (rules.read_rule_id IS NULL OR rules.read_rule_id IN (" +
        readableParams.map(() => "?").join(",") +
        "))\n"
      : all
        ? ""
        : "  AND rules.read_rule_id IS NULL\n") +
    "GROUP BY settings.id";
  return { sql, params: [setTypeId, settingTypeId, ...readableParams] };
}

export function installHelpRules(engine: {
  helpRules?: HelpRulesApi;
  fetchRenderCard(name: string): RenderCard | undefined;
  isDenied(card: RenderCard): boolean;
}, fetcher: FetchEngine): HelpRulesResolver {
  const resolver = new HelpRulesResolver(
    engine as unknown as RenderEngineHelpHost,
    fetcher,
  );
  (engine as { helpRules?: HelpRulesApi }).helpRules = resolver;
  return resolver;
}

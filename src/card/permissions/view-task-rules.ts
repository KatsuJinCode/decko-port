import type { SQLQueryResult, SQLStatement } from "../../server/driver.js";
import { resolveTypeId } from "../actions/type-resolution.js";
import { CardActionError } from "../actions/types.js";
import type { FetchEngine } from "../fetch.js";
import { DeckoName } from "../name.js";
import { CodenameNotFoundError, NameNotFoundError } from "../name/errors.js";
import { ruleNamesForCard } from "../set-patterns/rule-names.js";
import { parseSetName } from "../set-patterns/set-name.js";
import type { PatternCardInput } from "../set-patterns/types.js";
import { strictParityFlags } from "../parity/strict-parity-flags.js";
import type { ReadPermissionState } from "./read-rules.js";
import {
  resolveRuleIdsByComposedKeys,
  resolveRuleIdsByRuleKeys,
  ruleClosureWalkStatement,
} from "./read-rules.js";
import type { CrudTask } from "./view-perms.js";

export type WriteTask = Exclude<CrudTask, "read">;

const WRITE_TASK_CODENAMES: readonly WriteTask[] = ["update", "create", "delete"];

const TASK_SETTING_NAME: Record<CrudTask, string> = {
  read: "*read",
  create: "*create",
  update: "*update",
  delete: "*delete",
};

const LEFT_RULE_VALUE = /^\[?\[?_left\]?\]?$/;

export function viewTaskPermissionStatements(): SQLStatement[] {
  return [
    {
      sql:
        `SELECT rules.id AS ruleId, setting_cards.codename AS task, ` +
        `rules.db_content AS content, ` +
        `refs.referee_id AS partyId ` +
        `FROM cards rules ` +
        `JOIN cards setting_cards ON rules.right_id = setting_cards.id ` +
        `  AND setting_cards.codename IN ('update', 'create', 'delete') ` +
        `JOIN cards sets ON rules.left_id = sets.id ` +
        `LEFT JOIN card_references refs ON refs.referer_id = rules.id ` +
        `WHERE sets.type_id = ` +
        `  (SELECT id FROM cards WHERE codename = 'set' AND trash = 0 ORDER BY id LIMIT 1) ` +
        `AND rules.trash = 0 AND setting_cards.trash = 0 AND sets.trash = 0`,
      params: [],
    },
  ];
}

interface TaskRuleRow {
  ruleId: number;
  task: string;
  content: string | null;
  partyId: number | null;
}

export interface ViewTaskState {
  readonly alwaysOk: boolean;
  readonly viewerParties: number[];
  readonly hasTaskRules: Record<WriteTask, boolean>;
  readonly ruleParties: Record<WriteTask, Map<number, Set<number>>>;
  readonly ruleContent: Record<WriteTask, Map<number, string>>;
  readonly signedInActorId?: number;
}

export async function signupApprovalAllowed(
  fetcher: FetchEngine,
  state: ViewTaskState | undefined,
): Promise<boolean> {
  if (state === undefined) return false;
  const typeId = await fetcher.codenames.id("user");
  if (typeId === undefined) return false;
  const type = await fetcher.fetchById(typeId, { skipVirtual: true });
  return (await taskVerdictForCard(
    fetcher,
    { name: "", isNew: true, typeId, typeName: type?.name?.s },
    "create",
    state,
  )) === true;
}

export function viewTaskStateFromResults(
  results: SQLQueryResult[],
  readState: ReadPermissionState | undefined,
): ViewTaskState {
  const rows = (results[0]?.rows ?? []) as TaskRuleRow[];
  const ruleParties: Record<WriteTask, Map<number, Set<number>>> = {
    update: new Map(),
    create: new Map(),
    delete: new Map(),
  };
  const ruleContent: Record<WriteTask, Map<number, string>> = {
    update: new Map(),
    create: new Map(),
    delete: new Map(),
  };
  const hasTaskRules: Record<WriteTask, boolean> = {
    update: false,
    create: false,
    delete: false,
  };
  for (const row of rows) {
    if (!isWriteTask(row.task)) continue;
    const task = row.task;
    hasTaskRules[task] = true;
    if (!ruleContent[task].has(row.ruleId)) {
      ruleContent[task].set(row.ruleId, (row.content ?? "").trim());
    }
    let parties = ruleParties[task].get(row.ruleId);
    if (parties === undefined) {
      parties = new Set<number>();
      ruleParties[task].set(row.ruleId, parties);
    }
    if (row.partyId !== null && row.partyId !== undefined) parties.add(row.partyId);
  }
  return {
    alwaysOk: readState?.alwaysOk ?? false,
    viewerParties: readState?.parties ?? [],
    hasTaskRules,
    ruleParties,
    ruleContent,
    signedInActorId: readState?.signedInActorId,
  };
}

async function followPreferencePermit(
  fetcher: FetchEngine,
  card: PatternCardInput,
  state: ViewTaskState,
): Promise<true | undefined> {
  const actorId = state.signedInActorId;
  if (actorId === undefined) return undefined;
  const name = card.name instanceof DeckoName ? card.name : DeckoName.parse(String(card.name));
  const parts = name.parts;
  if (parts.length < 2) return undefined;
  const followId = await fetcher.codenames.id("follow");
  if (followId === undefined) return undefined;
  const followName = await fetcher.lexicon.name(followId);
  if (followName === undefined || DeckoName.parse(parts[parts.length - 1]!).key !== followName.key) return undefined;
  const right = await fetcher.fetchById(followId);
  if (right === undefined) return undefined;
  const [settingTypeId, setTypeId, userTypeId] = await Promise.all([
    fetcher.codenames.id("setting"),
    fetcher.codenames.id("set"),
    fetcher.codenames.id("user"),
  ]);
  if (right.typeId !== settingTypeId) return undefined;
  if (parts.length === 2) {
    if (strictParityFlags().mailUnfollowRefusal) return undefined;
    const dashboardOwner = await fetcher.fetchByName(parts[0]!);
    if (dashboardOwner === undefined || dashboardOwner.trash || dashboardOwner.typeId !== userTypeId) {
      return undefined;
    }
    return dashboardOwner.id === actorId ? true : undefined;
  }
  const setName = DeckoName.parse(parts.slice(0, -2).join("+"));
  const set = await fetcher.fetchByName(setName.s);
  const setIsSet =
    set === undefined
      ? parseSetName(setName).spec !== undefined
      : set.typeId === setTypeId;
  if (!setIsSet) return undefined;
  const preferer = await fetcher.fetchByName(parts[parts.length - 2]!);
  if (preferer === undefined || preferer.trash) return undefined;
  if (preferer.typeId !== userTypeId && preferer.codename !== "all") return undefined;
  return preferer.id === actorId ? true : undefined;
}

function isWriteTask(task: string): task is WriteTask {
  return (WRITE_TASK_CODENAMES as readonly string[]).includes(task);
}

export async function taskVerdictForCard(
  fetcher: FetchEngine,
  card: PatternCardInput,
  task: WriteTask,
  state: ViewTaskState,
  depth = 0,
): Promise<boolean | undefined> {
  if (state.alwaysOk) return true;
  if ((await followPreferencePermit(fetcher, card, state)) === true) return true;
  if (task !== "delete") {
    const owner = await enabledRolesOwnerVerdict(fetcher, card, state);
    if (owner !== undefined) return owner;
    if (await isSessionTyped(fetcher, card)) return true;
  }
  const trunk = await permitVerdict(fetcher, card, task, state);
  if (trunk !== true) return trunk;
  if (task === "create") {
    return createSidesAllowed(fetcher, card, state, depth);
  }
  return true;
}

export async function allTaskVerdictsForCard(
  fetcher: FetchEngine,
  card: PatternCardInput,
  state: ViewTaskState,
  depth = 0,
): Promise<Record<WriteTask, boolean | undefined>> {
  const out: Record<WriteTask, boolean | undefined> = {
    update: false,
    create: false,
    delete: false,
  };
  if (state.alwaysOk) {
    return { update: true, create: true, delete: true };
  }
  if ((await followPreferencePermit(fetcher, card, state)) === true) {
    return { update: true, create: true, delete: true };
  }
  const session = await isSessionTyped(fetcher, card);
  const owner = await enabledRolesOwnerVerdict(fetcher, card, state);
  if (session || owner !== undefined) {
    out.create = owner ?? true;
    out.update = owner ?? true;
  }
  const needed = WRITE_TASK_CODENAMES.filter(
    (task) => state.hasTaskRules[task] && !((session || owner !== undefined) && task !== "delete"),
  );
  if (needed.length === 0) return out;
  for (const task of needed) {
    const resolved = await applicableRule(fetcher, card, task, state, depth);
    if (resolved === undefined) continue;
    if (task !== "create") {
      out[task] = amongParties(state, resolved.task, resolved.ruleId);
      continue;
    }
    if (!amongParties(state, resolved.task, resolved.ruleId)) {
      out.create = false;
      continue;
    }
    out.create = await createSidesAllowed(fetcher, card, state, depth);
  }
  return out;
}

async function enabledRolesOwnerVerdict(
  fetcher: FetchEngine,
  card: PatternCardInput,
  state: ViewTaskState,
): Promise<boolean | undefined> {
  const name = DeckoName.parse(card.name);
  if (!name.isCompound || name.rightName === undefined || name.leftName === undefined) return undefined;
  await fetcher.codenames.ensureLoaded();
  const settingName = fetcher.codenames.peekName("enabled_roles");
  if (settingName === undefined || DeckoName.parse(settingName).key !== name.rightName.key) return undefined;
  const actorId = state.signedInActorId ?? await fetcher.codenames.id("anonymous");
  const owner = await fetcher.fetchByName(name.leftName.s);
  return actorId !== undefined && owner?.id === actorId;
}

async function isSessionTyped(fetcher: FetchEngine, card: PatternCardInput): Promise<boolean> {
  if (card.typeId === undefined || card.typeId === null) return false;
  const sessionId = await fetcher.codenames.id("session");
  return sessionId !== undefined && card.typeId === sessionId;
}

export async function followRightPermitPassedForCard(
  fetcher: FetchEngine,
  card: PatternCardInput,
  state: ViewTaskState,
): Promise<boolean> {
  if (state.alwaysOk) return false;
  const name = card.name instanceof DeckoName ? card.name : DeckoName.parse(String(card.name));
  const parts = name.parts;
  if (parts.length < 2) return false;
  const followId = await fetcher.codenames.id("follow");
  if (followId === undefined) return false;
  const followName = await fetcher.lexicon.name(followId);
  if (followName === undefined || DeckoName.parse(parts[parts.length - 1]!).key !== followName.key) {
    return false;
  }
  const right = await fetcher.fetchById(followId);
  if (right === undefined) return false;
  const settingTypeId = await fetcher.codenames.id("setting");
  if (right.typeId !== settingTypeId) return false;
  if (state.signedInActorId !== undefined && parts.length > 2) {
    const setParsed = parseSetName(parts.slice(0, -2).join("+"));
    if (setParsed.spec !== undefined) {
      const preferer = await fetcher.fetchByName(parts[parts.length - 2]!);
      if (preferer !== undefined && !preferer.trash) {
        const userTypeId = await fetcher.codenames.id("user");
        if (
          (preferer.typeId === userTypeId || preferer.codename === "all") &&
          preferer.id === state.signedInActorId
        ) {
          return true;
        }
      }
    }
  }
  return (await permitVerdict(fetcher, card, "create", state)) === true;
}

export async function saveTaskVerdictForCard(
  fetcher: FetchEngine,
  card: PatternCardInput,
  task: WriteTask,
  state: ViewTaskState,
  opts: { typeChanged?: boolean; assignedName?: string } = {},
): Promise<boolean | undefined> {
  if (state.alwaysOk) return true;
  if ((await followPreferencePermit(fetcher, card, state)) === true) return true;
  if (task !== "delete") {
    const owner = await enabledRolesOwnerVerdict(fetcher, card, state);
    if (owner !== undefined) return owner;
  }
  if (task !== "update") {
    return taskVerdictForCard(fetcher, card, task, state);
  }
  const update = await permitVerdict(fetcher, card, "update", state);
  if (update !== true) return update;
  if (opts.typeChanged === true) {
    const create = await permitVerdict(fetcher, card, "create", state);
    if (create !== true) return create;
  }
  if (opts.assignedName === undefined) return true;
  return renameCreatedSidesVerdict(fetcher, card, opts.assignedName, state);
}

async function renameCreatedSidesVerdict(
  fetcher: FetchEngine,
  card: PatternCardInput,
  assignedName: string,
  state: ViewTaskState,
): Promise<boolean | undefined> {
  const name = DeckoName.parse(assignedName);
  if (!name.isCompound) return true;
  return createSidesAllowed(fetcher, { name }, state, 0, card.id ?? undefined);
}

function amongParties(state: ViewTaskState, task: WriteTask, ruleId: number): boolean {
  const own = state.ruleParties[task].get(ruleId);
  if (own !== undefined) return state.viewerParties.some((party) => own.has(party));
  for (const [otherTask, map] of Object.entries(state.ruleParties)) {
    if (otherTask === task) continue;
    const parties = (map as Map<number, Set<number>>).get(ruleId);
    if (parties !== undefined) return state.viewerParties.some((party) => parties.has(party));
  }
  return false;
}

async function permitVerdict(
  fetcher: FetchEngine,
  card: PatternCardInput,
  task: WriteTask,
  state: ViewTaskState,
): Promise<boolean | undefined> {
  const resolved = await applicableRule(fetcher, card, task, state);
  if (resolved === undefined) return false;
  return amongParties(state, resolved.task, resolved.ruleId);
}

async function applicableRule(
  fetcher: FetchEngine,
  card: PatternCardInput,
  task: WriteTask,
  state: ViewTaskState,
  depth = 0,
): Promise<{ ruleId: number; task: WriteTask } | undefined> {
  return applicableRuleId(fetcher, card, task, state, depth);
}

async function applicableRuleId(
  fetcher: FetchEngine,
  card: PatternCardInput,
  task: WriteTask,
  state: ViewTaskState,
  depth = 0,
): Promise<{ ruleId: number; task: WriteTask } | undefined> {
  if (!state.hasTaskRules[task]) return undefined;
  const candidates = ruleNamesForCard(card, TASK_SETTING_NAME[task]).map(
    (name) => DeckoName.parse(name).key,
  );
  const resolved =
    ruleClosureWalkStatement(fetcher.driver) === undefined
      ? await resolveRuleIdsByRuleKeys(fetcher.driver, candidates)
      : await resolveRuleIdsByComposedKeys(fetcher.driver, candidates);
  let firstResolved: number | undefined;
  for (const key of candidates) {
    const ruleId = resolved.get(key);
    if (ruleId !== undefined) {
      firstResolved = ruleId;
      break;
    }
  }
  if (firstResolved === undefined) return undefined;
  const name = DeckoName.parse(card.name);
  const value = state.ruleContent[task].get(firstResolved) ?? "";
  if (depth >= 16 || !LEFT_RULE_VALUE.test(value) || !name.isCompound) {
    return { ruleId: firstResolved, task };
  }
  const leftName = name.leftName;
  if (leftName === undefined || leftName.key === "") return { ruleId: firstResolved, task };
  const left = await fetcher.fetchByName(leftName.key, { skipVirtual: true });
  let leftTypeName: string | undefined;
  if (left?.typeId !== undefined && left.typeId !== null) {
    leftTypeName = (await fetcher.fetchById(left.typeId, { skipModules: true }))?.name?.s;
  }
  const inheritedTask: WriteTask =
    task === "create" && left?.id !== undefined ? "update" : task;
  return applicableRuleId(
    fetcher,
    {
      name: left?.name?.s ?? leftName.s,
      id: left?.id,
      typeId: left?.typeId,
      typeName: leftTypeName,
    },
    inheritedTask,
    state,
    depth + 1,
  );
}

async function createSidesAllowed(
  fetcher: FetchEngine,
  card: PatternCardInput,
  state: ViewTaskState,
  depth: number,
  selfId?: number,
): Promise<boolean | undefined> {
  const name = DeckoName.parse(card.name);
  if (!name.isCompound) return true;
  for (const partName of [name.leftName, name.rightName]) {
    if (partName === undefined) continue;
    const partKey = partName.key;
    if (partKey === "") continue;
    const existing = (await fetcher.fetchByName(partKey)) ?? undefined;
    if (existing !== undefined && existing.id !== undefined && existing.id !== selfId) {
      continue;
    }
    const virtualPart = await virtualSidePart(fetcher, partName.s);
    const verdict = await taskVerdictForCard(fetcher, virtualPart, "create", state, depth + 1);
    if (verdict === false) return false;
  }
  return true;
}

async function virtualSidePart(
  fetcher: FetchEngine,
  partName: string,
): Promise<PatternCardInput> {
  try {
    const typeId = await resolveTypeId(fetcher, { name: partName });
    const typeCard = await fetcher.fetchById(typeId, { skipModules: true });
    return {
      name: partName,
      isNew: true,
      typeId,
      typeName: typeCard?.name?.s,
    };
  } catch (error) {
    if (
      error instanceof CardActionError ||
      error instanceof CodenameNotFoundError ||
      error instanceof NameNotFoundError
    ) {
      return { name: partName, isNew: true };
    }
    throw error;
  }
}

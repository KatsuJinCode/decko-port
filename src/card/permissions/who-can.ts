import { DeckoName } from "../name.js";
import { ruleNamesForCard } from "../set-patterns/rule-names.js";
import type { PatternCardInput } from "../set-patterns/types.js";
import { rawItemStrings } from "../render/pointer-list.js";
import type { RenderEngineLike } from "../render/format.js";

export type WhoCanOutcome = { kind: "absent" } | { kind: "items"; count: number };

const LEFT_DELEGATION_MAX_DEPTH = 16;

const LEFT_DELEGATION_CONTENT = /^\[?\[?_left\]?\]?$/m;

function itemCount(dbContent: string): number {
  return rawItemStrings(dbContent).filter((item) => item.length > 0).length;
}

function ruleCardFor(
  engine: RenderEngineLike,
  input: PatternCardInput,
  task: string,
): { content: string } | undefined {
  for (const candidate of ruleNamesForCard(input, `*${task}`)) {
    const rule = engine.fetchRenderCard(candidate);
    if (rule !== undefined) return { content: rule.dbContent };
  }
  return undefined;
}

export function whoCanItemCount(
  engine: RenderEngineLike | undefined,
  ancestorName: DeckoName,
  task: string,
): WhoCanOutcome {
  if (engine === undefined) return { kind: "absent" };
  const ancestor = engine.fetchRenderCard(ancestorName.s);
  if (ancestor === undefined) return { kind: "absent" };
  const input: PatternCardInput = {
    name: ancestor.name.s,
    id: ancestor.id,
    typeId: ancestor.typeId,
    typeName: ancestor.typeName,
  };
  return walk(engine, input, ancestor.name, task, 0);
}

function walk(
  engine: RenderEngineLike,
  input: PatternCardInput,
  name: DeckoName,
  task: string,
  depth: number,
): WhoCanOutcome {
  const rule = ruleCardFor(engine, input, task);
  if (rule === undefined) return { kind: "absent" };
  if (depth < LEFT_DELEGATION_MAX_DEPTH && name.isCompound && LEFT_DELEGATION_CONTENT.test(rule.content)) {
    const leftName = name.leftName;
    if (leftName === undefined) return { kind: "absent" };
    const left = engine.fetchRenderCard(leftName.s);
    const leftInput: PatternCardInput =
      left === undefined
        ? { name: leftName.s, id: undefined, isNew: true }
        : { name: left.name.s, id: left.id, typeId: left.typeId, typeName: left.typeName };
    return walk(engine, leftInput, leftName, task, depth + 1);
  }
  return { kind: "items", count: itemCount(rule.content) };
}

export function selfSetInheritText(outcome: WhoCanOutcome): string {
  if (outcome.kind === "items" && outcome.count === 0) return "Inherit (  )";
  return "Inherit";
}

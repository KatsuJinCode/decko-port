

import { CardActionEngine } from "../../../src/card/actions/card-action-engine.js";
import { CardActionError, type Actor } from "../../../src/card/actions/index.js";
import { DeckoName, type Nameish } from "../../../src/card/name.js";
import type { GherkinTestStorage } from "./gherkin-storage.js";
import {
  JOE_ACTOR as DEFAULT_ACTOR,
  seedExtendedDeck,
  seedStandardDeck,
} from "./gherkin-storage.js";
import type { CardsRow } from "../../../src/server/schema.js";
import type { CardRecord } from "../../../src/card/fetch/card-record.js";

export interface GherkinWorld {
  storage: GherkinTestStorage;
  engine: CardActionEngine;

  lastHtml: string;

  lastCard: CardRecord | undefined;

  actor: Actor;

  now?: () => Date;
}

export async function freshWorld(opts: { actor?: Actor; now?: () => Date } = {}): Promise<GherkinWorld> {

  const { createGherkinTestStorage } = await import("./gherkin-storage.js");
  const storage = await createGherkinTestStorage();
  const actor = opts.actor ?? DEFAULT_ACTOR;
  const engine = new CardActionEngine(storage.fetcher, {
    actor,
    ipAddress: "127.0.0.1",
    now: opts.now,
  });
  return { storage, engine, lastHtml: "", lastCard: undefined, actor };
}

export async function closeWorld(world: GherkinWorld): Promise<void> {
  world.storage.close();
}

export async function givenSignedInAs(world: GherkinWorld, actor: Actor): Promise<void> {
  world.actor = actor;
  world.engine = new CardActionEngine(world.storage.fetcher, {
    actor,
    ipAddress: "127.0.0.1",
    now: world.now,
  });
}

export async function givenSignedOut(world: GherkinWorld): Promise<void> {
  await givenSignedInAs(world, { id: -1, name: "*anonymous" });
}

export async function givenStandardDeck(world: GherkinWorld): Promise<void> {
  await seedStandardDeck(world.storage);
}

export async function givenExtendedDeck(world: GherkinWorld): Promise<void> {
  await seedExtendedDeck(world.storage);
}

export async function whenCreateCard(
  world: GherkinWorld,
  typeName: string,
  name: Nameish,
  content: string,
): Promise<void> {
  const typeCode = typeNameToCode(typeName);
  await world.engine.createCard({
    name,
    content,
    typeCode,
  });
}

export async function whenCreateSimpleCard(
  world: GherkinWorld,
  name: Nameish,
  content: string,
): Promise<void> {
  await world.engine.createCard({ name, content });
}

export async function whenSetContent(
  world: GherkinWorld,
  name: string,
  content: string,
): Promise<void> {
  const card = await fetchByName(world, name);
  if (card === undefined || card.id === undefined) {
    throw new CardActionError("not-found", `card ${name} not found`);
  }
  await world.engine.updateCard({ cardId: card.id, content });
}

export async function whenTouch(world: GherkinWorld, name: string): Promise<void> {
  const card = await fetchByName(world, name);
  if (card === undefined || card.id === undefined) {
    throw new CardActionError("not-found", `card ${name} not found`);
  }
  await world.engine.updateCard({ cardId: card.id, content: card.dbContent ?? "" });
}

export async function whenDeleteCard(world: GherkinWorld, name: string): Promise<void> {
  const card = await fetchByName(world, name);
  if (card === undefined || card.id === undefined) {
    throw new CardActionError("not-found", `card ${name} not found`);
  }
  await world.engine.deleteCard({ cardId: card.id });
}

export function thenSee(world: GherkinWorld, text: string): void {
  if (!world.lastHtml.includes(text)) {
    throw new Error(`expected HTML to contain ${JSON.stringify(text)}\n--- HTML ---\n${world.lastHtml}`);
  }
}

export function thenNotSee(world: GherkinWorld, text: string): void {
  if (world.lastHtml.includes(text)) {
    throw new Error(`expected HTML NOT to contain ${JSON.stringify(text)}\n--- HTML ---\n${world.lastHtml}`);
  }
}

export async function thenCardContains(
  world: GherkinWorld,
  name: string,
  content: string,
): Promise<void> {
  const card = await fetchByName(world, name);
  if (card === undefined) {
    throw new Error(`expected card ${name} to exist`);
  }
  if (!(card.dbContent ?? "").includes(content)) {
    throw new Error(
      `expected card ${name} db_content to include ${JSON.stringify(content)}, got ${JSON.stringify(card.dbContent)}`,
    );
  }
}

export async function thenCardNotContains(
  world: GherkinWorld,
  name: string,
  content: string,
): Promise<void> {
  const card = await fetchByName(world, name);
  if (card === undefined) return;
  if ((card.dbContent ?? "").includes(content)) {
    throw new Error(`expected card ${name} db_content NOT to include ${JSON.stringify(content)}`);
  }
}

export async function thenCardExists(world: GherkinWorld, name: string): Promise<void> {
  const card = await fetchByName(world, name);
  if (card === undefined) {
    throw new Error(`expected card ${name} to exist (was not found in db)`);
  }
}

export async function thenCardNotExists(world: GherkinWorld, name: string): Promise<void> {
  const card = await fetchByName(world, name);
  if (card !== undefined) {
    throw new Error(`expected card ${name} NOT to exist (found id=${card.id})`);
  }
}

export async function thenCardTrashed(world: GherkinWorld, name: string): Promise<void> {
  const row = await world.storage.selectOne<CardsRow>(
    "SELECT * FROM cards WHERE name = ? AND trash = 1",
    [name],
  );
  if (row === undefined) {
    throw new Error(`expected card ${name} to be trashed`);
  }
}

export async function thenCardPointsTo(
  world: GherkinWorld,
  name: string,
  target: string,
): Promise<void> {
  const card = await fetchByName(world, name);
  if (card === undefined) {
    throw new Error(`expected pointer card ${name} to exist`);
  }
  if (!(card.dbContent ?? "").includes(target)) {
    throw new Error(
      `expected pointer card ${name} to include ${JSON.stringify(target)}, got ${JSON.stringify(card.dbContent)}`,
    );
  }
}

export async function whenGoToCard(world: GherkinWorld, name: string, view: string = "titled"): Promise<void> {
  world.lastCard = await fetchByName(world, name);
  world.lastHtml = await world.storage.renderer.render(name, view);
}

export async function whenGoToNew(world: GherkinWorld, typeName: string, view: string = "titled"): Promise<void> {
  const title = typeName;
  await whenGoToCard(world, title, view);
}

export function thenNameKey(raw: string, key: string): void {
  const actual = DeckoName.parse(raw).key;
  if (actual !== key) {
    throw new Error(`expected name ${JSON.stringify(raw)} key to be ${JSON.stringify(key)}, got ${JSON.stringify(actual)}`);
  }
}

export function thenNameIsCompound(raw: string): void {
  if (!DeckoName.parse(raw).isCompound) {
    throw new Error(`expected name ${JSON.stringify(raw)} to be compound`);
  }
}

export function thenNameIsSimple(raw: string): void {
  if (DeckoName.parse(raw).isCompound) {
    throw new Error(`expected name ${JSON.stringify(raw)} to be simple`);
  }
}

async function fetchByName(world: GherkinWorld, name: string): Promise<CardRecord | undefined> {
  return world.storage.fetcher.fetchByName(name);
}

function typeNameToCode(typeName: string): string {
  switch (typeName) {
    case "RichText":
      return "basic";
    case "Cardtype":
      return "cardtype";
    case "Phrase":
      return "phrase";
    case "Pointer":
      return "pointer";
    default:

      return typeName.toLowerCase();
  }
}

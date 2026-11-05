// Gherkin step helpers for the decko-ts feature port. Each function is a
// direct port of a Gherkin "Given/When/Then" step from the upstream
// features (decko-commons/decko decko/features/*.feature), implemented
// against the TS engine: FetchEngine, RenderEngine, CardActionEngine.
//
// Design notes:
//   - These helpers are NOT a Gherkin parser — the spec files translate
//     scenario steps to helper calls 1:1, preserving the upstream step
//     wording in the spec file's `// upstream: ...` header comments.
//     (Running the upstream Ruby features unmodified would require a
//     real Rails stack with Capybara + a browser; the engine has neither,
//     so the helper layer is the boundary.)
//   - "I create <Type> card <name> with content '<body>'" — the type
//     argument is the Ruby Set signature (mod-* card-mod-.../set/type/
//     <type>.rb#view :name) and the content argument is the body. Both
//     pass through CardActionEngine.createCard.
//   - "I go to card <name>" / "I edit <name>" — in the engine, these are
//     fetch + render + assert against the rendered HTML. No UI driver.
//   - Anonymous actor is enforced where Ruby does, allowed where Ruby
//     does; the helpers default to Joe User and accept an override.

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

// ---------------------------------------------------------------------------
// World: the live state each scenario mutates. Built fresh per test.
// ---------------------------------------------------------------------------

export interface GherkinWorld {
  storage: GherkinTestStorage;
  engine: CardActionEngine;
  /** The rendered HTML from the last "go to card" step — what the
   *  "Then I should see" assertions read. */
  lastHtml: string;
  /** The card record from the last fetch, when the step needs to assert
   *  against it. */
  lastCard: CardRecord | undefined;
  /** Optional: the seed actor for the action engine. Defaults to Joe
   *  User (the standard action-test fixture). */
  actor: Actor;
  /** Optional clock override (deterministic timestamps across a scenario). */
  now?: () => Date;
}

export async function freshWorld(opts: { actor?: Actor; now?: () => Date } = {}): Promise<GherkinWorld> {
  // Lazy import so the helpers don't create the storage when the file is
  // merely type-loaded.
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

// ---------------------------------------------------------------------------
// Given — fixture seeding
// ---------------------------------------------------------------------------

/** "Given I am signed in as <actor>". The action engine's actor IS the
 *  signed-in identity; this step (re)builds the engine with that actor.
 *  Ruby: Card::Auth.current_id = ... (auth/current.rb:7-9). */
export async function givenSignedInAs(world: GherkinWorld, actor: Actor): Promise<void> {
  world.actor = actor;
  world.engine = new CardActionEngine(world.storage.fetcher, {
    actor,
    ipAddress: "127.0.0.1",
    now: world.now,
  });
}

/** "Given I am signed out" — builds an engine with `null` actor. Ruby
 *  equivalent: Card::Auth.current_id = Card::AnonymousID. */
export async function givenSignedOut(world: GherkinWorld): Promise<void> {
  await givenSignedInAs(world, { id: -1, name: "*anonymous" });
}

/** Seed the synthetic standard deck (RichText, Cardtype, *all, *default,
 *  *all+*default). Mirrors actions-test-storage.ts seedStandardDeck; this
 *  step is the prerequisite almost every Gherkin scenario needs. */
export async function givenStandardDeck(world: GherkinWorld): Promise<void> {
  await seedStandardDeck(world.storage);
}

/** "Given the deck has Phrase and Pointer type cards" — for
 *  pointer_inputs.feature scenarios that create Phrase cards and need
 *  the Pointer codename to resolve. */
export async function givenExtendedDeck(world: GherkinWorld): Promise<void> {
  await seedExtendedDeck(world.storage);
}

// ---------------------------------------------------------------------------
// When — actions
// ---------------------------------------------------------------------------

/** "When I create <type> card <name> with content '<content>'"
 *  Ruby: Card.create(name: ..., type: "<type>", content: "<content>") (Set
 *  signature). The type is the codename-ish form Decko uses — "Phrase",
 *  "RichText", "Pointer", "Cardtype" — and is mapped to the codename the
 *  seed deck stores (basic, cardtype, phrase, pointer). */
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

/** "When I create card <name> with content '<content>'" — no explicit
 *  type, falls to the *all+*default rule (default_type_id, type.rb:3-5). */
export async function whenCreateSimpleCard(
  world: GherkinWorld,
  name: Nameish,
  content: string,
): Promise<void> {
  await world.engine.createCard({ name, content });
}

/** "When I edit <name> setting content to '<content>'"
 *  Ruby: Card[name].update(content: ...) (Save/Update path). */
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

/** "When I edit <name>" without changing content — the upstream
 *  conflict.feature shape. Records a no-op save. */
export async function whenTouch(world: GherkinWorld, name: string): Promise<void> {
  const card = await fetchByName(world, name);
  if (card === undefined || card.id === undefined) {
    throw new CardActionError("not-found", `card ${name} not found`);
  }
  await world.engine.updateCard({ cardId: card.id, content: card.dbContent ?? "" });
}

/** "When I delete <name>" — trash flip (trash.rb:11-21). */
export async function whenDeleteCard(world: GherkinWorld, name: string): Promise<void> {
  const card = await fetchByName(world, name);
  if (card === undefined || card.id === undefined) {
    throw new CardActionError("not-found", `card ${name} not found`);
  }
  await world.engine.deleteCard({ cardId: card.id });
}

// ---------------------------------------------------------------------------
// Then — assertions
// ---------------------------------------------------------------------------

/** "Then I should see '<text>'" — the rendered HTML for the last fetched
 *  card (Ruby: response.body.include?(text)). */
export function thenSee(world: GherkinWorld, text: string): void {
  if (!world.lastHtml.includes(text)) {
    throw new Error(`expected HTML to contain ${JSON.stringify(text)}\n--- HTML ---\n${world.lastHtml}`);
  }
}

/** "Then I should not see '<text>'". */
export function thenNotSee(world: GherkinWorld, text: string): void {
  if (world.lastHtml.includes(text)) {
    throw new Error(`expected HTML NOT to contain ${JSON.stringify(text)}\n--- HTML ---\n${world.lastHtml}`);
  }
}

/** "Then the card <name> should contain '<content>'" — fetch and
 *  compare db_content. */
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

/** "Then the card <name> should not contain '<content>'". */
export async function thenCardNotContains(
  world: GherkinWorld,
  name: string,
  content: string,
): Promise<void> {
  const card = await fetchByName(world, name);
  if (card === undefined) return; // absence is its own proof here
  if ((card.dbContent ?? "").includes(content)) {
    throw new Error(`expected card ${name} db_content NOT to include ${JSON.stringify(content)}`);
  }
}

/** "Then I should see the card <name>" — fetch proves it exists. */
export async function thenCardExists(world: GherkinWorld, name: string): Promise<void> {
  const card = await fetchByName(world, name);
  if (card === undefined) {
    throw new Error(`expected card ${name} to exist (was not found in db)`);
  }
}

/** "Then I should not see the card <name>" — fetch proves absence
 *  (non-trashed cards only). */
export async function thenCardNotExists(world: GherkinWorld, name: string): Promise<void> {
  const card = await fetchByName(world, name);
  if (card !== undefined) {
    throw new Error(`expected card ${name} NOT to exist (found id=${card.id})`);
  }
}

/** "Then the card <name> should be trashed" — fetch with lookInTrash
 *  yields a row whose trash = 1. */
export async function thenCardTrashed(world: GherkinWorld, name: string): Promise<void> {
  const row = await world.storage.selectOne<CardsRow>(
    "SELECT * FROM cards WHERE name = ? AND trash = 1",
    [name],
  );
  if (row === undefined) {
    throw new Error(`expected card ${name} to be trashed`);
  }
}

/** "Then the card <name> should point to '<target>'" — pointer-card
 *  shape: the card's db_content encodes a reference. Mirrors the
 *  upstream pointer_inputs.feature assertions at the storage level.
 *  The TS port doesn't model the reference machinery yet, so we
 *  assert on the raw db_content. */
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

// ---------------------------------------------------------------------------
// Render — "When I go to card X" / "When I edit X"
// ---------------------------------------------------------------------------

/** "When I go to card <name>" — fetch + render the title view. Ruby:
 *  visit card_path (Capybara) — equivalent here to render the card and
 *  stash the HTML for the next "Then I should see" step. The default
 *  view is "titled" (card-mod-format set/all/html/views.rb). */
export async function whenGoToCard(world: GherkinWorld, name: string, view: string = "titled"): Promise<void> {
  world.lastCard = await fetchByName(world, name);
  world.lastHtml = await world.storage.renderer.render(name, view);
}

/** "When I go to new <Type>" — render an absent card, which the render
 *  engine handles with the unknown-view branch (render/views.ts
 *  unknownView — captures Ruby's "create denied" empty result). */
export async function whenGoToNew(world: GherkinWorld, typeName: string, view: string = "titled"): Promise<void> {
  const title = typeName; // the Gherkin form "new Movie" maps to name "Movie"
  await whenGoToCard(world, title, view);
}

// ---------------------------------------------------------------------------
// Names — the DeckoName algebra ports of name-related Gherkin steps.
// ---------------------------------------------------------------------------

/** "Then the name <raw> should parse to key '<key>'". Pure name algebra,
 *  no engine calls — ports the Gherkin "name" assertions to TS. */
export function thenNameKey(raw: string, key: string): void {
  const actual = DeckoName.parse(raw).key;
  if (actual !== key) {
    throw new Error(`expected name ${JSON.stringify(raw)} key to be ${JSON.stringify(key)}, got ${JSON.stringify(actual)}`);
  }
}

/** "Then the name <raw> should be compound". */
export function thenNameIsCompound(raw: string): void {
  if (!DeckoName.parse(raw).isCompound) {
    throw new Error(`expected name ${JSON.stringify(raw)} to be compound`);
  }
}

/** "Then the name <raw> should be simple". */
export function thenNameIsSimple(raw: string): void {
  if (DeckoName.parse(raw).isCompound) {
    throw new Error(`expected name ${JSON.stringify(raw)} to be simple`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fetch the named card (trash-excluded), via the live FetchEngine — same
 *  path Ruby's Card[name] takes (fetch/card_class.rb:42-44 skipVirtual). */
async function fetchByName(world: GherkinWorld, name: string): Promise<CardRecord | undefined> {
  return world.storage.fetcher.fetchByName(name);
}

/** "I create <Type> card ..." type argument to typeCode mapping. The
 *  upstream Gherkin uses Set::Card::Phrase, Set::Card::RichText, etc.
 *  The TS port's standard deck seeds RichText with codename "basic",
 *  Cardtype with codename "cardtype" — the other codenames ("phrase",
 *  "pointer", etc.) follow the same pattern. */
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
      // Unknown — fall back to the codename itself (Ruby accepts both
      // names and codenames here — Set::Card::Phrase.name = "Phrase",
      // Set::Card::Phrase.cardcode = "phrase"; the engine resolves both).
      return typeName.toLowerCase();
  }
}

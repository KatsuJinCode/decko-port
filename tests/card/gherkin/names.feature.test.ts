

import { describe, it } from "vitest";
import { DeckoName } from "../../../src/card/name.js";
import {
  thenNameIsCompound,
  thenNameIsSimple,
  thenNameKey,
} from "./gherkin-steps.js";

describe("Gherkin port: card name algebra (every feature file)", () => {

  it("conflict.feature — 'Duck Soup' parses with a simple key", () => {
    thenNameKey("Duck Soup", "duck_soup");
    thenNameIsSimple("Duck Soup");
  });

  it("conflict.feature — 'First' (existing seed card) parses with a simple key", () => {
    thenNameKey("First", "first");
    thenNameIsSimple("First");
  });

  it("structure.feature — 'Movie+*type+*structure' is a triple-jointed compound", () => {
    thenNameIsCompound("Movie+*type+*structure");
  });

  it("structure.feature — 'color+*right+*default' is compound", () => {
    thenNameIsCompound("color+*right+*default");
  });

  it("structure.feature — 'Movie+*type+*structure' left-of-left is 'Movie'", () => {

    const n = DeckoName.parse("Movie+*type+*structure");
    if (n.leftName === undefined || !n.leftName.isCompound) {
      throw new Error(`expected compound leftName, got ${n.leftName?.s}`);
    }
    const inner = n.leftName.leftName;
    if (inner === undefined || inner.s !== "Movie") {
      throw new Error(`expected leftName.leftName 'Movie', got ${inner?.s}`);
    }
  });

  it("pointer_inputs.feature — 'Joe User+friends' is a 2-part compound", () => {
    thenNameIsCompound("Joe User+friends");
  });

  it("conflict.feature — '*type' (star-named set card) is simple", () => {
    thenNameIsSimple("*type");
  });

  it("pointer_inputs.feature — 'User+*type+*structure' is compound", () => {
    thenNameIsCompound("User+*type+*structure");
  });

  it("setup.feature — 'The Newber' (an account name) parses simply", () => {
    thenNameKey("The Newber", "the_newber");
    thenNameIsSimple("The Newber");
  });

  it("follow.feature — 'Home+*self' is compound (left + right joint)", () => {
    thenNameIsCompound("Home+*self");
  });

  it("follow.feature — 'User+*type' is compound", () => {
    thenNameIsCompound("User+*type");
  });

  it("attach.feature — 'a test file' parses simply", () => {
    thenNameKey("a test file", "a_test_file");
    thenNameIsSimple("a test file");
  });

  it("attach.feature — 'Vignesh has a complicated relationship' parses simply", () => {

    thenNameIsSimple("Vignesh has a complicated relationship");
  });

  it("pointer_inputs.feature — 'friends+*right+*input type' is compound", () => {
    thenNameIsCompound("friends+*right+*input type");
  });

  it("history.feature — 'First' (seed card name) is simple", () => {
    thenNameIsSimple("First");
  });

  it("update_includers.feature — 'Ulysses+Author' is compound", () => {
    thenNameIsCompound("Ulysses+Author");

  });

  it("update_includers.feature — 'Banana+color+*self' is triple-jointed", () => {
    thenNameIsCompound("Banana+color+*self");
  });
});

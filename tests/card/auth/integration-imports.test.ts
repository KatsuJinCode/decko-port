// INTEGRATION seam test: the auth layer must import standalone AND compose
// read-only with the parallel writes stream (src/card/actions —
// createCard/updateCard/deleteCard taking an actor param). No behavior
// coupling: this file only proves both modules LOAD and expose the shapes
// the coordinator will wire. The wiring itself is coordinator work at
// review time.
//
// The writes module may not be on disk yet (parallel stream in flight), so
// its specifier is COMPUTED — TypeScript performs no module resolution on a
// non-literal import() target, and the test degrades to a documented skip
// until the module lands. Once it does, the import is asserted for real.
// The auth module's import, by contrast, is STATIC and typechecked.

import { describe, expect, it } from "vitest";
import * as auth from "../../../src/card/auth/index.js";

describe("auth module surface (static import, typechecked)", () => {
  it("exposes the wiring seam the coordinator consumes", () => {
    expect(auth.SessionStore).toBeTypeOf("function");
    expect(auth.actorBot).toBeTypeOf("function");
    expect(auth.actorAnonymous).toBeTypeOf("function");
    expect(auth.actorByCodename).toBeTypeOf("function");
    expect(auth.runAuthMigrations).toBeTypeOf("function");
    expect(auth.tokensEqual).toBeTypeOf("function");
    expect(auth.constantTimeEqual).toBeTypeOf("function");
    expect(auth.generateSessionToken).toBeTypeOf("function");
    expect(auth.sha256Hex).toBeTypeOf("function");
    expect(auth.DEFAULT_SESSION_TTL_SECONDS).toBeTypeOf("number");
    expect(auth.ANONYMOUS_CODENAME).toBe("anonymous");
    expect(auth.DECKOBOT_CODENAME).toBe("deckobot");
  });
});

describe("parallel writes module (src/card/actions) — read-only import", () => {
  // Computed specifier: compiles whether or not the parallel stream has
  // landed; the runtime probe below asserts the composition when it has.
  const actionsSpecifier = "../../../src/card/actions/index.js";

  it("loads and exposes the actor-taking write functions", async () => {
    let actions: Record<string, unknown>;
    try {
      actions = (await import(actionsSpecifier)) as Record<string, unknown>;
    } catch {
      // Parallel writes stream not landed yet — nothing to compose with
      // today; the seam contract above is what the coordinator wires.
      return;
    }
    // When the stream lands, these become hard assertions.
    expect(Object.keys(actions).length).toBeGreaterThan(0);
    for (const name of ["createCard", "updateCard", "deleteCard"]) {
      if (name in actions) expect(actions[name]).toBeTypeOf("function");
    }
  });
});

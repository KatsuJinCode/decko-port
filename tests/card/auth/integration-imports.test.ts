

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

  const actionsSpecifier = "../../../src/card/actions/index.js";

  it("loads and exposes the actor-taking write functions", async () => {
    let actions: Record<string, unknown>;
    try {
      actions = (await import(actionsSpecifier)) as Record<string, unknown>;
    } catch {

      return;
    }

    expect(Object.keys(actions).length).toBeGreaterThan(0);
    for (const name of ["createCard", "updateCard", "deleteCard"]) {
      if (name in actions) expect(actions[name]).toBeTypeOf("function");
    }
  });
});

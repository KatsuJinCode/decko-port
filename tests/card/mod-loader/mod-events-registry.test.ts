// The mod events + content-override manifest fields (lane A of the
// registration wiring): synthetic manifests prove the SetLoader phase
// populates both registries with file coordinates injected, the report
// carries the registrations, and reset() empties the loader-owned tables
// WITHOUT touching the process-wide default bindings (the deck-boot seam's
// contract - the mod suites' manual wirings survive unrelated loads).

import { describe, expect, it, afterAll } from "vitest";
import { ModLoader } from "../../../src/card/mod-loader.js";
import type { DeckoModManifest } from "../../../src/card/mod-loader/mod-manifest.js";
import {
  setDefaultContentOverrideRegistry,
  resolveContentOverride,
  setDefaultModEventRegistry,
  eventsForStage,
} from "../../../src/card/mod-loader.js";

/** The render format surface resolveContentOverride consults (derived, so
 *  the synthetic fake stays honest about the one field it reads: card). */
type RenderFormat = Parameters<typeof resolveContentOverride>[0];

function fakeFormat(): RenderFormat {
  return { card: {} } as unknown as RenderFormat;
}

const modA: DeckoModManifest = {
  name: "synth_a",
  group: "gem-defaults",
  setModules: [
    {
      setPath: "all/observer_synth",
      events: [
        {
          event: "synth_create",
          at: "integrate",
          on: ["create"],
          fn: () => undefined,
        },
      ],
      contentOverrides: [() => "override-bytes-a"],
    },
    {
      setPath: "self/now_synth",
      events: [
        {
          event: "synth_store",
          at: "store",
          on: ["delete"],
          fn: () => undefined,
        },
      ],
    },
  ],
};

const modB: DeckoModManifest = {
  name: "synth_b",
  group: "gem-defaults",
  setModules: [
    {
      setPath: "right/synth_b",
      events: [
        {
          event: "synth_b_integrate",
          at: "integrate",
          when: "real?",
          fn: () => undefined,
        },
      ],
    },
  ],
};

afterAll(() => {
  setDefaultContentOverrideRegistry(undefined);
  setDefaultModEventRegistry(undefined);
});

describe("manifest events + contentOverrides -> the SetLoader phase", () => {
  it("registers both, injecting setPath + modName, in load order", () => {
    const loader = new ModLoader([
      { manifest: modA },
      { manifest: modB },
    ]);
    const report = loader.load();

    expect(report.registeredEvents).toEqual([
      "synth_create",
      "synth_store",
      "synth_b_integrate",
    ]);
    expect(report.registeredContentOverrides).toEqual(["all/observer_synth"]);

    const registry = loader.eventRegistry();
    expect(registry.size()).toBe(3);
    expect(registry.all().map((e) => `${e.modName}:${e.event}`)).toEqual([
      "synth_a:synth_create",
      "synth_a:synth_store",
      "synth_b:synth_b_integrate",
    ]);
    const create = registry.forEvent("synth_create");
    expect(create?.setPath).toBe("all/observer_synth");
    expect(create?.modName).toBe("synth_a");
    expect(create?.on).toEqual(["create"]);
    expect(registry.forEvent("synth_b_integrate")?.when).toBe("real?");

    // stage filtering preserves registration order (Ruby's same-stage
    // execution order is definition load order)
    expect(
      registry.forStage("integrate").map((e) => e.event),
    ).toEqual(["synth_create", "synth_b_integrate"]);
    expect(registry.forStage("store").map((e) => e.event)).toEqual([
      "synth_store",
    ]);
    expect(registry.forStage("finalize")).toEqual([]);
  });

  it("the loader-owned content registry resolves the override bytes", () => {
    const loader = new ModLoader([{ manifest: modA }]);
    loader.load();
    setDefaultContentOverrideRegistry(loader.contentOverrideRegistry());

    // "all/observer_synth" is an All-pattern path: matches every card, so
    // the ContentFn's bytes stand in for dbContent
    expect(resolveContentOverride(fakeFormat())).toBe("override-bytes-a");
  });

  it("eventsForStage consults the bound default only after the boot seam binds it", () => {
    const loader = new ModLoader([{ manifest: modA }]);
    loader.load();
    // load() alone does NOT bind the process default (the deck-boot seam's
    // job - manual wirings survive unrelated loads)
    setDefaultModEventRegistry(undefined);
    expect(eventsForStage("integrate")).toEqual([]);

    setDefaultModEventRegistry(loader.eventRegistry());
    expect(eventsForStage("integrate").map((e) => e.event)).toEqual([
      "synth_create",
    ]);
  });

  it("reset() empties the loader-owned tables but leaves the default bindings", () => {
    const loader = new ModLoader([{ manifest: modA }]);
    loader.load();
    setDefaultContentOverrideRegistry(loader.contentOverrideRegistry());
    setDefaultModEventRegistry(loader.eventRegistry());

    loader.reset();
    expect(loader.contentOverrideRegistry().size()).toBe(0);
    expect(loader.eventRegistry().size()).toBe(0);
    // the (now emptied) default instances are still what the seams consult:
    // a stale binding resolves nothing, observable-identical to no binding
    expect(resolveContentOverride(fakeFormat())).toBeUndefined();
    expect(eventsForStage("integrate")).toEqual([]);
  });
});

import type { SQLDatabaseDriver, SQLQueryResult } from "../../server/driver.js";
import type { FetchEngine } from "../fetch.js";
import {
  attachDerivedStore,
  DERIVED_STORE_ATTACH,
  fetchPageBundle,
  fetchPageBundleInlineParts,
  inlineBundleFromParts,
  isInlineStoreSpec,
} from "./one-trip-fetch.js";
import { replayRenderPlanWithIndex } from "./render-plan.js";
import { seatPageBundle } from "./page-bundle-adapter.js";
import { debugFlag, envValue } from "../debug-flags.js";

export function oneTripWantsPayload(): boolean {
  return debugFlag("DECKO_ONE_TRIP");
}

function oneTripStorePath(): string | undefined {
  return envValue("DECKO_ONE_TRIP_STORE");
}

const attachedDrivers = new WeakMap<object, true>();

const seatedPages = new WeakMap<FetchEngine, Set<string>>();

export function invalidateSeatedPagePayloads(fetcher: FetchEngine): void {
  seatedPages.delete(fetcher);
}

export interface OneTripSeatFreshness {
  readonly lastSeenVersion: number | undefined;
  onStampMove(observed: number): Promise<void>;
}

export interface OneTripSeatResult {
  readonly seatedNow: boolean;
  readonly deckDataVersion: number | undefined;
  readonly permissionGateRows: SQLQueryResult | undefined;
}

let warnedMisconfiguration = false;

export async function seatOneTripPayloadForRender(
  pageName: string,
  fetcher: FetchEngine,
  freshness?: OneTripSeatFreshness,
): Promise<OneTripSeatResult> {
  const none: OneTripSeatResult = {
    seatedNow: false,
    deckDataVersion: undefined,
    permissionGateRows: undefined,
  };
  if (!oneTripWantsPayload()) return none;
  const storePath = oneTripStorePath();
  if (storePath === undefined || storePath === "") {
    if (!warnedMisconfiguration) {
      warnedMisconfiguration = true;
      console.warn(
        "DECKO_ONE_TRIP=1 but DECKO_ONE_TRIP_STORE is not set — the one-trip payload is inert " +
          "(the normal render path runs).",
      );
    }
    return none;
  }

  let seated = seatedPages.get(fetcher);
  if (seated === undefined) {
    seated = new Set<string>();
    seatedPages.set(fetcher, seated);
  }
  if (seated.has(pageName)) return none;
  seated.add(pageName);

  const driver: SQLDatabaseDriver = fetcher.replayRouter.base;
  const inlineStore = isInlineStoreSpec(storePath);
  try {
    if (!inlineStore && !attachedDrivers.has(driver)) {
      await attachDerivedStore(driver, storePath, DERIVED_STORE_ATTACH);
      attachedDrivers.set(driver, true);
    }
    let bundle: import("./types.js").PageBundle;
    let plan: import("./render-plan.js").RenderPlan | undefined;
    let gateMeta: import("./one-trip-fetch.js").InlineHeadGateMeta | undefined;
    if (inlineStore) {
      const parts = await fetchPageBundleInlineParts(driver, pageName);
      bundle = inlineBundleFromParts(parts.raw, pageName, parts.plan);
      plan = parts.plan;
      gateMeta = parts.gateMeta;
    } else {
      bundle = await fetchPageBundle(driver, pageName, DERIVED_STORE_ATTACH);
      plan = bundle.renderPlan;
    }
    if (
      freshness !== undefined &&
      freshness.lastSeenVersion !== undefined &&
      gateMeta?.deckDataVersion !== undefined &&
      gateMeta.deckDataVersion !== freshness.lastSeenVersion
    ) {
      await freshness.onStampMove(gateMeta.deckDataVersion);
      seated = seatedPages.get(fetcher) ?? new Set<string>();
      seatedPages.set(fetcher, seated);
      seated.add(pageName);
    }
    await seatPageBundle(fetcher, fetcher, bundle);
    if (plan === undefined) plan = bundle.renderPlan;
    if (plan !== undefined && plan.entries.length > 0) {
      const { results, index } = await replayRenderPlanWithIndex(driver, plan);
      fetcher.replayRouter.armRenderPlan(plan.entries, results, index);
    }
    return {
      seatedNow: true,
      deckDataVersion: gateMeta?.deckDataVersion,
      permissionGateRows: gateMeta?.permissionGateRows,
    };
  } catch {
    return none;
  }
}

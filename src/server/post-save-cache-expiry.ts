import type { FetchEngine } from "../card/fetch.js";
import type { WriteRouteResponse } from "./write-routes.js";

export interface RenderCacheEngines {
  fetcher: FetchEngine;
  renderEngine: {
    expireRenderCard(name: string): void;
    expireRuleCache?(): void;
  };
  signedInEngines: Iterable<{
    expireRenderCard(name: string): void;
    expireRuleCache?(): void;
  }>;
}

export function expireRenderCachesAfterSave(
  engines: RenderCacheEngines,
  writeResponse: WriteRouteResponse,
): void {
  if (writeResponse.status < 200 || writeResponse.status >= 400) return;
  const name = writeResponse.expiryName;
  if (name === undefined || name === "") return;
  const signedInEngines = Array.from(engines.signedInEngines);
  engines.fetcher.expireName(name);
  engines.renderEngine.expireRuleCache?.();
  for (const engine of signedInEngines) {
    engine.expireRuleCache?.();
  }
  engines.renderEngine.expireRenderCard(name);
  for (const engine of signedInEngines) {
    engine.expireRenderCard(name);
  }
  for (const sub of writeResponse.expiryNames ?? []) {
    if (sub === undefined || sub === "") continue;
    engines.fetcher.expireName(sub);
    engines.renderEngine.expireRenderCard(sub);
    for (const engine of signedInEngines) {
      engine.expireRenderCard(sub);
    }
  }
}

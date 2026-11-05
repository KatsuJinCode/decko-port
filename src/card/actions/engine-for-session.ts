import type { FetchEngine } from "../fetch.js";
import type { SQLDatabaseDriver } from "../../server/driver.js";
import { SessionStore, type Actor } from "../auth/index.js";
import { withVisitorEnabledRoles } from "../session/enabled-roles.js";
import {
  CardActionEngine,
  type CardActionEngineOptions,
} from "./card-action-engine.js";

export async function actorFromToken(
  driver: SQLDatabaseDriver,
  token: string | null | undefined,
): Promise<Actor | null> {
  if (token === null || token === undefined || token === "") return null;
  const sessions = new SessionStore({ driver });
  return sessions.resolveActorFromToken(token);
}

export async function createCardActionEngineForSession(
  fetchEngine: FetchEngine,
  driver: SQLDatabaseDriver,
  token: string | null | undefined,
  opts: Omit<CardActionEngineOptions, "actor"> = {},
  cookieHeader?: string,
): Promise<CardActionEngine> {
  const actor = await actorFromToken(driver, token);
  const viewer = await withVisitorEnabledRoles(fetchEngine,
    actor === null ? { signedIn: false } : { signedIn: true, actorId: actor.id }, cookieHeader);
  return new CardActionEngine(fetchEngine, { ...opts, actor,
    ...(viewer.enabledRoleIds === undefined ? {} : { enabledRoleIds: viewer.enabledRoleIds }) });
}

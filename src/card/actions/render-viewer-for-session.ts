import type { SQLDatabaseDriver } from "../../server/driver.js";
import { actorFromToken } from "./engine-for-session.js";
import { ANONYMOUS_VIEWER, type ReadViewer } from "../permissions/index.js";

export async function viewerFromToken(
  driver: SQLDatabaseDriver,
  token: string | null | undefined,
): Promise<ReadViewer> {
  const actor = await actorFromToken(driver, token);
  return actor === null ? ANONYMOUS_VIEWER : { signedIn: true, actorId: actor.id };
}

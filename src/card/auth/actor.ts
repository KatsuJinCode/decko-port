import type { SQLDatabaseDriver } from "../../server/driver.js";

export interface Actor {
  id: number;
  name: string;
}

export const ANONYMOUS_CODENAME = "anonymous";

export const DECKOBOT_CODENAME = "decko_bot";

export class ActorNotFoundError extends Error {
  readonly codename: string;
  constructor(codename: string) {
    super(
      `auth: no card with codename "${codename}" — ` +
        `every deck starts with Anonymous and DeckoBot cards (card/auth/setup.rb:44)`,
    );
    this.codename = codename;
    this.name = "ActorNotFoundError";
  }
}

export async function actorByCodename(
  driver: SQLDatabaseDriver,
  codename: string,
): Promise<Actor> {
  const result = await driver.query<{ id: number; name: string | null }>(
    "SELECT id, name FROM cards WHERE codename = ? AND trash = 0 ORDER BY id LIMIT 1",
    [codename],
  );
  const row = result.rows[0];
  if (row === undefined || row.name === null) {
    throw new ActorNotFoundError(codename);
  }
  return { id: row.id, name: row.name };
}

export function actorAnonymous(driver: SQLDatabaseDriver): Promise<Actor> {
  return actorByCodename(driver, ANONYMOUS_CODENAME);
}

export function actorBot(driver: SQLDatabaseDriver): Promise<Actor> {
  return actorByCodename(driver, DECKOBOT_CODENAME);
}

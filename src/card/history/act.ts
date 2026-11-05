import type { SQLDateTime } from "../../server/schema.js";

export interface ActAttributes {
  card_id: number | null;
  actor_id: number | null;
  acted_at: SQLDateTime | null;
  ip_address: string | null;
}

export function assignActor(
  actorId: number | null | undefined,
  currentActorId: number,
): number {
  return actorId ?? currentActorId;
}

export function sqlDateTime(date: Date): SQLDateTime {
  const iso = date.toISOString();
  const seconds = `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
  const ms = date.getUTCMilliseconds();
  return ms === 0 ? seconds : `${seconds}.${String(ms).padStart(3, "0")}000`;
}

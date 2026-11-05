import type { SavePathEvent } from "./types.js";
import type { FollowerRef, FollowerResolver } from "./follow-notify.js";

export class FollowerStash {
  private readonly checked = new Set<number>();
  private readonly stashed = new Map<number, FollowerRef>();

  async checkCard(cardId: number | null | undefined, event: SavePathEvent): Promise<void> {
    if (cardId === null || cardId === undefined || this.checked.has(cardId)) return;
    this.checked.add(cardId);
    const refs = await this.resolver(cardId, event);
    for (const ref of refs) {
      if (!this.stashed.has(ref.followerId)) this.stashed.set(ref.followerId, ref);
    }
  }

  followers(): FollowerRef[] {
    return [...this.stashed.values()];
  }

  constructor(private readonly resolver: FollowerResolver) {}
}

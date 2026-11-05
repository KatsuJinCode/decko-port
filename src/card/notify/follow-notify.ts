import {
  interpolateTemplate,
  renderMail,
  type EmailTemplate,
  type StockMailExtras,
  type FollowNotice,
  type FollowNoticeAct,
} from "./mail.js";
import { FollowerStash } from "./follower-stash.js";
import type {
  MailMessage,
  NotifyActor,
  NotifyContext,
  SavePathAct,
  SavePathEvent,
  SavePathIntegrationHook,
} from "./types.js";

export interface FollowerRef {
  readonly followerId: number;
  readonly followerName: string;
  readonly followerEmail: string | null;
  readonly followedSetName: string;
  readonly followOption: string;
}

export type FollowerResolver = (
  cardId: number | null,
  event: SavePathEvent,
) => readonly FollowerRef[] | Promise<readonly FollowerRef[]>;

export type EmailTemplateResolver = () => EmailTemplate | Promise<EmailTemplate>;

export interface FollowNotifyDeps {
  readonly actContext?: (act: SavePathAct) => Promise<{
    cardId: number | null;
    cardName: string | null;
    changesVisible: boolean;
  }>;
  readonly followers: FollowerResolver;
  readonly template: EmailTemplateResolver;
  readonly authAs: (followerId: number, followerName: string) => NotifyActor;
  readonly defaultFrom: string;
  readonly views?: (input: {
    act: SavePathAct;
    actCardId: number;
    ref: FollowerRef;
  }) => Promise<{ text: Record<string, string>; html: Record<string, string> }>;
  readonly deckoBotEmail?: string;
}

const STAGE: SavePathIntegrationHook["stage"] = "integrate_with_delay";

function isNotable(event: SavePathEvent): boolean {
  if (event.silent === true) return false;
  if (event.actor.name === "*Decko Bot") return false;
  return true;
}

async function notifyFollower(
  ref: FollowerRef,
  template: EmailTemplate,
  ctx: NotifyContext,
  act: FollowNoticeAct,
  extras?: StockMailExtras,
): Promise<void> {
  if (ref.followerEmail === null) return;
  const notice: FollowNotice = {
    follower: ref.followerName,
    followedSet: ref.followedSetName,
    followOption: ref.followOption,
  };
  const msg = renderMail({ ...template, to: ref.followerEmail }, notice, act, extras);
  try {
    await ctx.transport.sendMail(msg);
    ctx.logger?.(`[notify] sent follow mail to ${ref.followerEmail} (${ref.followerName})`);
  } catch (err) {
    ctx.logger?.(`[notify] FAIL to=${ref.followerEmail} subject=${JSON.stringify(msg.subject)} err=${(err as Error).message}`);
  }
}

async function notifyFollowersOfAct(
  act: SavePathAct,
  deps: FollowNotifyDeps,
  ctx: NotifyContext,
  stash: FollowerStash,
  mainAction: SavePathEvent,
): Promise<void> {
  const actContext = await deps.actContext?.(act);
  if (actContext !== undefined && !actContext.changesVisible) return;
  const template = await deps.template();
  if (template.subject.length === 0 && template.textBody.length === 0 && (template.htmlBody?.length ?? 0) === 0) {
    return;
  }
  const followAct: FollowNoticeAct = {
    userName: act.actor.name,
    verb: `${mainAction.verb}d`,
    cardName: actContext?.cardName ?? act.actCardName ?? mainAction.card?.name ?? "",
  };
  for (const ref of stash.followers()) {
    if (ref.followerId === act.actor.id) continue;
    deps.authAs(ref.followerId, ref.followerName);
    const actCardId = actContext?.cardId ?? mainAction.card?.id ?? null;
    let extras: StockMailExtras | undefined;
    if (deps.views !== undefined && actCardId !== null) {
      const views = await deps.views({ act, actCardId, ref });
      extras = {
        text: views.text,
        html: views.html,
        wrapHtmlDocument: true,
        ...(deps.deckoBotEmail !== undefined ? { botAccountEmail: deps.deckoBotEmail } : {}),
      };
    }
    await notifyFollower(ref, template, ctx, followAct, extras);
  }
}

export function buildFollowNotifyHook(deps: FollowNotifyDeps): SavePathIntegrationHook {
  const fireActOnce = async (act: SavePathAct, ctx: NotifyContext): Promise<void> => {
    if (act.events.length === 0) return;
    const deleteAct = act.events[0].isDeletePath === true;
    const stash = new FollowerStash(deps.followers);
    for (const event of act.events) {
      if (event.isDeletePath === true && !deleteAct) continue;
      await stash.checkCard(event.card?.id ?? null, event);
    }
    if (stash.followers().length === 0) return;
    const mainAction =
      act.events.find((e) => act.actCardName != null && e.card?.name === act.actCardName) ??
      act.events[0];
    await notifyFollowersOfAct(act, deps, ctx, stash, mainAction);
  };

  return {
    stage: STAGE,
    name: "follow_notification_after_save",
    event: "notify_followers_after_save",
    priority: 20,
    notable: isNotable,
    async fire(event: SavePathEvent, ctx: NotifyContext): Promise<void> {
      await fireActOnce(
        {
          actId: event.actId,
          actor: event.actor,
          silent: event.silent === true,
          events: [event],
          actCardName: event.card?.name ?? null,
        },
        ctx,
      );
    },
    fireAct: fireActOnce,
  };
}

export function fixedFollowerResolver(
  followers: readonly FollowerRef[],
): FollowerResolver {
  return () => followers;
}

export function fixedTemplateResolver(
  template: EmailTemplate,
): EmailTemplateResolver {
  return () => template;
}

export function fixedAuthAs(actor: NotifyActor): (id: number, name: string) => NotifyActor {
  return () => actor;
}

export { interpolateTemplate };
export type { MailMessage };

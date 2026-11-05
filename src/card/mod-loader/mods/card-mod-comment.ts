import { str, type ViewContext, type ViewFn } from "../../render/format.js";
import { HTML_VIEWS } from "../../render/views.js";
import { h } from "../../render/slot-html.js";
import type { DeckoModManifest, ModEventCard } from "../mod-manifest.js";
import type { ModEventContext, ModEventSaveInput } from "../mod-event-dispatch.js";

function output(parts: (string | undefined | null)[]): string {
  return parts
    .filter((part): part is string => part !== undefined && part !== null)
    .join("\n");
}

const BASE_OPEN: ViewFn | undefined = HTML_VIEWS["open"];
const BASE_TITLED: ViewFn | undefined = HTML_VIEWS["titled"];
const BASE_TITLED_CONTENT: ViewFn | undefined = HTML_VIEWS["titled_content"];
const BASE_CORE: ViewFn | undefined = HTML_VIEWS["core"];
const BASE_INPUT: ViewFn | undefined = HTML_VIEWS["input"];

function hiddenCommentFields(card: ViewContext["fmt"]["card"]): string {
  if (card.id !== undefined) return "";
  return (
    `<input type="hidden" name="card[name]" id="card_name"` +
    ` value="${h(card.name.s)}" autocomplete="off" />`
  );
}

function commentTextArea(): string {
  return (
    `<textarea rows="3" class=" form-control" name="card[comment]"` +
    ` id="card_comment">\n</textarea>`
  );
}

function commentButtons(ctx: ViewContext): string {
  return `<div class="comment-buttons">${commentAuthorLabel(ctx)}${commentSubmitButton()}</div>`;
}

function commentAuthorLabel(ctx: ViewContext): string {
  const signedIn =
    ctx.fmt.engine.viewer?.signedIn === true ||
    ctx.fmt.engine.pageSession?.signedIn === true;
  if (signedIn) return "";
  return `<label>My Name is:</label> <input type="text" name="comment_author">`;
}

function commentSubmitButton(): string {
  return (
    `<button name="button" type="submit" data-disable-with="Commenting"` +
    ` class="btn btn-outline-primary">Comment</button>`
  );
}

function commentBoxBody(ctx: ViewContext): string {
  const card = ctx.fmt.card;
  const isNew = card.id === undefined;
  const form = isNew
    ? `<form class="card-form slotter" id="new_card" action="/card/create"` +
      ` accept-charset="UTF-8" data-remote="true" method="post">`
    : `<form class="card-form slotter autosave" id="edit_card_${card.id}"` +
      ` action="/update/${h(ctx.fmt.urlKey())}" accept-charset="UTF-8"` +
      ` data-remote="true" method="post">` +
      `<input type="hidden" name="_method" value="patch" autocomplete="off" />`;
  const body =
    `<input name="utf8" type="hidden" value="&#x2713;" autocomplete="off" />` +
    output([
      hiddenCommentFields(card),
      commentTextArea(),
      commentButtons(ctx),
    ]);
  return `<div class="comment-box nodblclick">${form}${body}</form></div>`;
}

const BASE_COMMENT_BOX: ViewFn | undefined = HTML_VIEWS["comment_box"];
const commentBoxView: ViewFn = (ctx) =>
  BASE_COMMENT_BOX !== undefined ? BASE_COMMENT_BOX(ctx) : commentBoxBody(ctx);

const discussionOpenView: ViewFn = (ctx) => {
  ctx.voo.showViz("comment_box");
  return callBaseView(ctx, BASE_OPEN, "open");
};

const discussionOpenContentView: ViewFn = (ctx) => {
  ctx.voo.showViz("comment_box");
  return str(ctx.fmt.renderView("core", { skip_perms: true }));
};

const discussionTitledView: ViewFn = (ctx) => {
  ctx.voo.showViz("comment_box");
  return callBaseView(ctx, BASE_TITLED, "titled");
};

const discussionTitledContentView: ViewFn = (ctx) => {
  ctx.voo.showViz("comment_box");
  return callBaseView(ctx, BASE_TITLED_CONTENT, "titled_content");
};

const discussionCoreView: ViewFn = (ctx) => {
  return callBaseView(ctx, BASE_CORE, "core");
};

const discussionInputView: ViewFn = (ctx) => {
  if (BASE_INPUT !== undefined) return BASE_INPUT(ctx);
  return callBaseView(ctx, HTML_VIEWS["content"], "input");
};

function callBaseView(ctx: ViewContext, base: ViewFn | undefined, name: string): string {
  if (base !== undefined) {
    const result = base(ctx);
    return String(result ?? "");
  }
  throw new Error(`base view missing for discussion super() call: ${name}`);
}

export function rubyTimestamp(d: Date): string {
  const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`
  );
}

export function cleanComment(comment: string): string {
  return comment
    .split("\n")
    .map((line) => `<p>${line.trim() === "" ? "&nbsp;" : line}</p>`)
    .join("\n");
}

export function commentSignature(author: string, now: Date): string {
  return `<div class="w-comment-author">${author}.....${rubyTimestamp(now)}</div>`;
}

export function commentAuthorFor(save: {
  signedInActorName: string | undefined;
  commentAuthor: string | undefined;
  session?: { commentAuthor?: string };
}): string {
  if (save.signedInActorName !== undefined) return `[[${save.signedInActorName}]]`;
  const declared =
    save.session?.commentAuthor ?? save.commentAuthor ?? "Anonymous";
  return `${declared} (Not signed in)`;
}

export function appendComment(
  content: string | undefined,
  comment: string,
  author: string,
  now: Date,
): string {
  const signature = `${cleanComment(comment)}\n${commentSignature(author, now)}`;
  if (content === undefined) return signature;
  return `${content}\n<hr>\n${signature}`;
}

export async function addCommentEventFn(
  save: ModEventSaveInput,
): Promise<void> {
  const comment = save.comment;
  if (comment === undefined) return;
  if (save.session !== undefined) {
    save.session.commentAuthor =
      save.session.commentAuthor ?? save.commentAuthor ?? "Anonymous";
  }
  if (comment === "") return;
  const author = commentAuthorFor(save);
  save.setContent(appendComment(save.pendingContent, comment, author, save.now()));
  save.commentApplied = true;
}

export const commentModEventPredicates = {
  comment: (_card: ModEventCard, ctx?: ModEventContext): boolean =>
    ctx?.saveInput !== undefined &&
    ctx.saveInput.comment !== undefined &&
    !ctx.saveInput.commentApplied,
} as const;

const cardModComment: DeckoModManifest = {
  name: "comment",
  gemName: "card-mod-comment",
  group: "gem-defaults",
  setModules: [
    {
      setPath: "all/comment",
      events: [
        {
          event: "add_comment",
          at: "prepare_to_store",
          on: ["save"],
          when: "comment",
          fn: (card, _host, ctx) => {
            if (ctx.saveInput === undefined) return;
            void card;
            return addCommentEventFn(ctx.saveInput);
          },
        },
      ],
      formats: {
        html: {
          views: [
            {
              view: "comment_box",
              viewFn: commentBoxView,
              config: { denial: "blank", unknown: true, perms: "update" },
            },
          ],
        },
      },
    },
    {
      setPath: "right/comment",
    },
    {
      setPath: "right/discussion",
      formats: {
        html: {
          views: [
            {
              view: "open",
              viewFn: discussionOpenView,
              config: { unknown: true },
            },
            {
              view: "open_content",
              viewFn: discussionOpenContentView,
              config: { unknown: true },
            },
            {
              view: "titled",
              viewFn: discussionTitledView,
              config: { unknown: true },
            },
            {
              view: "titled_content",
              viewFn: discussionTitledContentView,
              config: { unknown: true },
            },
            {
              view: "core",
              viewFn: discussionCoreView,
              config: { unknown: true },
            },
            {
              view: "input",
              viewFn: discussionInputView,
            },
          ],
        },
      },
    },
  ],
};

export default cardModComment;

import type { ViewContext, ViewFn } from "../../render/format.js";
import {
  contentWithLinkBody,
  emailTemplateCoreBody,
  htmlMessageCoreBody,
  subjectCoreBody,
  textMessageCoreBody,
} from "../../render/views.js";
import type {
  DeckoModManifest,
  ModSetModuleFile,
} from "../mod-manifest.js";

const emailTextUnknownView: ViewFn = () => "";

const emailTextCompactMissingView: ViewFn = () => "";

const emailTextLastActionView: ViewFn = (ctx: ViewContext) =>
  ctx.fmt.renderView("last_action_verb", { skip_perms: true });

const emailHtmlUnknownView: ViewFn = () => "";

const emailHtmlCompactMissingView: ViewFn = () => "";

const testContextEmailHtmlCoreView: ViewFn = (ctx) =>
  ctx.fmt.processContent(ctx.fmt.renderRaw());

const emailDocumentWrapper =
  "<!DOCTYPE html>\n" +
  '<html>' + "\n" +
  "  <head>\n" +
  '    <meta http-equiv="Content-type" content="text/html;charset=UTF-8"/>\n' +
  "    <style></style>\n" +
  "  </head>\n" +
  '  <body class="d0-email-body">' + "\n" +
  "    INTERIOR\n" +
  "  </body>\n" +
  "</html>\n";

const emailPageView: ViewFn = (ctx: ViewContext) => {
  const core = ctx.fmt.renderDelegated("core");
  const interior = core;
  return emailDocumentWrapper.replace("INTERIOR", interior);
};

const contentWithLinkView: ViewFn = contentWithLinkBody;

const textMessageCoreView: ViewFn = textMessageCoreBody;

const htmlMessageCoreView: ViewFn = htmlMessageCoreBody;

const subjectCoreView: ViewFn = subjectCoreBody;

const emailTemplateCoreView: ViewFn = emailTemplateCoreBody;

const setModules: ModSetModuleFile[] = [
  {
    setPath: "abstract/email_field",
  },
  {
    setPath: "abstract/test_context",
    formats: {
      email_html: {
        views: [{ view: "core", viewFn: testContextEmailHtmlCoreView }],
      },
    },
  },
  {
    setPath: "all/email_html",
    formats: {
      html: {
        views: [
          { view: "email_page", viewFn: emailPageView, config: { wrap: "email_document" } },
        ],
      },
      email_html: {
        views: [
          { view: "unknown", viewFn: emailHtmlUnknownView },
          { view: "compact_missing", viewFn: emailHtmlCompactMissingView },
        ],
      },
    },
  },
  {
    setPath: "all/email_text",
    formats: {
      email_text: {
        views: [
          { view: "unknown", viewFn: emailTextUnknownView },
          { view: "compact_missing", viewFn: emailTextCompactMissingView },
          {
            view: "last_action",
            viewFn: emailTextLastActionView,
            config: { perms: "none", cache: "never" },
          },
        ],
      },
    },
  },
  {
    setPath: "right/bcc",
    assignsType: "list",
  },
  {
    setPath: "right/cc",
    assignsType: "list",
  },
  {
    setPath: "right/from",
    assignsType: "list",
  },
  {
    setPath: "right/subject",
    assignsType: "phrase",
    formats: {
      html: {
        views: [{ view: "core", viewFn: subjectCoreView }],
      },
    },
  },
  {
    setPath: "right/to",
    assignsType: "list",
  },
  {
    setPath: "right/text_message",
    assignsType: "plain_text",
    formats: {
      html: {
        views: [{ view: "core", viewFn: textMessageCoreView }],
      },
    },
  },
  {
    setPath: "right/html_message",
    formats: {
      html: {
        views: [
          { view: "content", viewFn: contentWithLinkView },
          { view: "core", viewFn: htmlMessageCoreView },
        ],
      },
    },
  },
  {
    setPath: "type/email_template",
  },
  {
    setPath: "type/email_template/email_config",
  },
  {
    setPath: "type/email_template/html",
    formats: {
      html: {
        views: [{ view: "core", viewFn: emailTemplateCoreView }],
      },
    },
  },
];

const cardModEmail: DeckoModManifest = {
  name: "email",
  gemName: "card-mod-email",
  group: "gem",
  setModules,
};

export default cardModEmail;

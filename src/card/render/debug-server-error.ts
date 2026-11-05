import type { ViewFn } from "./format.js";
import { MOD_SPECS } from "../mod-loader/mods/core-admin-runtime.js";

class NameError extends Error {
  override name = "NameError";
}

export const SERVER_ERROR_HTML =
  `<div class='border border-danger text-center p-3'>\n` +
  `<h1>Wild Card!</h1>\n` +
  `<h2 class='alert-danger'>500 Server Error</h2>\n` +
  `<h4 class='p-3'>\n` +
  `Yuck, sorry about that.\n` +
  `</h4>\n` +
  `</div>\n`;

export const serverErrorHtmlView: ViewFn = () => SERVER_ERROR_HTML;

const BETTER_ERRORS_MOD = "monkey";

export const debugServerErrorView: ViewFn = () => {
  if (MOD_SPECS[BETTER_ERRORS_MOD] === undefined) {
    throw new NameError(
      "uninitialized constant Card::Set::All::Html::Error::BetterErrors",
    );
  }
  throw new Error(
    "debug_server_error: BetterErrors::ErrorPage (better_errors, via card-mod-monkey) is not ported",
  );
};

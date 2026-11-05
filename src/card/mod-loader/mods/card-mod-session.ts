import { defineMod } from "../mod-dsl.js";
import { RubyRuntimeError } from "../../render/format.js";

export const ALLOW_ANONYMOUS_COOKIES = true;

const cardModSession = defineMod("card-mod-session", { group: "gem-defaults" }, ({ set }) => {
  set("all/location_history", ({ event }) => {
    event("discard_deleted_locations", "finalize", { on: "delete" });
    event("save_current_location", { before: "show_page" });
  });

  set("type/session", ({ event, format }) => {
    format("html", ({ before }) => {
      before("core", ({ voo }) => {
        const items = voo.items;
        if (typeof items === "string" || Array.isArray(items)) {
          throw new RubyRuntimeError("TypeError", "no implicit conversion of Symbol into Integer");
        }
        if (items === null || typeof items !== "object") {
          throw new RubyRuntimeError("NoMethodError", "Session items do not support []=");
        }
        (items as Record<string, unknown>)["view"] = "name";
      });
    });
    event("store_in_session", "prepare_to_store", { on: "save", engineOwned: true });
    event("delete_in_session", "prepare_to_store", { on: "delete", engineOwned: true });
  });
});

export default cardModSession;

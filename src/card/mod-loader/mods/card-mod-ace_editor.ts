import { defineMod } from "../mod-dsl.js";

const ACE_HELP_TEXT =
  "Configure [[https://ace.c9.io/|ace]], " +
  "Decko's default code editor, using these available " +
  "[[https://github.com/ajaxorg/ace/wiki/Configuring-Ace|options]].";

const cardModAceEditor = defineMod("card-mod-ace_editor", { group: "gem-defaults" }, ({ set }) => {
  set("self/ace", ({ setting }) => {
    setting({ group: "other", helpText: ACE_HELP_TEXT });
  });

  set("all/ace_editor", ({ format }) => {
    format("html", () => {});
  });
});

export default cardModAceEditor;

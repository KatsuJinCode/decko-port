export interface SettingHelpEntry {
  self?: string;
  right?: string;
}

export const SETTING_HELP_TEXT: ReadonlyMap<string, SettingHelpEntry> = new Map([
  ["thanks", {
    self: "Destination after card is created. [[http://decko.org/Custom_thank_you_messages_for_forms|more]]",
    right: "Destination after card is created. [[http://decko.org/Custom_thank_you_messages_for_forms|more]]",
  }],
  ["help", {
    self: "[[http://decko.org/custom_help_text|Help text]] people will see when editing.",
    right: "[[http://decko.org/custom_help_text|Help text]] people will see when editing.",
  }],
  ["input_type", {
    self: "Configure [[https://ace.c9.io/|ace]], Decko's default code editor, using these available [[https://github.com/ajaxorg/ace/wiki/Configuring-Ace|options]].",
    right: "edit interface for list cards",
  }],
  ["sidebar", {
    self: "    Sidebar content of [[Layouts]] with sidebar. [[http://decko.org/sidebar|more]]\n",
  }],
  ["tiny_mce", {
    self: "    Configure [[http://tinymce.com|TinyMCE]], Decko's default\n    [[http://en.wikipedia.org/wiki/Wysiwyg|wysiwyg]] editor.\n    [[http://decko.org/TinyMCE|more]]\n",
  }],
  ["content_options", {
    self: "Value options for [[List]] and [[Pointer]] and cards. Can itself be a List or a [[Search]]. [[http://decko.org/Pointer|more]]",
    right: "Value options for [[List]] and [[Pointer]] and cards. Can itself be a List or a [[Search]]. [[http://decko.org/Pointer|more]]",
  }],
  ["content_option_view", {
    self: "Label view for radio button and checkbox items.  [[http://decko.org/Pointer|more]]",
    right: "Label view for radio button and checkbox items.  [[http://decko.org/Pointer|more]]",
  }],
  ["layout", {
    self: "HTML structure of card's page [[http://decko.org/layouts | more]]",
    right: "HTML structure of card's page [[http://decko.org/layouts | more]]",
  }],
  ["captcha", {
    self: "Anti-spam setting.  Requires non-signed-in users to complete a [[http://decko.org/captcha|captcha]] before adding or editing cards (where permitted).",
    right: "Anti-spam setting.  Requires non-signed-in users to complete a [[http://decko.org/captcha|captcha]] before adding or editing cards (where permitted).",
  }],
  ["recaptcha_settings", {
    self:
      "Register your domain at Google's " +
      "[[http://google.com/recaptcha|reCAPTCHA service]] " +
      "and enter your site key and secret key below.<br>" +
      "If you want to turn captchas off then change all " +
      "[[*captcha|captcha rules]] to 'no'.",
  }],
  ["structure", {
    self: "Controls cards' content / structure. [[http://decko.org/formatting|more]]",
    right: "Controls cards' content / structure. [[http://decko.org/formatting|more]]",
  }],
  ["autoname", {
    self: "Autogenerate name for new cards by incrementing this value. [[http://decko.org/autonaming|more]]",
    right: "Autogenerate name for new cards by incrementing this value. [[http://decko.org/autonaming|more]]",
  }],
  ["create", { self: "Who can create new cards", right: "Who can create new cards" }],
  ["read", { self: "Who can view cards in the [[Set]].", right: "Who can view cards in the [[Set]]." }],
  ["update", { self: "Who can update cards", right: "Who can update cards" }],
  ["delete", { self: "Who can delete cards", right: "Who can delete cards" }],
  ["head", { self: "head tag content", right: "head tag content" }],

  ["style", {
    self: "Skin (collection of stylesheets) for card's page. [[http://decko.org/skins|more]]",
    right: "Skin (collection of stylesheets) for card's page. [[http://decko.org/skins|more]]",
  }],
  ["script", {
    right: "JavaScript (or CoffeeScript) for card's page.",
  }],
  ["on_create", { self: "Configure events to be executed when card is created", right: "Configure events to be executed when card is created" }],
  ["on_update", { self: "Configure events to be executed when card is updated", right: "Configure events to be executed when card is updated" }],
  ["on_delete", { self: "Configure events to be executed when card is deleted", right: "Configure events to be executed when card is deleted" }],
  ["ace", {
    self: "Configure [[https://ace.c9.io/|ace]], Decko's default code editor, using these available [[https://github.com/ajaxorg/ace/wiki/Configuring-Ace|options]].",
  }],
  ["favicon", {
    self: "A favicon (or shortcut icon) is a small image used by browsers to help identify your website. [[http://www.decko.org/favicon|How to customize your favicon]]",
  }],
  ["guide", {
    right: "Appears in the full editor view to guide users.",
  }],
  ["variables", {
    right: "    Override bootstrap [[https://github.com/twbs/bootstrap/blob/v5.1.3/scss/_variables.scss|variables]]\n",
  }],
  ["children", {
    right: "Cards formed by \"mating\" {{_left|name}} with another card. eg: \"{{_left|name}}+mate\".",
  }],
  ["created", { right: "Cards created by {{_left|name}}." }],
  ["edited", { right: "Cards edited by {{_left|name}}." }],
  ["editors", { right: "Users who have edited {{_left|name}}." }],
  ["linked_to_by", { right: "Cards that link to {{_left|name}}." }],
  ["links_to", { right: "Cards that <em>{{_left|name}}</em> links to." }],
  ["nested_by", { right: "Cards that nest {{_left|name}}." }],
  ["nests", { right: "Cards that {{_left|name}} includes." }],
  ["referred_to_by", { right: "Cards that refer to {{_left|name}}." }],
  ["refers_to", { right: "Cards that {{_left|name}} refers to." }],
]);

export function registeredSettingHelpText(
  cardCodename: string | undefined,
  rightCodename: string | undefined,
): string | undefined {
  if (cardCodename !== undefined) {
    const own = SETTING_HELP_TEXT.get(cardCodename);
    if (own?.self !== undefined) return own.self;
  }
  if (rightCodename !== undefined) {
    const right = SETTING_HELP_TEXT.get(rightCodename);
    if (right?.right !== undefined) return right.right;
  }
  return undefined;
}

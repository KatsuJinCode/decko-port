export const CARDTYPE_GROUPS: Readonly<Record<string, readonly string[]>> = {
  Text: ["RichText", "PlainText", "Markdown", "Phrase", "HTML"],
  Data: ["Number", "Toggle", "Date", "URI"],
  Upload: ["File", "Image"],
  Custom: [],
  Organize: ["List", "Pointer", "Search", "Link list", "Nest list"],
  Template: ["Notification template", "Email template", "Twitter template"],
  Admin: ["Cardtype", "User", "Role", "Sign up", "Session", "Set", "Setting"],
  Styling: ["Layout", "Skin", "Bootswatch skin", "CSS", "SCSS"],
  Scripting: ["JSON", "JavaScript", "CoffeeScript"],
};

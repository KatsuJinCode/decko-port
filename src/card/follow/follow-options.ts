export const FOLLOW_OPTION_MAIN: readonly (string | null)[] = Object.freeze([
  null,
  "always",
  "never",
]);

export const FOLLOW_OPTION_RESTRICTIVE: readonly string[] = Object.freeze([
  "created",
  "edited",
]);

export const FOLLOW_OPTION_ALL: readonly string[] = Object.freeze([
  "always",
  "created",
  "edited",
  "never",
]);

export const FOLLOW_OPTION_CARD_NAMES: readonly string[] = Object.freeze([
  "*always",
  "*created",
  "*edited",
  "*never",
]);

export function isRestrictiveFollowOption(codename: string): boolean {
  return (FOLLOW_OPTION_RESTRICTIVE as readonly string[]).includes(codename);
}

export function followOptionDescription(
  optionCodename: string,
  setLabel: string,
): string {
  if (optionCodename === "created") return `${setLabel} I created`;
  if (optionCodename === "edited") return `${setLabel} I edited`;
  return setLabel;
}

export function followOptionLabel(optionCodename: string): string {
  switch (optionCodename) {
    case "always":
      return "follow";
    case "created":
      return "follow if I created";
    case "edited":
      return "follow if I edited";
    case "never":
      return "ignore";
    default:
      return optionCodename;
  }
}

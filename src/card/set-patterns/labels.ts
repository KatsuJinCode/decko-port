export function allLabel(_anchor: string | undefined): string {
  return "All cards";
}

export function allShortLabel(_anchor: string | undefined): string {
  return "everything";
}

export function allPlusLabel(_anchor: string | undefined): string {
  return 'All "+" cards';
}

export function allPlusShortLabel(_anchor: string | undefined): string {
  return 'all "+" cards';
}

export function typeLabel(anchor: string | undefined): string {
  return `All "${anchor}" cards`;
}

export function typeShortLabel(anchor: string | undefined): string {
  return `all "${anchor}s"`;
}

export function typeGenericLabel(): string {
  return "cards of a given type";
}

export function starLabel(_anchor: string | undefined): string {
  return 'All "*" cards';
}

export function starShortLabel(_anchor: string | undefined): string {
  return 'all "*" cards';
}

export function rstarLabel(_anchor: string | undefined): string {
  return 'All "+*" cards';
}

export function rstarShortLabel(_anchor: string | undefined): string {
  return 'all "+*" cards';
}

export function ruleLabel(_anchor: string | undefined): string {
  return "All rule cards";
}

export function ruleShortLabel(_anchor: string | undefined): string {
  return "all rule cards";
}

export function rightLabel(anchor: string | undefined): string {
  return `All "+${anchor}" cards`;
}

export function rightShortLabel(anchor: string | undefined): string {
  return `all "+${anchor}s"`;
}

export function rightGenericLabel(): string {
  return "given field cards";
}

export function typePlusRightLabel(anchor: string | undefined): string {
  const { tag, left } = tagAndLeft(anchor);
  return `All "+${tag}" cards on "${left}" cards`;
}

export function typePlusRightShortLabel(anchor: string | undefined): string {
  const { tag, left } = tagAndLeft(anchor);
  return `all "+${tag}" on "${left}s"`;
}

export function typePlusRightGenericLabel(): string {
  return "given field cards on a given type";
}

export function selfLabel(anchor: string | undefined): string {
  return `The card "${anchor}"`;
}

export function selfShortLabel(anchor: string | undefined): string {
  return anchor ?? "";
}

export function selfGenericLabel(): string {
  return "a single card";
}

function tagAndLeft(anchor: string | undefined): { tag: string; left: string } {
  if (anchor === undefined) return { tag: "", left: "" };
  const joint = anchor.lastIndexOf("+");
  if (joint < 0) return { tag: anchor, left: "" };
  return {
    tag: anchor.slice(joint + 1),
    left: anchor.slice(0, joint),
  };
}

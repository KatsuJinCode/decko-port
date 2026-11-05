import { DeckoName } from "../name.js";
import { getNameEnvironment } from "../name/environment.js";
import type { PatternCardInput } from "./types.js";
import type { PatternSpec } from "./registry.js";

export type PatternCardNames = ReadonlyMap<string, string>;

export class PatternInstance {
  readonly spec: PatternSpec;

  private readonly card: PatternCardInput;

  private readonly anchor: DeckoName | undefined;

  private anchorIdMemo: { value: number | null | undefined } | undefined;

  private get anchorIdValue(): number | null | undefined {
    if (this.anchorIdMemo === undefined) {
      this.anchorIdMemo = {
        value:
          this.spec.anchorName === undefined
            ? undefined
            : this.spec.anchorId?.(this.card) || this.anchor?.cardId || undefined,
      };
    }
    return this.anchorIdMemo.value;
  }

  private constructor(spec: PatternSpec, card: PatternCardInput, private readonly patternNames?: PatternCardNames) {
    this.spec = spec;
    this.card = card;
    if (spec.anchorName === undefined) {
      this.anchor = undefined;
      return;
    }
    const anchorString = spec.anchorName(card);
    this.anchor = DeckoName.parse(anchorString ?? "");
  }

  static tryNew(
    spec: PatternSpec,
    card: PatternCardInput,
    patternNames?: PatternCardNames,
  ): PatternInstance | null {
    return spec.applies(card) ? new PatternInstance(spec, card, patternNames) : null;
  }

  get patternCode(): string {
    return this.spec.code;
  }

  get patternCardName(): string {
    if (this.patternNames !== undefined) return this.patternNames.get(this.spec.code) ?? this.spec.patternCardName;
    const env = getNameEnvironment();
    const id = env?.codename?.id(this.spec.code);
    if (id !== undefined) {
      const lexName = env?.lexicon?.name(id);
      if (lexName !== undefined) return lexName;
    }
    return this.spec.patternCardName;
  }

  get anchorName(): DeckoName | undefined {
    return this.anchor;
  }

  get anchorId(): number | undefined {
    return this.anchorIdValue ?? undefined;
  }

  get compoundOnly(): boolean {
    return this.spec.compoundOnly;
  }

  get assignsType(): boolean {
    return this.spec.assignsType;
  }

  get anchorless(): boolean {
    return this.spec.anchorName === undefined;
  }

  get anchorPartsCount(): number {
    if (this.spec.anchorPartsCountFor) {
      return this.spec.anchorPartsCountFor(this.anchor?.s);
    }
    return this.spec.staticAnchorPartsCount;
  }

  get anchorParts(): readonly DeckoName[] {
    if (!this.anchor) return [];
    const count = this.anchorPartsCount;
    if (count <= 1) return [this.anchor];
    const parts = this.anchor.partNames;
    if (parts.length <= count) return parts;
    return [
      this.anchor.getRange(0, -count),
      ...parts.slice(parts.length - count + 1),
    ];
  }

  get anchorCodenames(): readonly string[] | null {
    if (!this.anchor) return null;
    const codes: string[] = [];
    for (const part of this.anchorParts) {
      const code = part.codename;
      if (code === undefined) return null;
      codes.push(code);
    }
    return codes;
  }

  get moduleKey(): string | null {
    if (this.anchorless) return camelize(this.spec.code);
    const codes = this.anchorCodenames;
    if (codes === null) return null;
    return [this.spec.code, ...codes].map(camelize).join("::");
  }

  get setName(): string {
    const pattern = this.patternCardName;
    return this.anchorless ? pattern : `${this.anchor?.s}+${pattern}`;
  }

  get safeKey(): string {
    const capsPart = this.spec.code.replaceAll(" ", "_").toUpperCase();
    return this.anchorless
      ? capsPart
      : `${capsPart}-${this.anchor?.safeKey}`;
  }

  get ruleLookupKey(): string | null {
    if (this.anchorless) return this.spec.code;
    if (this.anchorIdValue) return `${this.anchorIdValue}+${this.spec.code}`;
    return null;
  }

  get cardInput(): PatternCardInput {
    return this.card;
  }

  inspect(): string {
    return `<${this.constructor.name} ${this.setName}>`;
  }
}

function camelize(code: string): string {
  return code
    .split("_")
    .map((word) =>
      word.length === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join("");
}

export function moduleKeyFromAnchorCodenames(
  spec: PatternSpec,
  anchorCodenames: readonly string[],
): string {
  return [spec.code, ...anchorCodenames].map(camelize).join("::");
}

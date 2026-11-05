import type { ViewContext, ViewFn, ViewResult } from "../render/format.js";
import type { ModFormatMethodFn, ModViewConfig } from "./mod-manifest.js";
import {inspectTagSymbol} from "./mod-tag-values.js";

export type DeclaredWrapperOptions = Readonly<Record<string, unknown>>;
export type DeclaredWrapperBody = (
  context: ViewContext, interior: ViewResult, options: DeclaredWrapperOptions,
) => ViewResult;

class ArgumentError extends Error {
  override name = "ArgumentError";
}

class UnsupportedModWrapperError extends Error {
  override name = "UnsupportedModWrapperError";
}

function optionsCopy(options: unknown): Record<string, unknown> {
  if (options === undefined || options === null) return {};
  if (typeof options !== "object" || Array.isArray(options)) {
    throw new ArgumentError("wrapper options must be an object");
  }
  return { ...options };
}

export function declaredWrapperMethod(name: string, body: DeclaredWrapperBody): {
  implementation: ModFormatMethodFn; invocation: ModFormatMethodFn;
} {
  if (typeof body !== "function") {
    throw new UnsupportedModWrapperError("Declared wrapper bodies must be functions; tag/layout declarations require their native framework support");
  }
  if (Object.prototype.toString.call(body) === "[object AsyncFunction]") {
    throw new ArgumentError(`Wrappers must be synchronous: ${name}`);
  }
  return {
    implementation: (ctx, interior, options) => body(ctx, interior as ViewResult, optionsCopy(options)),
    invocation: (ctx, interior, options) => ctx.fmt.callFormatMethod(
      `_wrapper_${name}`, typeof interior === "function" ? interior() : interior, optionsCopy(options),
    ),
  };
}

function wrapperEntries(wrap: ModViewConfig["wrap"]): Array<[unknown, unknown]> {
  if (wrap === undefined) return [];
  if (typeof wrap === "string") return [[wrap, undefined]];
  if (Array.isArray(wrap)) return wrap.map(entry => Array.isArray(entry) ? [entry[0], entry[1]] : [entry, undefined]);
  return Object.entries(wrap);
}

function wrapperLabel(name: unknown): string {
  if (typeof name === "object" && name !== null && !Array.isArray(name)) {
    return `{${Object.entries(name).map(([key, value]) => `${inspectTagSymbol(key)}=>${typeof value === "string" ? inspectTagSymbol(value) : String(value)}`).join(", ")}}`;
  }
  return String(name);
}

export function withDeclaredViewWrappers(body: ViewFn,
  setting: (ctx: ViewContext) => { wrap: ModViewConfig["wrap"]; strict: boolean }): ViewFn {
  return ctx => {
    let interior = body(ctx);
    const { wrap, strict } = setting(ctx);
    const entries = wrapperEntries(wrap);
    for (const [name, options] of [...entries].reverse()) {
      const fn = ctx.fmt.engine.resolveFormatMethod?.(ctx.fmt.card, `wrap_with_${name}`, ctx.fmt.formatName);
      if (fn === undefined) {
        if (strict) throw new ArgumentError(`unknown wrapper: ${wrapperLabel(name)}`);
        continue;
      }
      const wrapped = ctx.fmt.callFormatMethod(`wrap_with_${name}`, interior, options);
      if (wrapped === null || wrapped === undefined || wrapped === false) {
        throw new ArgumentError(`unknown wrapper: ${wrapperLabel(name)}`);
      }
      interior = wrapped as ViewResult;
    }
    return interior;
  };
}

import { emitAttrs } from "../render/slot-html.js";
import { formatTagNumber, stringifyTagJsonNumbers } from "./mod-tag-number.js";
import type { DeclaredWrapperBody, DeclaredWrapperOptions } from "./mod-wrapper-runtime.js";
import {UnsupportedModTagAttributeError,isTagRecord,validateTagOptions,ordinaryTagValue,tagTokens,mergedTagClasses,tagBlank} from './mod-tag-values.js';

const booleanAttributes = new Set(("allowfullscreen allowpaymentrequest async autofocus autoplay checked compact controls declare default " +
  "defaultchecked defaultmuted defaultselected defer disabled enabled formnovalidate hidden indeterminate inert ismap itemscope loop " +
  "multiple muted nohref nomodule noresize noshade novalidate nowrap open pauseonexit playsinline readonly required reversed scoped " +
  "seamless selected sortable truespeed typemustmatch visible").split(" "));

function truthy(value: unknown): boolean {
  return value !== false && value !== null && value !== undefined;
}

function jsonData(value: unknown): string | undefined {
  const escapes: Record<string, string> = {
    "<": "\\u003c", ">": "\\u003e", "&": "\\u0026", "\u2028": "\\u2028", "\u2029": "\\u2029",
  };
  return stringifyTagJsonNumbers(value)?.replace(/[<>&\u2028\u2029]/g, character => escapes[character]!);
}

function scalar(value: unknown, name: string): string {
  if (typeof value === "number") return formatTagNumber(value);
  if (["string", "number", "boolean"].includes(typeof value)) return String(value);
  throw new UnsupportedModTagAttributeError(`Unsupported tag attribute value: ${name}`);
}

function attributes(options: DeclaredWrapperOptions): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = Object.create(null);
  for (const [name, value] of Object.entries(options)) {
    if (value === undefined || value === null || name === "") continue;
    if (!/^[A-Za-z_:][A-Za-z0-9_.:-]*$/.test(name)) {
      throw new UnsupportedModTagAttributeError(`Unsupported tag attribute name: ${name}`);
    }
    if (booleanAttributes.has(name)) {
      if (truthy(value)) result[name] = name;
    } else if ((name === "data" || name === "aria") && isTagRecord(value)) {
      for (const [key, item] of Object.entries(value)) {
        if (key === "" || item === null || item === undefined) continue;
        const attribute = `${name}-${key.replace(/_/g, "-")}`;
        if (!/^[A-Za-z_:][A-Za-z0-9_.:-]*$/.test(attribute)) {
          throw new UnsupportedModTagAttributeError(`Unsupported tag attribute name: ${attribute}`);
        }
        if(name==='aria'&&(Array.isArray(item)||isTagRecord(item))){
          const tokens=tagTokens(item);if(tokens.length)result[attribute]=tokens.join(' ');
        }else result[attribute] = name === "data" && typeof item !== "string" ? jsonData(item) : scalar(item, attribute);
      }
    } else if (name === "class" && (Array.isArray(value)||isTagRecord(value))) {
      result[name] = tagTokens(value).join(' ');
    } else {
      result[name] = ordinaryTagValue(value);
    }
  }
  return result;
}

function tagContent(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.flat(Infinity).filter(item => item !== null && item !== undefined)
    .map(item => scalar(item, "interior")).join("\n");
  return scalar(value, "interior");
}

export function declaredTagWrapper(tag: string, defaults: DeclaredWrapperOptions = {}): DeclaredWrapperBody {
  if (!/^[A-Za-z][A-Za-z0-9:-]*$/.test(tag)) {
    throw new UnsupportedModTagAttributeError(`Unsupported wrapper tag name: ${tag}`);
  }
  validateTagOptions(defaults);
  return (_ctx, interior, options) => {
    validateTagOptions(options);
    const invocation = { ...options };
    const defaultClass = defaults.class;
    if (!tagBlank(defaultClass)) {
      invocation.class = mergedTagClasses(invocation.class,defaultClass);
    }
    const merged = { ...defaults, ...invocation };
    const body = tagContent(interior);
    return `<${tag}${emitAttrs(attributes(merged))}>${tag === "textarea" ? "\n" : ""}${body}</${tag}>`;
  };
}

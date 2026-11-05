import { SET_INCLUDE_GRAPH, type SetIncludes } from "./set-include-graph.js";

export const CONCRETE_SET_INCLUDES: Readonly<Record<string, SetIncludes>> = {
  "Type::LayoutType": { html: ["Type::Html"], base: ["Type::Html"] },
  "Type::Image::HtmlViews": { html: ["Type::File"] },
};

function mergeIncludes(
  a: Readonly<Record<string, SetIncludes>>,
  b: Readonly<Record<string, SetIncludes>>,
): Record<string, SetIncludes> {
  const out: Record<string, SetIncludes> = { ...a };
  for (const [owner, inc] of Object.entries(b)) {
    const prev = out[owner];
    out[owner] = {
      ...(prev?.html !== undefined || inc.html !== undefined ? { html: [...(inc.html ?? []), ...(prev?.html ?? [])] } : {}),
      ...(prev?.base !== undefined || inc.base !== undefined ? { base: [...(inc.base ?? []), ...(prev?.base ?? [])] } : {}),
    };
  }
  return out;
}

export const SET_INCLUDES: Readonly<Record<string, SetIncludes>> = mergeIncludes(
  SET_INCLUDE_GRAPH,
  CONCRETE_SET_INCLUDES,
);

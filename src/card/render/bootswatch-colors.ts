import { bootstrapVariablesScss } from "./bootstrap-code-files.js";

export const COLOR_VARIABLE_NAMES: readonly string[] = [
  "blue", "indigo", "purple", "pink", "red", "orange", "yellow", "green",
  "teal", "cyan", "black", "white", "gray-100", "gray-200", "gray-300",
  "gray-400", "gray-500", "gray-600", "gray-700", "gray-800", "gray-900",
];

export const THEME_VARIABLE_NAMES: readonly string[] = [
  "primary", "secondary", "success", "info", "warning", "danger", "light",
  "dark", "body-bg", "body-color",
];

export type VariableValues = Map<string, string | undefined>;

function definitionRegex(name: string): RegExp {
  return new RegExp(`^(?<before>\\s*\\$${name}:\\s*)(?<value>.+?)(?<after> !default;)$`, "m");
}

export function valueFromScss(name: string, source: string): string | undefined {
  const bare = name.startsWith("$") ? name.slice(1) : name;
  return source.match(definitionRegex(bare))?.groups?.["value"];
}

export function variableValue(
  name: string,
  content: string,
  variablesContent: string | undefined,
): string | undefined {
  return (
    valueFromScss(name, content) ??
    (variablesContent !== undefined && variablesContent.trim() !== ""
      ? valueFromScss(name, variablesContent)
      : undefined) ??
    valueFromScss(name, bootstrapVariables())
  );
}

let bootstrapCache: string | undefined;
function bootstrapVariables(): string {
  bootstrapCache ??= bootstrapVariablesScss();
  return bootstrapCache;
}

export function variableGroupWithValues(
  names: readonly string[],
  content: string,
  variablesContent: string | undefined,
): VariableValues {
  const values: VariableValues = new Map();
  for (const name of names) values.set(name, variableValue(name, content, variablesContent));
  return values;
}

function text(value: string | undefined): string {
  return value ?? "";
}

function colorGroupBody(entries: ReadonlyArray<readonly [string, string | undefined]>): string {
  return entries
    .map(
      ([name, color]) =>
        "<div>\n" +
        "<span class='labeled-badge'></span>\n" +
        `<i style='background-color: ${text(color)};'></i>\n` +
        "<label class='text-muted'>\n" +
        `${name}\n` +
        "</label>\n" +
        "</div>\n",
    )
    .join("");
}

export function renderColorsCore(colors: VariableValues, themeColors: VariableValues): string {
  const colorEntries = [...colors.entries()];
  const themeEntries: Array<[string, string | undefined]> = [...themeColors.entries()].map(
    ([name, value]) => [
      name,
      value !== undefined && value.startsWith("$") ? colors.get(value.slice(1)) : value,
    ],
  );
  const groups = [themeEntries, colorEntries.slice(0, 10), colorEntries.slice(10)];
  let out = "<div class='colorpicker-element row'>\n";
  for (const group of groups) {
    out += "<div class='col-auto input-group-addon'>\n" + colorGroupBody(group) + "\n</div>\n";
  }
  return out + "</div>\n";
}

function colorPickerPartial(name: string, color: string | undefined): string {
  return (
    "<div class='row'>\n" +
    "<label class='col-sm-3 col-form-label'>\n" +
    `${name}\n` +
    "</label>\n" +
    "<div class='col-sm-9 py-1'>\n" +
    "<div class='input-group colorpicker-component'>\n" +
    `<input class='form-control input-lg' name='colors[${name}]' type='text' value='${text(color)}'>\n` +
    "<span class='input-group-text input-group-addon'>\n" +
    "<i></i>\n" +
    "</span>\n" +
    "</div>\n" +
    "</div>\n" +
    "</div>\n"
  );
}

export function themeColorPicker(name: string, value: string | undefined): string {
  const options = COLOR_VARIABLE_NAMES.map((variable) => `$${variable}`);
  if (value !== undefined && !options.includes(value)) options.push(value);
  const id = `theme_colors[${name}]`.replace(/\]/g, "").replace(/[^-a-zA-Z0-9:.]/g, "_");
  const optionTags = options
    .map((option) => {
      const selected = option === value ? ' selected="selected"' : "";
      return `<option${selected} value="${option}">${option}</option>`;
    })
    .join("\n");
  return `<select name="theme_colors[${name}]" id="${id}" class="tags form-control">${optionTags}</select>`;
}

export function renderColorsInput(colors: VariableValues, themeColors: VariableValues): string {
  let out = "<div class='row'>\n<div class='col-6'>\n<h4>Palette</h4>\n";
  for (const [name, color] of colors) out += colorPickerPartial(name, color) + "\n";
  out += "</div>\n<div class='col-6'>\n<h4>Uses</h4>\n";
  for (const [name, value] of themeColors) {
    out +=
      "<div class='form-group row'>\n" +
      "<label class='col-sm-4 col-form-label'>\n" +
      `${name}\n` +
      "</label>\n" +
      `${themeColorPicker(name, value)}\n` +
      "</div>\n";
  }
  return out + "</div>\n</div>\n";
}

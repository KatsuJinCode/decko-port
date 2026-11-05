import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RenderCard, RenderFormat, ViewFn, ViewContext } from "../../render/format.js";
import type {
  DeckoModManifest,
  ModEngineHost,
  ModEventCard,
  ModEventContext,
  ModEventRegistration,
  ModEventStage,
  ModEventTrigger,
  ModSetModuleFile,
  ModViewConfig,
  ModViewDefinition,
} from "../mod-manifest.js";
import type { ModSource } from "../../mod-loader.js";
import type { ParsedNest } from "../../render/nest-syntax.js";
import { DeckoName } from "../../name.js";
import { registerModEventPredicates } from "../default-mod-deck.js";

const SHIM_PATH = fileURLToPath(new URL("./card-set-shim.rb", import.meta.url));

interface RubyVMLike {
  eval(code: string): { toString(): string };
}

interface RubyRegistrations {
  set_path: string;
  views: Array<{ format: string; view: string; config: Record<string, unknown> }>;
  events: Array<{
    event: string;
    at: string | null;
    on: string[] | null;
    changed: string[] | null;
    when: string | null;
  }>;
  accessors: string[];
  setting_opts: Record<string, unknown> | null;
}

type BridgeFrame =
  | { kind: "view"; fmt: RenderFormat }
  | { kind: "event"; card: ModEventCard; ctx: ModEventContext | undefined; setContent: (s: string) => void };

export interface RubyModHandle {
  readonly source: ModSource;
  readonly setFiles: readonly string[];
  readonly missingAbstracts: readonly string[];
  readonly registrations: readonly RubyRegistrations[];
}

let vmPromise: Promise<RubyVMLike> | undefined;

export function rubyVM(): Promise<RubyVMLike> {
  vmPromise ??= (async () => {
    const [{ DefaultRubyVM }, wasmPath] = await Promise.all([
      import("@ruby/wasm-wasi/dist/node"),
      Promise.resolve(
        fileURLToPath(import.meta.resolve("@ruby/3.4-wasm-wasi/dist/ruby+stdlib.wasm")),
      ),
    ]);
    const module = await WebAssembly.compile(readFileSync(wasmPath));
    const { vm } = await DefaultRubyVM(module);
    installBridge();
    vm.eval(readFileSync(SHIM_PATH, "utf8"));
    return vm as unknown as RubyVMLike;
  })();
  return vmPromise;
}

const frames: BridgeFrame[] = [];
let host: ModEngineHost | undefined;

function top(): BridgeFrame {
  const f = frames[frames.length - 1];
  if (f === undefined) throw new Error("ruby mod bridge called outside a Ruby body");
  return f;
}

function renderCardNamed(name: string): RenderCard | undefined {
  if (name === "") {
    const f = top();
    return f.kind === "view" ? f.fmt.card : undefined;
  }
  return host?.fetchRenderCard(name) as RenderCard | undefined;
}

function installBridge(): void {
  (globalThis as Record<string, unknown>).__deckoRubyBridge = {
    renderView(view: string): string {
      const f = top();
      if (f.kind !== "view") throw new Error(`render(${view}) outside a view`);
      const result = f.fmt.renderView(view);
      return result === null ? "" : String(result);
    },
    cardName(): string {
      const f = top();
      return f.kind === "view" ? f.fmt.card.name.s : f.card.name;
    },
    cardKey(name: string): string {
      const f = top();
      if (f.kind === "event" && name === f.card.name) return f.card.key ?? "";
      return renderCardNamed(name === cardNameOfTop() ? "" : name)?.key ?? "";
    },
    typeName(name: string): string {
      return renderCardNamed(name === cardNameOfTop() ? "" : name)?.typeName ?? "";
    },
    cardId(name: string): string {
      const f = top();
      if (f.kind === "event" && name === f.card.name) return f.card.id === undefined ? "" : String(f.card.id);
      const id = renderCardNamed(name === cardNameOfTop() ? "" : name)?.id;
      return id === undefined ? "" : String(id);
    },
    content(name: string): string {
      const f = top();
      if (name === "" && f.kind === "event") return f.ctx?.saveInput?.pendingContent ?? f.card.dbContent ?? "";
      return renderCardNamed(name)?.dbContent ?? "";
    },
    setContent(value: string): void {
      const f = top();
      if (f.kind !== "event") throw new Error("content= outside an event");
      f.setContent(value);
    },
    cardExists(name: string): string {
      const rc = renderCardNamed(name === cardNameOfTop() ? "" : name);
      return rc !== undefined && rc.id !== undefined ? "1" : "";
    },
    nest(name: string, optsJson: string): string {
      const f = top();
      if (f.kind !== "view") throw new Error(`nest(${name}) outside a view`);
      const { view, title, show, hide, size, ...extra } = JSON.parse(optsJson) as Record<string, string>;
      const parsed: ParsedNest = {
        syntax: name,
        name,
        options: { view, title, show, hide, size, extra },
        comment: undefined,
      };
      return f.fmt.nest(parsed);
    },
    linkToCard(name: string, text: string, hasText: string, optsJson: string): string {
      const opts = JSON.parse(optsJson) as Record<string, string>;
      const rc = renderCardNamed(name === cardNameOfTop() ? "" : name);
      const known = rc !== undefined && rc.id !== undefined;
      const cls = [opts.class, known ? "known-card" : "wanted-card"].filter(Boolean).join(" ");
      const parsedName = DeckoName.parse(name);
      const body = hasText === "1" ? text : escapeHtml(parsedName.s);
      return `<a class="${escapeHtml(cls)}" href="/${escapeHtml(parsedName.urlKey)}">${body}</a>`;
    },
    action(): string {
      const f = top();
      return f.kind === "event" ? (f.card.action ?? "") : "";
    },
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cardNameOfTop(): string {
  const f = top();
  return f.kind === "view" ? f.fmt.card.name.s : f.card.name;
}

function rubyString(s: string): string {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function listSetFiles(setDir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(setDir, rel)).sort()) {
    const relPath = rel === "" ? entry : `${rel}/${entry}`;
    if (statSync(path.join(setDir, relPath)).isDirectory()) out.push(...listSetFiles(setDir, relPath));
    else if (entry.endsWith(".rb")) out.push(relPath);
  }
  return out;
}

const STAGES: readonly ModEventStage[] = [
  "initialize", "prepare_to_validate", "validate", "prepare_to_store", "store",
  "finalize", "integrate", "after_integrate", "integrate_with_delay",
];

export async function loadRubyMod(modDir: string, opts: { name?: string } = {}): Promise<RubyModHandle> {
  const vm = await rubyVM();
  const name = opts.name ?? path.basename(modDir);
  const setDir = path.join(modDir, "set");
  const setFiles = listSetFiles(setDir);
  const registrations: RubyRegistrations[] = [];
  const setModules: ModSetModuleFile[] = [];
  const predicates: Record<string, (card: ModEventCard, ctx?: ModEventContext) => boolean> = {};

  for (const rel of setFiles) {
    const source = readFileSync(path.join(setDir, rel), "utf8");
    const index = Number(
      vm.eval(`DeckoRubyMods.load_set_file(${rubyString(rel)}, ${rubyString(source)})`).toString(),
    );
    const reg = JSON.parse(vm.eval(`DeckoRubyMods.registrations(${index})`).toString()) as RubyRegistrations;
    registrations.push(reg);

    const formats: Record<string, { views: ModViewDefinition[] }> = {};
    for (const v of reg.views) {
      const target = v.format === "base" ? "html" : v.format;
      const viewFn: ViewFn = (ctx: ViewContext) => {
        frames.push({ kind: "view", fmt: ctx.fmt });
        try {
          return vm
            .eval(`DeckoRubyMods.render_view(${index}, :${target}, ${rubyString(v.view)})`)
            .toString();
        } finally {
          frames.pop();
        }
      };
      (formats[target] ??= { views: [] }).views.push({
        view: v.view,
        viewFn,
        config: v.config as ModViewConfig,
      });
    }

    const events: ModEventRegistration[] = reg.events.map((e, eventIndex) => {
      const at = (STAGES as readonly string[]).includes(e.at ?? "") ? (e.at as ModEventStage) : undefined;
      let when: string | undefined;
      if (e.when !== null) {
        when = `ruby:${name}:${reg.set_path}:${e.event}`;
        predicates[when] = (card, ctx) => {
          frames.push({ kind: "event", card, ctx, setContent: () => {
            throw new Error(`event ${e.event}: content= inside a when: condition`);
          } });
          try {
            return vm.eval(`DeckoRubyMods.event_condition(${index}, ${eventIndex})`).toString() === "true";
          } finally {
            frames.pop();
          }
        };
      }
      return {
        event: e.event,
        at,
        on: e.on === null ? undefined : (e.on as ModEventTrigger[]),
        changed: e.changed ?? undefined,
        when,
        fn: (card: ModEventCard, _host: ModEngineHost, ctx: ModEventContext) => {
          frames.push({
            kind: "event",
            card,
            ctx,
            setContent: (s) => {
              if (ctx.saveInput === undefined) {
                throw new Error(`event ${e.event}: content= needs a save input on this save path`);
              }
              ctx.saveInput.setContent(s);
            },
          });
          try {
            vm.eval(`DeckoRubyMods.run_event(${index}, ${eventIndex})`);
          } finally {
            frames.pop();
          }
        },
      };
    });

    if (reg.set_path.startsWith("abstract/")) continue;
    const so = reg.setting_opts;
    setModules.push({
      setPath: reg.set_path,
      settingOpts:
        so === null
          ? undefined
          : {
              group: so.group as string | undefined,
              position: so.position as number | undefined,
              ruleTypeEditable: so.rule_type_editable as boolean | undefined,
              shortHelpText: so.short_help_text as string | undefined,
              helpText: so.help_text as string | undefined,
              restrictedToType: so.restricted_to_type as string[] | undefined,
              preference: so.preference as boolean | undefined,
            },
      formats: Object.keys(formats).length > 0 ? formats : undefined,
      events: events.length > 0 ? events : undefined,
    });
  }

  registerModEventPredicates(predicates);

  const manifest: DeckoModManifest = {
    name,
    setModules,
    prepareEngine: async (h) => {
      host = h;
    },
  };
  const missingAbstracts = JSON.parse(
    vm.eval("DeckoRubyMods.missing_abstracts.to_json_for_bridge").toString(),
  ) as string[];
  return { source: { manifest, group: "custom" }, setFiles, registrations, missingAbstracts };
}

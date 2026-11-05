import { setModuleShortname } from "./mod-registrar.js";
import type { ModSetModuleFile } from "./mod-manifest.js";

type StaticIncludes = (owner: string, format: string) => readonly string[];

export class DynamicSetFormatIncludes {
  private readonly buckets = new Map<string, Map<string, string[]>>();
  private readonly modules = new Map<string, string>();
  private readonly edges = new Map<string, Map<string, string[]>>();

  register(file: ModSetModuleFile, anchorParts: number): void {
    const owner = setModuleShortname(file.setPath);
    const parts = file.setPath.split("/");
    const bucket = setModuleShortname(parts[0] === "self" ? file.setPath
      : parts.slice(0, 1 + anchorParts).join("/"));
    this.modules.set(owner, bucket);
    let formats = this.buckets.get(bucket);
    if (formats === undefined) this.buckets.set(bucket, formats = new Map());
    const recordFormat = (format: string) => {
      let list = formats!.get(format);
      if (list === undefined) formats!.set(format, list = []);
      if (!list.includes(owner)) list.push(owner);
    };
    for (const format of Object.keys(file.formats ?? {})) recordFormat(format);
    for (const inclusion of file.includeSetFormats ?? []) {
      const target = setModuleShortname(inclusion.setPath);
      const targetBucket = this.modules.get(target) ?? (this.buckets.has(target) ? target : undefined);
      if (targetBucket === undefined) {
        const error = new Error(`Set format include target has not loaded: ${inclusion.setPath}`);
        error.name = "UnknownSetFormatIncludeTargetError";
        throw error;
      }
      const targets = [...this.buckets.get(targetBucket)!].map(([format, modules]) => [format, [...modules]] as const);
      for (const [format, modules] of targets) {
        const except = typeof inclusion.except === "string" ? [inclusion.except] : inclusion.except;
        const only = typeof inclusion.only === "string" ? [inclusion.only] : inclusion.only;
        if (except?.includes(format) || (only !== undefined && !only.includes(format))) continue;
        let byFormat = this.edges.get(owner);
        if (byFormat === undefined) this.edges.set(owner, byFormat = new Map());
        let list = byFormat.get(format);
        if (list === undefined) byFormat.set(format, list = []);
        for (const module of modules) if (!list.includes(module)) list.push(module);
        recordFormat(format);
        this.lineage(owner, format, () => []);
      }
    }
  }

  ownersFor(candidate: string): readonly string[] {
    return [...this.edges.keys()].filter(owner => owner === candidate || owner.startsWith(`${candidate}::`));
  }

  included(owner: string, format: string, stock: StaticIncludes): readonly string[] {
    return this.lineage(owner, format, stock).slice(1);
  }

  private lineage(owner: string, format: string, stock: StaticIncludes, active = new Set<string>()): string[] {
    if (active.has(owner)) {
      const error = new Error(`Cyclic set format inclusion at ${owner} (${format})`);
      error.name = "CyclicSetFormatIncludeError";
      throw error;
    }
    const nextActive = new Set(active).add(owner);
    const chain = [owner];
    const targets = [...stock(owner, format)].reverse();
    targets.push(...this.edges.get(owner)?.get(format) ?? []);
    for (const target of targets) {
      const ancestors = this.lineage(target, format, stock, nextActive);
      let cursor = 1;
      for (const ancestor of ancestors) {
        const existing = chain.indexOf(ancestor);
        if (existing === -1) chain.splice(cursor++, 0, ancestor);
        else if (existing >= cursor) cursor = existing + 1;
      }
    }
    return chain;
  }

  clear(): void {
    this.buckets.clear(); this.modules.clear(); this.edges.clear();
  }
}

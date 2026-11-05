import { setModuleShortname } from "./mod-registrar.js";
import type { ModSetModuleFile } from "./mod-manifest.js";

export class DynamicCardIncludes {
  private readonly modules = new Map<string, { path: string; bucket: string }>();
  private readonly buckets = new Map<string, string[]>();
  private readonly active = new Set<string>();
  private readonly edges = new Map<string, string[]>();

  register(file: ModSetModuleFile, anchorParts: number): void {
    const owner = setModuleShortname(file.setPath);
    const parts = file.setPath.split("/");
    const bucket = setModuleShortname(parts[0] === "self" ? file.setPath : parts.slice(0, 1 + anchorParts).join("/"));
    if (!this.modules.has(owner)) this.modules.set(owner, { path: file.setPath, bucket });
    let members = this.buckets.get(bucket);
    if (members === undefined) this.buckets.set(bucket, members = []);
    if (!members.includes(owner)) members.push(owner);
    for (const inclusion of file.includeSets ?? []) {
      const target = setModuleShortname(inclusion.setPath);
      const targetBucket = this.modules.get(target)?.bucket ?? (this.buckets.has(target) ? target : undefined);
      if (targetBucket === undefined) {
        const error = new Error(`Set include target has not loaded: ${inclusion.setPath}`);
        error.name = "UnknownSetIncludeTargetError";
        throw error;
      }
      let includes = this.edges.get(owner);
      if (includes === undefined) this.edges.set(owner, includes = []);
      for (const module of [...this.buckets.get(targetBucket)!]) {
        if (this.active.has(module) && !includes.includes(module)) includes.push(module);
      }
      if (includes.length) this.active.add(owner);
      this.lineage(owner);
    }
    if (file.events?.length) this.active.add(owner);
  }

  ancestries(): Readonly<Record<string, readonly string[]>> | undefined {
    if (![...this.edges.values()].some(paths => paths.length)) return undefined;
    return Object.fromEntries([...this.edges].filter(([, paths]) => paths.length).map(([owner]) => [
      this.modules.get(owner)!.path,
      this.lineage(owner).slice(1).map(module => this.modules.get(module)!.path),
    ]));
  }

  private lineage(owner: string, active = new Set<string>()): string[] {
    if (active.has(owner)) {
      const error = new Error(`Cyclic card set inclusion at ${owner}`);
      error.name = "CyclicCardSetIncludeError";
      throw error;
    }
    const stack = new Set(active).add(owner);
    const chain = [owner];
    for (const target of this.edges.get(owner) ?? []) {
      let cursor = 1;
      for (const ancestor of this.lineage(target, stack)) {
        const existing = chain.indexOf(ancestor);
        if (existing === -1) chain.splice(cursor++, 0, ancestor);
        else if (existing >= cursor) cursor = existing + 1;
      }
    }
    return chain;
  }

  clear(): void { this.modules.clear(); this.buckets.clear(); this.active.clear(); this.edges.clear(); }
}

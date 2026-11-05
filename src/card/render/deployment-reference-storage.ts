export interface ReadOnlyReferenceStorage {
  readonly origin: string;
  readonly filenamePolicy: "stored-leaf";
  readonly readOnly: true;
}

export class DeploymentReferenceStorageError extends Error {
  constructor(message: string) { super(message); this.name = "DeploymentReferenceStorageError"; }
}

type ReferenceStorageMap = Readonly<Record<string, ReadOnlyReferenceStorage>>;
let configured: ReferenceStorageMap = Object.freeze(Object.create(null));

export function validateDeploymentReferenceStorage(value: unknown): ReferenceStorageMap {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new DeploymentReferenceStorageError("referenceStorage must be a bucket map");
  const output: Record<string, ReadOnlyReferenceStorage> = Object.create(null);
  for (const [bucket, raw] of Object.entries(value)) {
    if (!/^[A-Za-z0-9_-]+$/.test(bucket) || ["__proto__", "constructor", "prototype"].includes(bucket)) throw new DeploymentReferenceStorageError("invalid reference bucket name");
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new DeploymentReferenceStorageError("reference bucket must be an object");
    const entry = raw as Record<string, unknown>;
    if (Object.keys(entry).some(key => !["origin", "filenamePolicy", "readOnly"].includes(key))) throw new DeploymentReferenceStorageError("unknown reference storage field");
    if (entry.filenamePolicy !== "stored-leaf" || entry.readOnly !== true || typeof entry.origin !== "string") throw new DeploymentReferenceStorageError("reference storage requires stored-leaf policy, readOnly true and an origin");
    let origin: URL;
    try { origin = new URL(entry.origin); } catch { throw new DeploymentReferenceStorageError("invalid reference storage origin"); }
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new DeploymentReferenceStorageError("reference storage origin must be an HTTPS origin without credentials, path or query");
    output[bucket] = Object.freeze({ origin: origin.origin, filenamePolicy: "stored-leaf", readOnly: true });
  }
  return Object.freeze(output);
}

export function configureDeploymentReferenceStorage(value: unknown | undefined): void {
  const next = value === undefined ? Object.freeze(Object.create(null)) : validateDeploymentReferenceStorage(value);
  configured = next;
}

export function deploymentReferenceAttachmentSource(content: string, assetHost: string | undefined, variant?: string): string | undefined {
  const prefix = /^\(([^)]*)\)\//.exec(content);
  const entry = prefix === null ? undefined : configured[prefix[1]];
  if (!entry) return undefined;
  if (assetHost !== undefined) {
    let caller: URL;
    try { caller = new URL(assetHost); } catch { return undefined; }
    if (caller.origin !== entry.origin || caller.pathname !== "/" || caller.username || caller.password || caller.search || caller.hash) return undefined;
  }
  const match = /^\([A-Za-z0-9_-]+\)\/([0-9]+)\/([A-Za-z0-9_.-]+)$/.exec(content);
  if (!match || match[2] === "." || match[2] === "..") throw new DeploymentReferenceStorageError("reference attachment path is unsupported");
  if (variant !== undefined && !/^[A-Za-z0-9_-]+$/.test(variant)) throw new DeploymentReferenceStorageError("reference attachment variant is unsupported");
  const dot = match[2].lastIndexOf(".");
  if (dot <= 0 || dot === match[2].length - 1) return "";
  const filename = variant === undefined ? match[2] : `${match[2].slice(0, dot)}-${variant}${match[2].slice(dot)}`;
  return `${entry.origin}/files/${match[1]}/${filename}`;
}

export class DeploymentDeckOriginError extends Error {
  constructor() {
    super("Invalid DECKO_DECK_ORIGIN: expected an absolute HTTP(S) origin without credentials, path, query or fragment");
    this.name = "DeploymentDeckOriginError";
  }
}

export function validateDeploymentDeckOrigin(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || /[\s\\"'<>`]/.test(value)
    || !/^https?:\/\/[^/?#@]+\/?$/i.test(value)) {
    throw new DeploymentDeckOriginError();
  }
  let url: URL;
  try { url = new URL(value); }
  catch { throw new DeploymentDeckOriginError(); }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash
    || /[\s\\"'<>`]/.test(url.origin)) {
    throw new DeploymentDeckOriginError();
  }
  return url.origin;
}

export interface DeploymentFollowLiveConfig {
  serializerEra?: "live";
  scriptIntegrityBySrc?: Readonly<Record<string, string>>;
  mainStylesheetRevisionDigits?: string;
  footerDeckoVersion?: string;
  recaptchaSiteKey?: string;
  deckoRootUrl?: string;
  defaultHtmlViewNest?: string;
}

let config: DeploymentFollowLiveConfig | undefined;

export const LIVE_DEPLOYMENT_CONSTANTS: Omit<DeploymentFollowLiveConfig, "serializerEra"> = {
  scriptIntegrityBySrc: {
    "https://code.jquery.com/jquery-3.5.1.min.js":
      "sha256-9/aliU8dGd2tb6OSsuzixeV4y/faTqgFtohetphbbj0=",
    "https://cdnjs.cloudflare.com/ajax/libs/jquery-ujs/1.2.3/rails.min.js":
      "sha512-yDJWVxuRSkQa1u9/Zif6Gh93Gk0Urboz98JLEPcERMQ+pTHz/c27d0Xz08G+lgutFyKklB9UILtnhG6bth6B4A==",
    "https://cdnjs.cloudflare.com/ajax/libs/ace/1.18.0/ace.min.js":
      "sha512-xcE2qpHHeRGdUixQ0W0CRrb5RcfFLPol+7Kbix/fxXMnB+Dg4ECW3pldd3gY3bOOqcKQ3wv4IHJKUbSlgn83Qw==",
    "https://cdnjs.cloudflare.com/ajax/libs/select2/4.0.6-rc.1/js/select2.full.min.js":
      "sha512-Y4+u+T/6DpDb2AkTrxs3eJiN9o/u+l8pLNt0lSRKnJe2wIDVCwd7N8afy+70Pmr5FtmoX5IXmwK6H7Jlb8Nx8A==",
  },
  mainStylesheetRevisionDigits: "0000000001",
  footerDeckoVersion: "0.0.0-synthetic",
  recaptchaSiteKey: "6LSYNTHETICLIVEKEY00000000000000000000AA",
  deckoRootUrl: "https://example.org/",
  defaultHtmlViewNest: "content",
};

const {
  defaultHtmlViewNest: _excludedDefaultHtmlViewNest,
  ...viewInertConstants
} = LIVE_DEPLOYMENT_CONSTANTS;

export const VIEW_INERT_DEPLOYMENT_CONSTANTS: Omit<
  DeploymentFollowLiveConfig,
  "serializerEra" | "defaultHtmlViewNest"
> = viewInertConstants;

export function setDeploymentFollowLiveConfig(
  next: DeploymentFollowLiveConfig | undefined,
): void {
  config = next;
}

export function getDeploymentFollowLiveConfig(): DeploymentFollowLiveConfig | undefined {
  return config;
}

export function validateDeploymentSerializerEra(value: unknown): "stock" | "live" | undefined {
  if (value === undefined || value === "stock" || value === "live") return value;
  throw new Error("Invalid serializer era: expected stock or live");
}

export function configureDeploymentSerializerEra(value: unknown): void {
  const era = validateDeploymentSerializerEra(value);
  if (era === undefined) return;
  setDeploymentFollowLiveConfig({...config, serializerEra: era === "live" ? "live" : undefined});
}

export function serializerFollowsLive(): boolean {
  return config?.serializerEra === "live";
}

export function scriptIntegrityFor(src: string): string | undefined {
  return config?.scriptIntegrityBySrc?.[src];
}

export function mainStylesheetRevisionDigits(): string | undefined {
  return config?.mainStylesheetRevisionDigits;
}

export function footerDeckoVersion(): string | undefined {
  return config?.footerDeckoVersion;
}

export function recaptchaSiteKey(): string | undefined {
  return config?.recaptchaSiteKey;
}

export function deckoRootUrl(): string | undefined {
  return config?.deckoRootUrl;
}

export function deploymentDefaultHtmlViewNest(): string | undefined {
  return config?.defaultHtmlViewNest;
}

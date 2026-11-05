import { configureDeploymentReferenceStorage, validateDeploymentReferenceStorage } from "../card/render/deployment-reference-storage.js";
import { recaptchaConfigFromHostEnv } from "./staging-server-recaptcha-env-config.js";

export class DeploymentMigrationConfigError extends Error {
  constructor(message: string) { super(message); this.name = "DeploymentMigrationConfigError"; }
}

type Environment = Record<string, string | undefined>;
export const MIGRATION_HOST_ALIAS_TARGETS = Object.freeze([
  "DECKO_ORIGIN", "DECKO_TOKEN_SECRET", "DECKO_DECK_PROFILE", "DECKO_MOD_PUBLIC_DIR",
  "COMPILED_ASSETS_DIR", "DECKO_FILES_DIR", "DECKO_SASSC", "DECKO_COMPRESS_ASSETS",
  "DECKO_ASSET_REFRESH", "DECKO_MAIL_CAPTURE", "DECKO_FONT_AWESOME",
  "DECKO_MATERIAL_ICONS", "DECKO_DELAYING", "HOSTNAME", "DECKO_SHADOW_VIEW_LANE",
  "DECKO_RECAPTCHA_SITE_KEY", "DECKO_RECAPTCHA_SECRET_KEY",
  "DECKO_RECAPTCHA_MINIMUM_SCORE", "DECKO_RECAPTCHA_VERIFY_URL",
] as const);
export interface PreparedDeploymentMigration {
  readonly environment: Environment;
  readonly configured: boolean;
  readonly antiSpamDisabled: boolean;
}

function environmentName(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(value)) throw new DeploymentMigrationConfigError("invalid environment variable name");
  return value;
}

function names(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new DeploymentMigrationConfigError(`${field} must be a list`);
  return [...new Set(value.map(environmentName))];
}

export function prepareDeploymentMigration(environment: Environment): PreparedDeploymentMigration {
  const raw = environment.DECKO_MIGRATION_CONFIG;
  if (raw === undefined) {
    configureDeploymentReferenceStorage(undefined);
    return { environment, configured: false, antiSpamDisabled: false };
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new DeploymentMigrationConfigError("DECKO_MIGRATION_CONFIG must be valid JSON"); }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new DeploymentMigrationConfigError("migration configuration must be an object");
  const config = parsed as Record<string, unknown>;
  if (config.version !== 1) throw new DeploymentMigrationConfigError("unsupported migration configuration version");
  if (Object.keys(config).some(key => !["version", "referenceStorage", "environmentAliases", "requiredEnvironment", "publicUrlEnvironment", "antiSpam"].includes(key))) throw new DeploymentMigrationConfigError("unknown migration configuration field");
  const referenceStorage = validateDeploymentReferenceStorage(config.referenceStorage === undefined ? {} : config.referenceStorage);
  const next = { ...environment };
  if (config.environmentAliases !== undefined) {
    if (!Array.isArray(config.environmentAliases)) throw new DeploymentMigrationConfigError("environmentAliases must be a list");
    const targets = new Set<string>();
    for (const rawAlias of config.environmentAliases) {
      if (rawAlias === null || typeof rawAlias !== "object" || Array.isArray(rawAlias)) throw new DeploymentMigrationConfigError("environment alias must be an object");
      const alias = rawAlias as Record<string, unknown>;
      if (Object.keys(alias).some(key => !["source", "target"].includes(key))) throw new DeploymentMigrationConfigError("unknown environment alias field");
      const source = environmentName(alias.source), target = environmentName(alias.target);
      if (target.startsWith("DECKO_") && !(MIGRATION_HOST_ALIAS_TARGETS as readonly string[]).includes(target)) throw new DeploymentMigrationConfigError(`unsupported host environment alias target: ${target}`);
      if (targets.has(target)) throw new DeploymentMigrationConfigError(`duplicate environment alias target: ${target}`);
      targets.add(target);
      const sourceValue = environment[source], targetValue = environment[target];
      if (sourceValue?.trim() && targetValue?.trim() && sourceValue !== targetValue) throw new DeploymentMigrationConfigError(`conflicting environment values: ${source} and ${target}`);
      if (!targetValue?.trim() && sourceValue !== undefined) next[target] = sourceValue;
    }
  }
  const required = names(config.requiredEnvironment, "requiredEnvironment");
  if (config.antiSpam !== undefined && config.antiSpam !== "required" && config.antiSpam !== "disabled") throw new DeploymentMigrationConfigError("antiSpam must be required or disabled");
  if (config.antiSpam === "required") required.push("DECKO_RECAPTCHA_SITE_KEY", "DECKO_RECAPTCHA_SECRET_KEY");
  const missing = [...new Set(required)].filter(name => !next[name]?.trim());
  if (missing.length) throw new DeploymentMigrationConfigError(`missing required environment: ${missing.join(", ")}`);
  for (const name of names(config.publicUrlEnvironment, "publicUrlEnvironment")) {
    let url: URL;
    try { url = new URL(next[name] ?? ""); } catch { throw new DeploymentMigrationConfigError(`invalid public URL environment: ${name}`); }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new DeploymentMigrationConfigError(`public URL environment must be HTTPS without credentials or query: ${name}`);
  }
  if (config.antiSpam === "disabled") {
    delete next.DECKO_RECAPTCHA_SITE_KEY;
    delete next.DECKO_RECAPTCHA_SECRET_KEY;
  } else {
    try { recaptchaConfigFromHostEnv(next); }
    catch { throw new DeploymentMigrationConfigError("invalid anti-spam environment configuration"); }
  }
  configureDeploymentReferenceStorage(referenceStorage);
  return { environment: next, configured: true, antiSpamDisabled: config.antiSpam === "disabled" };
}

export interface StrictParityFlags {
  readonly signinDetailedErrors: boolean;
  readonly revisionRestore500: boolean;
  readonly skinCreate500: boolean;
  readonly scriptBundleClockNames: boolean;
  readonly mailUnfollowRefusal: boolean;
}

export const STRICT_PARITY_ENV_NAMES = {
  signinDetailedErrors: "DECKO_STRICT_PARITY_SIGNIN_DETAILED_ERRORS",
  revisionRestore500: "DECKO_STRICT_PARITY_REVISION_RESTORE_500",
  skinCreate500: "DECKO_STRICT_PARITY_SKIN_CREATE_500",
  scriptBundleClockNames: "DECKO_STRICT_PARITY_SCRIPT_BUNDLE_CLOCK_NAMES",
  mailUnfollowRefusal: "DECKO_STRICT_PARITY_MAIL_UNFOLLOW_REFUSAL",
} as const;

export type StrictParityEnv = Partial<Record<(typeof STRICT_PARITY_ENV_NAMES)[keyof typeof STRICT_PARITY_ENV_NAMES], unknown>>;

function readSwitch(raw: unknown, name: string, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  if (typeof raw !== "string") throw new Error(`${name} must be "on" or "off", got ${typeof raw}`);
  const value = raw.trim().toLowerCase();
  if (value === "") return fallback;
  if (value === "off") return false;
  if (value === "on") return true;
  throw new Error(`${name} must be "on" or "off", got ${JSON.stringify(raw)}`);
}

export function strictParityFlagsFromEnv(env: StrictParityEnv | undefined): StrictParityFlags {
  return {
    signinDetailedErrors: readSwitch(env?.[STRICT_PARITY_ENV_NAMES.signinDetailedErrors], STRICT_PARITY_ENV_NAMES.signinDetailedErrors, false),
    revisionRestore500: readSwitch(env?.[STRICT_PARITY_ENV_NAMES.revisionRestore500], STRICT_PARITY_ENV_NAMES.revisionRestore500, false),
    skinCreate500: readSwitch(env?.[STRICT_PARITY_ENV_NAMES.skinCreate500], STRICT_PARITY_ENV_NAMES.skinCreate500, false),
    scriptBundleClockNames: readSwitch(env?.[STRICT_PARITY_ENV_NAMES.scriptBundleClockNames], STRICT_PARITY_ENV_NAMES.scriptBundleClockNames, false),
    mailUnfollowRefusal: readSwitch(env?.[STRICT_PARITY_ENV_NAMES.mailUnfollowRefusal], STRICT_PARITY_ENV_NAMES.mailUnfollowRefusal, true),
  };
}

let configured: StrictParityFlags | undefined;

export function configureStrictParity(flags: StrictParityFlags | undefined): void {
  configured = flags;
}

function processEnv(): StrictParityEnv | undefined {
  const proc = (globalThis as { process?: { env?: StrictParityEnv } }).process;
  return proc?.env;
}

export function strictParityFlags(): StrictParityFlags {
  return configured ?? strictParityFlagsFromEnv(processEnv());
}

export class StrictParityCrashError extends Error {
  readonly flag: string;

  constructor(flag: string, message: string) {
    super(message);
    this.name = "StrictParityCrashError";
    this.flag = flag;
  }
}

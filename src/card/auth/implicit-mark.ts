import type { SQLDatabaseDriver } from "../../server/driver.js";
import type { FetchEngine } from "../fetch.js";
import { setupCensus, type SetupWindowDeps } from "./first-run-setup.js";
import { setPreparedSetupVerdict } from "./first-run-setup-verdict-seam.js";

export const SETUP_VIEW = "setup";

export const DEFAULT_ACCOUNTED_TYPE_NAME = "User";

export interface PreparedSetupCard {
  readonly card: { readonly type_id: number };
  readonly view: typeof SETUP_VIEW;
}

export function initialSetupArming(input: {
  readonly needsSetup: boolean;
  readonly html: boolean;
}): boolean {
  return input.needsSetup && input.html;
}

export function prepareSetupCard(typeId: number): PreparedSetupCard {
  return { card: { type_id: typeId }, view: SETUP_VIEW };
}

export function implicitSetupArming(input: {
  readonly needsSetup: boolean;
  readonly html: boolean;
  readonly typeId: number | undefined;
}): PreparedSetupCard | undefined {
  if (!initialSetupArming(input)) return undefined;
  if (input.typeId === undefined) return undefined;
  return prepareSetupCard(input.typeId);
}

export async function defaultAccountedTypeId(
  fetcher: Pick<FetchEngine, "fetchByName">,
): Promise<number | undefined> {
  const card = await fetcher.fetchByName(DEFAULT_ACCOUNTED_TYPE_NAME);
  return card?.id;
}

export interface SetupArmingDeps extends SetupWindowDeps {
  readonly driver: SQLDatabaseDriver;
  readonly fetcher: Pick<FetchEngine, "fetchByName">;
}

export interface SetupArmingGates {
  readonly firstRunEnabled: boolean;
  readonly writePathEnabled: boolean;
}

export interface SetupArmingResult {
  readonly armed: boolean;
  readonly prepared: PreparedSetupCard | undefined;
  readonly censusReason: string;
  readonly accountCount: number | undefined;
}

export const ARMING_DISABLED = "disabled";
export const ARMING_CENSUS_UNCOMPUTABLE = "census_uncomputable";

export async function armSetupCardForRead(
  deps: SetupArmingDeps,
  input: { readonly html: boolean; readonly gates: SetupArmingGates },
): Promise<SetupArmingResult> {
  if (!input.gates.firstRunEnabled) {
    return {
      armed: false,
      prepared: undefined,
      censusReason: ARMING_DISABLED,
      accountCount: undefined,
    };
  }
  if (!input.gates.writePathEnabled) {
    return {
      armed: false,
      prepared: undefined,
      censusReason: ARMING_DISABLED,
      accountCount: undefined,
    };
  }
  const census = await setupCensus(deps);
  if (census.reason === "needs_setup") {
    setPreparedSetupVerdict({ open: true, accountCount: census.accountCount });
  } else if (census.reason === "setup_complete") {
    setPreparedSetupVerdict({ open: false, accountCount: census.accountCount });
  } else {
    return {
      armed: false,
      prepared: undefined,
      censusReason: ARMING_CENSUS_UNCOMPUTABLE,
      accountCount: census.accountCount,
    };
  }
  if (!census.open) {
    return {
      armed: false,
      prepared: undefined,
      censusReason: census.reason,
      accountCount: census.accountCount,
    };
  }
  const typeId = await defaultAccountedTypeId(deps.fetcher);
  const prepared = implicitSetupArming({
    needsSetup: census.open,
    html: input.html,
    typeId,
  });
  return {
    armed: prepared !== undefined,
    prepared,
    censusReason: census.reason,
    accountCount: census.accountCount,
  };
}

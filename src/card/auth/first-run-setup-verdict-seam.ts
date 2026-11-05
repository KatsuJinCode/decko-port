export interface PreparedSetupVerdict {
  readonly open: boolean;
  readonly accountCount?: number;
}

let prepared: PreparedSetupVerdict | undefined;

export function setPreparedSetupVerdict(verdict: PreparedSetupVerdict): void {
  prepared = verdict;
}

export function preparedSetupVerdict(): PreparedSetupVerdict | undefined {
  return prepared;
}

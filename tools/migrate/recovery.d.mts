export interface RecoveryPaths { databasePath: string; filesPath: string }
export function createRecoverySnapshot(options: RecoveryPaths & { snapshotDir: string }): Promise<{ version: number; databaseSha256: string; files: { path: string; directory: boolean; sha256?: string }[] }>;
export function restoreRecoverySnapshot(options: { snapshotDir: string; targetDir: string }): Promise<RecoveryPaths>;

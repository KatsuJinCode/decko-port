export interface ServerErrorArm {
  readonly status: 900 | 500;
  readonly view: "debug_server_error" | "server_error";
}

export const DEBUGGER_OFF_ARM: ServerErrorArm = { status: 500, view: "server_error" };

export const DEBUGGER_ON_ARM: ServerErrorArm = { status: 900, view: "debug_server_error" };

export interface DebuggerCardReader {
  hasDebuggerCodename(): boolean;
  debuggerCardContent(): Promise<string | undefined>;
}

export async function serverErrorArm(reader: DebuggerCardReader): Promise<ServerErrorArm> {
  if (!reader.hasDebuggerCodename()) return DEBUGGER_OFF_ARM;
  let content: string | undefined;
  try {
    content = await reader.debuggerCardContent();
  } catch {
    return DEBUGGER_OFF_ARM;
  }
  if (content === undefined || !/on/.test(content)) return DEBUGGER_OFF_ARM;
  return DEBUGGER_ON_ARM;
}

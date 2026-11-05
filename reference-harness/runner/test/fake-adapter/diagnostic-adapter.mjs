import { createInterface } from "node:readline";
import { stdoutDiagnostic, stderrDiagnostic, shutdownDiagnostic } from "./diagnostic-payload.mjs";

const emit = message => process.stdout.write(JSON.stringify(message) + "\n");
const write = (stream, bytes) => new Promise((resolve, reject) => stream.write(bytes, error => error ? reject(error) : resolve()));
async function diagnostics() {
  const split = stderrDiagnostic.indexOf(Buffer.from("🚀")) + 2;
  await write(process.stderr, stderrDiagnostic.subarray(0, split));
  await new Promise(resolve => setImmediate(resolve));
  await write(process.stderr, stderrDiagnostic.subarray(split));
  const stdout = Buffer.from(stdoutDiagnostic);
  const stdoutSplit = stdout.indexOf(Buffer.from("🚀")) + 2;
  await write(process.stdout, stdout.subarray(0, stdoutSplit));
  await new Promise(resolve => setImmediate(resolve));
  await write(process.stdout, stdout.subarray(stdoutSplit));
}

if (process.env.DIAGNOSTIC_MODE === "before-ready") {
  await diagnostics();
  process.exitCode = 17;
} else {
  emit({ ready: true, protocol: 1, engine: "owned-diagnostic-fixture", version: { fixture: 1 } });
  for await (const line of createInterface({ input: process.stdin })) {
    const request = JSON.parse(line);
    if (request.op === "quit") {
      await write(process.stderr, shutdownDiagnostic);
      break;
    }
    await diagnostics();
    if (process.env.DIAGNOSTIC_MODE === "hold") continue;
    if (process.env.DIAGNOSTIC_MODE === "request-exit") { process.exitCode = 23; break; }
    if (process.env.DIAGNOSTIC_MODE === "answer-error") {
      emit({ id: request.id, ok: false, error: { class: "NativeFixtureError", message: "native answer preserved" } });
    } else emit({ id: request.id, ok: true, result: { value: request.value } });
  }
  process.stdin.destroy();
}

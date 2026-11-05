import { appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { threadId } from "node:worker_threads";
export const transformWitnessEnabled = () => Boolean(process.env.DECKO_ADAPTER_TRANSFORM_AUDIT);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
export function witnessTransform({ url, source, returned, transformed, cache, error, transformer }) {
  if (!transformWitnessEnabled()) return;
  const counters = globalThis[Symbol.for("decko.adapter.source.worker.capture")];
  if (counters) Atomics.add(counters, 3, 1);
  const input = Buffer.from(source), output = Buffer.from(returned);
  const record = { format: "decko-typescript-transform/1", pid: process.pid, thread_id: threadId,
    url, input_bytes: input.length, input_sha256: digest(input),
    input_oid: createHash("sha1").update(`blob ${input.length}\0`).update(input).digest("hex"),
    output_sha256: digest(output), verified_output_sha256: transformed === undefined ? null : digest(Buffer.from(transformed)),
    transformer_function_sha256: digest(Function.prototype.toString.call(transformer)),
    cache, verification_error: error?.message ?? null };
  try {
    appendFileSync(process.env.DECKO_ADAPTER_TRANSFORM_AUDIT, JSON.stringify(record) + "\n");
    if (counters) Atomics.add(counters, 4, 1);
  } catch (failure) {
    if (counters) Atomics.add(counters, 2, 1);
    process.stderr.write(`TypeScript transform witness could not save: ${failure.message}\n`);
  }
}

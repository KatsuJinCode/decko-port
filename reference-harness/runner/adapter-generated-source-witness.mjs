import { createHash } from "node:crypto";
import path from "node:path";
import { bindGeneratedRuntime, generatedProducerDefinition } from "./adapter-generated-runtime-bindings.mjs";

export async function observeGeneratedSources(audit, { canonical = false } = {}) {
  const state = audit.generated_observer = { format: "decko-v8-source-observer/1", active: false, closed: false, pending: 0, events_observed: 0, bound_events: 0, unbound_events: 0, producers_observed: 0, errors: [] };
  audit.generated_sources = [];
  audit.generated_producers = [];
  let session;
  const failure = error => {
    state.errors.push({ name: error.name, code: error.code ?? null, message: error.message });
    audit.problems.push(`Generated source observation failed: ${error.message}`);
  };
  try {
    const { Session, url: inspectorUrl } = await import("node:inspector");
    session = new Session();
    session.connect();
    state.transport = "in-process Inspector Session; no listener opened by this observer";
    state.existing_listener_url = inspectorUrl() ?? null;
    const receive = event => ({ params }) => {
      if (!state.active) return;
      try {
        const url = params.url ?? "";
        const producer = canonical && !params.hasSourceURL && generatedProducerDefinition(url);
        if (!producer && !params.hasSourceURL && (url.startsWith("node:") || url.startsWith("file:") || path.isAbsolute(url))) return;
        const record = { event, metadata: params };
        if (producer) { audit.generated_producers.push(record); state.producers_observed++; }
        else { audit.generated_sources.push(record); state.events_observed++; }
        state.pending++;
        try {
          session.post("Debugger.getScriptSource", { scriptId: params.scriptId }, (error, result) => {
            try {
              if (error) { record.observation_error = error.message; failure(error); }
              else {
                record.source = result.scriptSource;
                if (result.bytecode !== undefined) record.bytecode = result.bytecode;
                const bytes = result.bytecode === undefined ? Buffer.from(result.scriptSource ?? "") : Buffer.from(result.bytecode, "base64");
                record.encoding = result.bytecode === undefined ? "UTF-8 serialization; original V8 JavaScript source string retained" : "V8 binary bytecode decoded from base64";
                record.bytes = bytes.length;
                record.sha256 = createHash("sha256").update(bytes).digest("hex");
              }
            } catch (error) { failure(error); }
            finally { state.pending--; }
          });
        } catch (error) { state.pending--; failure(error); }
      } catch (error) { failure(error); }
    };
    session.on("Debugger.scriptParsed", receive("Debugger.scriptParsed"));
    session.on("Debugger.scriptFailedToParse", receive("Debugger.scriptFailedToParse"));
    const post = (method, params = {}) => new Promise((resolve, reject) => session.post(method, params, (error, result) => error ? reject(error) : resolve(result)));
    await post("Debugger.enable");
    await post("Debugger.setSkipAllPauses", { skip: true });
    state.active = true;
  } catch (error) {
    failure(error);
    try { session?.disconnect(); } catch (error) { failure(error); }
  }
  return { finish() {
    if (state.pending !== 0) audit.problems.push("Generated-source requests remained pending at adapter exit");
    try { session?.disconnect(); } catch (error) { failure(error); }
    for (const record of audit.generated_sources) {
      const producer = audit.generated_producers.find(value => value.metadata.scriptId === record.metadata.stackTrace?.callFrames?.[0]?.scriptId);
      const binding = canonical ? bindGeneratedRuntime(record, producer) : null;
      if (binding) { record.binding = binding; state.bound_events++; }
      else { state.unbound_events++; audit.problems.push(`Unbound generated source compiled by V8: ${record.metadata.url || "(anonymous)"}`); }
    }
    state.closed = true;
  } };
}

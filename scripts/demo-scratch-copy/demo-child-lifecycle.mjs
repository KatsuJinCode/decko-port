// Cooperative control of the exact child handle returned by spawn. IPC uses
// the same mechanism on Windows and Linux; no PID lookup or signal fallback.
export function manageDemoChild(child, {
  owner = process, reportError = error => console.error(`boot-demo-scratch: ${error.message}`),
  onClosed = ({code, signal, failed}) => { process.exitCode = failed || signal ? 1 : code ?? 1; },
} = {}) {
  let requested = false, closed = false, failed = false;
  const report = error => {failed = true; reportError(error);};
  function requestStop() {
    if (closed || child.exitCode !== null || child.signalCode !== null || requested) return false;
    if (!child.connected || typeof child.send !== 'function') {
      report(Error(`child ${child.pid ?? 'not started'} control channel unavailable; child retained`));
      return false;
    }
    requested = true;
    try {
      child.send({type: 'decko-demo-shutdown'}, error => {if (error) report(error);});
    } catch (error) {report(error);}
    return true; // A request, not proof that drain or exit completed.
  }
  const control = message => {if (message?.type === 'decko-demo-shutdown') requestStop();};
  owner.on('SIGINT', requestStop);
  owner.on('SIGTERM', requestStop);
  owner.on('message', control);
  child.on('error', report);
  child.once('close', (code, signal) => {
    closed = true;
    owner.removeListener('SIGINT', requestStop);
    owner.removeListener('SIGTERM', requestStop);
    owner.removeListener('message', control);
    onClosed({code, signal, failed});
  });
  return {requestStop};
}

export function installDemoShutdownReceiver(beginShutdown, owner = process) {
  if (!owner.connected) return () => {};
  const receive = message => {
    if (message?.type === 'decko-demo-shutdown') beginShutdown('demo launcher control');
  };
  owner.on('message', receive);
  return () => owner.removeListener('message', receive);
}

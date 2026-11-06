// Minimal raw CDP client (flattened sessions) using Node's built-in WebSocket.
export async function connect(port) {
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((ok, fail) => {
    ws.onopen = ok;
    ws.onerror = fail;
  });
  let id = 0;
  const pending = new Map();
  const handlers = new Set();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { ok, fail, method } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) fail(new Error(`${method}: ${m.error.message}`));
      else ok(m.result);
    } else if (m.method) {
      for (const h of handlers) h(m);
    }
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((ok, fail) => {
      const mid = ++id;
      pending.set(mid, { ok, fail, method });
      ws.send(JSON.stringify({ id: mid, method, params, sessionId }));
    });
  const on = (fn) => (handlers.add(fn), () => handlers.delete(fn));
  const attach = async (targetId) => {
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const s = (method, params) => send(method, params, sessionId);
    s.id = sessionId;
    s.targetId = targetId;
    s.eval = async (expression, awaitPromise = true) => {
      const r = await s('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };
    return s;
  };
  return { send, on, attach, close: () => ws.close() };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

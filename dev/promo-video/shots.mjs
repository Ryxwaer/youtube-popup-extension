// Captures the poses for the store screenshots from the same headful Brave as
// record.mjs (extension loaded, claude.ai logged in), with the Claude tab zoomed
// so the page reads well at store size. Each pose is a real gesture held still
// (or settled) and grabbed with Page.captureScreenshot.
//
//   node shots.mjs <outdir> <claude chat url> [--port 9333] [--zoom 1.4]
import fs from 'node:fs';
import path from 'node:path';
import { connect, sleep } from './cdp.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const [OUT, CHAT] = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const PORT = Number(opt('--port', 9333));
const ZOOM = Number(opt('--zoom', 1.4));
const VW = Math.round(1194 / ZOOM);
const VH = Math.round(728 / ZOOM);
fs.mkdirSync(OUT, { recursive: true });

const c = await connect(PORT);
const { targetInfos } = await c.send('Target.getTargets');
const pages = targetInfos.filter((t) => t.type === 'page');
const ytT = pages.find((t) => t.url.includes('youtube.com/watch'));
const clT = pages.find((t) => t.url.startsWith('https://claude.ai'));
const yt = await c.attach(ytT.targetId);
const cl = await c.attach(clT.targetId);
const V = `document.querySelector('#movie_player video')`;

await cl('Page.enable');
await cl('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 2, mobile: false, screenWidth: VW, screenHeight: VH });
await cl('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cl('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
await cl('Emulation.setFocusEmulationEnabled', { enabled: true });

// Fresh page (default window position) on the finished chat.
const ctxs = [];
c.on((m) => {
  if (m.sessionId !== cl.id) return;
  if (m.method === 'Runtime.executionContextCreated') ctxs.push(m.params.context);
  if (m.method === 'Runtime.executionContextsCleared') ctxs.length = 0;
});
await cl('Runtime.enable');
await cl('Page.navigate', { url: CHAT });
await sleep(4000);
for (const x of ctxs.filter((x) => x.origin.startsWith('chrome-extension://')).reverse()) {
  const r = await cl('Runtime.evaluate', { contextId: x.id, awaitPromise: true, returnByValue: true,
    expression: `chrome.storage?.local ? chrome.storage.local.remove('pipPosition').then(() => true) : false` }).catch(() => null);
  if (r?.result?.value === true) break;
}
// Show the question and the start of the answer, not the end of the chat.
const toTop = () => cl.eval(`(() => {
  for (const e of document.querySelectorAll('*')) {
    const o = getComputedStyle(e).overflowY;
    if ((o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight + 40) e.scrollTop = 0;
  }
})()`);

async function playFrom(t) {
  await yt.eval(`(() => { const v = ${V}; v.currentTime = ${t}; v.play(); })()`);
}

// Watch it on YouTube first (the extension only floats a video you watched),
// then switch to Claude.
await c.send('Target.activateTarget', { targetId: ytT.targetId });
await playFrom(30.3);
await sleep(1800);
await c.send('Target.activateTarget', { targetId: clT.targetId });
await sleep(1800);
await toTop();
await sleep(400);

await cl('DOM.enable');
let pipNode = null;
async function pip() {
  for (let i = 0; i < 2; i++) {
    if (!pipNode) {
      const { root } = await cl('DOM.getDocument', { depth: -1, pierce: true });
      const walk = (n) => {
        if (n.attributes) for (let j = 0; j < n.attributes.length; j += 2) if (n.attributes[j] === 'class' && /(^|\s)pip(\s|$)/.test(n.attributes[j + 1])) return n;
        for (const ch of [...(n.children || []), ...(n.shadowRoots || [])]) {
          const f = walk(ch);
          if (f) return f;
        }
        return null;
      };
      pipNode = walk(root)?.nodeId ?? null;
    }
    try {
      const q = (await cl('DOM.getBoxModel', { nodeId: pipNode })).model.border;
      const x = Math.min(q[0], q[6]);
      const y = Math.min(q[1], q[3]);
      const w = Math.max(q[2], q[4]) - x;
      const h = Math.max(q[5], q[7]) - y;
      return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
    } catch {
      pipNode = null;
    }
  }
  throw new Error('floating window not found');
}
const touch = (type, pts) =>
  cl('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i, radiusX: 11, radiusY: 11, force: 1 })) });
async function moveTo(from, to, ms) {
  const t0 = performance.now();
  for (;;) {
    const u = Math.min(1, (performance.now() - t0) / ms);
    const k = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
    await touch('touchMove', [{ x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k }]);
    if (u >= 1) return;
    await sleep(10);
  }
}
const shots = [];
async function shot(name, touches = []) {
  const { data } = await cl('Page.captureScreenshot', { format: 'png' });
  const file = path.join(OUT, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  const title = await cl.eval(`document.title`);
  shots.push({ name, file, touches, title, url: await cl.eval(`location.href`) });
  console.log('shot', name);
}

// 1. The window in its corner while you read.
await playFrom(30.4);
await sleep(1200);
await shot('corner');

// 2. Controls.
await playFrom(52.2);
await sleep(600);
let p = await pip();
await touch('touchStart', [{ x: p.x + p.w * 0.25, y: p.y + p.h * 0.72 }]);
await sleep(60);
await touch('touchEnd', []);
await sleep(700);
await shot('controls');
await sleep(3200);

// 3. Mid-drag, under the finger.
await playFrom(38.6);
await sleep(500);
p = await pip();
const from = { x: p.cx + 20, y: p.cy + 10 };
const to = { x: VW * 0.42, y: VH * 0.36 };
await touch('touchStart', [from]);
await sleep(60);
await moveTo(from, to, 650);
await sleep(350);
await shot('drag', [to]);
await moveTo(to, { x: to.x - 40, y: to.y - 30 }, 300);
await sleep(120);
await touch('touchEnd', []);
await sleep(1200);

// 4. Mid-pinch, growing it back from the middle size.
p = await pip();
const ang = -0.5;
const pts = (c0, d) => [
  { x: c0.x - (Math.cos(ang) * d) / 2, y: c0.y - (Math.sin(ang) * d) / 2, id: 0 },
  { x: c0.x + (Math.cos(ang) * d) / 2, y: c0.y + (Math.sin(ang) * d) / 2, id: 1 },
];
async function pinchTo(c0, d0, d1, steps, release = true) {
  await touch('touchStart', pts(c0, d0));
  await sleep(50);
  for (let i = 1; i <= steps; i++) {
    await touch('touchMove', pts(c0, d0 + ((d1 - d0) * i) / steps));
    await sleep(12);
  }
  if (release) {
    await sleep(60);
    await touch('touchEnd', []);
  }
}
await pinchTo({ x: p.cx, y: p.cy }, 200, 120, 20);
await sleep(900);
await playFrom(41.2);
await sleep(500);
p = await pip();
const pc = { x: p.cx + 10, y: p.cy + 6 };
await pinchTo(pc, 90, 165, 30, false);
await sleep(300);
await shot('pinch', pts(pc, 165));
await touch('touchEnd', []);
await sleep(1000);

// 5. Tucked into the edge, and pulled back out with a finger.
await playFrom(47.5);
p = await pip();
const tf = { x: p.cx, y: p.cy + 40 };
await touch('touchStart', [tf]);
await sleep(40);
for (let i = 1; i <= 16; i++) {
  await touch('touchMove', [{ x: Math.max(4, tf.x - i * i * 1.6), y: tf.y + i * 6 }]);
  await sleep(10);
}
await touch('touchEnd', []);
await sleep(1400);
p = await pip();
const tab = { x: p.x + p.w - 12, y: p.cy };
const pulled = { x: tab.x + 120, y: tab.y - 6 };
await touch('touchStart', [tab]);
await sleep(60);
await moveTo(tab, pulled, 450);
await sleep(300);
await shot('tucked', [pulled]);
await touch('touchEnd', []);
await sleep(800);

fs.writeFileSync(path.join(OUT, 'shots.json'), JSON.stringify({ zoom: ZOOM, vw: VW, vh: VH, shots }, null, 1));
await cl('Emulation.clearDeviceMetricsOverride');
c.close();
process.exit(0);

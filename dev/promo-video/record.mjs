// Records the raw take for the promo video from a headful Brave (started with
// --remote-debugging-port) that has the extension loaded and claude.ai logged in.
//
//   node record.mjs <outdir> [--no-send] [--port 9333] [--monitor eDP-1]
//
// The Brave window must already be sized so its viewport is exactly VW x VH CSS
// px and sit fully visible on <monitor>. The screen is captured natively at
// 60 fps with gpu-screen-recorder (what the browser really renders, no
// emulation), while the take is scripted with real touch events (taps, drags,
// flicks, pinches) over CDP. Everything the compositor needs (touches, tab
// switches, captions, titles, video time, calibration) goes to take.json.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { connect, sleep } from './cdp.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const OUT = path.resolve(args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) || '/tmp/promo-take');
const SEND = !args.includes('--no-send');
const PORT = Number(opt('--port', 9333));
const MONITOR = opt('--monitor', 'eDP-1');
const VW = 1194;
const VH = 728;
const VIDEO = 'm1ijQhuJkCY';
const START = 30;
const PROMPT = 'What is picture-in-picture?';

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const c = await connect(PORT);
const now = () => Date.now() / 1000;
const take = { vw: VW, vh: VH, events: [], tabs: {}, video: [] };
const ev = (kind, data = {}) => take.events.push({ t: now(), kind, ...data });

// --- tabs ----------------------------------------------------------------------
let { targetInfos } = await c.send('Target.getTargets');
const pages = targetInfos.filter((t) => t.type === 'page');
const claudeT = pages.find((t) => t.url.startsWith('https://claude.ai'));
if (!claudeT) throw new Error('Open and log into claude.ai first.');
for (const t of pages) if (t !== claudeT && !t.url.includes('youtube.com')) await c.send('Target.closeTarget', { targetId: t.targetId });
const ytT = pages.find((t) => t.url.includes('youtube.com'));
const ytId = ytT ? ytT.targetId : (await c.send('Target.createTarget', { url: 'about:blank', background: true })).targetId;

const yt = await c.attach(ytId);
const cl = await c.attach(claudeT.targetId);
const sessions = { yt, claude: cl };

for (const s of [yt, cl]) {
  await s('Page.enable');
  await s('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await s('Emulation.setFocusEmulationEnabled', { enabled: true });
}
const size = await cl.eval(`[innerWidth, innerHeight]`);
if (size[0] !== VW || size[1] !== VH) throw new Error(`Viewport is ${size.join('x')}, resize the window to ${VW}x${VH}.`);

// --- extension: start from the default corner -------------------------------------
// Done from the extension's content-script context in the Claude tab (after it
// loads below); attaching to the service worker can stall it.
const ctxs = [];
c.on((m) => {
  if (m.sessionId !== cl.id) return;
  if (m.method === 'Runtime.executionContextCreated') ctxs.push(m.params.context);
  if (m.method === 'Runtime.executionContextsCleared') ctxs.length = 0;
});
await cl('Runtime.enable');
async function resetPosition() {
  for (const x of ctxs.filter((x) => x.origin.startsWith('chrome-extension://')).reverse()) {
    const r = await cl('Runtime.evaluate', { contextId: x.id, awaitPromise: true, returnByValue: true,
      expression: `chrome.storage?.local ? chrome.storage.local.remove('pipPosition').then(() => true) : false` }).catch(() => null);
    if (r?.result?.value === true) return true;
  }
  throw new Error('extension content script not found in the Claude tab: ' + JSON.stringify(ctxs.map((x) => [x.id, x.origin, x.name, x.auxData?.type])));
}

// --- YouTube: dark, parked just before START -------------------------------------------
for (const [name, value] of [['SOCS', 'CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg'], ['wide', '1'], ['PREF', 'f6=400&hl=en']]) {
  await yt('Network.setCookie', { name, value, domain: '.youtube.com', path: '/', secure: true });
}
await c.send('Target.activateTarget', { targetId: ytId });
await yt('Page.navigate', { url: `https://www.youtube.com/watch?v=${VIDEO}` });
const waitFor = async (s, expr, ms = 30000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const v = await s.eval(expr);
      if (v) return v;
    } catch {}
    await sleep(200);
  }
  throw new Error('timeout: ' + expr);
};
const V = `document.querySelector('#movie_player video')`;
await waitFor(yt, `(() => { const v = ${V}; return v && v.readyState >= 2 && !document.querySelector('#movie_player.ad-showing'); })()`);
await yt.eval(`(() => { const v = ${V}; v.muted = false; v.volume = 1; v.play(); })()`);
await waitFor(yt, `${V}.currentTime > 2 && !document.querySelector('#movie_player.ad-showing')`);
await yt.eval(`(() => { const v = ${V}; v.pause(); v.currentTime = ${START - 1.2}; })()`);
await waitFor(yt, `${V}.readyState >= 4`);
await yt.eval(`window.scrollTo(0, 0)`);
// Keep the account out of the shot: no avatar or notification badge.
await yt.eval(`(() => {
  const st = document.createElement('style');
  st.textContent = '#avatar-btn, ytd-topbar-menu-button-renderer:has(#avatar-btn), ytd-notification-topbar-button-renderer { display: none !important; }';
  document.head.append(st);
})()`);

// --- Claude: fresh chat ---------------------------------------------------------------
await cl('Page.navigate', { url: 'https://claude.ai/new' });
await waitFor(cl, `!!document.querySelector('[contenteditable="true"]')`);
await sleep(1000);
// A tablet-width chat without the sidebar (and the account's chat history).
await cl.eval(`document.querySelector('button[aria-label="Hide sidebar"]')?.click()`);
await sleep(800);
// Drop any draft left over from an earlier take.
await cl.eval(`(() => { const e = document.querySelector('[contenteditable="true"]'); e.focus(); document.execCommand('selectAll'); document.execCommand('delete'); e.blur(); })()`);
await sleep(300);
await resetPosition();

// --- favicons and titles for the compositor's tab strip --------------------------------
const tabInfo = async (s) =>
  s.eval(`(async () => {
    const link = [...document.querySelectorAll('link[rel~="icon"]')].pop();
    let icon = null;
    try {
      const b = await (await fetch(link ? link.href : '/favicon.ico')).blob();
      icon = await new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
    } catch {}
    return { icon, title: document.title, url: location.href };
  })()`);
take.tabs.yt = await tabInfo(yt);
take.tabs.claude = await tabInfo(cl);

// --- capture ---------------------------------------------------------------------------
const screenFile = path.join(OUT, 'screen.mp4');
const gsr = spawn('gpu-screen-recorder', ['-w', MONITOR, '-f', '60', '-k', 'h264', '-q', 'ultra', '-cursor', 'no', '-fm', 'cfr', '-write-first-frame-ts', 'yes', '-o', screenFile], { stdio: ['ignore', 'ignore', 'pipe'] });
let gsrLog = '';
gsr.stderr.on('data', (d) => (gsrLog += d));
await sleep(1500);

// Calibration: a magenta frame around the Claude viewport, so the compositor can
// find the exact capture region.
await c.send('Target.activateTarget', { targetId: claudeT.targetId });
await cl.eval(`(() => { const d = document.createElement('div'); d.id = 'pip-cal'; d.style.cssText = 'position:fixed;inset:0;border:4px solid #f0f;z-index:2147483647;pointer-events:none'; document.body.append(d); })()`);
await sleep(600);
ev('calibrate');
await sleep(300);
await cl.eval(`document.getElementById('pip-cal').remove()`);
await c.send('Target.activateTarget', { targetId: ytId });
await sleep(700);

const sampler = setInterval(async () => {
  try {
    const t = now();
    const vt = await yt.eval(`${V}.currentTime`);
    take.video.push({ t, vt });
  } catch {}
}, 250);
const titles = setInterval(async () => {
  for (const [k, s] of Object.entries(sessions)) {
    try {
      const r = await s.eval(`({ title: document.title, url: location.href })`);
      const last = take.events.findLast((e) => e.kind === 'title' && e.tab === k);
      if (!last || last.title !== r.title || last.url !== r.url) ev('title', { tab: k, ...r });
    } catch {}
  }
}, 300);

// --- input helpers ---------------------------------------------------------------------
const touch = (s, type, pts) => {
  ev('touch', { type, pts: pts.map(({ x, y, id }) => ({ x, y, id: id ?? 0 })) });
  return s('Input.dispatchTouchEvent', {
    type,
    touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: p.id ?? 0, radiusX: 11, radiusY: 11, force: 1 })),
  });
};
const ease = {
  inOut: (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2),
  sine: (u) => -(Math.cos(Math.PI * u) - 1) / 2,
  in: (u) => u * u,
  in3: (u) => u * u * u,
  out: (u) => 1 - (1 - u) * (1 - u),
  linear: (u) => u,
};
const clampPt = (p) => ({ x: Math.max(4, Math.min(VW - 4, p.x)), y: Math.max(4, Math.min(VH - 4, p.y)) });
async function tap(s, p, hold = 70) {
  await touch(s, 'touchStart', [clampPt(p)]);
  await sleep(hold);
  await touch(s, 'touchEnd', []);
}
// One continuous touch through several segments. A segment is { to, ms, curve,
// via } where `via` bends it into a quadratic curve. Ending a segment with an
// accelerating curve releases with real velocity (a flick).
async function gesture(s, from, segments, { hold = 50 } = {}) {
  let cur = clampPt(from);
  await touch(s, 'touchStart', [cur]);
  await sleep(hold);
  for (const seg of segments) {
    const a = cur;
    const b = seg.to;
    const m = seg.via || { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const t0 = performance.now();
    for (;;) {
      const u = Math.min(1, (performance.now() - t0) / seg.ms);
      const k = (seg.curve || ease.inOut)(u);
      cur = clampPt({
        x: (1 - k) * (1 - k) * a.x + 2 * (1 - k) * k * m.x + k * k * b.x,
        y: (1 - k) * (1 - k) * a.y + 2 * (1 - k) * k * m.y + k * k * b.y,
      });
      await touch(s, 'touchMove', [cur]);
      if (u >= 1) break;
      await sleep(8);
    }
    if (seg.pause) await sleep(seg.pause);
  }
  await touch(s, 'touchEnd', []);
}
const flick = (s, from, dx, dy, ms = 150) => gesture(s, from, [{ to: { x: from.x + dx, y: from.y + dy }, ms, curve: ease.in }], { hold: 35 });
async function pinch(s, center, d0, d1, ms, angle = -0.45) {
  const pts = (d) => [
    { ...clampPt({ x: center.x - (Math.cos(angle) * d) / 2, y: center.y - (Math.sin(angle) * d) / 2 }), id: 0 },
    { ...clampPt({ x: center.x + (Math.cos(angle) * d) / 2, y: center.y + (Math.sin(angle) * d) / 2 }), id: 1 },
  ];
  await touch(s, 'touchStart', pts(d0));
  await sleep(40);
  const t0 = performance.now();
  for (;;) {
    const u = Math.min(1, (performance.now() - t0) / ms);
    await touch(s, 'touchMove', pts(d0 + (d1 - d0) * ease.inOut(u)));
    if (u >= 1) break;
    await sleep(8);
  }
  await sleep(40);
  await touch(s, 'touchEnd', []);
}

// The floating window lives in a closed shadow root: find it through DOM pierce.
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
      const { model } = await cl('DOM.getBoxModel', { nodeId: pipNode });
      const q = model.border;
      const x = Math.min(q[0], q[6]);
      const y = Math.min(q[1], q[3]);
      const w = Math.max(q[2], q[4]) - x;
      const h = Math.max(q[5], q[7]) - y;
      const box = { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
      ev('pip', { box, stashed: x < 0 || x + w > VW });
      return box;
    } catch {
      pipNode = null;
    }
  }
  throw new Error('floating window not found');
}

// --- the take ----------------------------------------------------------------------------
const at = async (T) => {
  const wait = (take.t0 + T) * 1000 - Date.now();
  if (wait > 0) await sleep(wait);
};
const cue = (text) => ev('cue', { text });

await yt.eval(`${V}.play()`);
await waitFor(yt, `${V}.currentTime >= ${START}`, 10000);
take.t0 = now();
ev('tab', { tab: 'yt' });
cue('Watching something on YouTube?');
console.log('rolling');

// Switch tabs: the video pops out into the corner.
await at(2.5);
ev('ui-tap', { target: 'tab-claude' });
await sleep(90);
await c.send('Target.activateTarget', { targetId: claudeT.targetId });
ev('tab', { tab: 'claude' });
await at(2.8);
cue('Switch tabs. {It keeps playing.}');

// Ask Claude.
await at(3.2);
const box = await cl.eval(`(() => { const r = document.querySelector('[contenteditable="true"]').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
await tap(cl, { x: box.x + 70, y: box.y + box.h / 2 });
await cl.eval(`(() => { const e = document.querySelector('[contenteditable="true"]'); e.spellcheck = false; e.focus(); })()`);
await at(3.35);
for (const ch of PROMPT) {
  await cl('Input.insertText', { text: ch });
  await sleep(34 + Math.random() * 26);
}
await at(5.0);
const send = await cl.eval(`(() => { const b = document.querySelector('button[aria-label="Send message"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
if (send && SEND) await tap(cl, send);
else if (send) {
  ev('touch', { type: 'touchStart', pts: [{ ...send, id: 0 }] });
  await sleep(70);
  ev('touch', { type: 'touchEnd', pts: [] });
}

// Drag it, flick it: it tracks the finger 1:1 and glides with momentum.
// (claude.ai ignores all touch input for ~2 s after a message is sent.)
await at(7.6);
cue('Drag it. {Flick it.}');
let p = await pip();
await gesture(cl, { x: p.cx + 30, y: p.cy + 15 }, [
  { to: { x: 470, y: 400 }, via: { x: 760, y: 120 }, ms: 1050, curve: ease.sine },
  { to: { x: 455, y: 250 }, ms: 130, curve: ease.in },
]);
await at(9.05);
p = await pip();
await flick(cl, { x: p.cx, y: p.cy }, 30, 190, 140);
await at(9.85);
p = await pip();
await flick(cl, { x: p.cx, y: p.cy }, 220, -230, 160);

// Pinch to resize.
await at(10.75);
cue('Pinch to resize.');
p = await pip();
await pinch(cl, { x: p.cx, y: p.cy }, 230, 110, 420);
await at(11.5);
p = await pip();
await pinch(cl, { x: p.cx, y: p.cy }, 90, 270, 560);
await at(12.4);
p = await pip();
await pinch(cl, { x: p.cx, y: p.cy }, 240, 170, 380);

// Push it into the edge to tuck it away, then pull it back out.
await at(13.15);
cue('Tuck it away. {Pull it back.}');
p = await pip();
await gesture(cl, { x: p.cx, y: p.cy }, [{ to: { x: VW - 6, y: p.cy + 170 }, via: { x: p.cx + 40, y: p.cy + 150 }, ms: 380, curve: ease.in }]);
await at(14.45);
p = await pip();
await gesture(cl, { x: p.x + 12, y: p.cy }, [{ to: { x: p.x - 110, y: p.cy - 20 }, ms: 200, curve: ease.inOut }], { hold: 40 });

// Throw it around: momentum carries it, springs settle it on an edge.
await at(15.6);
cue('Throw it to any corner.');
p = await pip();
await flick(cl, { x: p.cx, y: p.cy }, -330, 120, 160);
await at(16.45);
p = await pip();
await flick(cl, { x: p.cx, y: p.cy }, 20, -260, 150);
await at(17.3);
p = await pip();
await flick(cl, { x: p.cx, y: p.cy }, 290, 200, 160);
await at(18.15);
p = await pip();
await gesture(cl, { x: p.cx, y: p.cy }, [
  { to: { x: 720, y: 300 }, via: { x: 600, y: 660 }, ms: 1000, curve: ease.sine },
]);

// Double-tap to switch size.
await at(19.8);
cue('Double-tap to resize.');
p = await pip();
await tap(cl, { x: p.cx - 20, y: p.cy + 10 });
await sleep(110);
await tap(cl, { x: p.cx - 18, y: p.cy + 12 });

// Tap for controls (and leave them alone).
await at(21.6);
cue('Tap for controls.');
p = await pip();
await at(21.8);
await tap(cl, { x: p.x + p.w * 0.28, y: p.y + p.h * 0.7 });

await at(26.0);
ev('end');
await at(31);
clearInterval(sampler);
clearInterval(titles);
await yt.eval(`${V}.pause()`).catch(() => {});
gsr.kill('SIGINT');
await new Promise((r) => gsr.on('close', r));
const rt = fs.readFileSync(screenFile + '.ts', 'utf8').trim().split(/\s+/).at(-1);
take.screen = { file: 'screen.mp4', firstFrame: Number(rt) / 1e6, fps: 60 };
fs.writeFileSync(path.join(OUT, 'take.json'), JSON.stringify(take, null, 1));
console.log(gsrLog.split('\n').filter((l) => /fps/.test(l)).slice(-2).join('\n'));
const tucked = take.events.filter((e) => e.kind === 'pip' && e.stashed).map((e) => (e.t - take.t0).toFixed(1));
console.log('tucked at', tucked.join(', ') || 'never', '(expected: once, around 14.5)');
console.log('saved', OUT);
c.close();
process.exit(0);

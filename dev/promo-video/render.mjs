// Composites a take from record.mjs into the finished promo video: the page
// frames inside a dark tablet browser, touch indicators, captions, an end card
// and the video's own soundtrack.
//
//   node render.mjs <takedir> <out.mp4> [--seconds 30] [--still T]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const [TAKE, OUT] = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')).map((p) => path.resolve(p));
const SECONDS = Number(opt('--seconds', 30));
const STILL = opt('--still', null);
const FPS = 60;
const take = JSON.parse(fs.readFileSync(path.join(TAKE, 'take.json'), 'utf8'));
const T0 = take.t0;
const here = import.meta.dirname;

// --- timeline -----------------------------------------------------------------------
// Captions follow the cues the recorder logged; each fades out just before the next.
const cues = take.events.filter((e) => e.kind === 'cue').map((e) => ({ a: e.t - T0 + 0.05, text: e.text }));
const END_AT = take.events.find((e) => e.kind === 'end').t - T0;
cues.forEach((q, i) => (q.b = (cues[i + 1]?.a ?? END_AT) - 0.2));
const fadeWin = (T, a, b, f = 0.22) => Math.max(0, Math.min(1, (T - a) / f, (b - T) / f));
function caption(T) {
  for (const q of cues) if (T >= q.a - 0.01 && T <= q.b + 0.01) return { text: q.text, o: ease(fadeWin(T, q.a, q.b)) };
  return { text: '', o: 0 };
}
const ease = (u) => u * u * (3 - 2 * u);

const tabAt = (t) => {
  let tab = 'yt';
  for (const e of take.events) if (e.kind === 'tab' && e.t <= t) tab = e.tab;
  return tab;
};

// Screen frames: the native 60 fps capture, cropped to the viewport (found from
// the magenta calibration frame) and cut to start at T0.
const FRAMES = path.join(TAKE, 'frames');
const SCR = take.screen;
const frameNo = (t) => Math.round((t - SCR.firstFrame) * SCR.fps);
function rawFrame(n) {
  return execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(TAKE, SCR.file), '-vf', `select=eq(n\\,${n})`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 26 });
}
function calibrate() {
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height', '-of', 'json', path.join(TAKE, SCR.file)])).streams[0];
  const W = probe.width;
  const d = rawFrame(frameNo(take.events.find((e) => e.kind === 'calibrate').t));
  const mag = (x, y) => { const i = (y * W + x) * 3; return d[i] > 200 && d[i + 1] < 90 && d[i + 2] > 200; };
  const midY = Math.floor(probe.height / 2);
  const xs = []; for (let x = 0; x < W; x++) if (mag(x, midY)) xs.push(x);
  const midX = Math.floor((xs[0] + xs.at(-1)) / 2);
  const ys = []; for (let y = 0; y < probe.height; y++) if (mag(midX, y)) ys.push(y);
  return { x: xs[0], y: ys[0], w: xs.at(-1) - xs[0] + 1, h: ys.at(-1) - ys[0] + 1 };
}
const crop = calibrate();
const first = frameNo(T0);
if (!fs.existsSync(path.join(FRAMES, 'done'))) {
  fs.mkdirSync(FRAMES, { recursive: true });
  execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(TAKE, SCR.file),
    '-vf', `select=gte(n\\,${first}),crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`, '-fps_mode', 'passthrough',
    '-frames:v', String(SECONDS * FPS + 2), '-q:v', '2', path.join(FRAMES, '%05d.jpg')]);
  fs.writeFileSync(path.join(FRAMES, 'done'), JSON.stringify(crop));
}
console.log('viewport in capture', crop);
const frameAt = (T) => ({ tab: tabAt(T0 + T), file: 'file://' + path.join(FRAMES, String(Math.min(SECONDS * FPS, Math.round(T * FPS)) + 1).padStart(5, '0') + '.jpg') });
function titlesAt(t) {
  const out = { yt: take.tabs.yt.title, claude: take.tabs.claude.title, url: { yt: take.tabs.yt.url, claude: take.tabs.claude.url } };
  for (const e of take.events) if (e.kind === 'title' && e.t <= t) { out[e.tab] = e.title; out.url[e.tab] = e.url; }
  return out;
}

// Touches: replay the logged touch events (page coordinates); a released finger
// fades out where it lifted. Taps on the browser's own tab strip are synthesized.
const TAB_POINT = { x: 10 + 236 + 2 + 118, y: -106 + 24 + 6 + 17 };
const touchEvents = [];
for (const e of take.events) {
  if (e.kind === 'touch') touchEvents.push(e);
  if (e.kind === 'ui-tap') {
    touchEvents.push({ t: e.t, type: 'touchStart', pts: [{ ...TAB_POINT, id: 0 }] });
    touchEvents.push({ t: e.t + 0.09, type: 'touchEnd', pts: [] });
  }
}
touchEvents.sort((a, b) => a.t - b.t);
function touchesAt(t) {
  let cur = [];
  let downAt = {};
  const lifted = [];
  for (const e of touchEvents) {
    if (e.t > t) break;
    if (e.type === 'touchStart') for (const p of e.pts) if (!(p.id in downAt)) downAt[p.id] = e.t;
    if (e.type === 'touchEnd') {
      for (const p of cur) lifted.push({ ...p, t: e.t, down: downAt[p.id] });
      downAt = {};
    }
    cur = e.pts;
  }
  const out = cur.map((p) => {
    const u = Math.min(1, (t - (downAt[p.id] ?? t)) / 0.08);
    return { x: p.x, y: p.y, o: u, s: 0.8 + 0.2 * u };
  });
  for (const p of lifted) {
    const u = (t - p.t) / 0.22;
    if (u < 1) out.push({ x: p.x, y: p.y, o: 1 - u, s: 1 + 0.15 * u });
  }
  return out;
}

function stateAt(T) {
  const t = T0 + T;
  const { tab, file } = frameAt(T);
  const ti = titlesAt(t);
  return {
    tab,
    frame: file,
    titles: { yt: ti.yt.replace(/^\(\d+\)\s*/, ''), claude: ti.claude },
    url: ti.url[tab],
    touches: touchesAt(t),
    caption: caption(T),
    end: ease(Math.max(0, Math.min(1, (T - END_AT) / 0.6))),
  };
}

// --- render -------------------------------------------------------------------------
const icon = 'data:image/png;base64,' + fs.readFileSync(path.join(here, '../../extension/icons/icon128.png')).toString('base64');
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium',
  headless: true,
  args: ['--allow-file-access-from-files', '--force-color-profile=srgb', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
await page.goto('file://' + path.join(here, 'stage.html'), { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.evaluate((s) => window.setup(s), { tabs: take.tabs, icon });

if (STILL != null) {
  for (const T of STILL.split(',').map(Number)) {
    await page.evaluate((s) => window.draw(s), stateAt(T));
    await page.screenshot({ path: OUT.replace(/(\.\w+)?$/, `-${T}.png`) });
  }
  await browser.close();
  process.exit(0);
}

// Soundtrack: the trailer's own audio, aligned with the video time at T0.
const vt = take.video.filter((s) => s.t >= T0 && s.t <= T0 + SECONDS);
const audioStart = vt.reduce((a, s) => a + (s.vt - (s.t - T0)), 0) / vt.length;
const audioFile = path.join(TAKE, 'audio.m4a');
if (!fs.existsSync(audioFile)) {
  execFileSync('yt-dlp', ['-q', '-f', 'bestaudio[ext=m4a]/bestaudio', '-o', audioFile, `https://www.youtube.com/watch?v=m1ijQhuJkCY`], { stdio: 'inherit' });
}
console.log(`audio starts at ${audioStart.toFixed(3)}s of the trailer`);

const ff = spawn('ffmpeg', [
  '-v', 'error', '-y',
  '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
  '-ss', audioStart.toFixed(3), '-t', String(SECONDS), '-i', audioFile,
  '-map', '0:v', '-map', '1:a',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  '-af', `afade=t=in:d=0.25,afade=t=out:st=${SECONDS - 1.6}:d=1.6`, '-c:a', 'aac', '-b:a', '192k',
  '-shortest', OUT,
], { stdio: ['pipe', 'inherit', 'inherit'] });
const N = SECONDS * FPS;
for (let i = 0; i < N; i++) {
  await page.evaluate((s) => window.draw(s), stateAt(i / FPS));
  const buf = await page.screenshot({ type: 'jpeg', quality: 96 });
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  if (i % 180 === 0) process.stdout.write(`${i / FPS}s `);
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
await browser.close();
console.log('\n' + OUT);

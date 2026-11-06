// Renders the store promo tiles from our own artwork only: a generic dark
// browser, a floating window showing an abstract scene, and the extension's
// real control glyphs. No third-party UI or footage.
//
//   node tiles.mjs <outdir>
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] || '.');
const here = import.meta.dirname;
const icon = 'data:image/png;base64,' + fs.readFileSync(path.join(here, '../../extension/icons/icon128.png')).toString('base64');

// The same glyphs the floating window uses (extension/pip.js).
const G = {
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><path d="M5.5 5.5l13 13M18.5 5.5l-13 13"/></svg>',
  restore: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="3.5" width="14.5" height="12" rx="1.8"/><rect x="11" y="10.5" width="10.5" height="9" rx="1.4" fill="currentColor" stroke="none"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4.4a8.6 8.6 0 1 0 8.15 5.85"/><path d="M14.1 2.2L12 4.4l2.1 2.2"/><text x="12" y="16.6" text-anchor="middle" font-size="7.6" font-weight="700" fill="currentColor" stroke="none" font-family="Inter">10</text></svg>',
  fwd: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4.4a8.6 8.6 0 1 1-8.15 5.85"/><path d="M9.9 2.2L12 4.4 9.9 6.6"/><text x="12" y="16.6" text-anchor="middle" font-size="7.6" font-weight="700" fill="currentColor" stroke="none" font-family="Inter">10</text></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="5.6" y="4" width="4.6" height="16" rx="1.3"/><rect x="13.8" y="4" width="4.6" height="16" rx="1.3"/></svg>',
};

// An original sunset scene for the "video".
const scene = `<svg viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2b1a5e"/><stop offset=".45" stop-color="#b83a7a"/><stop offset=".75" stop-color="#ff7a45"/><stop offset="1" stop-color="#ffc56b"/>
    </linearGradient>
    <radialGradient id="sun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff3c4"/><stop offset=".6" stop-color="#ffd27a"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="160" height="90" fill="url(#sky)"/>
  <circle cx="104" cy="58" r="22" fill="url(#sun)"/>
  <path d="M0 62 C 22 50, 40 54, 58 60 S 96 52, 120 58 S 150 54, 160 56 V90 H0Z" fill="#7a2a5a" opacity=".85"/>
  <path d="M0 70 C 26 60, 48 66, 70 70 S 110 62, 134 68 S 156 66, 160 66 V90 H0Z" fill="#4a1a46"/>
  <path d="M0 80 C 30 72, 60 78, 90 80 S 140 74, 160 76 V90 H0Z" fill="#26102e"/>
</svg>`;
const sceneUrl = `url("data:image/svg+xml;utf8,${encodeURIComponent(scene)}")`;

const css = (s) => `
  @font-face { font-family: Inter; src: url('file://${here}/fonts/InterVariable.ttf'); font-weight: 100 900; }
  * { box-sizing: border-box; margin: 0; }
  body { font-family: Inter, sans-serif; color: #fff; -webkit-font-smoothing: antialiased; }
  .t { position: relative; overflow: hidden;
    background:
      radial-gradient(60% 80% at 80% 75%, rgba(255, 70, 90, .22), transparent 70%),
      radial-gradient(45% 60% at 8% 12%, rgba(120, 60, 255, .14), transparent 70%),
      linear-gradient(#0d0d12, #060608); }
  .brand { position: absolute; top: 50%; transform: translateY(-50%); }
  .brand img { display: block; filter: drop-shadow(0 ${6 * s}px ${14 * s}px rgba(0,0,0,.5)); }
  .name { font-weight: 750; letter-spacing: -0.035em; line-height: 1.02; }
  .sub { font-weight: 500; color: rgba(255,255,255,.7); line-height: 1.3; }
  .browser { position: absolute; background: #1b1b1f; overflow: hidden;
    box-shadow: 0 0 0 ${1.5 * s}px #2c2c31, 0 ${28 * s}px ${70 * s}px rgba(0,0,0,.6); }
  .tabs { height: ${36 * s}px; background: #111114; display: flex; align-items: flex-end; gap: ${4 * s}px; padding: 0 ${12 * s}px; }
  .tab { height: ${28 * s}px; width: ${150 * s}px; border-radius: ${9 * s}px ${9 * s}px 0 0; display: flex; align-items: center; gap: ${8 * s}px; padding: 0 ${12 * s}px; }
  .tab.on { background: #26262b; }
  .tab i { width: ${12 * s}px; height: ${12 * s}px; border-radius: ${3 * s}px; background: #4a4a52; flex: none; }
  .tab.v i { background: #ff4b4b; }
  .tab b { height: ${6 * s}px; flex: 1; border-radius: ${3 * s}px; background: #3a3a40; }
  .tab.on b { background: #55555c; }
  .bar { height: ${38 * s}px; background: #26262b; display: flex; align-items: center; padding: 0 ${14 * s}px; gap: ${10 * s}px; }
  .bar u { width: ${10 * s}px; height: ${10 * s}px; border-radius: 50%; background: #45454c; flex: none; }
  .bar .url { flex: 1; height: ${24 * s}px; border-radius: ${12 * s}px; background: #131316; }
  .page { padding: ${34 * s}px ${48 * s}px; }
  .page .h { height: ${16 * s}px; width: 46%; border-radius: ${5 * s}px; background: #3a3a42; margin-bottom: ${22 * s}px; }
  .page .l { height: ${8 * s}px; border-radius: ${4 * s}px; background: #2c2c33; margin-bottom: ${13 * s}px; }
  .pip { position: absolute; overflow: hidden; background: ${sceneUrl} center / cover;
    box-shadow: 0 ${18 * s}px ${44 * s}px rgba(0,0,0,.55), 0 ${3 * s}px ${8 * s}px rgba(0,0,0,.35); }
  .pip.ghost { box-shadow: none; }
  .ctl { position: absolute; inset: 0; background: rgba(0,0,0,.32); color: #fff; }
  .ctl .g { position: absolute; display: grid; place-items: center; }
  .ctl .g svg { width: 100%; height: 100%; }
  .ctl .bar2 { position: absolute; height: 3px; border-radius: 2px; background: rgba(255,255,255,.35); overflow: hidden; }
  .ctl .bar2::after { content: ''; position: absolute; inset: 0 62% 0 0; background: #fff; }
  .touch { position: absolute; border-radius: 50%;
    background: radial-gradient(circle, rgba(255,255,255,.62), rgba(255,255,255,.42) 65%, rgba(255,255,255,.3));
    box-shadow: 0 0 0 2px rgba(255,255,255,.85), 0 0 0 3.5px rgba(0,0,0,.28), 0 6px 20px rgba(0,0,0,.4); }
`;

const lines = (ws) => ws.map((w) => `<div class="l" style="width:${w}%"></div>`).join('');
const browser = ({ x, y, w, h, r, s }) => `<div class="browser" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${r}px">
  <div class="tabs"><div class="tab v"><i></i><b></b></div><div class="tab on"><i></i><b></b></div></div>
  <div class="bar"><u></u><u></u><div class="url"></div></div>
  <div class="page"><div class="h"></div>${lines([92, 86, 95, 70, 0, 88, 93, 64, 0, 90, 82])}</div>
</div>`;
// Controls laid out like the real window: close / restore in the corners,
// skip-pause-skip in the middle, progress along the bottom.
const controls = (w, h) => {
  const big = h * 0.2;
  const small = h * 0.13;
  const corner = h * 0.1;
  const cy = h / 2;
  return `<div class="ctl">
    <div class="g" style="left:${h * 0.07}px;top:${h * 0.07}px;width:${corner}px;height:${corner}px">${G.close}</div>
    <div class="g" style="right:${h * 0.07}px;top:${h * 0.07}px;width:${corner * 1.1}px;height:${corner * 1.1}px">${G.restore}</div>
    <div class="g" style="left:${w / 2 - big * 2.1 - small / 2}px;top:${cy - small / 2}px;width:${small}px;height:${small}px">${G.back}</div>
    <div class="g" style="left:${w / 2 - big / 2}px;top:${cy - big / 2}px;width:${big}px;height:${big}px">${G.pause}</div>
    <div class="g" style="left:${w / 2 + big * 2.1 - small / 2}px;top:${cy - small / 2}px;width:${small}px;height:${small}px">${G.fwd}</div>
    <div class="bar2" style="left:${h * 0.07}px;right:${h * 0.07}px;bottom:${h * 0.07}px"></div>
  </div>`;
};

const marquee = () => {
  const s = 1;
  const pw = 400;
  const ph = 225;
  const px = 1400 - 60 - pw - 26;
  const py = 560 - 50 - ph - 22;
  return `<div class="t" style="width:1400px;height:560px">
    <div class="brand" style="left:76px">
      <img src="${icon}" style="width:84px;height:84px;margin-bottom:22px">
      <div class="name" style="font-size:64px">PiP Anywhere</div>
      <div class="sub" style="font-size:24px;margin-top:14px">A floating player for YouTube,<br>on every tab.</div>
    </div>
    ${browser({ x: 640, y: 50, w: 700, h: 460, r: 16, s })}
    <div class="pip ghost" style="left:${px - 210}px;top:${py - 150}px;width:${pw}px;height:${ph}px;border-radius:14px;opacity:.10"></div>
    <div class="pip ghost" style="left:${px - 110}px;top:${py - 78}px;width:${pw}px;height:${ph}px;border-radius:14px;opacity:.22"></div>
    <div class="pip" style="left:${px}px;top:${py}px;width:${pw}px;height:${ph}px;border-radius:14px"></div>
    <div class="touch" style="left:${px + pw * 0.46 - 25}px;top:${py + ph * 0.42 - 25}px;width:50px;height:50px"></div>
  </div>`;
};

const small = () => {
  const s = 0.5;
  const pw = 190;
  const ph = 107;
  const px = 440 - 18 - pw;
  const py = 280 - 22 - ph;
  return `<div class="t" style="width:440px;height:280px">
    <div class="brand" style="left:30px">
      <img src="${icon}" style="width:50px;height:50px;margin-bottom:12px">
      <div class="name" style="font-size:28px">PiP Anywhere</div>
      <div class="sub" style="font-size:14px;margin-top:8px">Floating player<br>for YouTube</div>
    </div>
    ${browser({ x: 226, y: 34, w: 260, h: 260, r: 10, s })}
    <div class="pip" style="left:${px}px;top:${py}px;width:${pw}px;height:${ph}px;border-radius:9px">${controls(pw, ph)}</div>
  </div>`;
};

fs.mkdirSync(OUT, { recursive: true });
const b = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--allow-file-access-from-files', '--force-color-profile=srgb'] });
const p = await b.newPage();
for (const [name, W, H, body, s] of [['promo-small-440x280', 440, 280, small(), 0.5], ['promo-marquee-1400x560', 1400, 560, marquee(), 1]]) {
  const file = path.join(OUT, `.${name}.html`);
  fs.writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8"><style>${css(s)}</style></head><body>${body}</body></html>`);
  await p.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await p.goto('file://' + file, { waitUntil: 'load' });
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: path.join(OUT, `${name}.png`) });
  fs.rmSync(file);
  console.log(path.join(OUT, `${name}.png`));
}
await b.close();

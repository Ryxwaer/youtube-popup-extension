// PiP Anywhere — settings page (also the toolbar popup).
//
// Sizes are stored as ids in chrome.storage.local under `pipSizes`; pip.js
// keeps the same ids, areas and defaults and picks up changes live.

const SIZES = [
  { id: 's', name: 'Small', area: 18225 },
  { id: 'm', name: 'Medium', area: 41006 },
  { id: 'l', name: 'Large', area: 81000 },
  { id: 'xl', name: 'Extra Large', area: 144000 },
];
const DEFAULT_SIZES = ['m', 'l', 'xl'];
const KEY = 'pipSizes';
const ASPECT = 16 / 9;
const SCREEN_W = 1440; // the laptop-sized viewport the previews are drawn against

if (chrome.extension?.getViews?.({ type: 'popup' }).includes(window)) document.documentElement.classList.add('popup');
document.getElementById('version').textContent = 'Version ' + chrome.runtime.getManifest().version;

const box = document.getElementById('sizes');
const note = document.getElementById('size-note');
const noteText = note.textContent;
let enabled = new Set(DEFAULT_SIZES);
const buttons = new Map();

for (const size of SIZES) {
  const w = Math.round(Math.sqrt(size.area * ASPECT));
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'size';
  btn.setAttribute('role', 'checkbox');
  btn.innerHTML = `
    <span class="screen"><span class="win" style="width:${((w / SCREEN_W) * 100).toFixed(1)}%"></span></span>
    <span class="label">${size.name}</span>
    <span class="dims">${w} × ${Math.round(w / ASPECT)}</span>
    <span class="check" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M4 8.4l2.6 2.6L12 5.4"/></svg></span>`;
  btn.addEventListener('click', () => toggle(size.id, btn));
  box.append(btn);
  buttons.set(size.id, btn);
}

function render() {
  for (const [id, btn] of buttons) {
    const on = enabled.has(id);
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-checked', String(on));
  }
}

function toggle(id, btn) {
  if (enabled.has(id) && enabled.size === 1) {
    note.textContent = 'Keep at least one size on.';
    note.classList.add('warn');
    btn.classList.remove('shake');
    void btn.offsetWidth;
    btn.classList.add('shake');
    return;
  }
  note.textContent = noteText;
  note.classList.remove('warn');
  if (enabled.has(id)) enabled.delete(id);
  else enabled.add(id);
  render();
  chrome.storage.local.set({ [KEY]: SIZES.filter((s) => enabled.has(s.id)).map((s) => s.id) });
}

function load(ids) {
  const valid = Array.isArray(ids) ? ids.filter((id) => SIZES.some((s) => s.id === id)) : [];
  enabled = new Set(valid.length ? valid : DEFAULT_SIZES);
  render();
}

render();
chrome.storage.local.get(KEY).then((r) => {
  load(r[KEY]);
  requestAnimationFrame(() => document.documentElement.classList.add('ready'));
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && KEY in changes) load(changes[KEY].newValue);
});

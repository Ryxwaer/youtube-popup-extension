// PiP Anywhere — background router.
//
// Tracks which YouTube tab is the playback "source" and which tab currently
// hosts the floating player ("overlay"), and relays state, commands and
// WebRTC signaling between them. The source tab keeps playing (audio stays
// native); the overlay receives the live video frames over a local
// RTCPeerConnection, so nothing is reloaded or re-buffered.

const KEY = 'pipState';
let mem = null;
let chain = Promise.resolve();

async function state() {
  if (!mem) {
    const stored = (await chrome.storage.session.get(KEY))[KEY];
    mem = stored || { source: null, overlayTab: null, active: false, sid: 0, lastActive: null };
  }
  return mem;
}

function save() {
  return chrome.storage.session.set({ [KEY]: mem });
}

// Serialize every state transition so tab switches never race each other.
function serial(fn) {
  chain = chain.then(fn).catch((e) => console.warn('[pip]', e));
  return chain;
}

async function sendTab(tabId, msg) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg, { frameId: 0 });
  } catch {
    return undefined;
  }
}

async function activeTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab || null;
  } catch {
    return null;
  }
}

async function hideOverlay(st, animate = false) {
  if (st.overlayTab != null) {
    sendTab(st.overlayTab, { type: 'pip:hide', animate });
    st.overlayTab = null;
  }
  if (st.source) sendTab(st.source.tabId, { type: 'src:rtc-close' });
}

async function showOverlay(st, tab, src, entrance) {
  st.sid += 1;
  const msg = {
    type: 'pip:show',
    sid: st.sid,
    entrance,
    state: src.state,
    snapshot: src.snapshot,
    rect: src.rect,
  };
  let res = await sendTab(tab.id, msg);
  if (!res) {
    // Tab was open before the extension loaded (or the script was blocked):
    // inject on demand. Fails silently on browser-internal pages.
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['pip.js'] });
      res = await sendTab(tab.id, msg);
    } catch {
      res = undefined;
    }
  }
  st.overlayTab = res?.ok ? tab.id : null;
}

async function evaluate(reason) {
  const st = await state();
  const tab = await activeTab();
  const prevActive = st.lastActive;
  if (tab) st.lastActive = tab.id;

  if (!st.source || !tab) {
    if (!st.source) await hideOverlay(st);
    return save();
  }

  if (tab.id === st.source.tabId) {
    // Back on the YouTube tab: it plays there "as normal".
    st.active = false;
    await hideOverlay(st);
    return save();
  }

  const wantSnapshot = st.overlayTab !== tab.id;
  const src = await sendTab(st.source.tabId, { type: 'src:query', snapshot: wantSnapshot });
  if (!src || !src.state?.hasVideo) {
    st.active = false;
    if (!src) st.source = null;
    await hideOverlay(st);
    return save();
  }

  // The source is still on screen in another window: no need to float it.
  let srcTab = null;
  try {
    srcTab = await chrome.tabs.get(st.source.tabId);
  } catch {}
  if (srcTab?.active && src.state.visible) {
    st.active = false;
    await hideOverlay(st);
    return save();
  }

  if (!src.state.playing && !st.active) {
    await hideOverlay(st);
    return save();
  }

  if (st.overlayTab === tab.id) {
    const alive = await sendTab(tab.id, { type: 'pip:ping', sid: st.sid });
    if (alive?.ok) {
      st.active = true;
      return save();
    }
    st.overlayTab = null;
  }

  await hideOverlay(st);
  const entrance = prevActive === st.source.tabId && reason !== 'hello' ? 'fly' : 'static';
  if (wantSnapshot === false) src.snapshot = null;
  await showOverlay(st, tab, src, entrance);
  st.active = true;
  return save();
}

chrome.tabs.onActivated.addListener(() => serial(() => evaluate('activated')));

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  serial(() => evaluate('focus'));
});

chrome.tabs.onRemoved.addListener((tabId) =>
  serial(async () => {
    const st = await state();
    if (st.source?.tabId === tabId) {
      st.source = null;
      st.active = false;
      await hideOverlay(st, true);
    }
    if (st.overlayTab === tabId) st.overlayTab = null;
    return save();
  }),
);

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tabId = sender.tab?.id;
  if (tabId == null) return;

  switch (msg.type) {
    case 'src:state':
      serial(async () => {
        const st = await state();
        const s = msg.state;
        let changed = false;
        if (st.source?.tabId === tabId) st.sourcePlaying = s.playing;
        // Ownership only moves when another tab actually starts playing (or the
        // current source is idle); periodic reports from a second playing tab
        // must not steal it back and forth.
        const takeOver = !st.source || msg.started || !st.sourcePlaying;
        if (s.playing && st.source?.tabId !== tabId && takeOver) {
          // A different YouTube tab started playing: it becomes the source.
          if (st.source) await hideOverlay(st);
          st.source = { tabId, windowId: sender.tab.windowId };
          st.sourcePlaying = true;
          st.active = false;
          changed = true;
          await save();
        }
        if (st.source?.tabId !== tabId) return;
        if (st.overlayTab != null) {
          sendTab(st.overlayTab, { type: 'pip:state', sid: st.sid, state: s });
        }
        if (changed || msg.important) return evaluate('source');
      });
      break;

    case 'src:rtc':
      serial(async () => {
        const st = await state();
        if (st.source?.tabId !== tabId || st.overlayTab == null || msg.sid !== st.sid) return;
        sendTab(st.overlayTab, { type: 'pip:rtc', sid: msg.sid, data: msg.data });
      });
      break;

    case 'pip:hello':
      if (sender.tab.active) serial(() => evaluate('hello'));
      break;

    case 'pip:rtc':
      serial(async () => {
        const st = await state();
        if (st.overlayTab !== tabId || msg.sid !== st.sid || !st.source) return;
        sendTab(st.source.tabId, { type: 'src:rtc', sid: msg.sid, data: msg.data });
      });
      break;

    case 'pip:cmd':
      serial(async () => {
        const st = await state();
        if (st.overlayTab !== tabId || !st.source) return;
        sendTab(st.source.tabId, { type: 'src:cmd', cmd: msg.cmd, value: msg.value });
      });
      break;

    case 'pip:restore':
      serial(async () => {
        const st = await state();
        if (!st.source) return;
        try {
          const t = await chrome.tabs.update(st.source.tabId, { active: true });
          await chrome.windows.update(t.windowId, { focused: true });
        } catch {}
      });
      break;

    case 'pip:close':
      serial(async () => {
        const st = await state();
        if (st.overlayTab !== tabId) return;
        st.active = false;
        st.overlayTab = null;
        if (st.source) {
          sendTab(st.source.tabId, { type: 'src:cmd', cmd: 'pause' });
          sendTab(st.source.tabId, { type: 'src:rtc-close' });
        }
        return save();
      });
      break;
  }
  reply?.({ ok: true });
});

// Make the extension work in tabs that were already open when it was installed.
chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.url || !/^https?:/.test(tab.url)) continue;
    const files = /^https?:\/\/([^/]+\.)?youtube\.com\//.test(tab.url) ? ['source.js', 'pip.js'] : ['pip.js'];
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files }).catch(() => {});
  }
});

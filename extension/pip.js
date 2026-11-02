// PiP Anywhere — the floating player.
//
// Injected into every page but dormant until the background asks it to
// show. Renders an iOS-style Picture in Picture window in the top layer
// (closed shadow DOM, so the page can't restyle it), receives the live
// frames from the YouTube tab over WebRTC, and implements the iPhone
// gestures: drag with momentum, snap to the side edges, stash off-screen
// behind a blurred tab, pinch / double-tap resize, tap for controls.

(() => {
  if (window.top !== window) return;
  // A previous copy (e.g. one orphaned by an extension reload, which shares
  // this isolated world) gives way to this one.
  try {
    window.__pipOverlay?.dispose();
  } catch {}
  const life = new AbortController();
  window.__pipOverlay = { dispose: () => life.abort() };
  const alive = () => {
    if (chrome.runtime?.id) return true;
    life.abort();
    return false;
  };

  // ---- tuning -------------------------------------------------------------

  const EDGE = 8; // inset from the viewport edges
  const STASH_VISIBLE = 24; // width of the strip left on screen when stashed
  const UNSTASH_PULL = 24; // drag distance out of the edge that brings it back
  const AREAS = [18225, 41006, 81000]; // size detents (px²), aspect-independent
  const DEFAULT_POS = { side: 'right', yFrac: 1, area: AREAS[2], stashed: false };
  const MOVE_SPRING = { response: 0.42, damping: 0.82 };
  const SIZE_SPRING = { response: 0.38, damping: 0.9 };
  const FLY_SPRING = { response: 0.5, damping: 0.86 };
  const DECELERATION = 0.998; // UIScrollView.DecelerationRate.normal
  const CONTROLS_TIMEOUT = 3000;
  const DOUBLE_TAP_MS = 280;
  const STORE_KEY = 'pipPosition';

  const send = (msg) => {
    try {
      return chrome.runtime.sendMessage(msg).catch(() => {});
    } catch {
      return Promise.resolve();
    }
  };

  // ---- SF Symbols–style glyphs ---------------------------------------------

  const ICON = {
    close:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><path d="M5.5 5.5l13 13M18.5 5.5l-13 13"/></svg>',
    restore:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="2.5" y="3.5" width="14.5" height="12" rx="1.8"/>' +
      '<rect x="11" y="10.5" width="10.5" height="9" rx="1.4" fill="currentColor" stroke="none"/>' +
      '</svg>',
    back:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 4.4a8.6 8.6 0 1 0 8.15 5.85"/><path d="M14.1 2.2L12 4.4l2.1 2.2"/>' +
      '<text x="12" y="16.6" text-anchor="middle" font-size="7.6" font-weight="700" fill="currentColor" stroke="none" font-family="-apple-system, \'SF Pro Rounded\', \'SF Pro Text\', Inter, \'Helvetica Neue\', system-ui, sans-serif">10</text></svg>',
    fwd:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 4.4a8.6 8.6 0 1 1-8.15 5.85"/><path d="M9.9 2.2L12 4.4 9.9 6.6"/>' +
      '<text x="12" y="16.6" text-anchor="middle" font-size="7.6" font-weight="700" fill="currentColor" stroke="none" font-family="-apple-system, \'SF Pro Rounded\', \'SF Pro Text\', Inter, \'Helvetica Neue\', system-ui, sans-serif">10</text></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7.2 4.9v14.2c0 .95 1.03 1.54 1.85 1.05l11.7-7.1a1.23 1.23 0 0 0 0-2.1L9.05 3.85C8.23 3.36 7.2 3.95 7.2 4.9z"/></svg>',
    pause:
      '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="5.6" y="4" width="4.6" height="16" rx="1.3"/><rect x="13.8" y="4" width="4.6" height="16" rx="1.3"/></svg>',
    chevronL: '<svg viewBox="0 0 18 30" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 15l5 10"/></svg>',
    chevronR: '<svg viewBox="0 0 18 30" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 5l5 10-5 10"/></svg>',
  };

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .pip {
      position: fixed; left: 0; top: 0;
      pointer-events: auto; touch-action: none;
      user-select: none; -webkit-user-select: none;
      will-change: transform, width, height;
      -webkit-tap-highlight-color: transparent;
      font-family: -apple-system, 'SF Pro Text', Inter, 'Helvetica Neue', system-ui, sans-serif;
      --u: 1;
      --r: 12px;
    }
    .body {
      position: absolute; inset: 0;
      border-radius: var(--r);
      box-shadow: 0 5px 18px rgba(0,0,0,.24), 0 1px 4px rgba(0,0,0,.20);
      transition: opacity .22s ease, transform .3s cubic-bezier(.2,.8,.2,1), border-radius .3s ease;
    }
    .pip.entering .body { border-radius: 0; box-shadow: none; }
    .pip.closing .body { opacity: 0; transform: scale(.86); }
    .pip.hidden .body { opacity: 0; }
    .clip {
      position: absolute; inset: 0; overflow: hidden;
      border-radius: inherit; background: #000;
      isolation: isolate; transform: translateZ(0);
    }
    video, .poster {
      position: absolute; inset: 0; width: 100%; height: 100%;
      object-fit: contain; display: block; pointer-events: none;
    }
    .poster { transition: opacity .3s ease; }
    .poster.gone { opacity: 0; }
    .scrim {
      position: absolute; inset: 0; background: rgba(0,0,0,.22);
      opacity: 0; transition: opacity .2s ease; pointer-events: none;
    }
    .controls { position: absolute; inset: 0; opacity: 0; transition: opacity .2s ease; pointer-events: none; }
    .pip.ctl .scrim, .pip.ctl .controls { opacity: 1; }
    .pip.ctl .controls { pointer-events: auto; }
    .btn {
      position: absolute; display: grid; place-items: center;
      width: calc(40px * var(--u)); height: calc(40px * var(--u));
      padding: 0; margin: 0; border: 0; background: none; color: #fff;
      cursor: default; outline: none;
      transition: opacity .12s ease, transform .12s ease;
      filter: drop-shadow(0 0 6px rgba(0,0,0,.18));
    }
    .btn svg { width: calc(20px * var(--u)); height: calc(20px * var(--u)); display: block; overflow: visible; }
    .btn.pressed { opacity: .45; transform: scale(.92); }
    .btn.restore { top: 0; right: calc(4px * var(--u)); }
    .btn.close { top: 0; left: calc(4px * var(--u)); }
    .btn:focus-visible { outline: 2px solid #fff; border-radius: 6px; }
    .center {
      position: absolute; left: 50%; top: calc(50% + 5px * var(--u)); transform: translate(-50%, -50%);
      display: flex; align-items: center; gap: calc(15px * var(--u));
    }
    .center .btn { position: relative; }
    .center .skip svg { width: calc(25px * var(--u)); height: calc(25px * var(--u)); }
    .center .toggle { width: calc(52px * var(--u)); height: calc(52px * var(--u)); }
    .center .toggle svg { width: calc(33px * var(--u)); height: calc(33px * var(--u)); }
    .progress {
      position: absolute; left: 3.49%; right: 3.49%; bottom: calc(var(--progress-unit) * 9);
      height: calc(var(--progress-unit) * 4); border-radius: calc(var(--progress-unit) * 2);
      overflow: hidden; background: rgba(255,255,255,.4); opacity: .65; pointer-events: none;
    }
    .elapsed { width: 0; height: 100%; border-radius: inherit; background: #fff; }
    .pip.live .progress { display: none; }
    .pip.ad .skip, .pip.live .skip.fwd { opacity: .35; pointer-events: none; }
    .pip.stashed { pointer-events: none; }
    .pip.stashed .body { opacity: 0; pointer-events: none; }
    .stash {
      position: absolute; left: 0; top: 50%; width: ${STASH_VISIBLE}px; height: 96px;
      transform: translateY(-50%); border-radius: 8px 0 0 8px;
      background: rgba(20,20,22,.97); color: rgba(235,235,245,.75);
      backdrop-filter: blur(20px) saturate(180%); -webkit-backdrop-filter: blur(20px) saturate(180%);
      box-shadow: 0 2px 8px rgba(0,0,0,.2);
      opacity: 0; pointer-events: none; transition: opacity .2s ease;
      display: grid; place-items: center;
    }
    .pip.left .stash { left: auto; right: 0; border-radius: 0 8px 8px 0; }
    .pip.stashed .stash { opacity: 1; pointer-events: auto; }
    .stash::before { content: ''; position: absolute; top: -16px; bottom: -16px; left: -20px; right: 0; }
    .pip.left .stash::before { left: 0; right: -20px; }
    .stash svg { width: 18px; height: 30px; }
    .chev { display: none; }
    .pip:not(.left) .chev.l, .pip.left .chev.r { display: block; }

  `;

  // ---- springs ----------------------------------------------------------------

  class Spring {
    constructor(v) {
      this.v = v;
      this.target = v;
      this.vel = 0;
    }
    snap(v) {
      this.v = this.target = v;
      this.vel = 0;
    }
    step(dt, { response, damping }) {
      const k = (2 * Math.PI / response) ** 2;
      const c = (4 * Math.PI * damping) / response;
      const a = -k * (this.v - this.target) - c * this.vel;
      this.vel += a * dt;
      this.v += this.vel * dt;
    }
    get settled() {
      return Math.abs(this.v - this.target) < 0.1 && Math.abs(this.vel) < 1;
    }
  }

  const project = (velocity) => ((velocity / 1000) * DECELERATION) / (1 - DECELERATION);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const rubber = (overshoot, dim) => (1 - 1 / ((overshoot * 0.55) / dim + 1)) * dim;

  // ---- the window ------------------------------------------------------------

  class Pip {
    constructor(opts) {
      this.sid = opts.sid;
      this.state = opts.state || {};
      this.stateAt = performance.now();
      this.aspect = clamp((this.state.w || 16) / (this.state.h || 9), 0.4, 2.6);
      this.pos = { ...DEFAULT_POS };
      this.springX = new Spring(0);
      this.springY = new Spring(0);
      this.springW = new Spring(300);
      this.moveSpring = MOVE_SPRING;
      this.pointers = new Map();
      this.drag = null;
      this.pinch = null;
      this.raf = 0;
      this.lastTap = 0;
      this.tapTimer = 0;
      this.ctlTimer = 0;
      this.pendingCandidates = [];
      this.build(opts.snapshot);
    }

    // DOM -----------------------------------------------------------------------

    build(snapshot) {
      // A built-in element: a custom tag could be pre-registered by the page,
      // which would then reach this closed shadow root via ElementInternals.
      const host = (this.host = document.createElement('div'));
      host.setAttribute('popover', 'manual');
      host.style.cssText = [
        'all:initial',
        'position:fixed',
        'inset:0',
        'width:100vw',
        'height:100vh',
        'max-width:none',
        'max-height:none',
        'margin:0',
        'padding:0',
        'border:0',
        'background:transparent',
        'overflow:visible',
        'pointer-events:none',
        'z-index:2147483647',
        'display:block',
        'color-scheme:normal',
      ]
        .map((d) => d + '!important')
        .join(';');
      const root = host.attachShadow({ mode: 'closed' });
      root.innerHTML = `
        <style>${CSS}</style>
        <div class="pip hidden">
          <div class="body">
            <div class="clip">
              <img class="poster" alt="">
              <video muted playsinline autoplay disablepictureinpicture></video>
              <div class="scrim"></div>
              <div class="controls">
                <button class="btn restore" data-act="restore" aria-label="Back to video tab">${ICON.restore}</button>
                <button class="btn close" data-act="close" aria-label="Close">${ICON.close}</button>
                <div class="center">
                  <button class="btn skip back" data-act="back" aria-label="Back 10 seconds">${ICON.back}</button>
                  <button class="btn toggle" data-act="toggle" aria-label="Play or pause">${ICON.pause}</button>
                  <button class="btn skip fwd" data-act="fwd" aria-label="Forward 10 seconds">${ICON.fwd}</button>
                </div>
                <div class="progress" aria-hidden="true"><div class="elapsed"></div></div>
              </div>
            </div>
          </div>
          <div class="stash" role="button" aria-label="Show video" tabindex="-1">
            <div class="chev l">${ICON.chevronL}</div>
            <div class="chev r">${ICON.chevronR}</div>
          </div>
        </div>`;
      this.el = root.querySelector('.pip');
      this.video = root.querySelector('video');
      this.poster = root.querySelector('.poster');
      this.controls = root.querySelector('.controls');
      this.progress = root.querySelector('.progress');
      this.elapsed = root.querySelector('.elapsed');
      this.controls.inert = true;
      this.stash = root.querySelector('.stash');
      this.toggleBtn = root.querySelector('.toggle');
      if (snapshot) this.poster.src = snapshot;
      else this.poster.classList.add('gone');

      this.video.addEventListener('playing', () => this.firstFrame());
      this.video.addEventListener('resize', () => this.firstFrame());

      this.el.addEventListener('pointerdown', (e) => this.onDown(e));
      this.el.addEventListener('pointermove', (e) => this.onMove(e));
      this.el.addEventListener('pointerup', (e) => this.onUp(e));
      this.el.addEventListener('pointercancel', (e) => this.onUp(e, true));
      this.el.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
      this.el.addEventListener('click', (e) => {
        if (!e.isTrusted || e.detail !== 0) return;
        const btn = e.target.closest('.btn');
        if (btn) this.action(btn.dataset.act);
      });
      this.stash.addEventListener('keydown', (e) => {
        if (!e.isTrusted) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.onTap(); }
      });
      this.el.addEventListener('contextmenu', (e) => e.preventDefault());
      this.el.addEventListener('dragstart', (e) => e.preventDefault());

      this.onResize = () => this.layout(true);
      addEventListener('resize', this.onResize);
      this.keepAlive = setInterval(() => this.ensureMounted(), 1000);
      this.mount();
    }

    // While a page element is fullscreen, everything outside it is inert, so
    // the window has to live inside that element to stay clickable. Media and
    // other replaced elements can't hold children; there it can only paint on top.
    mountParent() {
      const fs = document.fullscreenElement;
      const replaced = fs instanceof HTMLMediaElement || fs instanceof HTMLIFrameElement || fs instanceof HTMLImageElement || fs instanceof HTMLCanvasElement;
      return (fs && !replaced && fs) || document.documentElement || document.body;
    }

    mount() {
      const parent = this.mountParent();
      if (this.host.parentNode !== parent) {
        try {
          this.host.hidePopover();
        } catch {}
        parent.appendChild(this.host);
      }
      // (Re-)entering the top layer also puts the window above a fullscreen
      // element, since later top-layer entries paint on top.
      try {
        this.host.hidePopover();
      } catch {}
      try {
        this.host.showPopover();
      } catch {}
    }

    ensureMounted() {
      if (!alive()) return;
      if (!this.host.isConnected || this.host.parentNode !== this.mountParent()) this.mount();
    }

    raise() {
      this.mount();
    }

    // lifecycle --------------------------------------------------------------

    async show(entrance, rect) {
      try {
        const saved = (await chrome.storage.local.get(STORE_KEY))[STORE_KEY];
        if (saved && saved.side) this.pos = { ...DEFAULT_POS, ...saved };
      } catch {}
      if (this.dead) return;
      this.applyState(this.state);
      const target = this.targetFor(this.pos);
      const from = entrance === 'fly' ? this.fromRect(rect) : null;
      if (from) {
        this.springX.snap(from.x);
        this.springY.snap(from.y);
        this.springW.snap(from.w);
        // Appear solid at the video's old spot (no fade), then fly to the edge.
        const body = this.el.querySelector('.body');
        body.style.transition = 'none';
        this.el.classList.add('entering');
        this.el.classList.remove('hidden');
        this.render();
        void body.offsetWidth;
        body.style.transition = '';
        this.moveSpring = FLY_SPRING;
        requestAnimationFrame(() => {
          this.el.classList.remove('entering');
          this.retarget(target);
        });
      } else {
        this.springX.snap(target.x);
        this.springY.snap(target.y);
        this.springW.snap(target.w);
        this.render();
        requestAnimationFrame(() => this.el.classList.remove('hidden'));
      }
      this.el.classList.toggle('stashed', !!this.pos.stashed);
      this.startRtc();
    }

    // Map the YouTube player's on-screen rect into this viewport so the window
    // appears to shrink out of the video, like leaving an app on iOS.
    fromRect(rect) {
      if (!rect) return null;
      const { vw, vh } = this.viewport();
      const sx = vw / rect.vw;
      const sy = vh / rect.vh;
      let w = rect.w * sx;
      let h = rect.h * sy;
      let x = rect.x * sx;
      let y = rect.y * sy;
      // Fit the video's own aspect inside the element box (letterboxing).
      if (w / h > this.aspect) {
        const nw = h * this.aspect;
        x += (w - nw) / 2;
        w = nw;
      } else {
        const nh = w / this.aspect;
        y += (h - nh) / 2;
        h = nh;
      }
      if (x + w < 0 || y + h < 0 || x > vw || y > vh) return null;
      return { x, y, w };
    }

    destroy(animate) {
      if (this.dead) return;
      this.dead = true;
      clearInterval(this.keepAlive);
      clearTimeout(this.ctlTimer);
      clearTimeout(this.tapTimer);
      clearTimeout(this.wheelTimer);
      cancelAnimationFrame(this.raf);
      cancelAnimationFrame(this.progressRaf);
      removeEventListener('resize', this.onResize);
      try {
        this.pc?.close();
      } catch {}
      const remove = () => {
        try {
          this.host.hidePopover();
        } catch {}
        this.host.remove();
      };
      if (animate && document.visibilityState === 'visible') {
        this.el.classList.add('closing');
        setTimeout(remove, 260);
      } else {
        remove();
      }
    }

    // state from the YouTube tab ---------------------------------------------------

    applyState(s) {
      const wasPlaying = this.state.playing;
      this.state = s;
      this.stateAt = performance.now();
      this.el.classList.toggle('ad', !!s.ad);
      this.el.classList.toggle('live', !!s.live);
      this.el.classList.toggle('paused', !s.playing);
      this.toggleBtn.innerHTML = s.playing ? ICON.pause : ICON.play;
      this.toggleBtn.setAttribute('aria-label', s.playing ? 'Pause' : 'Play');
      this.progress.hidden = !!s.live || !(s.d > 0 && Number.isFinite(s.d));
      this.drawProgress();
      if (s.w && s.h) {
        const a = clamp(s.w / s.h, 0.4, 2.6);
        if (Math.abs(a - this.aspect) > 0.01) {
          this.aspect = a;
          this.layout(false);
        }
      }
      if (!s.playing && this.el.classList.contains('ctl')) clearTimeout(this.ctlTimer);
      else if (s.playing && !wasPlaying && this.el.classList.contains('ctl')) this.scheduleHide();
    }

    currentTime() {
      const s = this.state;
      if (!s.playing) return s.t || 0;
      return (s.t || 0) + ((performance.now() - this.stateAt) / 1000) * (s.rate || 1);
    }

    drawProgress() {
      if (this.dead) return;
      const fraction = this.progress.hidden ? 0 : clamp(this.currentTime() / this.state.d, 0, 1);
      this.elapsed.style.width = `${fraction * 100}%`;
      if (!this.progressRaf && !this.progress.hidden && this.state.playing && this.el.classList.contains('ctl') && !this.pos.stashed) {
        this.progressRaf = requestAnimationFrame(() => {
          this.progressRaf = 0;
          this.drawProgress();
        });
      }
    }

    // WebRTC receiver ---------------------------------------------------------------

    async startRtc() {
      const pc = (this.pc = new RTCPeerConnection());
      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.ontrack = (e) => {
        try {
          e.receiver.jitterBufferTarget = 0;
        } catch {}
        this.video.srcObject = new MediaStream([e.track]);
        this.video.play().catch(() => {});
      };
      pc.onicecandidate = (e) =>
        send({ type: 'pip:rtc', sid: this.sid, data: { candidate: e.candidate ? e.candidate.toJSON() : null } });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (this.dead) return;
      this.sentWant = this.wantHeight();
      send({ type: 'pip:rtc', sid: this.sid, data: { sdp: boostBitrate(offer.sdp), want: this.sentWant } });
    }

    // Device pixels the window shows at its resting size; the sender scales its
    // encode down to this.
    wantHeight() {
      return Math.ceil((this.targetFor(this.pos).w / this.aspect) * (devicePixelRatio || 1));
    }

    syncWant() {
      const want = this.wantHeight();
      if (!this.sentWant || Math.abs(want - this.sentWant) / this.sentWant < 0.1) return;
      this.sentWant = want;
      send({ type: 'pip:rtc', sid: this.sid, data: { want } });
    }

    async onRtc(data) {
      if (!this.pc || this.dead) return;
      if (data.sdp) {
        await this.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
        for (const c of this.pendingCandidates) this.pc.addIceCandidate(c).catch(() => {});
        this.pendingCandidates = [];
      } else if (data.candidate) {
        if (this.pc.remoteDescription) this.pc.addIceCandidate(data.candidate).catch(() => {});
        else this.pendingCandidates.push(data.candidate);
      }
    }

    firstFrame() {
      if (!this.video.videoWidth) return;
      const reveal = () => this.poster.classList.add('gone');
      if (this.video.requestVideoFrameCallback) this.video.requestVideoFrameCallback(reveal);
      else reveal();
    }

    // geometry -------------------------------------------------------------------

    viewport() {
      const de = document.documentElement;
      return {
        vw: (de && de.clientWidth) || innerWidth,
        vh: Math.min(innerHeight, (de && de.clientHeight) || innerHeight) || innerHeight,
      };
    }

    sizeFor(area) {
      const { vw, vh } = this.viewport();
      let w = Math.sqrt(area * this.aspect);
      const maxW = Math.max(1, Math.min(vw - EDGE * 2, (vh - EDGE * 2) * this.aspect));
      w = clamp(w, Math.min(96, maxW), maxW);
      return { w, h: w / this.aspect };
    }

    bounds(w, h) {
      const { vw, vh } = this.viewport();
      return { minX: EDGE, maxX: vw - w - EDGE, minY: EDGE, maxY: Math.max(EDGE, vh - h - EDGE), vw, vh };
    }

    targetFor(pos) {
      const { w, h } = this.sizeFor(pos.area);
      const b = this.bounds(w, h);
      const y = b.minY + clamp(pos.yFrac, 0, 1) * (b.maxY - b.minY);
      let x;
      if (pos.side === 'left') x = pos.stashed ? STASH_VISIBLE - w : b.minX;
      else x = pos.stashed ? b.vw - STASH_VISIBLE : b.maxX;
      return { x, y, w };
    }

    retarget(t) {
      this.springX.target = t.x;
      this.springY.target = t.y;
      this.springW.target = t.w;
      this.kick();
    }

    // Re-derive the target after a size / aspect / viewport change, keeping the
    // window pinned to its edge.
    layout(immediate) {
      if (this.drag) return;
      const t = this.targetFor(this.pos);
      if (immediate) {
        this.springX.snap(t.x);
        this.springY.snap(t.y);
        this.springW.snap(t.w);
        this.render();
      } else {
        this.retarget(t);
      }
    }

    render() {
      const w = this.springW.v;
      const h = w / this.aspect;
      const s = this.el.style;
      s.transform = `translate3d(${this.springX.v.toFixed(2)}px, ${this.springY.v.toFixed(2)}px, 0)`;
      s.width = w.toFixed(2) + 'px';
      s.height = h.toFixed(2) + 'px';
      const u = clamp(w / 344, 0.55, 1.15);
      s.setProperty('--u', u.toFixed(3));
      s.setProperty('--progress-unit', (w / 344).toFixed(4) + 'px');
      s.setProperty('--r', clamp(w * 0.04, 5, 16).toFixed(1) + 'px');
      this.el.classList.toggle('left', this.pos.side === 'left');
      this.stash.tabIndex = this.pos.stashed ? 0 : -1;
    }

    kick() {
      if (this.raf) return;
      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
        const h = dt / steps;
        for (let i = 0; i < steps; i++) {
          if (!this.drag) {
            this.springX.step(h, this.moveSpring);
            this.springY.step(h, this.moveSpring);
          }
          this.springW.step(h, SIZE_SPRING);
        }
        this.render();
        const settled = this.springX.settled && this.springY.settled && this.springW.settled;
        if (this.drag || this.pinch || !settled) {
          this.raf = requestAnimationFrame(tick);
        } else {
          this.raf = 0;
          this.moveSpring = MOVE_SPRING;
          this.springX.snap(this.springX.target);
          this.springY.snap(this.springY.target);
          this.springW.snap(this.springW.target);
          this.render();
        }
      };
      this.raf = requestAnimationFrame(tick);
    }

    savePos() {
      this.syncWant();
      chrome.storage.local.set({ [STORE_KEY]: this.pos }).catch(() => {});
    }

    // gestures ---------------------------------------------------------------------

    onDown(e) {
      if (!e.isTrusted || (e.button !== 0 && e.pointerType === 'mouse')) return;
      e.preventDefault();
      this.el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.pointers.size === 2) {
        this.drag?.btn?.classList.remove('pressed');
        clearTimeout(this.tapTimer);
        this.lastTap = 0;
        this.hideControls();
        // Touch pinch.
        this.drag = null;
        this.springX.snap(this.springX.v);
        this.springY.snap(this.springY.v);
        const [a, b] = [...this.pointers.values()];
        this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), area: this.currentArea() };
        return;
      }
      const btn = e.composedPath().find((n) => n.classList?.contains('btn'));
      if (btn && this.el.classList.contains('ctl')) btn.classList.add('pressed');
      this.drag = {
        id: e.pointerId,
        btn,
        startX: e.clientX,
        startY: e.clientY,
        offX: e.clientX - this.springX.v,
        offY: e.clientY - this.springY.v,
        x0: this.springX.v,
        fromStash: this.pos.stashed ? this.pos.side : null,
        moved: false,
        t0: performance.now(),
        samples: [{ t: performance.now(), x: e.clientX, y: e.clientY }],
      };
      this.springX.vel = this.springY.vel = 0;
      this.kick();
    }

    onMove(e) {
      if (!this.pointers.has(e.pointerId)) {
        if (this.el.classList.contains('ctl') && this.state.playing) this.scheduleHide();
        return;
      }
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.pinch && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const scale = Math.hypot(a.x - b.x, a.y - b.y) / this.pinch.dist;
        this.resizeTo(this.pinch.area * scale * scale, false);
        return;
      }
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 5) {
        d.moved = true;
        this.lastTap = 0;
        this.hideControls();
        d.btn?.classList.remove('pressed');
        clearTimeout(this.tapTimer);
        if (this.pos.stashed) {
          this.pos.stashed = false;
          this.el.classList.remove('stashed');
        }
      }
      if (!d.moved) return;
      const now = performance.now();
      d.samples.push({ t: now, x: e.clientX, y: e.clientY });
      while (d.samples.length > 2 && now - d.samples[0].t > 100) d.samples.shift();

      const w = this.springW.v;
      const h = w / this.aspect;
      const b = this.bounds(w, h);
      let x = e.clientX - d.offX;
      let y = e.clientY - d.offY;
      // Free horizontally (that's how you push it into the edge to stash it),
      // rubber-banded past the stash point and vertically past the insets.
      const minX = STASH_VISIBLE - w;
      const maxX = b.vw - STASH_VISIBLE;
      if (x < minX) x = minX - rubber(minX - x, w);
      if (x > maxX) x = maxX + rubber(x - maxX, w);
      if (y < b.minY) y = b.minY - rubber(b.minY - y, h);
      if (y > b.maxY) y = b.maxY + rubber(y - b.maxY, h);
      this.springX.snap(x);
      this.springY.snap(y);
      this.render();
    }

    onUp(e, cancelled) {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      try {
        this.el.releasePointerCapture(e.pointerId);
      } catch {}

      if (this.pinch) {
        if (this.pointers.size < 2) {
          this.pinch = null;
          this.drag = null;
          this.settleSize();
        }
        return;
      }
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      this.drag = null;
      d.btn?.classList.remove('pressed');

      if (!d.moved) {
        if (!cancelled) this.onTap(d.btn);
        this.kick();
        return;
      }

      // Release velocity from the last ~100ms of movement.
      const first = d.samples[0];
      const lastS = d.samples[d.samples.length - 1];
      const dt = Math.max(0.016, (lastS.t - first.t) / 1000);
      const stale = performance.now() - lastS.t > 80;
      const vx = cancelled || stale ? 0 : (lastS.x - first.x) / dt;
      const vy = cancelled || stale ? 0 : (lastS.y - first.y) / dt;
      this.release(vx, vy, d);
    }

    release(vx, vy, d) {
      const w = this.springW.v;
      const h = w / this.aspect;
      const b = this.bounds(w, h);
      const x = this.springX.v;
      const y = this.springY.v;
      const px = x + project(vx);
      const py = y + project(vy);
      const center = x + w / 2;
      const pCenter = px + w / 2;

      const offLeft = -x; // how much is pushed past the left edge
      const offRight = x + w - b.vw;
      let side = pCenter < b.vw / 2 ? 'left' : 'right';
      let stashed = false;
      if (center < b.vw / 2 && (offLeft > w * 0.3 || (px < -w * 0.45 && vx < 0))) {
        side = 'left';
        stashed = true;
      } else if (center >= b.vw / 2 && (offRight > w * 0.3 || (px + w > b.vw + w * 0.45 && vx > 0))) {
        side = 'right';
        stashed = true;
      }
      if (d?.fromStash) {
        // Pulling the tab out only takes a short tug or a flick, and it comes
        // back on the same edge. Momentum never throws it across; it only
        // changes sides if it was actually dragged past the middle.
        const out = d.fromStash === 'left' ? 1 : -1;
        const pulled = (x - d.x0) * out;
        const outV = vx * out;
        stashed = outV < -300 || (pulled < UNSTASH_PULL && outV < 300);
        const crossed = out === 1 ? center > b.vw / 2 : center < b.vw / 2;
        side = !stashed && crossed ? (center < b.vw / 2 ? 'left' : 'right') : d.fromStash;
        if (!stashed && !crossed) vx = Math.sign(vx) * Math.min(Math.abs(vx), 1200);
      }
      const ty = clamp(py, b.minY, b.maxY);
      this.pos = {
        ...this.pos,
        side,
        stashed,
        yFrac: b.maxY > b.minY ? (ty - b.minY) / (b.maxY - b.minY) : 0,
      };
      this.el.classList.toggle('stashed', stashed);
      if (stashed) this.hideControls();
      this.springX.vel = vx;
      this.springY.vel = vy;
      this.retarget(this.targetFor(this.pos));
      this.savePos();
    }

    onTap(btn) {
      if (this.pos.stashed) {
        this.pos.stashed = false;
        this.el.classList.remove('stashed');
        this.stash.tabIndex = -1;
        this.retarget(this.targetFor(this.pos));
        this.savePos();
        return;
      }
      if (btn && this.el.classList.contains('ctl')) {
        this.action(btn.dataset.act);
        return;
      }
      const now = performance.now();
      if (now - this.lastTap < DOUBLE_TAP_MS) {
        this.lastTap = 0;
        clearTimeout(this.tapTimer);
        this.toggleSize();
        return;
      }
      this.lastTap = now;
      // Like iOS, a single tap waits for a possible double-tap first.
      this.tapTimer = setTimeout(() => this.toggleControls(), DOUBLE_TAP_MS);
    }

    onWheel(e) {
      // Trackpad pinch arrives as ctrl+wheel in Chromium.
      if (!e.isTrusted || !e.ctrlKey) return;
      e.preventDefault();
      if (this.pos.stashed) return;
      const area = this.currentArea() * Math.exp(-e.deltaY * 0.02);
      this.resizeTo(area, true);
      clearTimeout(this.wheelTimer);
      this.wheelTimer = setTimeout(() => this.settleSize(), 140);
    }

    currentArea() {
      const w = this.springW.target;
      return (w * w) / this.aspect;
    }

    resizeTo(area, animated) {
      const lo = AREAS[0] * 0.75;
      const hi = AREAS[AREAS.length - 1] * 1.25;
      area = clamp(area, lo, hi);
      this.pos = { ...this.pos, area };
      const t = this.targetFor(this.pos);
      if (animated) {
        this.retarget(t);
      } else {
        this.springW.snap(t.w);
        this.springX.snap(t.x);
        this.springY.snap(t.y);
        this.render();
      }
    }

    settleSize() {
      const a = this.pos.area;
      let best = AREAS[0];
      for (const d of AREAS) if (Math.abs(Math.log(d / a)) < Math.abs(Math.log(best / a))) best = d;
      this.pos = { ...this.pos, area: best };
      this.retarget(this.targetFor(this.pos));
      this.savePos();
    }

    toggleSize() {
      const index = AREAS.findIndex((a) => a >= this.pos.area * 0.95);
      const area = AREAS[(index + 1) % AREAS.length];
      this.pos = { ...this.pos, area };
      this.retarget(this.targetFor(this.pos));
      this.savePos();
    }

    // controls -------------------------------------------------------------------

    toggleControls() {
      if (this.el.classList.contains('ctl')) this.hideControls();
      else this.showControls();
    }

    showControls() {
      this.el.classList.add('ctl');
      this.controls.inert = false;
      this.drawProgress();
      this.scheduleHide();
    }

    hideControls() {
      this.el.classList.remove('ctl');
      this.controls.inert = true;
      cancelAnimationFrame(this.progressRaf);
      this.progressRaf = 0;
      clearTimeout(this.ctlTimer);
    }

    scheduleHide() {
      clearTimeout(this.ctlTimer);
      if (!this.state.playing) return;
      this.ctlTimer = setTimeout(() => this.hideControls(), CONTROLS_TIMEOUT);
    }

    action(act) {
      switch (act) {
        case 'toggle': {
          const playing = !this.state.playing;
          this.applyState({ ...this.state, t: this.currentTime(), playing });
          send({ type: 'pip:cmd', cmd: 'toggle' });
          break;
        }
        case 'back':
        case 'fwd': {
          const delta = act === 'back' ? -10 : 10;
          const t = clamp(this.currentTime() + delta, 0, this.state.d || Infinity);
          this.applyState({ ...this.state, t });
          send({ type: 'pip:cmd', cmd: 'seek', value: delta });
          break;
        }
        case 'close':
          send({ type: 'pip:close' });
          this.destroy(true);
          ui = null;
          return;
        case 'restore':
          this.hideControls();
          send({ type: 'pip:restore' });
          return;
      }
      this.scheduleHide();
    }
  }

  // Raise the encoder's starting / floor bitrate: this is a loopback link, so
  // there's no reason to ramp up from a blurry first few seconds.
  function boostBitrate(sdp) {
    const lines = sdp.split('\r\n');
    const codecs = new Set();
    const hasFmtp = new Set();
    for (const l of lines) {
      const rtp = /^a=rtpmap:(\d+) (VP8|VP9|H264|AV1)\/90000/.exec(l);
      if (rtp) codecs.add(rtp[1]);
      const fm = /^a=fmtp:(\d+) /.exec(l);
      if (fm) hasFmtp.add(fm[1]);
    }
    const flags = 'x-google-start-bitrate=4000;x-google-min-bitrate=1000;x-google-max-bitrate=8000';
    const out = [];
    for (const l of lines) {
      const fm = /^a=fmtp:(\d+) /.exec(l);
      out.push(fm && codecs.has(fm[1]) ? `${l};${flags}` : l);
      const rtp = /^a=rtpmap:(\d+) /.exec(l);
      if (rtp && codecs.has(rtp[1]) && !hasFmtp.has(rtp[1])) out.push(`a=fmtp:${rtp[1]} ${flags}`);
    }
    return out.join('\r\n');
  }

  // ---- wiring ---------------------------------------------------------------------

  let ui = null;

  const onMessage = (msg, _sender, reply) => {
    if (!alive()) return;
    switch (msg.type) {
      case 'pip:show':
        ui?.destroy(false);
        ui = new Pip(msg);
        ui.show(msg.entrance, msg.rect).catch(() => {});
        reply({ ok: true });
        return;
      case 'pip:hide':
        ui?.destroy(msg.animate);
        ui = null;
        break;
      case 'pip:ping':
        reply({ ok: !!ui && !ui.dead && ui.sid === msg.sid });
        return;
      case 'pip:state':
        if (ui && ui.sid === msg.sid) ui.applyState(msg.state);
        break;
      case 'pip:rtc':
        if (ui && ui.sid === msg.sid) ui.onRtc(msg.data).catch(() => {});
        break;
      default:
        // Not ours (e.g. a source query reaching a tab that left YouTube):
        // stay silent so the sender sees no receiver.
        return;
    }
    reply({ ok: true });
  };
  chrome.runtime.onMessage.addListener(onMessage);

  life.signal.addEventListener('abort', () => {
    ui?.destroy(false);
    ui = null;
    try {
      chrome.runtime.onMessage.removeListener(onMessage);
    } catch {}
  });

  // Back/forward cache: drop the stale window on the way out and ask the
  // router to reconcile when the page comes back.
  const opts = { signal: life.signal };
  addEventListener('pagehide', (e) => {
    if (!e.persisted) return;
    ui?.destroy(false);
    ui = null;
  }, opts);
  addEventListener('pageshow', (e) => {
    if (e.persisted && alive()) send({ type: 'pip:hello' });
  }, opts);
  document.addEventListener('fullscreenchange', () => ui?.raise(), opts);

  send({ type: 'pip:hello' });
})();

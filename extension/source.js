// PiP Anywhere — YouTube side.
//
// Reports the main player's state to the background and, when another tab
// hosts the floating player, streams the real <video> frames to it with
// captureStream() + a local RTCPeerConnection. Audio keeps playing here.

(() => {
  // A previous copy (e.g. one orphaned by an extension reload, which shares
  // this isolated world) gives way to this one.
  try {
    window.__pipSource?.dispose();
  } catch {}
  const life = new AbortController();
  window.__pipSource = { dispose: () => life.abort() };
  const opts = { capture: true, signal: life.signal };

  // Diagnostics, off unless enabled with chrome.storage.local.set({ pipDebug: true })
  // (e.g. from the service worker's DevTools console). When on: a small ring
  // buffer (__pipLog in this content script's context) mirrored to console.debug.
  let debug = false;
  chrome.storage.local.get('pipDebug').then((r) => (debug = !!r.pipDebug), () => {});
  const onStorage = (changes, area) => {
    if (area === 'local' && 'pipDebug' in changes) debug = !!changes.pipDebug.newValue;
  };
  chrome.storage.onChanged.addListener(onStorage);
  const log = (...parts) => {
    if (!debug) return;
    const buf = (window.__pipLog ||= []);
    buf.push([new Date().toISOString().slice(11, 23), ...parts.map((x) => (typeof x === 'string' ? x : JSON.stringify(x)))].join(' '));
    if (buf.length > 400) buf.shift();
    console.debug('[PiP]', ...parts);
  };

  const MAX_SEND_HEIGHT = 720;
  const MAX_SEND_FPS = 30;

  let video = null;
  let stream = null;
  let streamVideo = null;
  let streamSrc = '';
  let pc = null;
  let sid = 0;
  let gen = 0;
  let attaching = null;
  let sender = null;
  let pendingCandidates = [];
  let wantHeight = MAX_SEND_HEIGHT;
  let lastTick = 0;

  const send = (msg) => {
    if (!chrome.runtime?.id) {
      // Extension was reloaded: this orphaned copy shuts itself down.
      life.abort();
      return;
    }
    try {
      chrome.runtime.sendMessage(msg).catch(() => {});
    } catch {}
  };

  function findVideo() {
    const shorts = location.pathname.startsWith('/shorts');
    const selectors = shorts
      ? ['ytd-reel-video-renderer[is-active] video', 'ytm-reel-item-renderer[is-active] video', '#shorts-player video', '#movie_player video']
      : ['#movie_player video', 'ytmusic-player video', 'video.html5-main-video'];
    for (const sel of selectors) {
      const v = document.querySelector(sel);
      if (v) return v;
    }
    return null;
  }

  function isMain(v) {
    return v instanceof HTMLVideoElement && !v.closest('ytd-video-preview, #inline-preview-player, #video-preview') && v === findVideo();
  }

  function snapshotState() {
    const v = findVideo();
    if (v !== video) {
      video = v;
      if (sender) attachTrack();
    }
    if (!v) return { hasVideo: false, playing: false, visible: document.visibilityState === 'visible' };
    const player = v.closest('.html5-video-player');
    const d = v.duration;
    return {
      hasVideo: true,
      playing: !v.paused && !v.ended,
      // Actually showing frames (not stuck before the first one, e.g. when
      // autoplay in a background tab is blocked).
      ready: v.readyState >= 3 && v.videoWidth > 0,
      t: v.currentTime,
      d: Number.isFinite(d) ? d : 0,
      rate: v.playbackRate || 1,
      w: v.videoWidth || 16,
      h: v.videoHeight || 9,
      ad: !!player?.classList.contains('ad-showing'),
      live: !Number.isFinite(d) || !!player?.querySelector('.ytp-live'),
      title: document.title.replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube$/, ''),
      visible: document.visibilityState === 'visible',
    };
  }

  // Switching to a tab whose video is already playing (it may have started while
  // the tab was hidden) counts as starting to watch it, once it shows frames, so
  // it takes the floating window over from another playing tab.
  let claim = false;

  function report(important, started = false) {
    const state = snapshotState();
    if (!state.visible) claim = false;
    else if (claim && state.playing && state.ready) {
      claim = false;
      started = true;
    }
    send({ type: 'src:state', important, started, state });
  }

  function frameSnapshot() {
    const v = video;
    if (!v || !v.videoWidth || v.readyState < 2) return null;
    try {
      const w = Math.min(640, v.videoWidth);
      const h = Math.round((w * v.videoHeight) / v.videoWidth);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d').drawImage(v, 0, 0, w, h);
      return c.toDataURL('image/jpeg', 0.85);
    } catch {
      return null;
    }
  }

  function videoRect() {
    if (!video) return null;
    const r = video.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) return null;
    return {
      x: r.left,
      y: r.top,
      w: r.width,
      h: r.height,
      vw: document.documentElement.clientWidth || innerWidth,
      vh: innerHeight,
    };
  }

  // ---- media events -------------------------------------------------------

  const IMPORTANT = ['play', 'pause', 'playing', 'ended', 'emptied', 'loadedmetadata', 'seeked', 'ratechange', 'durationchange', 'resize'];
  for (const ev of IMPORTANT) {
    document.addEventListener(
      ev,
      (e) => {
        if (!isMain(e.target)) return;
        video = e.target;
        if (sender && (ev === 'loadedmetadata' || ev === 'playing' || ev === 'resize' || ev === 'emptied')) attachTrack();
        report(ev !== 'resize', ev === 'play');
      },
      opts,
    );
  }
  document.addEventListener(
    'timeupdate',
    (e) => {
      if (!isMain(e.target)) return;
      const changed = video !== e.target;
      video = e.target;
      if (changed && sender) attachTrack();
      const now = performance.now();
      if (now - lastTick < 250) return;
      lastTick = now;
      report(false);
    },
    opts,
  );
  document.addEventListener(
    'visibilitychange',
    () => {
      claim = document.visibilityState === 'visible';
      report(true);
    },
    opts,
  );
  // Back/forward cache: the peer connection belongs to the old visit.
  addEventListener('pagehide', (e) => e.persisted && closePc(), opts);
  addEventListener('pageshow', (e) => e.persisted && report(true), opts);

  // ---- WebRTC sender ------------------------------------------------------

  function currentTrack() {
    if (!video) return null;
    if (
      !stream || streamVideo !== video || streamSrc !== video.currentSrc ||
      (video.readyState >= 2 && !stream.getVideoTracks().some((t) => t.readyState === 'live'))
    ) {
      try {
        stream?.getTracks().forEach((t) => t.stop());
        stream = video.captureStream();
        streamVideo = video;
        streamSrc = video.currentSrc;
        log('capture', { src: streamSrc.slice(-12), ready: video.readyState, tracks: stream.getVideoTracks().length });
        stream.addEventListener('addtrack', (e) => {
          log('capture addtrack', e.track.kind);
          attachTrack();
        });
      } catch (err) {
        log('captureStream failed', String(err));
        stream = null;
        return null;
      }
    }
    return stream.getVideoTracks().find((t) => t.readyState === 'live') || null;
  }

  async function attachTrack() {
    if (!sender) return;
    const track = currentTrack();
    if (track && sender.track !== track && attaching !== track) {
      attaching = track;
      try {
        track.contentHint = 'motion';
        await sender.replaceTrack(track);
        log('replaceTrack', { id: track.id.slice(0, 8), w: video?.videoWidth, h: video?.videoHeight });
        for (const ev of ['ended', 'mute', 'unmute']) track.addEventListener(ev, () => log('track', ev, track.id.slice(0, 8)));
      } catch (err) {
        log('replaceTrack failed', String(err));
      } finally {
        attaching = null;
      }
    } else if (!track) {
      log('attachTrack: no live track', { ready: video?.readyState, tracks: stream?.getVideoTracks().map((t) => t.readyState) });
    }
    tune();
  }

  async function tune() {
    if (!sender) return;
    try {
      const p = sender.getParameters();
      if (!p.encodings || !p.encodings.length) return;
      // Encode only the pixels the floating window actually shows: encoding
      // is by far the most expensive part of the pipeline.
      const h = video?.videoHeight || MAX_SEND_HEIGHT;
      const target = Math.max(144, Math.min(MAX_SEND_HEIGHT, wantHeight));
      p.encodings[0].maxBitrate = 8_000_000;
      p.encodings[0].maxFramerate = MAX_SEND_FPS;
      p.encodings[0].scaleResolutionDownBy = Math.max(1, h / target);
      p.degradationPreference = 'maintain-resolution';
      await sender.setParameters(p);
    } catch (err) {
      log('setParameters failed', String(err));
    }
  }

  // Snapshot of the sending side, logged when the floating window reports a freeze.
  async function diagnose(reason) {
    const v = video;
    const q = v?.getVideoPlaybackQuality?.();
    const out = {
      reason,
      visible: document.visibilityState,
      video: v && { t: +v.currentTime.toFixed(2), paused: v.paused, ready: v.readyState, w: v.videoWidth, frames: q?.totalVideoFrames, dropped: q?.droppedVideoFrames, same: v === findVideo() },
      track: sender?.track && { state: sender.track.readyState, muted: sender.track.muted, enabled: sender.track.enabled },
      pc: pc && { conn: pc.connectionState, ice: pc.iceConnectionState },
    };
    try {
      (await pc?.getStats())?.forEach((r) => {
        if (r.type === 'outbound-rtp' && r.kind === 'video') out.out = { sent: r.framesSent, encoded: r.framesEncoded, fps: r.framesPerSecond, w: r.frameWidth, h: r.frameHeight, limit: r.qualityLimitationReason, enc: r.encoderImplementation };
        if (r.type === 'media-source' && r.kind === 'video') out.srcFrames = r.frames;
      });
    } catch {}
    // Frames decoded by the YouTube <video> over one second: 0 means the
    // browser stopped decoding video in this (hidden) tab.
    const f0 = q?.totalVideoFrames;
    await new Promise((r) => setTimeout(r, 1000));
    out.decodedPerSec = (v?.getVideoPlaybackQuality?.().totalVideoFrames ?? 0) - (f0 ?? 0);
    log('diagnose', out);
  }

  function closePc() {
    sender = null;
    pendingCandidates = [];
    if (pc) {
      try {
        pc.close();
      } catch {}
      pc = null;
    }
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
      streamVideo = null;
      streamSrc = '';
    }
  }

  async function onRtc(msgSid, data) {
    if (data.sdp) {
      closePc();
      sid = msgSid;
      gen = data.gen || 0;
      if (data.want) wantHeight = data.want;
      video = findVideo() || video;
      const mine = (pc = new RTCPeerConnection());
      log('rtc offer', { sid: msgSid, gen, want: wantHeight });
      const myGen = gen;
      mine.onconnectionstatechange = () => log('rtc state', mine.connectionState);
      mine.onicecandidate = (e) => send({ type: 'src:rtc', sid: msgSid, data: { gen: myGen, candidate: e.candidate ? e.candidate.toJSON() : null } });
      await mine.setRemoteDescription({ type: 'offer', sdp: data.sdp });
      if (pc !== mine) return;
      const tr = mine.getTransceivers()[0];
      tr.direction = 'sendonly';
      sender = tr.sender;
      await attachTrack();
      const answer = await mine.createAnswer();
      await mine.setLocalDescription(answer);
      if (pc !== mine) return;
      send({ type: 'src:rtc', sid: msgSid, data: { gen: myGen, sdp: mine.localDescription.sdp } });
      tune();
      for (const c of pendingCandidates) mine.addIceCandidate(c).catch(() => {});
      pendingCandidates = [];
    } else if (data.want && msgSid === sid) {
      wantHeight = data.want;
      tune();
    } else if (data.candidate && msgSid === sid && (data.gen || 0) === gen) {
      if (pc?.remoteDescription) pc.addIceCandidate(data.candidate).catch(() => {});
      else pendingCandidates.push(data.candidate);
    }
  }

  // ---- commands -------------------------------------------------------------

  function command(cmd, value) {
    if (cmd === 'diag') return debug && diagnose(value);
    const v = findVideo();
    if (!v) return;
    switch (cmd) {
      case 'toggle':
        if (v.paused || v.ended) v.play().catch(() => {});
        else v.pause();
        break;
      case 'play':
        v.play().catch(() => {});
        break;
      case 'pause':
        v.pause();
        break;
      case 'seek': {
        const end = Number.isFinite(v.duration) ? v.duration - 0.25 : Infinity;
        v.currentTime = Math.max(0, Math.min(end, v.currentTime + value));
        break;
      }
    }
  }

  const onMessage = (msg, _sender, reply) => {
    switch (msg.type) {
      case 'src:query': {
        video = findVideo();
        reply({
          state: snapshotState(),
          snapshot: msg.snapshot ? frameSnapshot() : null,
          rect: videoRect(),
        });
        return;
      }
      case 'src:rtc':
        onRtc(msg.sid, msg.data).catch(() => {});
        break;
      case 'src:rtc-close':
        closePc();
        break;
      case 'src:cmd':
        command(msg.cmd, msg.value);
        break;
      default:
        // pip.js in this same tab answers its own messages.
        return;
    }
    reply({ ok: true });
  };
  chrome.runtime.onMessage.addListener(onMessage);

  life.signal.addEventListener('abort', () => {
    closePc();
    try {
      chrome.runtime.onMessage.removeListener(onMessage);
      chrome.storage.onChanged.removeListener(onStorage);
    } catch {}
  });
})();

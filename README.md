# PiP Anywhere – Floating Player for YouTube

A Chrome / Brave extension that keeps your YouTube video playing in a floating
picture-in-picture window while you use other tabs. It works like picture-in-picture
on a phone: drag the window with a flick, it snaps to an edge, and you can tuck it
away against the edge.

- **Stays out of the way on YouTube.** The YouTube tab behaves normally. The window
  only appears when you switch to another tab while a video is playing.
- **Same video, same sound.** The frames are streamed live from the YouTube tab, so
  nothing reloads and the audio keeps playing without a gap.
- **Drag, snap and hide.** Throw it with momentum and it snaps to the left or right
  edge at any height. Push it into the edge and it hides behind a small tab; tug the
  tab to bring it back.
- **Resize.** Double-click it or pinch on a trackpad to switch between three sizes.
- **Controls.** Tap to show close, back to the video tab, skip back/forward 10 seconds,
  play/pause, and a progress bar.
- **Private.** No accounts, no analytics, no network requests. See [PRIVACY.md](PRIVACY.md).

## Install

From the Chrome Web Store (link coming once the listing is approved), or from source:

1. Open `chrome://extensions` (or `brave://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select the `extension/` folder.

## How it works

| File | Role |
| --- | --- |
| `extension/source.js` | Runs on youtube.com. Reports the player's state and streams the `<video>` frames with `captureStream()` over a local `RTCPeerConnection`, scaled to the size the floating window actually shows. |
| `extension/pip.js` | Runs on every page but stays idle until needed. Draws the floating window in a closed shadow root in the browser's top layer, with spring physics, edge snapping, hiding and resizing. |
| `extension/background.js` | Service worker. Tracks which YouTube tab is playing and which tab shows the window, and relays state, commands and WebRTC signaling between them. |

The video never leaves your computer: the WebRTC connection is between two tabs of
your own browser, with no servers involved.

## Limitations

- The window floats inside browser pages. It can't appear over other apps.
- It doesn't appear on browser-internal pages (new tab page, settings, the Web Store);
  the audio keeps playing there.
- YouTube only for now.

## Development

Headless browser tests live in `dev/` (Puppeteer, using the system Chromium or Brave):

```bash
cd dev && npm install
node review.mjs /tmp/pip-results 2 --full   # full functional + visual suite
node unstash.mjs                            # edge hide/unhide gestures
node perf.mjs 1                             # CPU / memory with the extension
```

YouTube stops playback after about 30 seconds in headless automation (with or
without the extension), so the tests keep each session short.

Not affiliated with YouTube, Google or Apple.

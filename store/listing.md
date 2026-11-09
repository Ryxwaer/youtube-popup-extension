# Chrome Web Store listing

The text and answers entered in the developer dashboard, kept here so the
listing can be reviewed and updated alongside the code.

## Store listing

**Name** (from the manifest, ≤75 chars): Picture in Picture for YouTube – iOS-style Floating Player

**Summary** (from the manifest, ≤132 chars): A floating mini player for YouTube on every tab. Drag it, pinch to resize, tuck it into the edge, just like PiP on iPhone.

**Category:** Tools · **Language:** English

**Description:**

```
Watch YouTube in a floating picture-in-picture window while you use other tabs. It works like PiP on iPhone, brought to your desktop browser.

• Start a video and switch tabs. It follows you in a small floating player, and the sound never stops.
• Drag it anywhere. Flick it and it glides to an edge.
• Pinch or double-tap to resize. Pick your sizes in the settings.
• Push it into the edge to hide it. Pull it back anytime.
• Tap it for play, pause, skip 10 seconds, or back to YouTube.

No account, no tracking. The video never leaves your browser.

Works on regular web pages in Chrome, Brave and other Chromium browsers.

Not affiliated with YouTube, Google or Apple.
```

**Homepage URL:** https://github.com/Ryxwaer/youtube-popup-extension
**Support URL:** https://github.com/Ryxwaer/youtube-popup-extension/issues

**Images:** `screenshot-1-corner.png` … `screenshot-5-controls.png` (1280×800),
`promo-small-440x280.png`, `promo-marquee-1400x560.png`, store icon
`extension/icons/icon128.png`. The screenshots are poses from the promo take
(`dev/promo-video/shots.mjs` + `stills.mjs`) and show the Azuki Elementals trailer
(© Azuki) playing in claude.ai. The tiles (`tiles.mjs`) are our own artwork only: a
generic browser and an abstract scene, with no third-party UI or footage.

**Promo video:** https://www.youtube.com/watch?v=sXBby2GZxbY (unlisted).

## Privacy practices

**Single purpose:** Show the YouTube video you are watching in a floating
picture-in-picture window on your other tabs.

**Permission justifications:**

- `scripting`: Adds the floating-window script to tabs that were already open before
  the extension was installed, so the window can appear there without reloading the
  page.
- `storage`: Saves the window's last position and size on your device, and keeps
  temporary session state (which tab is playing the video) in session storage.
- Host permission `<all_urls>`: The floating window has to be drawn on whichever
  website you switch to, so the script runs on all sites. It only adds the window and
  does not read or change the page's content. On youtube.com it reads the playing
  video so it can stream it to that window.

**Remote code:** No. All code is included in the package.

**Data usage:** No user data is collected or transmitted. All three disclosure
certifications are checked.

**Privacy policy:** https://github.com/Ryxwaer/youtube-popup-extension/blob/main/PRIVACY.md

## Distribution

Free · Public · All regions.

## Test instructions (for the reviewer)

1. Open any YouTube video and let it play.
2. Switch to another tab with a regular website (not the new tab page). The video
   appears in a floating window in the bottom-right corner.
3. Drag it, push it into the right edge to hide it, then tug the tab to bring it back.
4. Click the video to show the controls. The button at the top right switches back to
   the YouTube tab, where the floating window disappears.

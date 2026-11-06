# Chrome Web Store listing

The text and answers entered in the developer dashboard, kept here so the
listing can be reviewed and updated alongside the code.

## Store listing

**Name** (from the manifest): PiP Anywhere – Floating Player for YouTube

**Summary** (from the manifest, ≤132 chars): Keeps your YouTube video playing in a
floating picture-in-picture window on every tab. Drag it, snap it to an edge or tuck
it away.

**Category:** Tools · **Language:** English

**Description:**

```
PiP Anywhere keeps the YouTube video you're watching on screen when you switch tabs. Start a video, open another tab, and the video shrinks into a small floating window in the corner, like picture-in-picture on a phone. Go back to the YouTube tab and everything is normal again.

HOW IT WORKS
• Automatic: the floating window appears when you leave a playing YouTube tab and goes away when you come back.
• Same video, same sound: the picture is streamed live from your YouTube tab, so nothing reloads, there are no extra ads, and the audio never stops.
• Place it anywhere along the edge: flick it and it glides to the left or right side, at whatever height you leave it.
• Hide it: push it into the edge and it tucks away behind a small tab while the audio keeps playing. Tug the tab to bring it back.
• Resize: pinch it on a touchscreen or trackpad, or double-tap it, to switch between three sizes.
• Controls: tap the video for play/pause, skip back or forward 10 seconds, a progress bar, close, and a button that takes you back to the YouTube tab.
• It remembers where you put it and how big you made it.

PRIVATE BY DESIGN
No account, no analytics, no tracking. The video travels only between two tabs of your own browser and never leaves your computer.

GOOD TO KNOW
• It shows on regular web pages. Browser pages such as the new tab page or settings can't display it, but the audio keeps playing.
• The window floats inside the browser, not over other apps.
• Works in Chrome, Brave and other Chromium-based browsers.

Open source: https://github.com/Ryxwaer/youtube-popup-extension

Not affiliated with YouTube or Google.
```

**Homepage URL:** https://github.com/Ryxwaer/youtube-popup-extension
**Support URL:** https://github.com/Ryxwaer/youtube-popup-extension/issues

**Images:** `screenshot-1-corner.png` … `screenshot-5-controls.png` (1280×800),
`promo-small-440x280.png`, `promo-marquee-1400x560.png`, store icon
`extension/icons/icon128.png`. The screenshots are poses from the promo take
(`dev/promo-video/shots.mjs` + `stills.mjs`) and show the Azuki Elementals trailer
(© Azuki) playing in claude.ai. The tiles (`tiles.mjs`) are our own artwork only: a
generic browser and an abstract scene, with no third-party UI or footage.

**Promo video:** https://www.youtube.com/watch?v=Pl1ZqiW49xI (unlisted).

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

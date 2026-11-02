# iPhone-style PiP review and implementation

This review changed the extension directly and exercised the real YouTube → captureStream → WebRTC → overlay path in headless browsers. The YouTube source remains the audio player; no embeds or iframes were introduced.

Reference provenance, version caveats and measured/estimated dimensions are in [refs/README.md](refs/README.md). Original downloaded bytes live in `refs/downloads/` with exact URLs in `sources.json`; downloads were not executed.

## Round 2 fidelity corrections

The parent reviewer's progress-bar objection is confirmed. Enlarged source frames 45/50/58 clearly show a bottom capsule below the scoreboard; frame 35 and pre-controls frames 38/39 do not. Round 1's statement that the floating player has no progress bar was wrong and is corrected here and in the reference ledger.

| Discrepancy | Round 2 fix | Current location |
| --- | --- | --- |
| Missing progress indicator | 4/344 width thickness, 12/344 side insets, 9/344 bottom clearance and 2/344 cap radius; opaque white fill in a .65-opacity layer, white .4 track (effective .26 alpha). No yellow ad variant. | `extension/pip.js:122` |
| No elapsed animation after removal | Draw from `currentTime()` interpolation on animation frames while controls are visible; paused/seeking/rate changes update from source state; live/unknown duration hidden; stop loop on hide/destroy. Width updates preserve the small capsule's round cap. | `extension/pip.js:402`, `:421`, `:819`, `:372` |
| Top controls too close to side edges; X too large | Inset the 40 px hit boxes horizontally by 4 scaled px (top remains 0, center ~20 px); use 20 px X SVG; calibrate glyph scale to the 344 px reference crop. | `extension/pip.js:109`, `:111`, `:534` |
| Skip glyphs slightly large, pause small, playback row spacing/height off | 25 px skip / 33 px pause boxes, 15 px flex gaps and row 5 scaled px below center. | `extension/pip.js:114` |
| Corner radius underestimated in round 1 | Increase from .028 × width to .04 × width, capped at 16 px; 15.2 px at the large landscape detent. | `extension/pip.js:537` |

`refs/README.md` records every presence/absence recheck, source frame numbers, sample values, measurement limits and reproducible crop paths. White glyphs, top-button ordering, 10-second skips, no visible circular materials, no visible volume glyph, transient chrome and the separate settled stash tab are supported across multiple frames. The scrim's exact alpha/gradient, shadow kernel and backdrop blur remain tuning estimates; round 1 overstated their precision. The radius estimate is revised to roughly 13–15 reference pixels. Stash evidence is explicitly older iOS, and its no-visible-video claim applies while settled.

## Retained corrections from round 1

| Found | Implemented correction | Round 1 location (historical) |
| --- | --- | --- |
| Close and restore were on opposite sides from YouTube's iPhone PiP | X top left, overlapping-window restore top right | `extension/pip.js:38`, `:111` |
| Skip circles had reversed winding / misleading arrow shapes | Counterclockwise back and clockwise forward; retain the evidenced 10 seconds | `extension/pip.js:46` |
| X was too small; restore had the wrong enclosed-window silhouette; pause too large/row too high | Overlapping rectangles; round 2 reduces X, insets top controls horizontally, uses 33 px playback glyph box and row 5 scaled px below midpoint | `extension/pip.js:38`, `:111` |
| Bottom progress indicator incorrectly removed in round 1 | Round 2 restores a controls-only, proportionally scaled capsule with smoothly interpolated elapsed time; live/unknown-duration hidden; no unsupported ad-yellow styling | `extension/pip.js:122`, `:402`, `:421` |
| Window/shadow too large and edge inset too wide | About 180/270/379 px detents, 8 px inset; softer 18 px shadow; round 2 increases radius to width × .04 | `extension/pip.js:16`, `:77`, `:512` |
| Controls dimmed the movie too much | Lighter 22% uniform black scrim; 200 ms control fade | `extension/pip.js:94` |
| Stash was a 225 px tall blurred slice of the movie | Fully hide movie and show a separate 24 × 96 px dark blurred tab with 8 px corners; darker sampled tint, taller gray inward chevron on either side | `extension/pip.js:124`, `:240` |
| Controls never auto-hid while video reports arrived every 250 ms | Only re-arm timeout on playback transition / user activity | `extension/pip.js:383` |
| Double-tap skipped the smallest detent | Cycle all three detents | `extension/pip.js:778` |
| Portrait minimum width collapsed two size detents together; cover could crop content | Lower the minimum and contain the video at its reported aspect | `extension/pip.js:90`, `:460` |
| Actual next-video transition froze the receiver | Re-capture when `currentSrc`, element, or live capture tracks change; replace sender track | `extension/source.js:138` |
| Shorts lookup could choose an inactive player; cached connected element could be obsolete | Prefer active Short renderer; query the current player for reports and commands; reattach on element change | `extension/source.js:31`, `:47`, `:124`, `:228` |
| Discovering an already-playing source from timeupdate did not necessarily evaluate overlay | Evaluate when source ownership changes, even for a non-important report | `extension/background.js:169` |
| Hidden controls could remain keyboard-focusable; keyboard buttons lacked action handling | Use inert while controls are hidden, native keyboard click handling, accessible play/pause label, keyboard stash restore | `extension/pip.js:249`, `:262`, `:391`, `:795` |
| Pinch could leave a pressed control / pending tap; cancellation could inject velocity | Cancel pending tap and press on pinch/drag, freeze spring starting point, suppress cancelled-release momentum; clear wheel timer on teardown | `extension/pip.js:361`, `:561`, `:607`, `:669` |

## Verification and reproducibility

Run from `dev/`:

```sh
node review.mjs round2-dpr2 2 --full
PIP_TEST_BROWSER=/usr/bin/chromium node review.mjs round2-dpr1 1 --full
.venv/bin/python refs/audit.py
.venv/bin/python compare/make.py round2-dpr2
```

`review.mjs` uses genuine pointer and touch events, CDP to inspect the closed shadow root, real YouTube watch/Shorts videos, and decoded-frame counters. A receiver having a nonzero `currentTime` is insufficient evidence of a moving stream: the test explicitly checks new frames after changing videos.

The first full run reproduced an autoplay-next freeze (`22 → 22` decoded frames). After tracking `currentSrc`, the focused transition run advanced continuously (`171 → 705` decoded frames over the recorded next-video interval). `iteration-1/` retains the initial visual correction; `iteration-2/` retains the subsequent full run. Two test-driver mistakes were corrected: Puppeteer's single `clickCount:2` was replaced with two actual pointer taps; a pinch-growth assertion now begins at a smaller detent rather than the maximum size. These were test issues, not extension regressions.

The round 1 Brave DPR 2 run passed **30/30 checks**, including both stash edges, real two-pointer pinch, resize, three repeated return/switch cycles, source play/pause/seeks, restore, close-to-pause, next-video decoding, portrait frames and active-Short selection. The round 1 Chromium DPR 1 run passed **6/6 smoke checks**. All extension scripts passed `node --check`.

Final results and screenshot geometry/timestamps are in each final capture directory's `results.json` and `shots.json`. All runs use temporary profiles, `headless:true`, one test browser at a time, and `finally` closure. The harness rejects headed launches and removes its temporary profile after process exit.

## Round 2 verification

Final-code Brave DPR 2: **42/42 checks passed**. Its real next-video transition advanced **236 → 274 decoded frames** over the sampled interval; portrait playback advanced **110 → 147 frames**. Its media log has no nonempty `playerErrorsRaised` reports. Final-code Chromium DPR 1: **42/42 checks passed**, including the same complete functional suite (not the former six-check smoke run). Its next-video sample advanced **273 → 311 decoded frames**; portrait playback **100 → 137 frames**. All extension scripts passed `node --check`.

The full suite now includes the original 30 functional checks plus 12 checks for reference progress geometry/colors, per-frame interpolation, hidden controls, source readiness, pause, seek, live/unknown-duration hiding, neutral ad styling, restoring finite duration, playback rate and proportional scaling at all three detents. Live/unknown/ad/rate variants are explicitly **state fixtures delivered through the extension service worker** while the real source is paused; they are not claims of a live YouTube/ad broadcast or a final real-2× playback test. The remaining media/control/transition checks use genuine YouTube playback and WebRTC.

The test driver's closed-shadow CDP calls now await promises for the rAF sampler. A bounded overlay wait replaces the former fixed 1.5 s delay after restore and includes media diagnostics on timeout. No production routing or WebRTC code changed in round 2.

Retry evidence is retained in `round2-attempt-media-reset/`, `round2-attempt-restore/`, `round2-attempt-rate-reset/` and `round2-attempt-switch-reset/`. The first captured a source at time 0 with no dimensions/duration and readyState 0 following an extra screenshot-staging seek; later seek/frame checks ran against unloaded source media and failed; the browser was closed. The second completed all progress checks and repeated source switches but tried to click an overlay before it reappeared after restore. The final test sequence removes the staging seek and uses a bounded readiness wait. A later Brave retry also reset the remote media after the added actual-2× playback test (`round2-attempt-rate-reset/`, diagnostic source time 0, duration null, dimensions 0, paused, readyState 0). The final rate check therefore measures the renderer's interpolation against a timed rate-2 state fixture, without changing the real source rate. A further retry also lost source media at 1× during the third switch cycle (`round2-attempt-switch-reset/`); this rules out attributing the issue solely to 2×. Media-pipeline logging was added to subsequent runs. These failed attempts are not counted as passing runs.

New artifacts:

- `compare/controls-reference-vs-final.png`: real iPhone frame 45 vs final Brave DPR 2, normalized window widths.
- `compare/progress-reference-vs-final.png`: enlarged bottom edges for source frames 50/58, including actual paused/playing elapsed positions, plus frame 35 vs controls-hidden extension as a negative check. Elapsed lengths reflect different actual playback positions.
- `compare/stash-reference-vs-final.png`: regenerated settled stash comparison.
- `refs/round2/`: multi-frame 3×/4×/8× audits and pixel samples.
- `round2-dpr2/`, `round2-dpr1/`: full results, measured screenshot boxes/timestamps and real captures.

## Remaining differences and confidence

- Brave intermittently emptied the YouTube media element during extended seek/rate/switch tests, including a 1× switch attempt. Earlier Brave and Chromium full runs passed. The cause is unresolved; it cannot be attributed solely to 2× or to the visual CSS change. Final rate interpolation is validated with an explicit state fixture, while the original real-source functional suite remains at 1×.
- This is an evidence-based approximation, not a certified pixel-identical rendering. The modern recording is 360 px wide and GIF-compressed; its precise iOS build is unspecified. The clearest stash demonstration is older iOS 14. Exact SF Symbol outlines/Apple typography, continuous native corner rendering, shadow kernel, material blur, scrim alpha, fade duration and spring constants are not recoverable from these references.
- Three-second hide timing and the existing velocity-preserving springs are tuned values, not a claim of Apple's private constants. WWDC's projection method was already correct and is retained.
- Apple's documentation says corners. Arbitrary vertical placement on a side is preserved as the user's explicit desktop adaptation.
- Native-like point sizes are used on desktop rather than scaling the large window to 96% of desktop width. Desktop viewport edges replace iPhone safe areas/dock. Restore switches tabs; it cannot recreate the native iOS app-switcher compositor animation.
- iOS 26's version-pinned guide retains the same documented gestures. No reliable collected iOS 26 YouTube PiP footage established a Liquid Glass control change; speculative glass button chrome was not added.

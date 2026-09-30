# Loader final pass — 30 September 2026

Production build of `codex/console-loader-refresh`, compared with the previous PR head `cd6b7393`. All sessions, workspaces, providers and dashboard metrics used local fixtures. This verifies startup behavior, not customer OAuth, provider API availability or completed imports.

## Diagnosis and fixes

1. **Honest progress** (`88046aba`): the previous 2–4 node grouping could mark several signals complete together and show every node filled before the dashboard committed. Every node now owns exactly one real signal: verified session, loaded workspace, returned source metadata/health snapshot, committed usable dashboard. Source checking here is the returned application snapshot, not a fresh provider credential test. The last node pulses while the dashboard is pending. Label and copy render atomically in one keyed group; the outgoing 250ms stale copy was removed. When all signals complete the label becomes READY and the copy becomes Workspace ready. English and Vietnamese remain supported. Signals arriving together legitimately skip intermediate labels; no artificial delay is added.
2. **Shorter handoff** (`faecfab0`): convergence is 225ms, desktop travel 250ms. The 600ms minimum visible lifetime includes exit, instead of adding another hold before exit. Content starts 30ms into flight, using 150ms entrances and 40ms stagger capped at three groups; outgoing placeholders fade in 100ms and are removed after 300ms. Dashboard readiness is reported in a layout effect after its actual destination DOM commits. Phone/collapsed sidebar use a 200ms fade after convergence; reduced motion uses a plain 150ms fade. Very early readiness after the mark appears may still wait to satisfy its minimum lifetime; readiness before 200ms shows no mark.
3. **Crisp flight** (`9972560c`): resolve glow, outline and completion halos are hidden for travel. The old glow animation could restart from full opacity when its animation changed. A synchronous flight-flag CSS selector also avoids waiting for React to apply exit styles on the first travel frame.
4. **Exact asset swap**: both positions render the existing `LogoMark` component from `src/components/Logo.tsx`. Its current repo asset is the rounded square with the plus; this pass does not invent a new mark. FLIP uses the real sidebar SVG bounds and the tile's untransformed 72px size, so entrance scale cannot distort its final 24px size. On the animation's completion promise, the travelling tile is hidden and the original sidebar SVG is restored in one JS turn before paint. React then removes the overlay. Original target visibility is restored on cancellation too. Tests compare the SVG contents, require one visible mark during flight and check landing center error <0.5px and width error <0.25px.

No dependency, font, color, analytics or production feature-flag changes.

## Production trace conditions

Chromium, 1440×900, production `next build`/`next start`, CPU throttled 4×. Actual DevTools Slow 4G network parameters: 562.5ms latency, 180,000 bytes/s download, 84,375 bytes/s upload. Local HTTP fixture API adds 350ms session, 250ms workspace, 1200ms summary response delays; the network throttle applies to these requests too. Warm measurements prime the browser cache and clear only the loader session marker; cold measurements use a fresh context.

Separate DevTools traces include timeline, user-timing and compositor frame events, without simultaneous JPEG capture. Readiness/content/settled/removal deltas below use trace user marks, rather than the older rAF callback timestamp, which can precede callback execution on a busy main thread. First visible content means content opacity >0.1 and cover opacity <0.1; settled means all entrance groups opacity ≥0.99 and cover <0.01. These are repeatable visual thresholds, not backend response time or LCP.

| Time after actual dashboard readiness | Before warm | After warm | Before cold | After cold |
| --- | ---: | ---: | ---: | ---: |
| First visible content | 951ms | 353ms | 1115ms | 402ms |
| Content settled | 1292ms | 528ms | 1455ms | 586ms |
| Loader removed / target restored | 1092ms | 552ms | 1262ms | 586ms |

Navigation-to-first-visible-content, sampled at rAF cadence: approximately 3.65s → 3.03s warm, 9.10s → 8.27s cold. These single lab runs include throttled asset delivery, fixture API delays and hydration; they do not establish improved production API latency.

| Final trace measurement | Warm | Cold |
| --- | ---: | ---: |
| Worst compositor DrawFrame interval during handoff | 12.65ms | 16.03ms |
| Worst rAF interval during handoff | 10.0ms | 9.9ms |
| Fully dropped compositor frames during handoff | 0 | 0 |
| Partial compositor updates during handoff | 1 | 2 |
| Worst rAF interval across startup | 108.2ms | 175.1ms |
| CLS | 0 | 0 |

Handoff window: flight/fade start through the later of content settled or loader removed, plus one nominal 60Hz frame. DrawFrame intervals use the dominant main frame layer tree. Idle gaps after all motion finishes are excluded. Both final handoffs stay within the 16.67ms frame budget. The startup-wide hydration intervals remain above budget; this is not a claim that the whole application starts without long frames. Partial updates are reported separately from fully dropped frames.

## Behavior checks

Final production build and TypeScript passed. Changed-component ESLint and diff check passed. The final 12 Playwright checks passed on desktop and Pixel 7:

- Each completed node matches its own real signal and completion never reverses.
- Individually held session/workspace/summary responses verify the pending active node; two source icons do not collapse four readiness signals.
- Active packets change position continuously during the pending hold; source icons come from workspace metadata.
- The mark matches the sidebar asset, only one mark is visible during flight, glow is hidden from its first frame, content starts before landing, and final geometry matches the actual slot.
- Expanded, collapsed and phone handoffs; reduced motion plain fade.
- At >4s pending, Still working appears with the last node incomplete. At >10s, the cover is removed, the skeleton and Retry are usable; Retry reloads and completes a subsequent real fixture response.
- Destination headings and activation text stay unique through the cross-fade.

The same ten motion/readiness/recovery cases also passed with 4× CPU and Slow 4G enabled, one worker, on desktop and Pixel 7. The first run passed eight; the two staged-response assertions correctly encountered Still working after the initial throttled asset/hydration delay exceeded four seconds. Their copy expectation was corrected to allow that real slow state while still requiring STEP 4, an active last node and no READY, and both reruns passed. These behavior tests intercept fixture API responses to hold individual signals; unlike the performance proxy, they do not measure network transport of API responses. Set `LOADER_THROTTLE=1` for the opt-in CDP conditions in `workspace-loader-motion.spec.ts`; use a production server and sufficient assertion timeout (20s) for cold assets. The trace measurements above remain unchanged because this follow-up changes tests/documentation only.

Additional production browser checks passed: fast cached readiness (~94ms, no visible mark); repeat-session skip; app client navigation and marketing-to-app navigation skip; Vietnamese phone status and no horizontal overflow; delayed hydration by 1.5s; error, empty workspace and expired session destinations. These checks recorded CLS 0, no hydration errors and no residual body scroll lock.

## Preview and evidence

Artifacts are in `/Users/camtai/.codex/visualizations/2026/09/28/01a0ea17-b803-7f51-88e9-31606045befe`:

- `loader-final-{before,after}-{warm,cold}-devtools.json`: raw DevTools traces, loadable in Chrome Performance.
- `loader-final-{before,after}-{warm,cold}-timing.json`: frame samples and summaries. Baseline user-mark deltas in the table are recalculated from raw trace marks; its earlier rAF-based summary is retained unchanged.
- `loader-final-behavior.json`: delayed hydration, repeat, reduced motion, error/empty/expired checks.
- `loader-final-preview-60fps.mp4`: 304 encoded frames, 5.067s; illustrative unthrottled fixture preview, recorded separately from performance measurement.
- `loader-final-contact-sheet.png`: selected original captured frames.

The previous preview really was 25fps / 82 frames. Its JPEG concat input inherited a 25fps time base. The new concat sets a millisecond time base before encoding at 60fps. It contains 207 original browser screencast frames; encoding can duplicate frames and does not make this a native 60fps screen recording. The raw DevTools traces satisfy the requested performance-trace alternative and are the performance evidence.

## Remaining performance work

Keep the grid, border sweep and blur out of this pass. The flight deliberately drops glow; these effects add paint/compositing work without improving the handoff. The remaining 175ms startup main-thread gap under cold 4× CPU is the next useful profiling target (app hydration and startup bundle work). Investigate that separately rather than masking it with longer loader choreography. Real authenticated customer behavior and field performance remain unverified until an authorized workspace is available. No Lighthouse rerun is claimed for this pass.

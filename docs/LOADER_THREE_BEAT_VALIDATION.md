# Loader: Arrive, Work, Resolve — 2026-09-30

Supersedes the visual choreography in `LOADER_CONVERGENCE_VALIDATION.md`.

## Diagnosis and plan before changes

The previous network was static between API completions; completed nodes were removed before a visible completion beat. Simultaneous loader/content fades caused overlap. Loader CSS restyled the shared logo, making it differ from the sidebar. Broad ancestor selectors and animation setup during handoff caused expensive style recalculation.

Plan: commit the shared mark/network entrance, commit animated real readiness and long-wait recovery, then commit the completion/FLIP/reveal sequence. Verify a production build with actual DevTools CPU/network throttling, real compositor tracing, and a separate visual capture.

## Three beats

- **Arrive** (`473ed272`): unmodified `LogoMark`, also used by the sidebar and `public/logo-mark.svg`; 72px mark, .94→1 entrance, one small SVG outline draw, asymmetric source network, 50ms node stagger, token gradient and 1px top highlight. The repo's existing shared asset is the rounded-square plus; no replacement brand asset was invented.
- **Work** (`a05949ea`): neutral rings until workspace source providers are known, then 2–4 existing monochrome provider assets. Pending rings, active pulse/1600ms packet, completed fill/450ms packet and glow. English/Vietnamese real status, 12px ink step label; 4s pending message, 10s skeleton and Retry. No extra requests or dependencies.
- **Resolve** (third commit): 300ms convergence packets with 60ms stagger, glow peak, network/copy fade after 480ms, then 400ms FLIP. Actual source/target SVG bounds determine travel. Target hidden until landing; chrome first, content starts 240ms into travel, with 50ms group stagger and 12px drift. Phone/collapsed sidebar use a fade; reduced motion omits convergence/travel and uses plain fades.

The four monotonic milestones are authenticated session, valid workspace resolution, returned source metadata/health snapshot, and committed usable dashboard summary. Source metadata is returned by the existing workspaces endpoint, with summary fallback for older payloads. “Checking sources” does **not** claim a new live request to each provider or fresh credential certification. Failure/empty/expired destinations release the cover without inventing successful milestones.

The server cover, 200ms artwork delay, 600ms minimum visible hold, fast/repeat/client-navigation skipping remain. No scroll lock or focus trap. Existing analytics are unchanged. Marketing stays loader-free.

## Performance decisions

Packets use precomputed transform/opacity keyframes and the native animation compositor; no per-frame path queries or JS updates. Only entrance outline/line drawing uses SVG dash offsets. Content animations are prepared and paused beneath the cover, then played at reveal. Target visibility is changed directly instead of invalidating a whole-app ancestor selector. Readiness actions are stable to avoid rerendering app chrome.

Cut faint dot grid, border sweep and blur. They added little visible information. If a beat becomes costly on a customer device, cut resolve line-opacity pulses/glow layers first and use the existing plain-fade fallback for travel. Keep real status, accessible source states, the skeleton and recovery.

## Production-build trace: 4× CPU and Slow 4G

Local Chrome/Playwright, 1440×900, native display cadence ~120Hz. Actual [DevTools Slow 4G preset parameters](https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/core/sdk/NetworkManager.ts): CDP latency 562.5ms, download 180,000 bytes/s, upload 84,375 bytes/s; CPU rate 4. First-visit loader runs with session storage cleared. Warm means cached assets; cold means a new browser context. HTTP fixture server delays session/workspaces/summary by 350/250/1200ms; network throttling also applies to these responses. No customer account or production latency claim.

Before is `cf5b6e47`, rebuilt separately with the same fixture responses and analytics. Measurements include the exit and next 800ms.

| Metric | Before, warm | After, warm | After, cold |
| --- | ---: | ---: | ---: |
| Worst main-thread rAF handoff interval | 33.4ms | 9.3ms | 92.4ms |
| Worst compositor DrawFrame handoff interval | 12.80ms | 17.93ms | 16.37ms |
| Full DroppedFrame events in handoff | 0 | 0 | 0 |
| Partial-update DroppedFrame events in handoff | 4 | 3 | 14 |
| CLS | .0000291 | .0000221 | .0000221 |

Warm Resolve maximum rAF interval: 16.8ms; cold Resolve: 16.6ms. Warm/cold last-second Work compositor maxima: 15.89/15.03ms. Whole startup worst main-thread intervals: 132.5ms warm, 191.3ms cold.

**Limits:** This is not certification of zero missed frames throughout startup. Chrome marks partial updates at this 120Hz cadence, and one warm compositor interval is 17.93ms, slightly above a 16.67ms budget. Cold handoff's 92.4ms rAF gap is attributed by the long-animation-frame trace to a 93.1ms Meta pixel configuration script, while compositor drawing continued. App hydration/dashboard mounting also still occupy the main thread before Resolve. Analytics were not blocked to improve the measurement.

Resolve began at 2795.7ms warm / 8019.5ms cold; travel at 3403.6ms / 8628.7ms. Loader removed at 3803.3ms / 9037.0ms. These are fixture/throttling times, not production service response times.

## Capture and behavior

Separate, unthrottled timestamped browser screencast: 278 native captured frames, ~4.1s, median source interval 8.67ms. Variable-rate MP4 preserves capture cadence; it is not relabeled as a constant/native 60fps recording. The raw DevTools traces above are the requested performance verification alternative.

The 0.7–1.5s visual hold contained 74 captured frames and **zero identical adjacent cropped network frames**. Reviewed contact sheet shows all four source logos, completion illumination and the handoff onto navigation/skeleton before dashboard content.

Production build and TypeScript passed; changed-component ESLint passed. Ten Playwright regressions passed across desktop/phone: uniqueness, real monotonic milestones, moving work packets, completed Resolve, delayed content, hidden target, landing error <1.5px, collapsed/reduced fallback, 4s pending and 10s recovery with a real reload retry. Additional fixture checks passed for delayed hydration, fast readiness (last invisible cover frame ~126ms), repeat visits, client navigation, marketing-to-app navigation, Vietnamese, request failure, empty workspace and expired session. Those checks recorded CLS 0, no hydration errors and no retained scroll lock.

## Lighthouse

Lighthouse 13.5 desktop, local production builds, same successful HTTP fixtures. Separate from CPU/network trace and visual recording; default desktop Lighthouse simulation.

| Metric | Before | After initial | After diagnostic |
| --- | ---: | ---: | ---: |
| Performance | 99 | 96 | 98 |
| LCP | .875s | 1.105s | .889s |
| CLS | 0 | 0 | 0 |
| Total blocking time | 0ms | 49.5ms | 0ms |

Preserve both after runs; no claim of improved LCP or a certified non-regression. The diagnostic trace's LCP candidate is an H1 at 234ms, not the final usable dashboard. Opacity/cover choreography changes paint candidates and external script/network behavior varies. These numbers do not measure backend speed or replace field monitoring.

## Artifacts and remaining

Local artifact directory: `/Users/camtai/.codex/visualizations/2026/09/28/01a0ea17-b803-7f51-88e9-31606045befe`.

- `loader-three-beat-preview.mp4`: visual preview at native captured timestamps.
- `loader-three-beat-{warm,cold}-devtools.json`: raw importable Chrome Performance traces.
- `loader-three-beat-{warm,cold}-timing.json`: rAF/long-task/layout-shift observations.
- `loader-three-beat-{warm,cold}-compositor.json`: compositor summaries.
- `loader-three-beat-before-warm-{devtools,timing}.json`: comparison trace.
- `loader-three-beat-capture-check.json`: hold-frame comparison.
- `loader-three-beat-{before-lighthouse,lighthouse,after-diagnostic}.json`: sanitized lab reports.

Review the preview before merging PR #199. Performance work remaining: initial app hydration/render cost and analytics main-thread contention; validate on customer hardware and an authenticated workspace. Functional acceptance passed; a strict end-to-end zero-missed-frame gate is not yet proven.

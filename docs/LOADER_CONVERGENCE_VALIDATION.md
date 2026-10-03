# Loader convergence and handoff validation — 2026-09-30

## Diagnosis before changes

The two-signal progress bar stopped at 50% while waiting for the dashboard response. There was no continuously moving wait treatment. The whole overlay, inner contents, outgoing skeleton and dashboard faded together, and the overlay inherited a different canvas token from the console. This produced the dark dip and ghost overlap. No FLIP target existed.

A local production trace measured a 49.2ms frame gap near readiness and 25.8ms of forced layout inside the per-element geometry snapshot. That snapshot queried every descendant and text range synchronously.

## Implementation

- Replaced the bar with four asymmetric jade connections and source dots around the existing Monstera logo. Completions are monotonic: authenticated session, validated workspace, received source-health snapshot, committed dashboard data. Source health and data arrive together in the existing summary response; the animation does not invent a delay between them. Pending/unmeasurable connections pulse rather than suggest completion.
- Added one outline entrance, an inner gradient and top highlight, a single border sweep, restrained ambient border/glow opacity motion and a radially masked dot grid. Existing console tokens and mono font only.
- Added real English/Vietnamese status transitions and STEP n / 4. Status uses the existing ink token, above WCAG AA contrast.
- Separated the backdrop and copy exit from the flying tile. Desktop FLIP measures only the tile and actual sidebar workspace SVG. The real target is temporarily hidden and restored at arrival. Offscreen/mobile targets and reduced motion use a plain fade.
- Replaced the synchronous geometry snapshot with a lightweight inert, text-free SVG placeholder layer. The real dashboard retains final layout dimensions; outgoing placeholders are absolute and removed. Sidebar/header/dashboard groups reveal with staggered opacity and 12px motion.
- Stabilized context values and separated readiness actions from choreography to prevent milestone changes from rerendering the dashboard. Deferred dashboard rendering yields to browser work, and deferred responses are checked against the current workspace ID.
- Preserved completed animation styles to avoid a late second paint. Components mounted after startup do not replay the intro. Server cover, 200ms mark delay, 600ms minimum hold, actual readiness gating and session/navigation skipping remain in place. Marketing remains loader-free; analytics scripts are unchanged.

## Controlled measurements

Local production builds, Lighthouse 13.5 desktop, identical successful synthetic responses: session 350ms, workspace 250ms, summary 1200ms. No customer account or production latency measurement.

| Metric | Before | After |
| --- | ---: | ---: |
| Lighthouse performance | 96 | 99 |
| Lighthouse LCP | 0.93s | 0.86s |
| Lighthouse CLS | 0 | 0 |
| Maximum frame interval during exit and 700ms handoff window | 25ms | 9.4ms |
| Maximum frame interval including 200ms before exit | 49.2ms | 25.1ms |
| Forced layout in response script | 25.8ms | 0 in profiling run |

The display ran at 120Hz (median rAF interval 8.3ms). The MP4 is encoded at 60fps from timestamped browser screencast frames; encoding alone does not prove rendering cadence. Independent rAF, long-task, long-animation-frame and layout-shift traces accompany it. Final exit began at 1793.9ms; no interval above 16.7ms was measured during the flight/reveal. One 25.1ms frame remains immediately before exit as dashboard content mounts. Earlier isolated iterations measured 26–33ms there. This is not a claim of zero dropped frames across startup or all devices.

LCP candidates are affected by opacity choreography; these lab numbers do not measure backend speed or time to a usable dashboard. An intermediate version cleared finished styles and registered a new late dashboard text candidate (LCP 2.70s); that style reset was removed. The final comparison above uses the completed implementation.

## Verification

Production build and TypeScript passed. Changed-file ESLint and diff checks passed. Both existing uniqueness regression and new milestone/FLIP regression passed on desktop and phone (4 tests). Fast readiness was ~102ms with no visible mark; marketing-to-app navigation did not show the loader. Delayed hydration, slow summary, repeat session, reduced motion, expired session, empty workspace and request failure were checked with browser fixtures; no hydration errors or scroll lock remained.

## Artifacts and remaining work

The local visualization directory contains `loader-convergence-handoff-60fps.mp4`, `loader-convergence-frame-before.json`, `loader-convergence-frame-after.json`, and sanitized Lighthouse before/after reports.

Review the capture before merging PR #199. Validate with an authenticated customer workspace when available. Remaining performance work: reduce the initial dashboard mount cost (one 25ms frame), and verify on slower hardware. The exit choreography itself is within the 60fps frame budget in this local trace.

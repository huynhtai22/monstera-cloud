# Loader visual refinement — 30 September 2026

Follow-up to the readiness and handoff fixes in PR #199. This pass changes composition and hierarchy, with no new dependency, font, color, milestone, provider request or motion duration.

## Visual decisions

- The existing shared LogoMark is 80px in the intro, up from 72px, and still lands on the actual 24px sidebar slot. The asset is identical in both locations.
- Reduce the network scene from 260px to 224px high; center the complete composition rather than shifting it 58% upward. Keep asymmetric source positions and bring the wordmark closer to the mark.
- Make the wordmark 30px (28px on phones), with Monstera carrying more weight and Cloud using the existing muted ink token. Status is 15px ink; the 12px mono step caption is below it, using muted ink. Muted ink against the existing canvas has approximately 6.7:1 contrast; status uses the higher contrast ink token.
- Reserve 47px for status text in every locale/step so wrapping cannot move the scene. The label and copy still update atomically; their accessible status remains unchanged.
- Pending nodes have clear neutral rings, the active node has a jade ring/pulse and moving packet, completed nodes are filled jade. The 26px source nodes and 14px provider glyphs support the mark instead of competing with it.
- Soften connection opacity to 0.28 and reduce the ambient halo and packet size. Keep the inner gradient and top highlight. No added grid, sweep, blur, starfield or chart elements.
- Derive SVG paths and moving packet keyframes from the same curves. The refined endpoints meet the larger mark border, instead of leaving a small disconnected gap. Nodes remain asymmetric.
- At widths ≤360px, scale the scene to 92% while retaining the existing phone fade fallback. The text stays at readable sizes.

## Verification

Final production build / TypeScript, changed-component ESLint and diff check passed. All 12 existing desktop/Pixel 7 production browser regressions passed again after the final geometry adjustment: real milestone completion, active packet motion, synchronized step/status, identical SVG assets, one mark in flight, exact target landing (<0.5px center and <0.25px width error), content during travel, collapsed/phone/reduced motion, 4s/10s recovery and usable Retry.

Additional fresh production checks: fast readiness with no visible mark; marketing-to-app client navigation skip; desktop and Vietnamese 390px/320px screenshots with no horizontal overflow. Existing timers, fallback behavior and actual readiness signals are unchanged.

## Final performance trace

Production build, 1440×900, 4× CPU and actual DevTools Slow 4G: 562.5ms latency, 180000 bytes/s download, 84375 bytes/s upload. Local HTTP fixture API adds session/workspace/summary delays of 350/250/1200ms. Warm trace primes assets and clears the loader session marker; cold trace starts a new context. Trace capture was separate from preview screenshots. Same measurement definitions as `LOADER_FINAL_PASS_VALIDATION.md`.

| Metric | Warm | Cold |
| --- | ---: | ---: |
| Actual readiness → first visible content | 352ms | 401ms |
| Actual readiness → content settled | 546ms | 599ms |
| Actual readiness → loader removed | 553ms | 599ms |
| Worst handoff compositor frame interval | 14.36ms | 16.30ms |
| Worst handoff rAF interval | 10.4ms | 10.1ms |
| Fully dropped handoff frames | 0 | 0 |
| Partial compositor updates | 4 | 3 |
| Worst startup-wide rAF interval | 125.6ms | 190.9ms |
| CLS | 0 | 0 |

The handoff remains inside a nominal 60fps frame budget. Startup hydration still has longer main-thread intervals under 4× CPU. Single lab runs cannot establish field performance or isolate small differences from analytics/network variability. These fixtures do not verify customer OAuth or real imports. No new Lighthouse result is claimed.

## Review artifacts

Directory: `/Users/camtai/.codex/visualizations/2026/09/28/01a0ea17-b803-7f51-88e9-31606045befe`.

- `loader-refined-preview-60fps.mp4`: fresh illustrative fixture preview, 304 encoded frames / 5.067s, sourced from 208 browser screencast frames. The 60fps encoding may duplicate frames; raw DevTools traces are performance evidence, not this video's output rate.
- `loader-refined-{warm,cold}-devtools.json` and matching `timing.json`: final raw traces and sampled summaries.
- `loader-refined-desktop.png`, `loader-refined-phone-vi.png`, `loader-refined-narrow-vi.png`: production screenshots.
- `loader-refined-contact-sheet.png`: selected native captured frames across arrival, work and handoff. Idle captured-frame gaps after content finishes are not animation stalls.

Review the visual result before release. PR #199's separate dependency gate remains tracked by PR #196; this pass changes no lockfile or feature flags.

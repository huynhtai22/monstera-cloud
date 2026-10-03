# Console production standard

This is mandatory for every console section, subsection, and new feature. The refined Settings experience is the reference.

## Customer experience
- State the page purpose directly. Show workspace/client/reporting-window scope where relevant.
- Use compact grouped rows for administrative choices; use cards only for distinct resources or measurements.
- Present one clear primary task. Place secondary controls near the resource they affect.
- Keep navigation neutral gray. Reserve green, amber, and red for meaningful activity and semantic status; a primary action may use the shared brand token.
- Use shared light/dark tokens, 8px content corners, consistent outlined icons, and restrained elevation. Preserve official platform logos.
- Use brief opacity/position transitions; no decorative card lift, fake loading progress, or repeated promotional animation. Respect reduced motion.

## Production behavior
- Preserve tenant scope, role checks, and entitlements on the server. Filtering is not isolation.
- Distinguish authorization, successful import, data-through date, and verified delivery. Unknown must not become zero or success.
- Provide empty, loading, error, retry, and recovery states. A status needs evidence; a button needs a real destination or action.
- Keep preview controls and fixtures outside the production account experience.

## Review before release
Check all affected subsections in light/dark mode and desktop/mobile. Verify keyboard focus, reduced motion, scope persistence through navigation/reload, actionable failures, and no overflow. Run appropriate production build, type/lint, and browser checks. Describe any unverified live integration separately; visual polish is not connector or payment certification.

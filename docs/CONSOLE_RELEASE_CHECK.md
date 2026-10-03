# Combined console release

PR #218 targets main and includes the console work from #217. Main was merged before final release verification. Merge only after required checks pass on the final head; preview deployment success alone is insufficient.

## Release coverage

- Shared console surfaces, section/subsection navigation, light/dark themes and themed scrollbars.
- Mobile sidebar is inert while closed; opening contains keyboard focus and locks page scrolling. Escape restores focus to the opener. Background controls are inert while it is open.
- Sources tabs use one tab stop, arrow keys, Home and End. Selection is represented in the URL and survives reload.
- Shared motion respects reduced-motion preferences. Existing workspace-loader tests verify real milestones, slow loading and retry recovery.
- Console release browser suite checks every public console section/subsection in both themes on desktop/mobile, tab reload, mobile focus and the reviewed onboarding handoff.
- Existing database-backed onboarding/browser suites remain the release gate for setup, consent, import, failure recovery and client context.

## Boundaries

Preview fixtures are synthetic. Their handoff test verifies that goals/windows survive reload and ongoing monitoring still needs separate consent; it does not certify live provider totals or destination output. Feature reminders remain behind their existing enablement flag. Polar purchase/webhook/entitlement proof is a separate next session. No launch certification or automatic billing enablement is implied by this UI release.

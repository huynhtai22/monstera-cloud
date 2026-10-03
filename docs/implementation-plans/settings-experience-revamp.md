# Settings experience: customer fit and delivery

## Customer outcome
Find a control by intent, understand whom it affects, and return to reporting quickly. Settings supports the agency reporting workflow; it is not a second onboarding or a second connector catalogue.

## Research translated to Monstera
- Vercel makes settings searchable: https://vercel.com/changelog/project-settings-are-now-searchable. Search category labels, descriptions and task synonyms, including invite, Sheets, billing and theme.
- Linear separates personal preferences from workspace controls: https://linear.app/docs/account-preferences. Appearance is local to this browser; sessions belong to the signed-in account. Workspace identity, people, client assignments, rules and billing belong to the selected workspace.
- Google Analytics makes account/property context explicit: https://support.google.com/analytics/answer/9304153. Keep workspace name and role visible; keep client reporting scope separate from membership and tenant access.

These are functional references, not a claim to have inspected authenticated competitor screens.

## Implemented structure
- Overview: six entry cards for existing production controls, plus shortcuts to Sources, Report readiness and Exports.
- Workspace: workspace identity/setup, client scope, people and roles.
- Reporting: quality rules/alerts and API access keys.
- Administration: existing plan, limits and billing.
- Personal: sign-in sessions and light/dark appearance.
- Search: discover settings by intent, Enter opens the first result, Escape clears search, explicit empty state.
- Existing `?tab=` links remain valid; overview is the default landing page. Selection survives reload and browser history.

## Visual and motion rules
One custom SVG family, a 24px optical grid, consistent 1.5px strokes and rounded geometry. Neutral selection in both themes. White content surfaces in light mode and restrained raised surfaces in dark mode. Labels and descriptions precede actions. A compact horizontal category strip replaces the inner rail on mobile.

Use the existing console theme transition for all Appearance changes. Use short opacity/position transitions, never fake progress. Honor system reduced motion. Keep focus visible and navigation keyboard operable. The feature replay control remains demo-only and is moved below the useful settings content.

## Boundaries and next decisions
Existing permission checks, entitlement logic, billing providers and backend mutations remain authoritative. No new provider, automatic monitoring approval, or commercial promise is introduced. Source consent, importing, and inspecting delivered output remain in their existing journeys.

Future features need customer evidence before adding more settings: workspace identity editing, notification digests, reporting-default preferences, and an activity/audit view. Reporting currency/timezone defaults must not silently reinterpret imported provider data. Agent responsibilities should link to their existing approval flow rather than introduce blanket autonomy toggles.

## Acceptance
Check both themes, mobile overflow, search/empty/keyboard paths, all nine categories, reload/history, theme preference persistence and reduced motion. Confirm production reuses this component and demo links remain inside the demo. Existing settings mutation tests remain the backend contract.

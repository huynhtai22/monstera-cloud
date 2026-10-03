# Console light-mode revision

## Design decision

Light mode is a neutral working environment, with Monstera green reserved for primary actions, selection, focus, and meaningful activity. It is not a recolored dark theme.

| Role | Treatment |
| --- | --- |
| Canvas | #f7f8fa |
| Cards, menus, dialogs, notifications | White |
| Sidebar | #f3f4f6 |
| Secondary surface | #f1f3f5 |
| Dividers | #e0e3e7 |
| Main text | #202124 |
| Supporting text | #5f6368 |
| Primary action and focus | #286b40; white action text |
| Selection | Pale green with dark green label |
| Warning | Pale amber with dark text |
| Dialog veil | Neutral ink at 32% opacity |

Official provider and Monstera marks retain their identity. Black logo artwork is intentional; black cards, pale labels on white, and dark notification plates are not.

## References and interpretation

- [Google Analytics public product page](https://business.google.com/us/google-analytics/) presents clear white report surfaces and selective color emphasis.
- [Google Material color roles](https://m3.material.io/styles/color/roles) distinguishes body, navigation, container, text, and outline roles and keeps their mapping consistent across breakpoints.
- [OpenAI's public API project documentation](https://help.openai.com/en/articles/9186755-managing-projects-in-the-api-platform) includes console screenshots with neutral navigation, white tables, menus, and dialogs. These are published examples, not an inspection of an authenticated current customer console.

Our palette and implementation are our design choices based on those references.

## Coverage

Document-level tokens supply body portals as well as the app shell. Legacy glass cards, panels, dialogs, and Sonner notifications receive light surfaces. The connector picker, consent panel, feature reminder, dashboard warnings, identifier chips, account status badges and legacy status utilities, tab indicator, and form controls use matching colors. Source connector hover actions retain readable text in both themes.

Preserve existing navigation, consent, delivery evidence, reminder frequency, and reduced-motion behavior. Do not turn sample preview data into a readiness claim.

## Release acceptance

Inspect Sources connected/accounts/library/attention, Reports, Exports, Settings, dashboard failure and loading states, connector consent, search/notification menus, and feature reminder in both themes. Check desktop and mobile, keyboard focus, native controls, hover text, and reload persistence. Browser regression checks should cover actual rendered light surfaces rather than only the theme attribute.

Selected sidebar sections and subsections use neutral gray (`#e4e7eb`) with dark labels (`#202124`), a gray inset indicator and gray keyboard focus. Brand green remains on primary actions and meaningful status.

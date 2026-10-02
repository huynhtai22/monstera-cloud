# Console navigation release

The approved nested navigation previously existed only through demo props. The production Sidebar now defaults to a shared directory in `src/lib/console-navigation.ts`: Sources, Reports, Exports & API, and Settings have independent, persistent expand/collapse controls. Their links use existing production pages and preserve supported client context. Data explorer uses the existing `/explorer` route.

Settings panels now derive their active tab from the URL, including browser history; in-page tab clicks update that same URL. Reports supports a focused `view=readiness` screen using the existing scoped evidence evaluator, with client and date controls and no performance dashboard substituted for readiness.

The production shell adds section/subsection breadcrumbs and an optional Page guide with the purpose and next action. The existing real client selector stays in place. No synthetic data or demo state selector is added to production.

Sources now offers Overview and Lite. The Detailed card view is removed; its stored preference falls back to Overview. Manage, Sync, Reconnect, account controls, and disconnect confirmation remain available.

Brand consistency: LogoMark references `/logo-mark.svg`, also used by the existing favicon/application assets, instead of an independently drawn variant. Selected controls, source selection, and motion accents reference `--console-brand-green`; its initial value is the existing root green `#86c99b`. A different approved brand asset or creative hex should update this single source of truth rather than recreate competing marks/colors.

This release has no billing, connector, scheduler, or database-schema changes. It can merge independently of draft PRs #206–208. Rebase those drafts before shipping so their older preview styling does not reintroduce divergence.

Verification: production build, type checking, focused lint, and `node scripts/verify-console-production-parity.mjs`. The browser check exercises authenticated production `/sources` at desktop/mobile widths with synthetic API responses, not a `/demo` page. It checks real tab links, independently open subsections, persisted collapse, removed Detailed controls, brand token, guide, overflow, and uncaught page errors. It also verifies Settings tab/history synchronization and the dedicated readiness screen with preserved reporting dates. Provider authorization and reporting certification are separate.

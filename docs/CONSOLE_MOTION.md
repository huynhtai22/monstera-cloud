# Console motion

The console and feature reminder share a restrained motion rhythm. The shell stays mounted; route content animates once without mounting a duplicate live page.

- Controls: 150 ms.
- Routes, subsections, selections, rows, and connector dismissal: 240 ms.
- Dialog and illustration entrance: 360 ms.
- Reminder scene departure: 180 ms.
- Shared easing: cubic-bezier(.2,.8,.2,1).

JavaScript timings live in `src/lib/console-motion.ts`. Matching CSS variables live in `src/app/globals.css` and the console shell module. Portaled dialogs inherit document-level variables.

Route entrance uses opacity and a small vertical movement. Navigation loading starts only on a navigation-start signal, waits 150 ms before showing a cue, and ends when the destination commits. There is no artificial 800 ms loading minimum. Canonical Sources queries and reordered query parameters do not replay the entrance. Interrupted animations cancel before the next one starts.

Tabs retain their real controls and content; the measured indicator moves to the selected control. It is positioned without animation on first layout. Source sorting animates positional changes while retaining DOM order. Source row stagger is capped at 120 ms so long lists do not take seconds to settle. Count changes start from the last displayed value, and initial values are not fabricated from zero.

Connector dismissal retains scroll lock and restores focus after removal. Its closing contents are inert and its overlay intercepts clicks until dismissal completes. Reduced-motion users get immediate removal. OAuth, account selection, import, recovery, billing, and receipt behavior are unchanged.

The reminder uses the same easing and shorter scene transitions with restrained scale, without blur on arriving icons. Existing optional display/frequency rules remain unchanged. Work animations still reflect existing active operation states, and reminder art remains illustrative.

Verification: transition-key and client-context tests; ESLint and TypeScript; browser inspection of source subsections, indicator alignment, loading completion, reminder scene changes and dismissal. No live operation is certified by these UI checks.

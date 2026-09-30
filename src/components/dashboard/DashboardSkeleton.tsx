import styles from "./ConsoleOverview.module.css";

function Line({ width = "70%", height = 12 }: { width?: string; height?: number }) {
  return <div className="console-skeleton-shimmer rounded bg-line" style={{ width, height }} />;
}

/** Reuses the real console's responsive grid, cards, spacing and heading geometry. */
export function DashboardSkeleton() {
  return (
    <div className={styles.console} data-workspace-skeleton aria-label="Preparing workspace layout" aria-busy="true">
      <div aria-hidden="true">
        <header className={styles.header}>
          <div><p className={styles.eyebrow}>WORKSPACE OVERVIEW</p><h1>Dashboard</h1><p className={styles.subtitle}>Your sources, performance, and reporting in one place.</p></div>
          <div className={styles.headerActions}><div className={styles.button}><Line width="100px" /></div><div className={styles.button}><Line width="85px" /></div></div>
        </header>
        <div className={styles.healthStrip}><div className="space-y-3 w-full"><Line width="35%" height={16} /><Line width="60%" /></div></div>
        <section className={styles.performance}>
          <div className={styles.sectionHeading}><h2>Performance &amp; Spend</h2></div>
          <div className={styles.metrics}>{Array.from({ length: 4 }, (_, i) => <article key={i} className={styles.metric}><div className={styles.metricTop}><Line /></div><div className={styles.metricValue}><Line width="60%" height={32} /></div><p className={styles.metricDetail}><Line width="90%" /></p></article>)}</div>
        </section>
        <div className={styles.workGrid}>
          <div className={styles.workColumn}>
            <section className={styles.panel}><div className={styles.sectionHeading}><h2>Connected sources</h2></div><div className={styles.sourceGrid}>{Array.from({ length: 2 }, (_, i) => <article key={i} className={styles.sourceCard}><div className={styles.sourceTop}><Line width="32px" height={32} /></div><div className="space-y-3 mt-4"><Line width="75%" height={16} /><Line width="50%" /><Line width="80%" /></div></article>)}</div></section>
            <section className={styles.panel}><div className={styles.sectionHeading}><h2>Warehouse health</h2></div><div className="space-y-4"><Line /><Line width="90%" /></div></section>
          </div>
          <div className={styles.workColumn}>
            <section className={styles.panel}><div className={styles.sectionHeading}><h2>Destinations</h2></div><div className="space-y-5"><Line height={32} /><Line height={32} /></div></section>
            <section className={styles.panel}><div className={styles.sectionHeading}><h2>Reporting &amp; delivery</h2></div><div className="space-y-5"><Line width="90%" /><Line width="75%" /><Line width="85%" /></div></section>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Server fallback while the interactive navigation hydrates. */
export function WorkspaceShellSkeleton() {
  return (
    <div className="min-h-screen bg-canvas text-ink" data-workspace-shell-skeleton>
      <aside aria-label="Workspace navigation" className="fixed inset-y-0 left-0 hidden w-64 border-r border-line bg-canvas p-6 lg:block">
        <div className="h-10" /><div className="mt-8 space-y-7" aria-hidden="true">{Array.from({ length: 7 }, (_, i) => <Line key={i} width={i % 2 ? "65%" : "80%"} height={16} />)}</div>
      </aside>
      <div className="lg:pl-64"><div className="h-14 border-b border-line lg:h-[53px]" /><main><DashboardSkeleton /></main></div>
    </div>
  );
}

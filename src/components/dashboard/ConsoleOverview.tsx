"use client";

import { ConsoleCountUp } from "@/components/console/ConsoleMotion";
import type { ReactNode, Ref } from "react";
import Link from "next/link";
import { useClientContextNavigation } from "@/components/client-context/useClientContextNavigation";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleDollarSign,
  Layers3,
  MousePointer2,
  Plus,
  Share2,
  ShieldCheck,
  TriangleAlert,
  Zap,
} from "lucide-react";
import type {
  DashboardOverviewDTO,
  DashboardIssueItem,
} from "@/lib/dashboard-overview";
import { IntegrationMark } from "@/components/ui/IntegrationMark";
import { CopyableBadge } from "@/components/ui/CopyableBadge";
import {
  INTEGRATION_LOGOS,
  logoPathForConnectionProvider,
} from "@/lib/integration-logos";
import { cn } from "@/lib/utils";
import { SetupWizard } from "./SetupWizard";
import { ConsoleActivityLabel } from "./ConsoleActivityLabel";
import { ConsoleSyncLabel } from "./ConsoleSyncLabel";
import {
  PROVIDER_NAMES,
  formatCompactNumber,
  formatCurrency,
  formatDateTime,
  warehouseStatePresentation,
  sourceStatePresentation,
  destinationStatePresentation,
  type StatePresentation,
} from "./console-presentation";
import styles from "./ConsoleOverview.module.css";

type Props = {
  overview: DashboardOverviewDTO;
  isUpdating?: boolean;
  showRefreshWarning?: boolean;
  onRefresh: () => void;
  wizardDismissed: boolean;
  onWizardDismiss: () => void;
  onWizardResume: () => void;
  onReconnect: (issue: DashboardIssueItem) => void;
  performancePanelRef?: Ref<HTMLDivElement>;
};

function Status({
  state,
  busy = false,
}: {
  state: StatePresentation;
  busy?: boolean;
}) {
  return (
    <span
      className={cn(styles.status, state.textClassName)}
      title={state.detail}
    >
      <ConsoleSyncLabel
        active={busy}
        idleLabel={state.label}
        activeLabel={state.label}
        idleIcon={<span className={cn(styles.statusDot, state.dotClassName)} />}
      />
    </span>
  );
}

function SectionTitle({
  eyebrow,
  title,
  action,
}: {
  eyebrow: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className={styles.sectionHeading}>
      <div>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
  href,
  label,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  href?: string;
  label?: string;
}) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon}>{icon}</span>
      <h3>{title}</h3>
      <p>{description}</p>
      {href && (
        <Link className={styles.button} href={href}>
          {label}
          <ArrowRight size={14} />
        </Link>
      )}
    </div>
  );
}

const channelColors = [
  "#5eead4",
  "#a78bfa",
  "#fbbf24",
  "#a5a5a5",
  "#8f8181",
  "#777777",
];

/** Shared by the authenticated console and the development-only visual preview. */
export function ConsoleOverview({
  overview,
  isUpdating = false,
  showRefreshWarning = false,
  onRefresh,
  wizardDismissed,
  onWizardDismiss,
  onWizardResume,
  onReconnect,
  performancePanelRef,
}: Props) {
  const { hrefFor } = useClientContextNavigation();
  const {
    workspace,
    summaryCards,
    warehouseSnapshot,
    sourcesList,
    destinationsList,
    recentActivity,
    needsAttention,
    overallStatus,
  } = overview;
  const warehouse = summaryCards.warehouse;
  const warehouseState = warehouseStatePresentation(warehouse.status);
  const metrics = warehouseSnapshot.metrics7d;
  const hasMetrics = warehouse.rows7d > 0;
  const mixedCurrency = metrics.mixedCurrency || metrics.byCurrency.length > 1;
  const firstCurrency = metrics.byCurrency[0];
  const singleRoas = !mixedCurrency && firstCurrency && firstCurrency.spend > 0;
  const currencyValue = (key: "spend" | "revenue") =>
    !hasMetrics || !metrics.byCurrency.length ? (
      "—"
    ) : (
      <>
        {metrics.byCurrency.map((item) => (
          <span key={item.currency} className={styles.currencyValue}>
            <ConsoleCountUp value={item[key]} format={value => formatCurrency(value, item.currency)} />
            {mixedCurrency && <small>{item.currency}</small>}
          </span>
        ))}
      </>
    );
  const metricsCards = [
    {
      name: "Ad spend",
      icon: <CircleDollarSign />,
      value: currencyValue("spend"),
      detail: mixedCurrency
        ? "Separated by currency"
        : "Across connected ad channels",
      featured: true,
    },
    {
      name: "Attributed revenue / GMV",
      icon: <ArrowUpRight />,
      value: currencyValue("revenue"),
      detail: "Reported by your sources",
    },
    {
      name: "Blended ROAS",
      icon: <Zap />,
      value: !hasMetrics
        ? "—"
        : mixedCurrency
          ? "Multiple currencies"
          : singleRoas
            ? <ConsoleCountUp value={firstCurrency.roas} format={value => `${value.toFixed(2)}×`} />
            : "—",
      detail: mixedCurrency
        ? "Review each currency in the warehouse"
        : "Revenue relative to ad spend",
    },
    {
      name: "Impressions",
      icon: <MousePointer2 />,
      value: hasMetrics ? <ConsoleCountUp value={metrics.impressions} format={value => formatCompactNumber(Math.round(value))} /> : "—",
      detail: hasMetrics
        ? `${formatCompactNumber(metrics.clicks)} clicks · ${formatCompactNumber(metrics.conversions)} conversions`
        : "Traffic appears after your first import",
    },
  ];
  const workInProgress = warehouse.status === "refreshing" || isUpdating;
  const activityIcon = (status: string) =>
    status === "success" ? (
      <Check size={13} />
    ) : status === "error" || status === "warning" ? (
      <TriangleAlert size={13} />
    ) : (
      <Activity size={13} />
    );

  return (
    <div className={styles.console} data-console-page="true" data-console-section="dashboard">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>
            WORKSPACE OVERVIEW <span className={styles.eyebrowDivider}>/</span>{" "}
            {workspace.name}
          </p>
          <h1>Dashboard</h1>
          <p className={styles.subtitle}>
            Your sources, performance, and reporting in one place.
          </p>
        </div>
        <div className={styles.headerActions}>
          <button
            className={styles.button}
            type="button"
            onClick={onRefresh}
            disabled={isUpdating}
          >
            <ConsoleSyncLabel
              active={isUpdating}
              idleLabel="Update status"
              activeLabel="Updating…"
            />
          </button>
          <Link
            className={styles.primaryButton}
            href="/sources"
            data-dashboard-focus-fallback
          >
            <Plus size={16} />
            Add source
          </Link>
        </div>
      </header>

      {showRefreshWarning && (
        <div role="status" className={styles.warning}>
          <TriangleAlert size={18} />
          <p>
            Dashboard update failed. Showing the last available summary; status
            may be out of date.
          </p>
          <button
            type="button"
            className={styles.button}
            onClick={onRefresh}
            disabled={isUpdating}
          >
            Retry update
          </button>
        </div>
      )}

      <section className={styles.statusGroup} aria-label="Workspace status">
      <div
        className={styles.healthStrip}
        data-working={workInProgress ? "true" : undefined}
      >
        <div className={styles.healthHeadline}>
          <div role="status" aria-live="polite">
            <strong
              className={workInProgress ? styles.workingTitle : undefined}
            >
              <ConsoleSyncLabel
                active={workInProgress}
                idleLabel={overallStatus.headline}
                activeLabel="Monstera is working"
                idleIcon={
                  overallStatus.state === "attention" ? (
                    <TriangleAlert size={16} />
                  ) : overallStatus.state === "onboarding" ? (
                    <Layers3 size={16} />
                  ) : (
                    <ShieldCheck size={16} />
                  )
                }
              />
            </strong>
            <p>
              {isUpdating
                ? "Checking the latest workspace status. Your metrics remain available."
                : overallStatus.supportingText}
            </p>
          </div>
        </div>
        <div className={styles.healthMeta} role="status" aria-live="polite">
          <Status
            state={warehouseState}
            busy={warehouse.status === "refreshing"}
          />
          <span>
            {warehouseSnapshot.dataThroughDate
              ? `Data through ${formatDateTime(`${warehouseSnapshot.dataThroughDate}T00:00:00`).split(",")[0]}`
              : warehouse.totalRows > 0 ? "Stored history available" : summaryCards.syncs.successful7d > 0 ? "Sync completed without metric rows" : "Awaiting first import"}
          </span>
        </div>
      </div>

      {needsAttention.length > 0 && (
        <section
          className={styles.attention}
          aria-labelledby="attention-heading"
        >
          <div className={styles.attentionHeading}>
            <TriangleAlert size={16} />
            <h2 id="attention-heading">Needs your attention</h2>
            <span>{needsAttention.length}</span>
          </div>
          {needsAttention.map((issue) => (
            <div key={issue.id} className={styles.issue}>
              <div>
                <h3>{issue.title}</h3>
                <p>{issue.explanation}</p>
                <time dateTime={issue.timestamp}>
                  {formatDateTime(issue.timestamp)}
                </time>
              </div>
              {issue.actionType === "reconnect" && issue.connectionId ? (
                <button
                  type="button"
                  className={styles.button}
                  onClick={() => onReconnect(issue)}
                >
                  {issue.actionLabel}
                  <ArrowRight size={14} />
                </button>
              ) : (
                <Link className={styles.button} href={hrefFor(issue.href || (issue.connectionId ? `/sources/${encodeURIComponent(issue.connectionId)}#source-recovery` : "/operations"))}>
                  {issue.actionLabel}
                  <ArrowRight size={14} />
                </Link>
              )}
            </div>
          ))}
        </section>
      )}

      </section>
      {!wizardDismissed && hasMetrics && (
        <SetupWizard
          activation={overview.pilotActivation}
          plan={workspace.plan}
          workspaceStatus={workspace.status}
          onDismiss={onWizardDismiss}
        />
      )}

      <section
        id="performance-spend"
        ref={performancePanelRef}
        className={styles.performance}
        aria-labelledby="performance-heading"
      >
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="performance-heading">Performance &amp; Spend</h2>
          </div>
          <div className={styles.sectionTools}>
            <span className={styles.period}>Last 7 days</span>
            <Link href="/explorer" className={styles.textLink}>
              Explore data <ArrowUpRight size={15} />
            </Link>
          </div>
        </div>
        {!hasMetrics && (
          <div className={styles.guidedEmpty}>
            <h3>{warehouse.totalRows > 0 ? "No metrics in the last 7 days" : summaryCards.syncs.successful7d > 0 ? "Sync completed; no metric rows returned" : "Build your first performance report"}</h3>
            <p>{warehouse.totalRows > 0 ? "Your stored history is available in the data explorer. Review the date window or sync recent data." : "Follow these steps to bring source data into a report."}</p>
            <ol className={styles.checklist}>
              {[{ label: "Connect", href: "/sources", done: sourcesList.some(source => !["disconnected", "error", "unknown"].includes(source.state)) },
                { label: "Sync", href: "/explorer", done: warehouse.totalRows > 0 },
                { label: "Review", href: "/explorer", done: Boolean(overview.pilotActivation.dashboardReviewedAt) },
                { label: "Report", href: "/reports", done: false }].map((step, index) => (
                <li key={step.label}><Link href={hrefFor(step.href)}><span aria-label={step.done ? "Complete" : "Incomplete"}>{step.done ? <Check size={15} /> : index + 1}</span>{step.label}<ArrowRight size={14} /></Link></li>
              ))}
            </ol>
          </div>
        )}
        {hasMetrics && <div className={styles.metrics}>
          {metricsCards.map((card) => (
            <article
              key={card.name}
              data-working={
                warehouse.status === "refreshing" ? "true" : undefined
              }
              className={cn(
                styles.metric,
                card.featured && styles.featuredMetric,
              )}
            >
              <div className={styles.metricTop}>
                <h3>{card.name}</h3>
                {card.icon}
              </div>
              <div
                className={cn(
                  styles.metricValue,
                  card.name === "Blended ROAS" &&
                    mixedCurrency &&
                    styles.metricValueSmall,
                )}
              >
                {card.value}
              </div>
              <p className={styles.metricDetail}>
                {hasMetrics
                  ? card.detail
                  : "No metric rows for this date window"}
              </p>
            </article>
          ))}
        </div>
        }
        {hasMetrics && metrics.byPlatform.length > 0 && (
          <div className={styles.channelMix}>
            <div className={styles.channelHeading}>
              <h3>
                Channel mix <span>Ad spend</span>
              </h3>
              {warehouse.status === "refreshing" ? (
                <ConsoleActivityLabel label="Refreshing metrics" />
              ) : (
                <span>
                  {mixedCurrency
                    ? "Spend shown in source currency"
                    : "Share of total spend"}
                </span>
              )}
            </div>
            {!mixedCurrency && (
              <div
                className={styles.stackedBar}
                aria-label="Ad spend by channel"
              >
                {metrics.byPlatform.map((channel, index) => (
                  <span
                    key={`${channel.platform}-${channel.currency}`}
                    style={{
                      width: `${Math.max(0, Math.min(100, channel.percentage))}%`,
                      background: channelColors[index % channelColors.length],
                    }}
                    title={`${PROVIDER_NAMES[channel.platform] || channel.platform}: ${channel.percentage}%`}
                  />
                ))}
              </div>
            )}
            <div className={styles.channelLegend}>
              {metrics.byPlatform.map((channel, index) => (
                <div key={`${channel.platform}-${channel.currency}`}>
                  <i
                    style={{
                      background: channelColors[index % channelColors.length],
                    }}
                  />
                  <span>
                    {PROVIDER_NAMES[channel.platform] || channel.platform}
                  </span>
                  <strong>
                    {formatCurrency(channel.spend, channel.currency)}
                  </strong>
                  {!mixedCurrency && <small>{channel.percentage}%</small>}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <div className={styles.workGrid}>
        <div className={styles.workColumn}>
          <section className={styles.panel} id="connected-sources">
            <SectionTitle
              eyebrow={`${summaryCards.sources.total} SOURCES · ${summaryCards.sources.accountsTotal} ACCOUNTS`}
              title="Connected sources"
              action={
                <Link href="/sources" className={styles.textLink}>
                  Manage <ArrowUpRight size={14} />
                </Link>
              }
            />
            {sourcesList.length ? (
              <div className={styles.sourceGrid}>
                {sourcesList.map((source) => {
                  const state = sourceStatePresentation(source.state);
                  return (
                    <article key={source.id} className={styles.sourceCard}>
                      <div className={styles.sourceTop}>
                        <IntegrationMark
                          src={logoPathForConnectionProvider(source.provider)}
                          size="lg"
                          className={styles.logo}
                        />
                        <Status
                          state={state}
                          busy={source.state === "syncing"}
                        />
                      </div>
                      <Link
                        className={styles.sourceName}
                        href={`/sources/${source.id}`}
                      >
                        {source.name}
                        <ArrowUpRight size={15} />
                      </Link>
                      <p className={styles.sourceProvider}>
                        {PROVIDER_NAMES[source.provider] || source.provider}{" "}
                        <span>·</span> {source.accountCount}{" "}
                        {source.accountCount === 1 ? "account" : "accounts"}
                      </p>
                      {(source.managerBadge || source.shortId) && (
                        <div className={styles.sourceIds}>
                          {source.managerBadge && (
                            <CopyableBadge
                              text={source.managerBadge.replace(/^\[|\]$/g, "")}
                              copyValue={source.managerBadge
                                .replace(/^\[|\]$/g, "")
                                .replace(/^(MCC|BM|BC):\s*/, "")}
                              title={`Copy ${source.managerBadge}`}
                            />
                          )}
                          {source.shortId && (
                            <CopyableBadge
                              text={`#${source.shortId}`}
                              copyValue={source.id}
                              title="Copy connection ID"
                            />
                          )}
                        </div>
                      )}
                      <div className={styles.sourceFooter}>
                        {source.state === "syncing" ? (
                          <ConsoleActivityLabel label="Importing data" />
                        ) : (
                          <>
                            <span className={styles.sourceSyncDot} />
                            {source.lastSyncAt
                              ? `Synced ${formatDateTime(source.lastSyncAt)}`
                              : "No successful sync yet"}
                          </>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                icon={<Layers3 size={24} />}
                title="Your data starts here"
                description="Connect your first ad platform or store to bring performance into focus."
                href="/sources"
                label="Connect a source"
              />
            )}
            {sourcesList.length > 0 && (
              <Link href="/sources" className={styles.addSource}>
                <Plus size={15} />
                Connect another source
                <span>
                  Grow your data workspace <ArrowRight size={14} />
                </span>
              </Link>
            )}
          </section>
          <section className={cn(styles.panel, styles.warehousePanel)}>
            <SectionTitle
              eyebrow={`${formatCompactNumber(warehouse.totalRows)} STORED ROWS`}
              title="Warehouse health"
              action={
                <Status
                  state={warehouseState}
                  busy={warehouse.status === "refreshing"}
                />
              }
            />
            <div className={styles.warehouseStats}>
              <div>
                <span>Successful syncs</span>
                <strong>
                  {summaryCards.syncs.successful7d}
                  <small> / 7 days</small>
                </strong>
              </div>
              <div>
                <span>Failed syncs</span>
                <strong
                  className={
                    summaryCards.syncs.failed7d > 0 ? styles.failure : undefined
                  }
                >
                  {summaryCards.syncs.failed7d}
                  <small> / 7 days</small>
                </strong>
              </div>
              <div>
                <span>Recent metric rows</span>
                <strong>{formatCompactNumber(warehouse.rows7d)}</strong>
              </div>
            </div>
            <div className={styles.warehouseBottom}>
              <div>
                <span>LAST SUCCESSFUL REFRESH</span>
                <p>
                  {warehouseSnapshot.lastRefreshAt
                    ? formatDateTime(warehouseSnapshot.lastRefreshAt)
                    : "Your first import will appear here"}
                </p>
              </div>
              <Link href="/explorer" className={styles.button}>
                Open warehouse
                <ArrowUpRight size={14} />
              </Link>
            </div>
          </section>
        </div>
        <div className={styles.workColumn}>
          <section className={styles.panel} id="destinations">
            <SectionTitle
              eyebrow={`${summaryCards.destinations.activeCount} ACTIVE DESTINATIONS`}
              title="Destinations"
              action={
                <Link href="/exports" className={styles.textLink}>
                  Manage <ArrowUpRight size={14} />
                </Link>
              }
            />
            {destinationsList.length ? (
              <div className={styles.destinationList}>
                {destinationsList.map((destination) => (
                  <Link
                    key={destination.id}
                    href={destination.href}
                    className={styles.destination}
                  >
                    <span className={styles.destinationIcon}>
                      {destination.type === "api" ? (
                        <ArrowDownToLine size={20} />
                      ) : (
                        <IntegrationMark
                          src={
                            destination.type === "sheets"
                              ? INTEGRATION_LOGOS.googleSheets
                              : INTEGRATION_LOGOS.looker
                          }
                          size="md"
                          className={styles.logo}
                        />
                      )}
                    </span>
                    <div className={styles.destinationCopy}>
                      <div>
                        <h3>{destination.name}</h3>
                        <ArrowUpRight size={14} />
                      </div>
                      <p>{destination.subtext}</p>
                      <Status
                        state={destinationStatePresentation(destination.status)}
                        busy={destination.status === "syncing"}
                      />
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<Share2 size={24} />}
                title="Give your data a destination"
                description="Bring metrics into a spreadsheet, dashboard, or your own workflow."
                href="/exports"
                label="Explore destinations"
              />
            )}
            <div className={styles.deliveryNote}>
              <Share2 size={14} />
              <p>One warehouse. Ready for the way you report.</p>
            </div>
          </section>
          <section className={styles.panel}>
            <SectionTitle
              eyebrow="WORKSPACE PULSE"
              title="Recent activity"
              action={
                <Link href="/reports" className={styles.textLink}>
                  View reports <ArrowUpRight size={14} />
                </Link>
              }
            />
            {recentActivity.length ? (
              <ol className={styles.timeline}>
                {recentActivity.map((item) => (
                  <li key={item.id}>
                    <span
                      className={cn(
                        styles.eventIcon,
                        (item.status === "error" ||
                          item.status === "warning") &&
                          styles.attentionIcon,
                      )}
                    >
                      {activityIcon(item.status)}
                    </span>
                    <div>
                      <h3>{item.title}</h3>
                      <p>{item.description}</p>
                      <time dateTime={item.timestamp}>
                        {formatDateTime(item.timestamp)}
                      </time>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState
                icon={<Activity size={23} />}
                title="A little quiet, for now"
                description="Your imports, connections, and delivery events will appear here."
              />
            )}
          </section>
        </div>
      </div>
      {wizardDismissed && (
        <div className={styles.resume}>
          <span>Setup guide hidden.</span>
          <button type="button" onClick={onWizardResume}>
            Resume setup guide <ArrowRight size={12} />
          </button>
        </div>
      )}
      <footer className={styles.footer}>
        <span>
          <span className={styles.footerMark}>✳</span> Monstera Cloud
        </span>
        <p>
          {warehouseSnapshot.lastRefreshAt
            ? `Last successful sync ${formatDateTime(warehouseSnapshot.lastRefreshAt)}`
            : "Built around your data"}
        </p>
        <span>Workspace overview</span>
      </footer>
    </div>
  );
}

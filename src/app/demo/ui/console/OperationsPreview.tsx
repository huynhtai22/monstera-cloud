"use client";
import {
  Activity,
  ArrowRight,
  Check,
  Database,
  FileCheck2,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import {
  Action,
  Badge,
  Empty,
  Notice,
  Panel,
  SectionHeader,
  Stats,
  TextLink,
} from "./PreviewPrimitives";
import { usePreviewTask } from "./use-preview-task";
import type { SectionProps } from "./section-types";
import styles from "./sections.module.css";

export function OperationsPreview({ overview, mode }: SectionProps) {
  const { busy, notice, run } = usePreviewTask();
  const empty = mode === "New workspace";
  const attention = mode === "Needs attention";
  const syncing = mode === "Syncing" || Boolean(busy);
  const warehouse = overview.summaryCards.warehouse;
  const cards = [
    {
      title: "Connector health",
      eyebrow: "01 / AUTHORIZATION",
      icon: ShieldCheck,
      value: empty ? "0" : attention ? "8 / 12" : "12 / 12",
      label: "accounts authorized",
      note: empty
        ? "Connect a source to start monitoring authorization."
        : attention
          ? "Google Ads needs to be reconnected."
          : "Your account authorizations are in good shape.",
      status: empty
        ? "Not connected"
        : attention
          ? "Reconnect required"
          : "Healthy",
      href: "#sources",
      action: "Manage sources",
    },
    {
      title: "Source freshness",
      eyebrow: "02 / CURRENCY",
      icon: Activity,
      value: empty ? "0" : attention ? "3 / 4" : syncing ? "2 / 4" : "4 / 4",
      label: "sources current",
      note: empty
        ? "Freshness appears after the first successful import."
        : syncing
          ? "Two sources are importing fresh metrics."
          : "Last successful refresh: Sep 27, 8:42 PM.",
      status: empty
        ? "Awaiting data"
        : syncing
          ? "Syncing"
          : attention
            ? "Partial"
            : "Current",
      href: "#sources",
      action: "Review freshness",
    },
    {
      title: "Ingestion",
      eyebrow: "03 / WAREHOUSE",
      icon: Database,
      value: String(overview.summaryCards.syncs.successful7d),
      label: "successful imports · 7 days",
      note: `${overview.summaryCards.syncs.failed7d} failed jobs in the same window. Existing warehouse data is retained.`,
      status: syncing
        ? "Importing"
        : attention
          ? "Review failures"
          : empty
            ? "No jobs yet"
            : "Up to date",
      href: "#warehouse",
      action: "Open warehouse",
    },
    {
      title: "Report readiness",
      eyebrow: "04 / REVIEW",
      icon: FileCheck2,
      value: empty ? "0" : attention ? "2 / 3" : "3 / 3",
      label: "client datasets ready",
      note: empty
        ? "Assign accounts to clients to evaluate report readiness."
        : attention
          ? "Forma Studio has a source gap to resolve before reporting."
          : "Coverage and freshness checks passed for your sample clients.",
      status: empty ? "Not evaluated" : attention ? "Needs review" : "Ready",
      href: "#reports",
      action: "Review reports",
    },
    {
      title: "Destination delivery",
      eyebrow: "05 / AVAILABILITY",
      icon: ArrowRight,
      value: empty ? "0" : "2",
      label: "configured destinations",
      note: "Google Sheets and Looker Studio pull from the warehouse on demand.",
      status: empty ? "Not configured" : "Available",
      href: "#exports",
      action: "View destinations",
    },
    {
      title: "Marketing anomalies",
      eyebrow: "06 / SIGNALS",
      icon: TriangleAlert,
      value: empty ? "—" : "0",
      label: "flagged metric anomalies",
      note: empty
        ? "Anomaly evidence appears when campaigns have enough history."
        : "No flagged anomalies in the sample campaign evidence.",
      status: empty ? "No evidence" : "Clear",
      href: "#reports",
      action: "Explore performance",
    },
  ];
  return (
    <div className={styles.page}>
      <SectionHeader
        eyebrow="WORKSPACE HEALTH"
        title="Operations"
        description="A clear view of every step between connection and reporting."
      >
        <Action
          onClick={() => run("refresh", "Sample operation statuses refreshed.")}
          loadingLabel="Checking health…"
          busy={busy ? "Checking health…" : undefined}
        >
          <RefreshCw size={14} />
          Update status
        </Action>
      </SectionHeader>
      {notice && <Notice>{notice}</Notice>}
      <div className={styles.callout}>
        <div className={styles.row}>
          <span className={styles.calloutIcon}>
            {attention ? (
              <TriangleAlert size={27} />
            ) : (
              <ShieldCheck size={27} />
            )}
          </span>
          <div>
            <p className={styles.eyebrow}>YOUR NEXT BEST ACTION</p>
            <h2>
              {empty
                ? "Connect your first source"
                : attention
                  ? "Restore the Google Ads connection"
                  : syncing
                    ? "An import is underway"
                    : "Your workspace is ready for reporting"}
            </h2>
            <p>
              {empty
                ? "The operations hub brings authorization, freshness, and delivery into one view."
                : attention
                  ? "Four accounts are waiting for authorization. Review the source to restore their coverage."
                  : syncing
                    ? "Keep working while fresh data arrives. Existing metrics remain available."
                    : "Source authorization, recent data, and client coverage are in place. Review the latest performance before sharing."}
            </p>
          </div>
        </div>
        <TextLink href={empty || attention ? "#sources" : "#reports"}>
          {empty || attention ? "Open sources" : "Open reports"}
        </TextLink>
      </div>
      <Stats
        items={[
          {
            label: "Monitored accounts",
            value: overview.summaryCards.sources.accountsTotal,
            detail: "Across all connected sources",
          },
          {
            label: "Current sources",
            value: overview.summaryCards.sources.healthy,
            detail: `${overview.summaryCards.sources.total} connections in this workspace`,
          },
          {
            label: "Recent rows",
            value: warehouse.rows7d.toLocaleString(),
            detail: "Imported in the last 7 days",
          },
          {
            label: "Failed imports",
            value: overview.summaryCards.syncs.failed7d,
            detail: "Review the latest job evidence",
            tone: attention ? "#e5bb80" : undefined,
          },
        ]}
      />
      <div className={styles.grid3}>
        {cards.map((card) => (
          <Panel
            key={card.title}
            title={card.title}
            eyebrow={card.eyebrow}
            action={<card.icon size={17} className={styles.muted} />}
          >
            <div className={styles.miniStats}>
              <div>
                <strong>{card.value}</strong>
                <span>{card.label}</span>
              </div>
            </div>
            <div className={styles.healthTrack} aria-hidden>
              {Array.from({ length: 12 }, (_, i) => (
                <span
                  key={i}
                  className={
                    empty
                      ? styles.emptySegment
                      : attention &&
                          i > 7 &&
                          card.title !== "Marketing anomalies"
                        ? styles.badSegment
                        : undefined
                  }
                />
              ))}
            </div>
            <Badge
              busy={
                syncing &&
                ["Source freshness", "Ingestion"].includes(card.title)
              }
              tone={
                empty
                  ? "neutral"
                  : attention &&
                      !["Destination delivery", "Marketing anomalies"].includes(
                        card.title,
                      )
                    ? "warn"
                    : "good"
              }
            >
              {card.status}
            </Badge>
            <p
              className={styles.muted}
              style={{ marginTop: 14, minHeight: 60 }}
            >
              {card.note}
            </p>
            <div className={styles.cardFooter}>
              <TextLink href={card.href}>{card.action}</TextLink>
            </div>
          </Panel>
        ))}
      </div>
      <div style={{ marginTop: 22 }}>
        <Panel
          title="Latest operational evidence"
          eyebrow="RECENT CHECKS"
          action={<TextLink href="#reports">View sync activity</TextLink>}
        >
          {empty ? (
            <Empty title="Waiting for your first import" />
          ) : (
            <ul className={styles.eventList}>
              {overview.recentActivity.map((item) => (
                <li key={item.id}>
                  <span className={styles.iconTile}>
                    {item.status === "error" ? (
                      <TriangleAlert size={16} />
                    ) : (
                      <Check size={16} />
                    )}
                  </span>
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.description}</p>
                  </div>
                  <time>
                    {new Date(item.timestamp).toLocaleTimeString("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

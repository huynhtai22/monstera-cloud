"use client";
import { useState } from "react";
import { Check, Download, FileCheck2, RefreshCw } from "lucide-react";
import {
  formatCompactNumber,
  formatCurrency,
  PROVIDER_NAMES,
} from "@/components/dashboard/console-presentation";
import {
  Action,
  Badge,
  Empty,
  Modal,
  Notice,
  Panel,
  SectionHeader,
  Stats,
  Switcher,
  TextLink,
} from "./PreviewPrimitives";
import {
  campaignRows,
  downloadSampleCsv,
  sampleClients,
} from "./sections-model";
import { CampaignTable } from "./CampaignTable";
import { usePreviewTask } from "./use-preview-task";
import type { SectionProps } from "./section-types";
import styles from "./sections.module.css";

const dailySpend = [2150, 2840, 2610, 3020, 2450, 2950, 2400.5];
export function ReportsPreview({ overview, mode }: SectionProps) {
  const [view, setView] = useState("Executive performance");
  const [client, setClient] = useState("");
  const [review, setReview] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [logStatus, setLogStatus] = useState("All runs");
  const { notice, busy, run, setNotice } = usePreviewTask();
  const rows =
    mode === "New workspace"
      ? []
      : campaignRows.filter((row) => !client || row.client === client);
  const spend = rows.reduce((sum, row) => sum + row.spend, 0);
  const revenue = rows.reduce((sum, row) => sum + row.revenue, 0);
  const conversions = rows.reduce((sum, row) => sum + row.conversions, 0);
  const mixed = mode === "Multi-currency" && !client;
  const logs =
    mode === "New workspace"
      ? []
      : [
          {
            id: "1",
            name: "Google Sheets · North Supply",
            destination: "Google Sheets",
            rows: 1248,
            time: "Sep 27, 8:42 PM",
            status: "Success",
          },
          {
            id: "2",
            name: "Client dashboard · Forma",
            destination: "Looker Studio",
            rows: 864,
            time: "Sep 27, 8:32 PM",
            status: mode === "Needs attention" ? "Error" : "Success",
          },
          {
            id: "3",
            name: "Weekly performance · Goodkind",
            destination: "Google Sheets",
            rows: 640,
            time: "Sep 26, 9:10 PM",
            status: "Success",
          },
        ].filter((log) => logStatus === "All runs" || log.status === logStatus);
  return (
    <div className={styles.page}>
      <SectionHeader
        eyebrow="MEANING BEHIND THE METRICS"
        title="Reports"
        description="Turn connected data into a clearer story for every client."
      >
        <Action disabled={!rows.length} onClick={() => downloadSampleCsv(rows)}>
          <Download size={14} />
          Export sample CSV
        </Action>
      </SectionHeader>
      {notice && <Notice>{notice}</Notice>}
      <div className={styles.toolbar}>
        <Switcher
          label="Report view"
          options={["Executive performance", "Sync activity & logs"]}
          value={view}
          onChange={setView}
        />
        {view === "Executive performance" ? (
          <select
            className={styles.select}
            aria-label="Report client"
            value={client}
            onChange={(e) => setClient(e.target.value)}
          >
            <option value="">All clients</option>
            {sampleClients.map((c) => (
              <option key={c.id}>{c.name}</option>
            ))}
          </select>
        ) : (
          <Switcher
            label="Run status"
            options={["All runs", "Success", "Error"]}
            value={logStatus}
            onChange={setLogStatus}
          />
        )}
      </div>
      {view === "Executive performance" ? (
        <>
          <div className={styles.callout}>
            <div className={styles.row}>
              <span className={styles.calloutIcon}>
                <FileCheck2 size={28} />
              </span>
              <div>
                <p className={styles.eyebrow}>WEEKLY PERFORMANCE · SEP 21–27</p>
                <h2>
                  {mode === "New workspace"
                    ? "Your first report starts with data"
                    : reviewed
                      ? "The sample report has been reviewed"
                      : "From raw metrics to a report worth sharing"}
                </h2>
                <p>
                  {mode === "Needs attention"
                    ? "Resolve the Google Ads authorization gap before treating client reporting as complete."
                    : "Review source coverage, revenue attribution, and campaign results before sharing your next client update."}
                </p>
              </div>
            </div>
            <Action
              primary
              disabled={!rows.length}
              onClick={() => setReview(true)}
            >
              {reviewed ? <Check size={14} /> : <FileCheck2 size={14} />}Review
              report
            </Action>
          </div>
          <Stats
            items={[
              {
                label: "Ad spend",
                value: rows.length
                  ? mixed
                    ? "USD + VND"
                    : formatCurrency(spend, "USD")
                  : "—",
                detail: mixed
                  ? "Currencies shown separately below"
                  : "Across the selected client campaigns",
              },
              {
                label: "Attributed revenue",
                value: rows.length
                  ? mixed
                    ? "USD + VND"
                    : formatCurrency(revenue, "USD")
                  : "—",
                detail: "Revenue and GMV reported by sources",
              },
              {
                label: "Blended ROAS",
                value:
                  spend && !mixed ? `${(revenue / spend).toFixed(2)}×` : "—",
                detail: mixed
                  ? "No blending across currencies"
                  : "Attributed revenue / ad spend",
              },
              {
                label: "Conversions",
                value: rows.length ? formatCompactNumber(conversions) : "—",
                detail: "Source-reported conversion events",
              },
            ]}
          />
          <div className={styles.grid2}>
            <Panel
              title="Daily spend"
              eyebrow={client ? `${client} · USD` : "LAST 7 DAYS · USD"}
              action={<Badge tone="neutral">Sample series</Badge>}
            >
              {rows.length ? (
                <>
                  <div className={styles.chartLegend}>
                    <span>
                      <i />
                      Ad spend
                    </span>
                  </div>
                  <div
                    className={styles.chart}
                    role="img"
                    aria-label={`Sample daily USD ad spend for September 21 to 27. Total ${formatCurrency(spend, "USD")}.`}
                  >
                    <div className={styles.bars}>
                      {dailySpend.map((value, index) => (
                        <div className={styles.barGroup} key={index}>
                          <div
                            className={styles.bar}
                            style={{
                              height: `${(value / 3500) * 100}%`,
                              width: "100%",
                              maxWidth: 42,
                            }}
                            title={`${index + 21} Sep: ${formatCurrency((value * spend) / 18420.5, "USD")}`}
                          />
                        </div>
                      ))}
                    </div>
                    <div className={styles.chartLabels}>
                      {dailySpend.map((_, i) => (
                        <span key={i}>{i + 21} Sep</span>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <Empty title="Your performance story is on its way" />
              )}
            </Panel>
            <Panel title="Review before sharing" eyebrow="REPORT READINESS">
              <ol className={styles.numberList}>
                <li>
                  <div>
                    <h3>Source coverage</h3>
                    <p>
                      {mode === "Needs attention"
                        ? "Google Ads is missing a current authorization. Reconnect before delivery."
                        : `${overview.summaryCards.sources.total} sample connections cover this workspace. Check account assignments for client-specific reports.`}
                    </p>
                  </div>
                </li>
                <li>
                  <div>
                    <h3>Attribution & currency</h3>
                    <p>
                      {mixed
                        ? "USD and VND are both present. Compare each currency on its own; a combined ROAS would be misleading."
                        : "Revenue follows each platform’s attribution. Amounts in this sample view are in USD."}
                    </p>
                  </div>
                </li>
                <li>
                  <div>
                    <h3>Data freshness</h3>
                    <p>
                      {overview.warehouseSnapshot.dataThroughDate
                        ? `Latest metric date: ${overview.warehouseSnapshot.dataThroughDate}. Review the date window before sharing.`
                        : "Import recent rows to evaluate report freshness."}
                    </p>
                  </div>
                </li>
              </ol>
              <div className={styles.cardFooter}>
                <TextLink href="#operations">
                  Inspect readiness evidence
                </TextLink>
              </div>
            </Panel>
          </div>
          {mixed && (
            <div style={{ marginTop: 20 }}>
              <Notice>
                Separate VND sample totals: ₫32,400,000 spend · ₫110,000,000
                revenue. The chart and campaign table below show USD only.
              </Notice>
            </div>
          )}
          <div style={{ marginTop: 22 }}>
            <Panel
              title="Campaign performance"
              eyebrow="THE DETAIL BEHIND YOUR REPORT"
              action={<TextLink href="#warehouse">Explore warehouse</TextLink>}
            >
              <CampaignTable rows={rows} />
              <div className={styles.tableFooter}>
                <span>{rows.length} sample campaigns · Sep 21–27, 2026</span>
                <span>Amounts in USD</span>
              </div>
            </Panel>
          </div>
        </>
      ) : (
        <>
          <div className={styles.callout}>
            <div>
              <p className={styles.eyebrow}>DELIVERY EVIDENCE</p>
              <h2>Every destination run, in one place.</h2>
              <p>
                These are sample source-to-destination pipeline records. Manual
                warehouse import health is shown in Operations.
              </p>
            </div>
            <TextLink href="#operations">Open Operations</TextLink>
          </div>
          <Panel
            title="Destination run history"
            eyebrow="ACTIVITY & LOGS"
            action={
              <Action
                loadingLabel="Refreshing…"
                busy={busy ? "Refreshing…" : undefined}
                onClick={() =>
                  run("refresh", "Sample destination run history refreshed.")
                }
              >
                <RefreshCw size={13} />
                Refresh
              </Action>
            }
          >
            {logs.length ? (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Pipeline</th>
                      <th>Destination</th>
                      <th>Status</th>
                      <th>Rows</th>
                      <th>Started</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr key={log.id}>
                        <td>
                          <strong>{log.name}</strong>
                          <small>Sample run · {log.id}</small>
                        </td>
                        <td>{log.destination}</td>
                        <td>
                          <Badge
                            tone={log.status === "Error" ? "warn" : "good"}
                          >
                            {log.status}
                          </Badge>
                        </td>
                        <td>
                          {log.status === "Error"
                            ? "—"
                            : log.rows.toLocaleString()}
                        </td>
                        <td>{log.time}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No destination runs in this view" />
            )}
          </Panel>
        </>
      )}
      {review && (
        <Modal
          title="Weekly performance review"
          wide
          onClose={() => setReview(false)}
        >
          <p className={styles.muted}>
            Sep 21–27, 2026 · {client || "All clients"} · Sample report
          </p>
          <div className={styles.divider} />
          <Stats
            items={[
              {
                label: "Sample spend · USD",
                value: formatCurrency(spend, "USD"),
                detail: "Selected campaigns",
              },
              {
                label: "Revenue · USD",
                value: formatCurrency(revenue, "USD"),
                detail: "Source attribution",
              },
              {
                label: "ROAS · USD",
                value: spend ? `${(revenue / spend).toFixed(2)}×` : "—",
                detail: "Same-currency comparison",
              },
              {
                label: "Conversions",
                value: formatCompactNumber(conversions),
                detail: "Source-reported",
              },
            ]}
          />
          <ul className={styles.eventList}>
            {overview.sourcesList.map((source) => (
              <li key={source.id}>
                <div>
                  <strong>{PROVIDER_NAMES[source.provider]}</strong>
                  <p>{source.name}</p>
                </div>
                <Badge tone={source.state === "error" ? "warn" : "good"}>
                  {source.state === "error"
                    ? "Resolve source gap"
                    : "Coverage available"}
                </Badge>
              </li>
            ))}
          </ul>
          {mode === "Needs attention" && (
            <Notice>
              Resolve the source gap before marking this sample report reviewed.
            </Notice>
          )}
          <div className={styles.formActions}>
            <Action onClick={() => setReview(false)}>Close</Action>
            <Action
              primary
              disabled={mode === "Needs attention"}
              onClick={() => {
                setReviewed(true);
                setReview(false);
                setNotice(
                  "Sample report marked reviewed. Nothing has been sent to clients.",
                );
              }}
            >
              <Check size={14} />
              Mark sample reviewed
            </Action>
          </div>
        </Modal>
      )}
    </div>
  );
}

"use client";
import { useState } from "react";
import {
  ArrowRight,
  Code2,
  Copy,
  Database,
  KeyRound,
  Table2,
} from "lucide-react";
import { IntegrationMark } from "@/components/ui/IntegrationMark";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";
import {
  Action,
  Badge,
  Modal,
  Notice,
  Panel,
  SectionHeader,
  TextLink,
} from "./PreviewPrimitives";
import { usePreviewTask } from "./use-preview-task";
import type { SectionProps } from "./section-types";
import styles from "./sections.module.css";

export function ExportsPreview({ mode }: SectionProps) {
  const [destination, setDestination] = useState<string | null>(null);
  const [connected, setConnected] = useState<string[]>(
    mode === "New workspace" ? [] : ["Google Sheets", "Looker Studio"],
  );
  const { busy, notice, run, setNotice } = usePreviewTask();
  const destinations = [
    {
      name: "Google Sheets",
      logo: INTEGRATION_LOGOS.googleSheets,
      description:
        "Bring warehouse metrics into the spreadsheets your team already knows.",
      eyebrow: "SPREADSHEETS",
      features: [
        "Query metrics with the Monstera add-on",
        "Select sources, accounts, and date windows",
        "Refresh your spreadsheet on demand",
      ],
    },
    {
      name: "Looker Studio",
      logo: INTEGRATION_LOGOS.looker,
      description:
        "Power client dashboards with a consistent foundation of marketing data.",
      eyebrow: "DASHBOARDS",
      features: [
        "Connect through the Monstera connector",
        "Build visual reports from warehouse metrics",
        "Included on eligible workspace plans",
      ],
    },
  ];
  async function copyExample() {
    try {
      await navigator.clipboard.writeText(
        "GET /api/metrics/query?workspaceId=YOUR_WORKSPACE_ID",
      );
      setNotice(
        "Example request copied. Use a real workspace and valid authorization in your integration.",
      );
    } catch {
      setNotice(
        "Clipboard unavailable. You can select the example request below to copy it.",
      );
    }
  }
  return (
    <div className={styles.page}>
      <SectionHeader
        eyebrow="FROM DATA TO DELIVERY"
        title="Exports & API"
        description="Your warehouse, wherever your work happens."
      >
        <Action
          onClick={() => {
            window.location.hash = "settings";
          }}
        >
          <KeyRound size={14} />
          Manage API keys
        </Action>
      </SectionHeader>
      {notice && <Notice>{notice}</Notice>}
      <div className={styles.callout}>
        <div className={styles.row}>
          <span className={styles.calloutIcon}>
            <Database size={27} />
          </span>
          <div>
            <p className={styles.eyebrow}>
              ONE WAREHOUSE. MULTIPLE WAYS TO WORK.
            </p>
            <h2>Make your data useful beyond the console.</h2>
            <p>
              Query fresh warehouse metrics from Google Sheets, Looker Studio,
              or an authorized API integration.
            </p>
          </div>
        </div>
        <Badge tone="blue">On-demand delivery</Badge>
      </div>
      <div className={styles.grid2}>
        {destinations.map((item) => (
          <article key={item.name} className={styles.card}>
            <div className={styles.cardTop}>
              <IntegrationMark src={item.logo} size="lg" />
              <Badge tone={connected.includes(item.name) ? "good" : "neutral"}>
                {connected.includes(item.name)
                  ? "Sample configured"
                  : "Not configured"}
              </Badge>
            </div>
            <p className={styles.eyebrow}>{item.eyebrow}</p>
            <h2 style={{ fontSize: 23, margin: "8px 0 12px" }}>{item.name}</h2>
            <p>{item.description}</p>
            <ol className={styles.numberList}>
              {item.features.map((feature) => (
                <li key={feature}>
                  <div>
                    <p>{feature}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className={styles.cardFooter}>
              <span>
                {item.name === "Google Sheets"
                  ? "Add-on · Private beta"
                  : "Connector · Plan eligibility applies"}
              </span>
              <Action primary onClick={() => setDestination(item.name)}>
                {connected.includes(item.name)
                  ? "View setup"
                  : "Set up destination"}
                <ArrowRight size={14} />
              </Action>
            </div>
          </article>
        ))}
      </div>
      <div style={{ marginTop: 22 }}>
        <Panel
          title="Build with your warehouse"
          eyebrow="DEVELOPER ACCESS"
          action={
            <span className={styles.iconTile}>
              <Code2 size={20} />
            </span>
          }
        >
          <div className={styles.grid2}>
            <div>
              <h3 style={{ fontSize: 15, marginBottom: 10 }}>Metrics API</h3>
              <p className={styles.muted}>
                Read workspace metrics using a scoped API key. Keep account
                filters and reporting dates explicit in your integration.
              </p>
              <div className={styles.actions} style={{ marginTop: 22 }}>
                <TextLink href="#settings">Review API access</TextLink>
                <Action onClick={copyExample}>
                  <Copy size={13} />
                  Copy example
                </Action>
              </div>
            </div>
            <div>
              <code className={styles.code}>
                GET /api/metrics/query
                <br />
                ?workspaceId=YOUR_WORKSPACE_ID
                <br />
                <br /># Example only — add valid authorization.
              </code>
            </div>
          </div>
        </Panel>
      </div>
      <div
        className={styles.callout}
        style={{ marginTop: 22, borderColor: "#333333" }}
      >
        <div className={styles.row}>
          <span className={styles.iconTile}>
            <Table2 size={22} />
          </span>
          <div>
            <p className={styles.eyebrow}>ON THE ROADMAP</p>
            <h2>Scheduled spreadsheet delivery</h2>
            <p>
              Background push to spreadsheets is not active during the pilot.
              Use the add-on or connector for on-demand pulls.
            </p>
          </div>
        </div>
        <Badge tone="neutral">Coming soon</Badge>
      </div>
      {destination && (
        <Modal
          title={`${destination} setup`}
          onClose={() => setDestination(null)}
        >
          <p className={styles.muted}>
            This local walkthrough previews the destination setup. No external
            account is contacted.
          </p>
          <ol className={styles.numberList}>
            <li>
              <div>
                <h3>
                  {destination === "Google Sheets"
                    ? "Open the Monstera add-on"
                    : "Select the Monstera connector"}
                </h3>
                <p>Start from your spreadsheet or Looker Studio report.</p>
              </div>
            </li>
            <li>
              <div>
                <h3>Authorize the workspace</h3>
                <p>
                  Use credentials scoped to the workspace you want to query.
                </p>
              </div>
            </li>
            <li>
              <div>
                <h3>Choose your metrics</h3>
                <p>
                  Pick accounts and a reporting window, then pull from the
                  warehouse.
                </p>
              </div>
            </li>
          </ol>
          <div className={styles.formActions}>
            <Action onClick={() => setDestination(null)}>Close</Action>
            <Action
              primary
              loadingLabel="Checking sample…"
              busy={busy ? "Checking sample…" : undefined}
              onClick={() =>
                run(
                  "destination",
                  `${destination} sample setup checked. No external destination was changed.`,
                  () => {
                    setConnected((prev) => [
                      ...new Set([...prev, destination]),
                    ]);
                    setDestination(null);
                  },
                )
              }
            >
              Check sample setup
              <ArrowRight size={14} />
            </Action>
          </div>
        </Modal>
      )}
    </div>
  );
}

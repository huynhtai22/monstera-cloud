"use client";
import { useState } from "react";
import { Check, Database, Download, RefreshCw } from "lucide-react";
import { PROVIDER_NAMES } from "@/components/dashboard/console-presentation";
import {
  Action,
  Badge,
  Modal,
  Notice,
  Panel,
  SearchBox,
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

export function WarehousePreview({ overview, mode }: SectionProps) {
  const [platform, setPlatform] = useState("");
  const [client, setClient] = useState("");
  const [search, setSearch] = useState("");
  const [preset, setPreset] = useState("Performance");
  const [importOpen, setImportOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(
    overview.sourcesList.map((item) => item.id),
  );
  const [since, setSince] = useState("2026-09-21");
  const [until, setUntil] = useState("2026-09-27");
  const { busy, notice, run } = usePreviewTask();
  const allRows =
    mode === "New workspace"
      ? []
      : mode === "Multi-currency"
        ? [
            ...campaignRows,
            {
              id: "vnd",
              name: "Shop discovery · September",
              client: "North Supply",
              platform: "shopee",
              date: "2026-09-27",
              spend: 32400000,
              revenue: 110000000,
              impressions: 185000,
              clicks: 6300,
              conversions: 284,
              currency: "VND",
            },
          ]
        : campaignRows;
  const rows = allRows.filter(
    (row) =>
      (!platform || row.platform === platform) &&
      (!client || row.client === client) &&
      `${row.name} ${row.client}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className={styles.page}>
      <SectionHeader
        eyebrow="YOUR DATA FOUNDATION"
        title="Warehouse"
        description="Explore the metrics behind every decision. Organized, searchable, and yours."
      >
        <Action onClick={() => downloadSampleCsv(rows)} disabled={!rows.length}>
          <Download size={14} />
          Export sample CSV
        </Action>
        <Action
          primary
          loadingLabel="Importing…"
          busy={busy ? "Importing…" : undefined}
          onClick={() => setImportOpen(true)}
        >
          <RefreshCw size={14} />
          Import data
        </Action>
      </SectionHeader>
      {notice && <Notice>{notice}</Notice>}
      <Stats
        items={[
          {
            label: "Stored metric rows",
            value: overview.summaryCards.warehouse.totalRows.toLocaleString(),
            detail: "Across the entire sample warehouse",
          },
          {
            label: "Rows in last 7 days",
            value: overview.summaryCards.warehouse.rows7d.toLocaleString(),
            detail: "Recent campaign and order metrics",
          },
          {
            label: "Connected sources",
            value: overview.summaryCards.sources.total,
            detail: "Platforms delivering data",
          },
          {
            label: "Data through",
            value: mode === "New workspace" ? "—" : "Sep 27",
            detail: "Latest available metric date",
          },
        ]}
      />
      <Panel
        title="Warehouse data"
        eyebrow="EXPLORE YOUR METRICS"
        action={
          <Badge
            busy={Boolean(busy) || mode === "Syncing"}
            tone={
              mode === "Needs attention"
                ? "warn"
                : mode === "New workspace"
                  ? "neutral"
                  : "good"
            }
          >
            {busy || mode === "Syncing"
              ? "Importing data"
              : mode === "Needs attention"
                ? "Partial coverage"
                : mode === "New workspace"
                  ? "Awaiting data"
                  : "Current"}
          </Badge>
        }
      >
        <div className={styles.toolbar}>
          <div className={styles.actions}>
            <select
              className={styles.select}
              aria-label="Warehouse platform"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
            >
              <option value="">All platforms</option>
              {Object.entries(PROVIDER_NAMES)
                .slice(0, 4)
                .map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
            </select>
            <select
              className={styles.select}
              aria-label="Warehouse client"
              value={client}
              onChange={(e) => setClient(e.target.value)}
            >
              <option value="">All clients</option>
              {sampleClients.map((c) => (
                <option key={c.id}>{c.name}</option>
              ))}
            </select>
            <span className={styles.muted}>Sep 21–27, 2026</span>
          </div>
          <Action
            onClick={() => {
              setPlatform("");
              setClient("");
              setSearch("");
              setPreset("Performance");
            }}
          >
            Reset view
          </Action>
        </div>
        <div className={styles.toolbar}>
          <Switcher
            label="Metric columns"
            options={["Performance", "Traffic & engagement"]}
            value={preset}
            onChange={setPreset}
          />
          <SearchBox
            label="Search warehouse"
            placeholder="Search campaigns or clients…"
            value={search}
            onChange={setSearch}
          />
        </div>
        <CampaignTable
          rows={rows}
          traffic={preset === "Traffic & engagement"}
        />
        <div className={styles.tableFooter}>
          <span>
            <Database size={12} />
            {rows.length} sample rows shown · Amounts in source currency
          </span>
          <TextLink href="#sources">Manage source coverage</TextLink>
        </div>
      </Panel>
      <div className={styles.callout} style={{ marginTop: 24 }}>
        <div>
          <p className={styles.eyebrow}>ONE RELIABLE FOUNDATION</p>
          <h2>Your warehouse powers every destination.</h2>
          <p>
            Import data here, then explore it in Reports or query it from Google
            Sheets and Looker Studio. Mixed currencies stay separate.
          </p>
        </div>
        <TextLink href="#exports">Explore destinations</TextLink>
      </div>
      {importOpen && (
        <Modal title="Import recent data" onClose={() => setImportOpen(false)}>
          <p className={styles.muted}>
            Choose the source connections and reporting window for this sample
            import.
          </p>
          <div className={styles.checkList}>
            {overview.sourcesList.map((source) => (
              <label key={source.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(source.id)}
                  onChange={(e) =>
                    setSelected((prev) =>
                      e.target.checked
                        ? [...prev, source.id]
                        : prev.filter((id) => id !== source.id),
                    )
                  }
                />
                {source.name}
                <small className={styles.muted}>
                  {" "}
                  · {source.accountCount} accounts
                </small>
              </label>
            ))}
          </div>
          {!overview.sourcesList.length && (
            <Notice>Connect a source before importing data.</Notice>
          )}
          <div className={`${styles.form} ${styles.grid2}`}>
            <label>
              From
              <input
                type="date"
                value={since}
                onChange={(e) => setSince(e.target.value)}
                required
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={until}
                onChange={(e) => setUntil(e.target.value)}
                required
              />
            </label>
          </div>
          {since > until && (
            <p className={styles.muted} role="alert">
              The end date must be on or after the start date.
            </p>
          )}
          <div className={styles.formActions}>
            <Action onClick={() => setImportOpen(false)}>Cancel</Action>
            <Action
              primary
              disabled={!selected.length || !since || !until || since > until}
              onClick={() => {
                setImportOpen(false);
                run(
                  "import",
                  `Sample import completed for ${selected.length} connections. Live warehouse data is unchanged.`,
                );
              }}
            >
              <Check size={14} />
              Run sample import
            </Action>
          </div>
        </Modal>
      )}
    </div>
  );
}

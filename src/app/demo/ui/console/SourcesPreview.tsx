"use client";
import { useState } from "react";
import { ArrowRight, Check, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { IntegrationMark } from "@/components/ui/IntegrationMark";
import { logoPathForCatalogId } from "@/lib/integration-logos";
import {
  PROVIDER_NAMES,
  sourceStatePresentation,
} from "@/components/dashboard/console-presentation";
import {
  Action,
  Badge,
  Empty,
  Modal,
  Notice,
  Panel,
  SearchBox,
  SectionHeader,
  Stats,
  Switcher,
  TextLink,
} from "./PreviewPrimitives";
import { sampleClients } from "./sections-model";
import { usePreviewTask } from "./use-preview-task";
import type { SectionProps } from "./section-types";
import styles from "./sections.module.css";
import sourceStyles from "./SourcesPreview.module.css";

const catalog = [
  {
    id: "meta_ads",
    description:
      "Campaigns, ads, and daily performance from your business accounts.",
    category: "Advertising",
  },
  {
    id: "google_ads",
    description:
      "Search, display, shopping, and video performance in one warehouse.",
    category: "Advertising",
  },
  {
    id: "tiktok_business",
    description:
      "Bring your short-form advertising performance into the picture.",
    category: "Advertising",
  },
  {
    id: "shopee",
    description: "Daily order and revenue rollups from your connected stores.",
    category: "Commerce",
  },
];
export function SourcesPreview({ overview, mode }: SectionProps) {
  const [tab, setTab] = useState("Connected");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState("Overview");
  const [newConnection, setNewConnection] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [recovered, setRecovered] = useState<string[]>([]);
  const { busy, notice, run } = usePreviewTask();
  const extra = added
    .filter((id) => !overview.sourcesList.some((s) => s.provider === id))
    .map((id) => ({
      id: `sample-${id}`,
      provider: id,
      name: `Sample ${PROVIDER_NAMES[id]}`,
      accountCount: 1,
      accountTags: [],
      state: "pending" as const,
      lastSyncAt: null,
      lastError: null,
    }));
  const sources = [...overview.sourcesList, ...extra];
  const filtered = sources.filter((item) =>
    `${item.name} ${PROVIDER_NAMES[item.provider]}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const source = sources.find((item) => item.id === selected);
  const accountRows = sources.flatMap((item) =>
    Array.from({ length: item.accountCount }, (_, i) => ({
      id: `${item.id}-${i}`,
      name: `${sampleClients[i % 3].name} · ${i + 1}`,
      source: item,
      client: sampleClients[i % 3].name,
    })),
  );
  function openSource(id: string) {
    setSelected(id);
    setDetailTab("Overview");
  }
  function sync(id: string) {
    run(id, "Sample source sync completed. Live accounts are unchanged.", () =>
      setRecovered((prev) => [...prev, id]),
    );
  }
  return (
    <div className={styles.page}>
      <SectionHeader
        eyebrow="CONNECTED DATA"
        title="Sources"
        description="Every platform, account, and connection. Together in one workspace."
      >
        <Action
          primary
          onClick={() => {
            setTab("Integration library");
            setSearch("");
          }}
        >
          <Plus size={15} />
          Connect a source
        </Action>
      </SectionHeader>
      {notice && <Notice>{notice}</Notice>}
      <div className={sourceStyles.summary}>
        <Stats
          items={[
            {
              label: "Connected sources",
              value: sources.length,
              detail: "Your workspace connections",
            },
            {
              label: "Linked accounts",
              value: accountRows.length,
              detail: "Ad accounts and stores",
            },
            {
              label: "Current connections",
              value: overview.summaryCards.sources.healthy,
              detail: "With a recent successful import",
            },
            {
              label: "Need attention",
              value:
                mode === "Needs attention" &&
                !recovered.includes("preview-google")
                  ? 1
                  : 0,
              detail: "Authorization or freshness issues",
            },
          ]}
        />
      </div>
      <div className={styles.toolbar}>
        <Switcher
          label="Source view"
          options={["Connected", "Client accounts", "Integration library"]}
          value={tab}
          onChange={setTab}
        />
        <SearchBox
          label="Search sources"
          placeholder="Search platforms or connections…"
          value={search}
          onChange={setSearch}
        />
      </div>
      {tab === "Connected" &&
        (filtered.length ? (
          <div className={sourceStyles.layout}>
            <section
              className={sourceStyles.connections}
              aria-label="Connected sources"
            >
              <div className={sourceStyles.listHeading}>
                <div>
                  <h2>
                    Your connections <span>{filtered.length}</span>
                  </h2>
                  <p>Monitor freshness and manage your connected accounts.</p>
                </div>
              </div>
              {filtered.map((item) => {
                const inProgress = busy === item.id || item.state === "syncing";
                const state = recovered.includes(item.id)
                  ? "fresh"
                  : item.state;
                return (
                  <article
                    className={sourceStyles.connection}
                    key={item.id}
                    data-working={inProgress}
                  >
                    <div className={sourceStyles.identity}>
                      <IntegrationMark
                        src={logoPathForCatalogId(item.provider)}
                        size="lg"
                      />
                      <div>
                        <button
                          type="button"
                          className={styles.sourceName}
                          onClick={() => openSource(item.id)}
                        >
                          {item.name}
                        </button>
                        <p>
                          {PROVIDER_NAMES[item.provider]} <span>·</span>{" "}
                          {item.accountCount}{" "}
                          {item.accountCount === 1 ? "account" : "accounts"}
                        </p>
                      </div>
                    </div>
                    <div className={sourceStyles.connectionStatus}>
                      <Badge
                        busy={inProgress}
                        tone={
                          state === "error"
                            ? "warn"
                            : state === "pending"
                              ? "neutral"
                              : "good"
                        }
                      >
                        {inProgress
                          ? "Syncing"
                          : sourceStatePresentation(state).label}
                      </Badge>
                      <small>
                        {inProgress
                          ? "Importing metrics"
                          : state === "pending"
                            ? "Awaiting first import"
                            : "Imported Sep 27 · 8:42 PM"}
                      </small>
                    </div>
                    <Action
                      aria-label={`Manage ${item.name}`}
                      onClick={() => openSource(item.id)}
                    >
                      Manage <ArrowRight size={12} />
                    </Action>
                    {state === "error" && !inProgress && (
                      <p className={sourceStyles.connectionWarning}>
                        Reconnect to resume imports. Your existing data is
                        preserved.
                      </p>
                    )}
                  </article>
                );
              })}
              <div className={sourceStyles.listFooter}>
                <ShieldCheck size={14} />
                <span>
                  Manage permissions and account selection from each connection.
                </span>
              </div>
            </section>
            <aside
              className={sourceStyles.discover}
              aria-label="Discover integrations"
            >
              <p className={styles.eyebrow}>EXPAND YOUR WORKSPACE</p>
              <h2>Add a platform</h2>
              <p>Bring your advertising and commerce data together.</p>
              <div className={sourceStyles.platforms}>
                {catalog.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => setNewConnection(item.id)}
                    aria-label={`Connect ${PROVIDER_NAMES[item.id]}`}
                  >
                    <IntegrationMark
                      src={logoPathForCatalogId(item.id)}
                      size="sm"
                    />
                    <span>{PROVIDER_NAMES[item.id]}</span>
                    <Plus size={14} />
                  </button>
                ))}
              </div>
              <Action
                onClick={() => {
                  setTab("Integration library");
                  setSearch("");
                }}
              >
                Explore integration library <ArrowRight size={13} />
              </Action>
              <div className={sourceStyles.warehouseLink}>
                <p>Already connected?</p>
                <TextLink href="#warehouse">Explore your warehouse</TextLink>
              </div>
            </aside>
          </div>
        ) : (
          <Panel title="Your connections">
            <Empty
              title={
                search
                  ? "No matching connections"
                  : "Bring your first source into focus"
              }
            >
              {search
                ? "Try another platform or connection name."
                : "Open the integration library to choose an ad platform or store."}
            </Empty>
            <Action
              primary
              onClick={() => {
                setTab("Integration library");
                setSearch("");
              }}
            >
              Explore integrations <ArrowRight size={14} />
            </Action>
          </Panel>
        ))}
      {tab === "Client accounts" && (
        <Panel
          title="Accounts in your workspace"
          eyebrow="ACCOUNT ASSIGNMENTS"
          action={<TextLink href="#clients">Manage clients</TextLink>}
        >
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Source</th>
                  <th>Assigned client</th>
                  <th>Health</th>
                </tr>
              </thead>
              <tbody>
                {accountRows
                  .filter((row) =>
                    `${row.name} ${row.source.name}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((row) => (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.name}</strong>
                        <small>{row.id}</small>
                      </td>
                      <td>{PROVIDER_NAMES[row.source.provider]}</td>
                      <td>{row.client}</td>
                      <td>
                        <Badge
                          tone={row.source.state === "error" ? "warn" : "good"}
                        >
                          {row.source.state === "error"
                            ? "Reconnect required"
                            : "Authorized"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {!accountRows.length && <Empty title="No accounts connected yet" />}
        </Panel>
      )}
      {tab === "Integration library" && (
        <>
          <div className={styles.callout}>
            <div>
              <p className={styles.eyebrow}>BUILT FOR YOUR MARKETING STACK</p>
              <h2>Connect once. Bring the whole picture together.</h2>
              <p>
                Choose a supported source, authorize your accounts, and import
                recent metrics into your warehouse.
              </p>
            </div>
            <ShieldCheck size={32} className={styles.muted} />
          </div>
          <div className={`${styles.grid2} ${sourceStyles.library}`}>
            {catalog
              .filter((item) =>
                `${PROVIDER_NAMES[item.id]} ${item.category}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((item) => (
                <article key={item.id} className={styles.card}>
                  <div className={styles.cardTop}>
                    <IntegrationMark
                      src={logoPathForCatalogId(item.id)}
                      size="lg"
                    />
                    <Badge tone="neutral">{item.category}</Badge>
                  </div>
                  <h2>{PROVIDER_NAMES[item.id]}</h2>
                  <p style={{ marginTop: 10 }}>{item.description}</p>
                  <div className={styles.cardFooter}>
                    <span>
                      {sources.some((s) => s.provider === item.id)
                        ? "Already in your workspace"
                        : "Available in the pilot"}
                    </span>
                    <Action onClick={() => setNewConnection(item.id)}>
                      <Plus size={13} />
                      Connect
                    </Action>
                  </div>
                </article>
              ))}
          </div>
        </>
      )}
      {source && (
        <Modal title={source.name} wide onClose={() => setSelected(null)}>
          <Switcher
            label="Connection detail view"
            options={["Overview", "Accounts", "Import history"]}
            value={detailTab}
            onChange={setDetailTab}
          />
          <div style={{ marginTop: 22 }}>
            {detailTab === "Overview" ? (
              <>
                <div className={styles.row}>
                  <IntegrationMark
                    src={logoPathForCatalogId(source.provider)}
                    size="lg"
                  />
                  <div>
                    <h3>{PROVIDER_NAMES[source.provider]}</h3>
                    <p className={styles.muted}>
                      {source.accountCount} linked accounts · Studio North
                    </p>
                  </div>
                </div>
                <div className={styles.divider} />
                <p className={styles.muted}>
                  {source.state === "error" && !recovered.includes(source.id)
                    ? "Authorization expired. Reconnect this sample source to preview its recovered state."
                    : "This sample connection brings daily performance into the warehouse. Review the account selection before your next import."}
                </p>
                <div className={styles.formActions}>
                  <Action onClick={() => setDetailTab("Accounts")}>
                    Review accounts
                  </Action>
                  <Action
                    primary
                    loadingLabel="Working…"
                    busy={busy === source.id ? "Working…" : undefined}
                    onClick={() => sync(source.id)}
                  >
                    <RefreshCw size={14} />
                    {source.state === "error" && !recovered.includes(source.id)
                      ? "Simulate reconnect"
                      : "Simulate sync"}
                  </Action>
                </div>
                {recovered.includes(source.id) && (
                  <Notice>
                    Sample connection is current. No live authorization was
                    changed.
                  </Notice>
                )}
              </>
            ) : detailTab === "Accounts" ? (
              <ul className={styles.eventList}>
                {accountRows
                  .filter((row) => row.source.id === source.id)
                  .map((row) => (
                    <li key={row.id}>
                      <span className={styles.iconTile}>
                        <Check size={15} />
                      </span>
                      <div>
                        <strong>{row.name}</strong>
                        <p>Assigned to {row.client}</p>
                      </div>
                    </li>
                  ))}
              </ul>
            ) : (
              <ul className={styles.eventList}>
                {["Sep 27, 8:42 PM", "Sep 26, 8:45 PM", "Sep 25, 8:40 PM"].map(
                  (date) => (
                    <li key={date}>
                      <span className={styles.iconTile}>
                        <Check size={15} />
                      </span>
                      <div>
                        <strong>Daily metric import completed</strong>
                        <p>
                          {source.accountCount} accounts · Sample import record
                        </p>
                      </div>
                      <time>{date}</time>
                    </li>
                  ),
                )}
              </ul>
            )}
          </div>
        </Modal>
      )}
      {newConnection && (
        <Modal
          title={`Connect ${PROVIDER_NAMES[newConnection]}`}
          onClose={() => setNewConnection(null)}
        >
          <ol className={styles.numberList}>
            <li>
              <div>
                <h3>Authorize your source</h3>
                <p>
                  In the live product, you sign in through the platform’s
                  authorization flow.
                </p>
              </div>
            </li>
            <li>
              <div>
                <h3>Choose accounts</h3>
                <p>Select the accounts or store you want in this workspace.</p>
              </div>
            </li>
            <li>
              <div>
                <h3>Import recent data</h3>
                <p>
                  Review warehouse coverage before using the data in reports.
                </p>
              </div>
            </li>
          </ol>
          <p className={styles.muted} style={{ marginTop: 20 }}>
            For this local preview, add a sample connection to explore the
            connected state.
          </p>
          <div className={styles.formActions}>
            <Action
              primary
              onClick={() => {
                setAdded((prev) => [...prev, newConnection]);
                setNewConnection(null);
                setTab("Connected");
                setSearch("");
              }}
            >
              Show sample connection
              <ArrowRight size={14} />
            </Action>
          </div>
        </Modal>
      )}
    </div>
  );
}

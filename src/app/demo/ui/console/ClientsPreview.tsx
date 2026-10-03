"use client";
import { useState } from "react";
import { ArrowRight, Pencil, Plus, Users } from "lucide-react";
import { sampleClients } from "./sections-model";
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
import type { SectionProps } from "./section-types";
import styles from "./sections.module.css";

type Client = (typeof sampleClients)[number];
export function ClientsPreview({ mode }: SectionProps) {
  const [clients, setClients] = useState<Client[]>(
    mode === "New workspace" ? [] : sampleClients,
  );
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All clients");
  const [selected, setSelected] = useState<Client | null>(null);
  const [editing, setEditing] = useState<Client | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [sector, setSector] = useState("");
  const [notice, setNotice] = useState("");
  function status(client: Client) {
    return !client.accounts
      ? "No accounts assigned"
      : mode === "Needs attention" && client.id === "forma"
        ? "Needs attention"
        : "Ready to report";
  }
  const filtered = clients.filter(
    (client) =>
      `${client.name} ${client.sector}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (filter === "All clients" || status(client) === filter),
  );
  function openForm(client?: Client) {
    setEditing(client ?? null);
    setName(client?.name ?? "");
    setEmail(client?.email ?? "");
    setSector(client?.sector ?? "");
    setFormOpen(true);
  }
  function save() {
    const next: Client = {
      id: editing?.id ?? `sample-${Date.now()}`,
      name: name.trim(),
      initials: name
        .trim()
        .split(/\s+/)
        .map((word) => word[0])
        .slice(0, 2)
        .join("")
        .toUpperCase(),
      color: editing?.color ?? "#c9dbac",
      sector: sector.trim() || "Client workspace",
      email,
      accounts: editing?.accounts ?? 0,
      sources: editing?.sources ?? 0,
      rows: editing?.rows ?? 0,
      state: editing?.state ?? "No accounts assigned",
    };
    setClients((prev) =>
      editing
        ? prev.map((item) => (item.id === editing.id ? next : item))
        : [...prev, next],
    );
    setFormOpen(false);
    setNotice(
      `${next.name} ${editing ? "updated" : "added"} in this page preview. Live clients are unchanged.`,
    );
  }
  return (
    <div className={styles.page}>
      <SectionHeader
        eyebrow="YOUR AGENCY PORTFOLIO"
        title="Clients"
        description="Every client’s data, coverage, and reporting readiness. Clearly connected."
      >
        <Action primary onClick={() => openForm()}>
          <Plus size={15} />
          Add client
        </Action>
      </SectionHeader>
      {notice && <Notice>{notice}</Notice>}
      <Stats
        items={[
          {
            label: "Client brands",
            value: clients.length,
            detail: "Managed in this sample workspace",
          },
          {
            label: "Assigned accounts",
            value: clients.reduce((sum, c) => sum + c.accounts, 0),
            detail: "Mapped to client reporting",
          },
          {
            label: "Ready to report",
            value: clients.filter((c) => status(c) === "Ready to report")
              .length,
            detail: "Current data and source coverage",
          },
          {
            label: "Need a review",
            value: clients.filter((c) => status(c) !== "Ready to report")
              .length,
            detail: "Account setup or coverage gaps",
          },
        ]}
      />
      <div className={styles.toolbar}>
        <Switcher
          label="Client status"
          options={["All clients", "Ready to report", "Needs attention"]}
          value={filter}
          onChange={setFilter}
        />
        <SearchBox
          label="Search clients"
          placeholder="Search your client portfolio…"
          value={search}
          onChange={setSearch}
        />
      </div>
      {filtered.length ? (
        <div className={styles.grid3}>
          {filtered.map((client) => (
            <article className={styles.card} key={client.id}>
              <div className={styles.cardTop}>
                <span
                  className={styles.clientMark}
                  style={{ color: client.color }}
                >
                  {client.initials}
                </span>
                <Action
                  aria-label={`Edit ${client.name}`}
                  onClick={() => openForm(client)}
                >
                  <Pencil size={13} />
                </Action>
              </div>
              <h2 style={{ fontSize: 20, marginBottom: 6 }}>{client.name}</h2>
              <p>{client.sector}</p>
              <div style={{ marginTop: 17 }}>
                <Badge
                  tone={status(client) === "Ready to report" ? "good" : "warn"}
                >
                  {status(client)}
                </Badge>
              </div>
              <div className={styles.miniStats}>
                <div>
                  <strong>{client.accounts}</strong>
                  <span>Accounts</span>
                </div>
                <div>
                  <strong>{client.sources}</strong>
                  <span>Sources</span>
                </div>
                <div>
                  <strong>
                    {client.rows ? (client.rows / 1000).toFixed(1) + "k" : "—"}
                  </strong>
                  <span>Recent rows</span>
                </div>
              </div>
              <div className={styles.cardFooter}>
                <span>
                  {client.accounts
                    ? "Workspace data assigned"
                    : "Add accounts to begin"}
                </span>
                <Action onClick={() => setSelected(client)}>
                  View client <ArrowRight size={13} />
                </Action>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Panel title="Your client portfolio">
          <Empty
            title={
              search || filter !== "All clients"
                ? "No matching clients"
                : "A home for every client"
            }
          >
            {search || filter !== "All clients"
              ? "Try another search or status filter."
              : "Add a client brand, then assign its connected accounts to keep reporting organized."}
          </Empty>
          <Action onClick={() => openForm()}>
            <Plus size={14} />
            Add a sample client
          </Action>
        </Panel>
      )}
      <div className={styles.callout} style={{ marginTop: 24 }}>
        <div className={styles.row}>
          <span className={styles.iconTile}>
            <Users size={22} />
          </span>
          <div>
            <p className={styles.eyebrow}>A CLEARER CLIENT CONTEXT</p>
            <h2>The right accounts. The right report.</h2>
            <p>
              Keep source accounts assigned to their client so metrics,
              operations, and reporting stay in context.
            </p>
          </div>
        </div>
        <TextLink href="#sources">Review client accounts</TextLink>
      </div>
      {formOpen && (
        <Modal
          title={editing ? "Edit client" : "Add a client"}
          onClose={() => setFormOpen(false)}
        >
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <label>
              Client name
              <input
                required
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. North Supply"
              />
            </label>
            <label>
              Industry or description
              <input
                maxLength={120}
                value={sector}
                onChange={(e) => setSector(e.target.value)}
                placeholder="e.g. Lifestyle & retail"
              />
            </label>
            <label>
              Contact email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="team@example.test"
              />
              <small>
                Sample contact details only. No invitation or email is sent.
              </small>
            </label>
            <div className={styles.formActions}>
              <Action onClick={() => setFormOpen(false)}>Cancel</Action>
              <Action primary type="submit" disabled={!name.trim()}>
                Save sample client
              </Action>
            </div>
          </form>
        </Modal>
      )}
      {selected && (
        <Modal title={selected.name} onClose={() => setSelected(null)}>
          <div className={styles.row}>
            <span
              className={styles.clientMark}
              style={{ color: selected.color }}
            >
              {selected.initials}
            </span>
            <div>
              <p>{selected.sector}</p>
              <p className={styles.muted}>
                {selected.email || "No contact email added"}
              </p>
            </div>
          </div>
          <div className={styles.miniStats}>
            <div>
              <strong>{selected.accounts}</strong>
              <span>Assigned accounts</span>
            </div>
            <div>
              <strong>{selected.sources}</strong>
              <span>Connected sources</span>
            </div>
            <div>
              <strong>{selected.rows.toLocaleString()}</strong>
              <span>Recent rows</span>
            </div>
          </div>
          <Badge
            tone={status(selected) === "Ready to report" ? "good" : "warn"}
          >
            {status(selected)}
          </Badge>
          <p className={styles.muted} style={{ marginTop: 20 }}>
            Review this client’s assigned accounts before sharing performance.
            The details shown here are sample portfolio records.
          </p>
          <div className={styles.formActions}>
            <Action
              onClick={() => {
                setSelected(null);
                openForm(selected);
              }}
            >
              Edit client
            </Action>
            <Action
              primary
              onClick={() => {
                setSelected(null);
                window.location.hash = "reports";
              }}
            >
              Open reports <ArrowRight size={14} />
            </Action>
          </div>
        </Modal>
      )}
    </div>
  );
}

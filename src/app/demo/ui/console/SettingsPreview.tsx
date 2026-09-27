"use client";
import { useState } from "react";
import {
  Bell,
  Check,
  Copy,
  CreditCard,
  KeyRound,
  Laptop,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  Users,
  Workflow,
} from "lucide-react";
import {
  Action,
  Badge,
  Modal,
  Notice,
  Panel,
  SectionHeader,
  TextLink,
} from "./PreviewPrimitives";
import { sampleClients } from "./sections-model";
import type { SectionProps } from "./section-types";
import styles from "./sections.module.css";

const tabs = [
  { name: "Workspace", icon: Workflow },
  { name: "Clients", icon: Users },
  { name: "Team", icon: Users },
  { name: "Alerts & quality", icon: Bell },
  { name: "Billing", icon: CreditCard },
  { name: "API keys", icon: KeyRound },
  { name: "Sessions", icon: ShieldCheck },
];
export function SettingsPreview({ mode }: SectionProps) {
  const [tab, setTab] = useState("Workspace");
  const [name, setName] = useState("Studio North");
  const [zone, setZone] = useState("Asia/Ho_Chi_Minh");
  const [notice, setNotice] = useState("");
  const [alerts, setAlerts] = useState([true, true, false]);
  const [members, setMembers] = useState([
    { name: "Alex Morgan", email: "alex@example.test", role: "Owner" },
    { name: "Jamie Chen", email: "jamie@example.test", role: "Admin" },
    { name: "Sam Rivera", email: "sam@example.test", role: "Member" },
  ]);
  const [invite, setInvite] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("Member");
  const [keys, setKeys] = useState(
    mode === "New workspace"
      ? []
      : [
          {
            id: 1,
            name: "Reporting integration",
            masked: "demo_••••••••_0001",
          },
        ],
  );
  const [newKey, setNewKey] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [otherSession, setOtherSession] = useState(true);
  const save = () =>
    setNotice(
      "Sample settings saved for this page preview. Live workspace settings are unchanged.",
    );
  return (
    <div className={styles.page}>
      <SectionHeader
        eyebrow="MAKE IT YOUR WORKSPACE"
        title="Settings"
        description="The people, preferences, and access behind your workspace."
      />
      <div className={styles.settingsLayout}>
        <nav className={styles.settingsNav} aria-label="Settings categories">
          {tabs.map((item) => (
            <button
              key={item.name}
              type="button"
              aria-pressed={tab === item.name}
              onClick={() => {
                setTab(item.name);
                setNotice("");
              }}
            >
              <item.icon size={16} />
              {item.name}
            </button>
          ))}
        </nav>
        <div className={styles.stack}>
          {notice && <Notice>{notice}</Notice>}
          {tab === "Workspace" && (
            <>
              <Panel title="Workspace details" eyebrow="GENERAL">
                <form
                  className={styles.form}
                  onSubmit={(e) => {
                    e.preventDefault();
                    save();
                  }}
                >
                  <div className={styles.row}>
                    <span
                      className={styles.clientMark}
                      style={{ color: "#ededed" }}
                    >
                      SN
                    </span>
                    <div>
                      <h3>Studio North</h3>
                      <p className={styles.muted}>
                        Your shared home for marketing data.
                      </p>
                    </div>
                  </div>
                  <label>
                    Workspace name
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      maxLength={80}
                    />
                  </label>
                  <label>
                    Workspace ID
                    <input value="local-preview" disabled />
                    <small>
                      A sample workspace identifier for this local design
                      review.
                    </small>
                  </label>
                  <label>
                    Reporting timezone
                    <select
                      value={zone}
                      onChange={(e) => setZone(e.target.value)}
                    >
                      <option value="Asia/Ho_Chi_Minh">
                        Ho Chi Minh City (UTC+07:00)
                      </option>
                      <option value="Asia/Singapore">
                        Singapore (UTC+08:00)
                      </option>
                      <option value="UTC">UTC</option>
                    </select>
                  </label>
                  <div className={styles.formActions}>
                    <Action
                      onClick={() => {
                        setName("Studio North");
                        setZone("Asia/Ho_Chi_Minh");
                        setNotice("");
                      }}
                    >
                      Reset
                    </Action>
                    <Action primary type="submit" disabled={!name.trim()}>
                      <Save size={14} />
                      Save changes
                    </Action>
                  </div>
                </form>
              </Panel>
              <Panel title="Workspace access" eyebrow="MEMBERSHIP">
                <div className={styles.rowSpread}>
                  <div>
                    <h3>Your role</h3>
                    <p className={styles.muted}>
                      Manage settings, accounts, and team membership.
                    </p>
                  </div>
                  <Badge>Owner</Badge>
                </div>
              </Panel>
            </>
          )}
          {tab === "Clients" && (
            <Panel
              title="Client account assignments"
              eyebrow="KEEP REPORTING IN CONTEXT"
              action={<TextLink href="#clients">Open portfolio</TextLink>}
            >
              <ul className={styles.eventList}>
                {sampleClients.map((client) => (
                  <li key={client.id}>
                    <span
                      className={styles.clientMark}
                      style={{ color: client.color }}
                    >
                      {client.initials}
                    </span>
                    <div>
                      <strong>{client.name}</strong>
                      <p>
                        {mode === "New workspace" ? 0 : client.accounts} source
                        accounts assigned
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              <div className={styles.formActions}>
                <Action
                  onClick={() => {
                    window.location.hash = "sources";
                  }}
                >
                  Review source accounts
                </Action>
              </div>
            </Panel>
          )}
          {tab === "Team" && (
            <Panel
              title="People in your workspace"
              eyebrow="TEAM & ROLES"
              action={
                <Action primary onClick={() => setInvite(true)}>
                  <Plus size={14} />
                  Add sample member
                </Action>
              }
            >
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th>Role</th>
                      <th>Access</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((member) => (
                      <tr key={member.email}>
                        <td>
                          <strong>{member.name}</strong>
                          <small>{member.email}</small>
                        </td>
                        <td>{member.role}</td>
                        <td>
                          <Badge
                            tone={member.role === "Owner" ? "good" : "neutral"}
                          >
                            {member.role === "Owner" ? "You" : "Sample member"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className={styles.muted} style={{ marginTop: 18 }}>
                Roles control access to shared workspace data. Adding a member
                here only creates a sample row.
              </p>
            </Panel>
          )}
          {tab === "Alerts & quality" && (
            <Panel
              title="Data quality monitoring"
              eyebrow="KEEP THE IMPORTANT SIGNALS CLOSE"
            >
              <p className={styles.muted}>
                Preview how rules and notification preferences are organized.
              </p>
              {[
                {
                  title: "Import failure alerts",
                  description:
                    "Surface a connection or warehouse import that needs attention.",
                },
                {
                  title: "Stale data reminders",
                  description:
                    "Highlight sources whose latest data is outside the freshness window.",
                },
                {
                  title: "Quality rule notifications",
                  description:
                    "Notify workspace owners when a configured data quality rule is triggered.",
                },
              ].map((item, index) => (
                <div className={styles.toggleRow} key={item.title}>
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.description}</p>
                  </div>
                  <button
                    role="switch"
                    type="button"
                    aria-label={item.title}
                    aria-checked={alerts[index]}
                    className={styles.toggle}
                    onClick={() =>
                      setAlerts((prev) =>
                        prev.map((value, i) => (i === index ? !value : value)),
                      )
                    }
                  />
                </div>
              ))}
              <div className={styles.formActions}>
                <Action primary onClick={save}>
                  <Save size={14} />
                  Save preferences
                </Action>
              </div>
            </Panel>
          )}
          {tab === "Billing" && (
            <>
              <div className={styles.callout}>
                <div>
                  <p className={styles.eyebrow}>CURRENT SAMPLE PLAN</p>
                  <h2>Professional workspace</h2>
                  <p>
                    Manage your workspace subscription and review the data usage
                    that matters.
                  </p>
                </div>
                <Badge>Active</Badge>
              </div>
              <Panel title="Workspace usage" eyebrow="SAMPLE ALLOCATION">
                <div className={styles.miniStats}>
                  <div>
                    <strong>{members.length}</strong>
                    <span>Team members</span>
                  </div>
                  <div>
                    <strong>{mode === "New workspace" ? 0 : 4}</strong>
                    <span>Connected sources</span>
                  </div>
                  <div>
                    <strong>{mode === "New workspace" ? 0 : 12}</strong>
                    <span>Linked accounts</span>
                  </div>
                </div>
                <p className={styles.muted}>
                  This design preview does not create a checkout or change your
                  plan. Current entitlements and billing details remain managed
                  by the connected product.
                </p>
                <div className={styles.formActions}>
                  <Action
                    onClick={() =>
                      setNotice(
                        "Billing management is available in the connected product. No checkout was created in this preview.",
                      )
                    }
                  >
                    Review billing options
                  </Action>
                </div>
              </Panel>
            </>
          )}
          {tab === "API keys" && (
            <Panel
              title="Workspace API keys"
              eyebrow="SCOPED ACCESS"
              action={
                <Action primary onClick={() => setNewKey(true)}>
                  <Plus size={14} />
                  Create sample key
                </Action>
              }
            >
              <p className={styles.muted}>
                Use scoped credentials for authorized reporting integrations.
                Every key in this local preview is a nonfunctional example.
              </p>
              <div className={styles.tableWrap} style={{ marginTop: 20 }}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Key</th>
                      <th>Value</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map((key) => (
                      <tr key={key.id}>
                        <td>
                          <strong>{key.name}</strong>
                          <small>Local preview only</small>
                        </td>
                        <td>
                          <code>{key.masked}</code>
                        </td>
                        <td>
                          <div className={styles.actions}>
                            <Action
                              aria-label={`Copy sample ${key.name}`}
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(
                                    `demo_key_not_valid_${key.id}`,
                                  );
                                  setNotice("Nonfunctional sample key copied.");
                                } catch {
                                  setNotice(
                                    "Clipboard unavailable. Sample value: demo_key_not_valid_" +
                                      key.id,
                                  );
                                }
                              }}
                            >
                              <Copy size={13} />
                            </Action>
                            <Action
                              aria-label={`Remove sample ${key.name}`}
                              onClick={() => {
                                setKeys((prev) =>
                                  prev.filter((item) => item.id !== key.id),
                                );
                                setNotice(
                                  "Sample key removed from this preview. No live key was revoked.",
                                );
                              }}
                            >
                              <Trash2 size={13} />
                            </Action>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!keys.length && (
                <p
                  className={styles.muted}
                  style={{ padding: 22, textAlign: "center" }}
                >
                  No sample keys yet.
                </p>
              )}
              <div className={styles.formActions}>
                <TextLink href="#exports">Explore API integrations</TextLink>
              </div>
            </Panel>
          )}
          {tab === "Sessions" && (
            <Panel title="Your active sessions" eyebrow="ACCOUNT SECURITY">
              <ul className={styles.eventList}>
                <li>
                  <span className={styles.iconTile}>
                    <Laptop size={18} />
                  </span>
                  <div>
                    <strong>Mac · Current browser</strong>
                    <p>Localhost preview · This session</p>
                  </div>
                  <Badge>Current</Badge>
                </li>
                {otherSession && (
                  <li>
                    <span className={styles.iconTile}>
                      <Laptop size={18} />
                    </span>
                    <div>
                      <strong>Chrome · Sample device</strong>
                      <p>Last active 2 hours ago · Sample record</p>
                    </div>
                    <Action
                      onClick={() => {
                        setOtherSession(false);
                        setNotice(
                          "Sample session removed. No real session was signed out.",
                        );
                      }}
                    >
                      Remove sample
                    </Action>
                  </li>
                )}
              </ul>
              <p className={styles.muted} style={{ marginTop: 20 }}>
                Review where your account is signed in and remove sessions you
                no longer need.
              </p>
            </Panel>
          )}
        </div>
      </div>
      {invite && (
        <Modal
          title="Add a sample team member"
          onClose={() => setInvite(false)}
        >
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              if (
                members.some(
                  (m) => m.email.toLowerCase() === email.trim().toLowerCase(),
                )
              ) {
                setNotice("That sample member already exists.");
                setInvite(false);
                return;
              }
              setMembers((prev) => [
                ...prev,
                { name: email.split("@")[0], email: email.trim(), role },
              ]);
              setInvite(false);
              setEmail("");
              setNotice("Sample member added. No invitation email was sent.");
            }}
          >
            <label>
              Email address
              <input
                type="email"
                value={email}
                required
                onChange={(e) => setEmail(e.target.value)}
                placeholder="colleague@example.test"
              />
            </label>
            <label>
              Workspace role
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option>Member</option>
                <option>Admin</option>
                <option>Viewer</option>
              </select>
            </label>
            <div className={styles.formActions}>
              <Action type="submit" primary>
                <Check size={14} />
                Add sample member
              </Action>
            </div>
          </form>
        </Modal>
      )}
      {newKey && (
        <Modal title="Create a sample API key" onClose={() => setNewKey(false)}>
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              const id = Date.now();
              setKeys((prev) => [
                ...prev,
                {
                  id,
                  name: keyName.trim(),
                  masked: "demo_••••••••_" + String(id).slice(-4),
                },
              ]);
              setNewKey(false);
              setKeyName("");
              setNotice(
                "A nonfunctional sample key was added. No credentials were generated.",
              );
            }}
          >
            <label>
              Key name
              <input
                value={keyName}
                required
                maxLength={80}
                onChange={(e) => setKeyName(e.target.value)}
                placeholder="e.g. Client reporting"
              />
            </label>
            <p className={styles.muted}>
              Sample scope: workspace metrics, read access. This example cannot
              authorize an API request.
            </p>
            <div className={styles.formActions}>
              <Action type="submit" primary disabled={!keyName.trim()}>
                Create sample key
              </Action>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

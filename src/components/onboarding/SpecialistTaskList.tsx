"use client";
import { ChevronDown, Check, Pause } from "lucide-react";
import type { AgentSnapshot } from "@/hooks/use-agent-run";
import { ONBOARDING_PROVIDERS } from "@/lib/agent/catalog";
import styles from "./Onboarding.module.css";
import { BusinessIcon, SourceLogo } from "./OnboardingIcons";
import { AgentTaskSetup, type TaskAction, type ImportChoice } from "./AgentTaskSetup";
import { SpecialistStack } from "./OnboardingMotion";

const stateLabels: Record<string, string> = {
  waiting_authorization: "Needs your permission",
  discovering_accounts: "Discovering accounts…",
  waiting_selection: "Choose your accounts",
  queued: "Import queued",
  importing: "Importing your data…",
  verifying: "Checking warehouse results…",
  ready: "Ready for review",
  needs_attention: "Needs attention",
  deferred: "Saved for later",
};

interface SpecialistTaskListProps {
  providerCount: number;
  workspaceId: string;
  tasks: AgentSnapshot["tasks"];
  changedIds: string[];
  paused: boolean;
  disabled: boolean;
  onAction: (task: AgentSnapshot["tasks"][number], action: TaskAction, connectionId?: string | string[]) => void;
  canAuthorize: { tiktok_business: boolean; meta_ads: boolean; google_ads: boolean; shopee: boolean };
  onConfirm: (task: AgentSnapshot["tasks"][number], input: ImportChoice) => void;
  onReviewed: (id: string) => void;
}

export function SpecialistTaskList({
  providerCount,
  workspaceId,
  tasks,
  changedIds,
  paused,
  disabled,
  onAction,
  canAuthorize,
  onConfirm,
  onReviewed,
}: SpecialistTaskListProps) {
  return (
    <aside className={styles.board} aria-label="Your source agents">
      <div className={styles.boardHeading}>
        <div>
          <p className={styles.eyebrow}>SOURCE AGENTS</p>
          <h2>Your setup team</h2>
        </div>
        <span className={styles.count} key={tasks.length}>
          {tasks.length.toString().padStart(2, "0")}
          <span> / {providerCount.toString().padStart(2, "0")}</span>
        </span>
      </div>
      <p className={styles.boardDescription}>A focused agent for every source. One place to follow their progress.</p>
      <div className={styles.teamCoordinator}>
        <span className={styles.teamCoordinatorIcon}><BusinessIcon name="coordinator" size={19} /></span>
        <span>Monstera coordinates</span>
        <span>{paused ? "Paused" : "You’re in control"}</span>
      </div>

      {!tasks.length && (
        <div className={styles.emptyBoard}>
          <div className={styles.emptyTeamVisual} aria-hidden="true">
            <span><SourceLogo provider="tiktok_business" size={23} /></span>
            <span><SourceLogo provider="meta_ads" size={23} /></span>
            <span><SourceLogo provider="shopee" size={23} /></span>
          </div>
          <h3>A team shaped by your tools.</h3>
          <p>Choose your first source. Its agent will appear here with a clear next step.</p>
          <div className={styles.emptyBoardFoot}>
            <span>01</span>Select a source to begin<BusinessIcon name="team" size={16} />
          </div>
        </div>
      )}

      <SpecialistStack revision={tasks.map(task => `${task.id}:${task.state}`).join("|")}>
        {tasks.map(task => {
          const provider = ONBOARDING_PROVIDERS.find(p => p.id === task.provider);
          const active = !paused && ["queued", "importing", "verifying", "discovering_accounts"].includes(task.state);
          const step = task.state === "waiting_authorization" ? 0
            : ["discovering_accounts", "waiting_selection"].includes(task.state) ? 1
            : ["queued", "importing", "verifying"].includes(task.state) ? 2
            : task.state === "ready" ? 3
            : task.confirmedScope ? 2 : task.requestedScope?.connectionId ? 1 : 0;

          return (
            <details key={task.id} data-specialist-id={task.id} data-state={task.state} className={`${styles.task} ${changedIds.includes(task.id) ? styles.updated : ""}`}>
              <summary>
                <span className={styles.providerMark} aria-hidden="true"><SourceLogo provider={task.provider} size={20} /></span>
                <span className={styles.taskTitle}>
                  <strong>{provider?.name ?? task.provider} agent</strong>
                  <span>{paused ? "Setup paused" : stateLabels[task.state]}</span>
                </span>
                <span className={active ? styles.pulse : styles.statusDot}>
                  {task.state === "ready" ? <Check size={13} /> : paused ? <Pause size={12} /> : null}
                </span>
                <ChevronDown size={14} className={styles.chevron} aria-hidden="true" />
              </summary>

              <div className={styles.taskBody}>
                <p>{provider?.description}</p>
                <ol className={styles.stages} aria-label="Connection stages">
                  {["Authorize account", "Choose accounts", "Import data", "Review results"].map((label, index) => (
                    <li
                      key={label}
                      data-step-state={step > index ? "complete" : step === index ? "current" : "upcoming"}
                      aria-current={!paused && task.state !== "deferred" && step === index ? "step" : undefined}
                    >
                      <span>{step > index ? <Check size={12} /> : `0${index + 1}`}</span>
                      <div>
                        {label}
                        <small>{["You approve access to your account", "Choose what this workspace can use", "Wait for the source import to finish", "Check the data before finishing"][index]}</small>
                      </div>
                    </li>
                  ))}
                </ol>

                {/* State: waiting_authorization -> Real Connect Button */}
                <AgentTaskSetup key={`${task.id}:${task.scopeRevision}`} task={task} workspaceId={workspaceId} canAuthorize={canAuthorize[task.provider as keyof typeof canAuthorize] ?? false} disabled={disabled} onAction={onAction} onConfirm={onConfirm} onReviewed={onReviewed} />
            {task.reasonCode && (
                  <p role="status" className={styles.taskAttention}>
                    {task.reasonCode === "no_accounts" ? "No accessible advertiser accounts found for this connection." :
                     task.reasonCode === "no_data_found" ? "Connected, but no warehouse data was returned for these dates." :
                     task.reasonCode === "partial_import" ? "Some accounts are still missing. Review coverage, retry failed accounts, or save this source for later." :
                     task.reasonCode === "import_failed" ? "Import did not finish. Check source health or save it for later." :
                     "This source needs your attention before setup can continue."}
                  </p>
                )}

                <div style={{ marginTop: "10px", display: "flex", gap: "8px" }}>
                  {["waiting_authorization", "waiting_selection", "needs_attention"].includes(task.state) && (
                    <button className={styles.textButton} disabled={disabled} onClick={() => onAction(task, "defer")}>
                      Save this source for later
                    </button>
                  )}
                  {task.state === "deferred" && (
                    <button className={styles.textButton} disabled={disabled} onClick={() => onAction(task, "reconnect")}>
                      Add back to setup →
                    </button>
                  )}
                </div>
              </div>
            </details>
          );
        })}
      </SpecialistStack>

      <div className={styles.permissionNote}>
        <BusinessIcon name="permission" size={18} />
        <span>You authorize each account. Agents never need your password.</span>
      </div>
    </aside>
  );
}

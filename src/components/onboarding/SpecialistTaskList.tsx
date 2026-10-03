"use client";
import { ChevronDown, Pause, CircleAlert } from "lucide-react";
import type { AgentSnapshot } from "@/hooks/use-agent-run";
import { ONBOARDING_PROVIDERS } from "@/lib/agent/catalog";
import styles from "./Onboarding.module.css";
import { BusinessIcon, SourceLogo } from "./OnboardingIcons";
import { AgentTaskSetup, type TaskAction, type ImportChoice, type DataPreview } from "./AgentTaskSetup";
import { taskPresentation, type WarehouseEvidence } from "./task-presentation";
import { CompletionCheck, SpecialistStack } from "./OnboardingMotion";

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
  onReviewed: (id: string, evidence: WarehouseEvidence, preview?: DataPreview) => void;
  warehouseEvidence: Record<string, WarehouseEvidence>;
  activeTaskId: string | null;
  onOpen: (id: string | null) => void;
  explorerPath: string;
  scopeLabel?: string;
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
  warehouseEvidence,
  activeTaskId,
  onOpen,
  explorerPath,
  scopeLabel,
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
          const status = taskPresentation(task, warehouseEvidence[task.id]);
          const open = activeTaskId === task.id;
          const milestones = [status.connected, status.connected && Boolean(task.confirmedScope), status.imported];

          return (
            <section key={task.id} id={`source-agent-${task.id}`} data-open={open} data-specialist-id={task.id} data-state={task.state} className={`${styles.task} ${changedIds.includes(task.id) ? styles.updated : ""}`}>
              <button type="button" className={styles.taskToggle} aria-expanded={open} aria-controls={`agent-panel-${task.id}`} onClick={() => onOpen(open ? null : task.id)}>
                <span className={styles.providerMark} aria-hidden="true"><SourceLogo provider={task.provider} size={20} /></span>
                <span className={styles.taskTitle}>
                  <strong>{provider?.name ?? task.provider} agent</strong>
                  <span>{paused ? "Setup paused" : status.label}</span>
                </span>
                <span className={active ? styles.pulse : styles.taskStatus}>
                  {status.imported ? <CompletionCheck /> : paused ? <Pause size={14} /> : task.state === "needs_attention" ? <CircleAlert size={15} /> : status.connected ? <CompletionCheck /> : <span className={styles.notConnected} />}
                </span>
                <ChevronDown size={14} className={styles.chevron} aria-hidden="true" />
              </button>

              <div id={`agent-panel-${task.id}`} className={styles.taskPanel} inert={!open} aria-hidden={!open}><div className={styles.taskPanelInner}><div className={styles.taskBody}>
                <p>{provider?.description}</p>
                <ol className={styles.stages} aria-label="Connection stages">
                  {["Connect source", "Choose accounts", "Warehouse import"].map((label, index) => (
                    <li
                      key={label}
                      data-step-state={milestones[index] ? "complete" : (index === 0 || milestones[index - 1]) ? "current" : "upcoming"}
                      aria-current={!paused && task.state !== "deferred" && !milestones[index] && (index === 0 || milestones[index - 1]) ? "step" : undefined}
                    >
                      <span>{milestones[index] ? <CompletionCheck /> : `0${index + 1}`}</span>
                      <div>
                        {label}
                        <small>{["You approve account access", "You choose the accounts and dates", status.imported ? "Data confirmed in your warehouse" : "Your agent checks that data arrives"][index]}</small>
                      </div>
                    </li>
                  ))}
                </ol>

                {/* State: waiting_authorization -> Real Connect Button */}
                <AgentTaskSetup paused={paused} scopeLabel={scopeLabel} key={`${task.id}:${task.scopeRevision}`} task={task} workspaceId={workspaceId} canAuthorize={canAuthorize[task.provider as keyof typeof canAuthorize] ?? false} disabled={disabled} onAction={onAction} onConfirm={onConfirm} onReviewed={onReviewed} explorerPath={explorerPath} />

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
              </div></div></div>
            </section>
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

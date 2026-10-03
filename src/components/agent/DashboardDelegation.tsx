"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { useSession } from "next-auth/react";
import {
  ArrowRight,
  FileChartColumn,
  ChartNoAxesCombined,
  Wallet,
  ListChecks,
} from "lucide-react";
import {
  agentRequest,
  AgentRequestError,
  useAgentRun,
} from "@/hooks/use-agent-run";
import {
  ONBOARDING_GOALS,
  type OnboardingGoal,
} from "@/lib/agent/onboarding-goals";
import { ONBOARDING_PROVIDERS } from "@/lib/agent/catalog";
import { IntegrationMark } from "@/components/ui/IntegrationMark";
import { logoPathForCatalogId } from "@/lib/integration-logos";
import { MonsteraTaskCard } from "./MonsteraTaskCard";
import { taskCardState, taskImportProgress } from "./task-card-state";
import styles from "./delegation.module.css";

type Entry = {
  workspaceId: string;
  canDelegate: boolean;
  runId: string | null;
  clients: { id: string; name: string }[];
};
async function entry(url: string): Promise<Entry | null> {
  try {
    return await agentRequest<Entry>(url);
  } catch (error) {
    if (error instanceof AgentRequestError && error.code === "not_found")
      return null;
    throw error;
  }
}
const goalIcons = {
  reporting: FileChartColumn,
  performance: ChartNoAxesCombined,
  spend: Wallet,
};

export function DashboardDelegation({ workspaceId }: { workspaceId: string }) {
  const { data: session } = useSession();
  if (!session?.user?.id) return null;
  // Reset local intent on workspace changes; old scope must never flash in the next tenant.
  return (
    <WorkspaceDelegation
      key={`${session.user.id}:${workspaceId}`}
      workspaceId={workspaceId}
      userId={session.user.id}
    />
  );
}

function WorkspaceDelegation({
  workspaceId,
  userId,
}: {
  workspaceId: string;
  userId: string;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const prefix = pathname?.match(/^\/agencies\/[^/]+/)?.[0] ?? "";
  const {
    data,
    error: entryError,
    isLoading,
    mutate,
  } = useSWR(
    [
      `/api/agent/delegation?workspaceId=${encodeURIComponent(workspaceId)}`,
      userId,
    ],
    ([url]) => entry(url),
    { revalidateOnFocus: true },
  );
  const {
    snapshot: loaded,
    error: runError,
    refresh,
  } = useAgentRun(data?.runId ?? null);
  const snapshot =
    loaded?.run.workspaceId === workspaceId && loaded.run.id === data?.runId
      ? loaded
      : null;
  const [goal, setGoal] = useState<OnboardingGoal>(
    () =>
      ONBOARDING_GOALS.find((item) => item.id === params.get("task"))?.id ??
      "reporting",
  );
  const [context, setContext] = useState("");
  const [clientId, setClientId] = useState(
    params.get("clientId") === "all" ? "" : (params.get("clientId") ?? ""),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<{
    workspaceId: string;
    clientId?: string;
    goalId: OnboardingGoal;
    context: string;
    requestId: string;
  } | null>(null);
  const lock = useRef(false);
  const continueLink = useRef<HTMLAnchorElement>(null);
  const focusCreatedTask = useRef(false);
  const active = snapshot && snapshot.run.status !== "completed";
  const loadingRun = Boolean(data?.runId && !snapshot && !runError);
  const setupHref = `${prefix}/onboarding?workspaceId=${encodeURIComponent(workspaceId)}`;
  useEffect(() => {
    if (snapshot && focusCreatedTask.current) {
      focusCreatedTask.current = false;
      continueLink.current?.focus({ preventScroll: true });
    }
  }, [snapshot]);
  const start = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      if (
        !pending.current ||
        pending.current.goalId !== goal ||
        pending.current.context !== context.trim() ||
        (pending.current.clientId ?? "") !== clientId
      )
        pending.current = {
          workspaceId,
          ...(clientId ? { clientId } : {}),
          goalId: goal,
          context: context.trim(),
          requestId: crypto.randomUUID(),
        };
      const next = await agentRequest<{ runId: string }>(
        "/api/agent/delegation",
        pending.current,
      );
      focusCreatedTask.current = true;
      await mutate(
        {
          workspaceId,
          canDelegate: true,
          runId: next.runId,
          clients: data?.clients ?? [],
        },
        false,
      );
      pending.current = null;
      setContext("");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to save this task. Try again.",
      );
      if (err instanceof AgentRequestError && err.code === "active_run_exists")
        await mutate();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  if (isLoading || data === null) return null;
  if (entryError)
    return (
      <section className={styles.root} aria-label="Task availability">
        <p role="status">Tasks could not be loaded.</p>
        <button
          type="button"
          className={styles.secondary}
          onClick={() => void mutate()}
        >
          Retry
        </button>
      </section>
    );
  if (!data) return null;
  return (
    <section
      className={styles.root}
      aria-labelledby="delegate-heading"
      data-dashboard-delegation="true"
    >
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>WORKSPACE TASKS</p>
          <h2 id="delegate-heading">What would you like Monstera to do?</h2>
          <p>
            Choose an outcome. You approve access, accounts, and dates before
            Monstera imports data.
          </p>
        </div>
        <Link
          href={`${prefix}/settings?tab=workspace`}
          className={styles.quiet}
        >
          Access & setup <ArrowRight size={14} />
        </Link>
      </header>
      {!active && !loadingRun && !runError && (
        <>
          <div
            className={styles.recipes}
            role="group"
            aria-label="Task outcome"
          >
            {ONBOARDING_GOALS.map((item) => {
              const Icon = goalIcons[item.id];
              return (
                <button
                  type="button"
                  key={item.id}
                  aria-pressed={goal === item.id}
                  disabled={busy || !data.canDelegate}
                  onClick={() => setGoal(item.id)}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span>{item.title}</span>
                </button>
              );
            })}
          </div>
          <form
            className={styles.composer}
            onSubmit={(event) => {
              event.preventDefault();
              void start();
            }}
          >
            <label className={styles.clientChoice}>
              <span>Reporting for</span>
              <select
                aria-label="Task reporting client"
                value={clientId}
                disabled={busy || !data.canDelegate}
                onChange={(event) => setClientId(event.target.value)}
              >
                <option value="">Workspace only</option>
                {data.clients.map((client) => (
                  <option value={client.id} key={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor="delegation-context" className={styles.srOnly}>
              Additional reporting context (optional)
            </label>
            <input
              id="delegation-context"
              value={context}
              onChange={(event) => setContext(event.target.value)}
              maxLength={500}
              disabled={busy || !data.canDelegate}
              placeholder="Add reporting context (optional)"
            />
            <button
              type="submit"
              className={styles.primary}
              disabled={busy || !data.canDelegate}
            >
              {busy ? "Saving task…" : "Prepare task"}
              <ArrowRight size={16} />
            </button>
          </form>
          <p className={styles.hint}>
            Client scope is fixed when the task is saved. Approve accounts and
            dates in guided setup.
          </p>
        </>
      )}
      {!data.canDelegate && (
        <p className={styles.hint}>
          A workspace member must start tasks and approve account access.
        </p>
      )}
      {(error || runError) && (
        <div className={styles.error} role="alert">
          <span>{error || runError}</span>
          <button
            type="button"
            onClick={() => void (runError ? refresh() : mutate())}
          >
            Retry task status
          </button>
        </div>
      )}
      {loadingRun && (
        <p className={styles.hint} role="status">
          Loading your saved task…
        </p>
      )}
      {snapshot && (
        <div className={styles.saved}>
          <div className={styles.savedHeading}>
            <span>
              {snapshot.run.goal?.context ?? "Source setup"} ·{" "}
              {snapshot.run.clientId
                ? (data.clients.find(
                    (client) => client.id === snapshot.run.clientId,
                  )?.name ?? "Original client scope")
                : "Workspace only"}
            </span>
            <span>
              {snapshot.run.status === "completed"
                ? "Setup reviewed"
                : snapshot.run.status === "paused"
                  ? "Paused"
                  : "Saved · resumes where you left off"}
            </span>
          </div>
          {!snapshot.tasks.length && (
            <MonsteraTaskCard
              title="Confirm the reporting scope"
              label="Choose your source, client, accounts, and dates"
              status="waiting"
              icon={<ListChecks size={19} />}
            >
              <p>
                Your request is saved. No import has started and no account
                access has been approved.
              </p>
              {snapshot.messages
                .filter((message) => message.role === "user")
                .slice(0, 1)
                .map((message) => (
                  <p key={message.id}>{message.content}</p>
                ))}
            </MonsteraTaskCard>
          )}
          {snapshot.tasks.map((task) => {
            const state = taskCardState(task, snapshot.run.status === "paused");
            const scope = task.confirmedScope;
            return (
              <MonsteraTaskCard
                key={task.id}
                title={`${ONBOARDING_PROVIDERS.find((item) => item.id === task.provider)?.name ?? task.provider} · reporting data`}
                label={state.label}
                status={state.status}
                icon={
                  <IntegrationMark
                    src={logoPathForCatalogId(task.provider)}
                    size="sm"
                  />
                }
              >
                <dl className={styles.scope}>
                  <div>
                    <dt>Accounts</dt>
                    <dd>
                      {scope
                        ? `${scope.selectedAccountIds.length} approved`
                        : "Awaiting selection"}
                    </dd>
                  </div>
                  <div>
                    <dt>Reporting window</dt>
                    <dd>
                      {scope
                        ? `${scope.since} – ${scope.until}`
                        : "Awaiting approval"}
                    </dd>
                  </div>
                  <div>
                    <dt>Import</dt>
                    <dd>{taskImportProgress(task)}</dd>
                  </div>
                  <div>
                    <dt>Destination output</dt>
                    <dd>Review separately in Reports</dd>
                  </div>
                </dl>
              </MonsteraTaskCard>
            );
          })}
          <div className={styles.savedActions}>
            <Link
              ref={continueLink}
              className={styles.secondary}
              href={setupHref}
            >
              {snapshot.run.status === "completed"
                ? "Review setup"
                : snapshot.run.status === "paused"
                  ? "Open paused task"
                  : "Continue task"}
              <ArrowRight size={15} />
            </Link>
            <Link className={styles.quiet} href={`${prefix}/reports`}>
              Review reporting output <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}

export function ReportingTaskRecipes({
  workspaceId,
  clientId,
}: {
  workspaceId: string | null;
  clientId?: string | null;
}) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const prefix = pathname?.match(/^\/agencies\/[^/]+/)?.[0] ?? "";
  const { data } = useSWR(
    workspaceId && session?.user?.id
      ? [
          `/api/agent/delegation?workspaceId=${encodeURIComponent(workspaceId)}`,
          session.user.id,
        ]
      : null,
    ([url]) => entry(url),
  );
  if (!data?.canDelegate) return null;
  return (
    <section className={styles.root} aria-label="Reporting task recipes">
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>REPORTING TASKS</p>
          <h2>Start with a reporting outcome</h2>
          <p>Open a saved task or prepare a new one from your dashboard.</p>
        </div>
      </header>
      <div className={styles.recipes}>
        {ONBOARDING_GOALS.map((goal) => {
          const Icon = goalIcons[goal.id];
          return (
            <Link
              className={styles.secondary}
              key={goal.id}
              href={`${prefix}/console?task=${goal.id}${clientId ? `&clientId=${encodeURIComponent(clientId)}` : ""}`}
            >
              <Icon size={17} />
              {goal.title}
              <ArrowRight size={14} />
            </Link>
          );
        })}
      </div>
    </section>
  );
}

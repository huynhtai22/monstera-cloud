"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUp, Check, ArrowRight, ArrowLeft, Pause, ChevronDown, Building2, LockKeyhole } from "lucide-react";
import type { WorkCategory } from "@prisma/client";
import type { OnboardingBoot } from "@/lib/agent/onboarding-page";
import { ONBOARDING_PROVIDERS } from "@/lib/agent/catalog";
import { useSWRConfig } from "swr";
import { WorkspaceSessionSync } from "@/components/WorkspaceSessionSync";
import { useWorkspaceStore } from "@/store/workspace";
import { agentRequest, AgentRequestError, useAgentRun } from "@/hooks/use-agent-run";
import type { AgentSnapshot } from "@/hooks/use-agent-run";
import { taskPresentation, type WarehouseEvidence } from "./task-presentation";
import { ONBOARDING_GOALS, onboardingGoal } from "@/lib/agent/onboarding-goals";
import type { DataPreview } from "./AgentTaskSetup";
import { firstResultKey } from "./first-result";
import { FirstResult } from "./FirstResult";
import { WorkRolePicker } from "./WorkRolePicker";
import { OnboardingIntro } from "./OnboardingIntro";
import { SpecialistTaskList } from "./SpecialistTaskList";
import { Logo } from "@/components/Logo";
import { BusinessIcon, SourceLogo } from "./OnboardingIcons";
import styles from "./Onboarding.module.css";

export function OnboardingExperience({ boot }: { boot: OnboardingBoot }) {
  const router = useRouter();
  const { mutate: updateCache } = useSWRConfig();
  const [category, setCategory] = useState<WorkCategory | null>(boot.profile.category);
  const [goal, setGoal] = useState(onboardingGoal(boot.profile.context));
  const [stage, setStage] = useState<"intro" | "role" | "sources">(boot.profile.answered ? "sources" : boot.workspaces.find(w => w.id === boot.selectedWorkspaceId)?.run ? "role" : "intro");
  const [workspaceRuns, setWorkspaceRuns] = useState(() => Object.fromEntries(boot.workspaces.map(w => [w.id, w.run])));
  const [workspaceId, setWorkspaceId] = useState(boot.selectedWorkspaceId);
  const workspace = boot.workspaces.find(w => w.id === workspaceId);
  const [runId, setRunId] = useState<string | null>(workspace?.run?.id ?? null);
  const [clientId, setClientId] = useState<string | null>(workspace?.run ? workspace.run.clientId ?? "" : null);
  const { snapshot: loaded, error: loadError, refresh, newTaskIds } = useAgentRun(runId);
  const snapshot = loaded?.run.id === runId && loaded.run.workspaceId === workspaceId ? loaded : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewedTaskIds, setReviewedTaskIds] = useState<string[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [warehouseEvidence, setWarehouseEvidence] = useState<Record<string, WarehouseEvidence>>({});
  const [previews, setPreviews] = useState<Record<string, { scopeRevision: number; data: DataPreview }>>({});
  const [acknowledgedResult, setAcknowledgedResult] = useState<string | null>(null);
  const markReviewed = useCallback((id: string, evidence: WarehouseEvidence, preview?: DataPreview) => {
    if (preview) setPreviews(previous => ({ ...previous, [id]: { scopeRevision: evidence.scopeRevision, data: preview } }));
    setWarehouseEvidence(previous => ({ ...previous, [id]: evidence }));
    setReviewedTaskIds(ids => evidence.verified && evidence.rowsCount > 0 ? ids.includes(id) ? ids : [...ids, id] : ids.filter(item => item !== id));
  }, []);
  const [text, setText] = useState("");
  const pendingMessage = useRef<{ messageId: string; text: string; expectedVersion: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const writeLock = useRef(false);
  const stageAnimation = useRef<Animation | null>(null);
  const conversationLog = useRef<HTMLDivElement>(null);
  const followConversation = useRef(true);
  const seenMessages = useRef<{ runId: string | null; ids: Set<string> }>({ runId: null, ids: new Set() });
  const [arrivalIds, setArrivalIds] = useState<string[]>([]);
  useEffect(() => {
    if (!snapshot) return;
    const previous = seenMessages.current;
    setArrivalIds(previous.runId === snapshot.run.id ? snapshot.messages.filter(message => !previous.ids.has(message.id)).map(message => message.id) : []);
    seenMessages.current = { runId: snapshot.run.id, ids: new Set(snapshot.messages.map(message => message.id)) };
  }, [snapshot]);
  const consolePath = boot.agencySlug ? `/agencies/${boot.agencySlug}/console` : "/console";
  const explorerPath = boot.agencySlug ? `/agencies/${boot.agencySlug}/explorer` : "/explorer";
  const sourcesPath = boot.agencySlug ? `/agencies/${boot.agencySlug}/sources` : "/sources";
  const paused = snapshot?.run.status === "paused";
  const completed = snapshot?.run.status === "completed";
  const viewer = workspace?.role === "viewer";
  const writable = !viewer && !paused && !completed && !!snapshot;
  const greeting = category === "GROWTH_MARKETER" ? "Start with the ad platforms behind your campaigns."
    : category === "AGENCY_CONSULTANT" ? "Start with the sources behind your client reporting."
    : category === "ECOMMERCE_SELLER" ? "Start with your shop and advertising sources."
    : category === "BUSINESS_OWNER" ? "Start with the advertising sources behind your business."
    : "Start with the sources behind your everyday work.";
  useEffect(() => { stageRef.current?.focus({ preventScroll: true }); }, [stage]);
  useEffect(() => () => stageAnimation.current?.cancel(), []);
  useEffect(() => {
    const log = conversationLog.current;
    if (log && followConversation.current) log.scrollTo({ top: log.scrollHeight, behavior: "instant" });
  }, [snapshot?.messages.length]);
  function changeStage(next: typeof stage) {
    if (next === stage || stageAnimation.current) return;
    const content = stageRef.current?.firstElementChild as HTMLElement | null;
    if (!content || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setStage(next); return; }
    content.inert = true;
    const animation = content.animate([{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(-5px)" }], { duration: 140, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" });
    stageAnimation.current = animation;
    void animation.finished.then(() => { setStage(next); }).catch(() => { content.inert = false; }).finally(() => { stageAnimation.current = null; });
  }

  async function returnToConsole() {
    // Refresh membership before handoff so a stale console list cannot discard this workspace.
    const workspaces = await agentRequest<{ id: string }[]>("/api/workspaces");
    if (workspaceId && !workspaces.some(item => item.id === workspaceId)) throw new Error("Workspace access changed. Refresh setup before continuing.");
    await updateCache("/api/workspaces", workspaces, { revalidate: false });
    if (workspaceId) useWorkspaceStore.getState().setActiveWorkspaceId(workspaceId);
    router.push(consolePath);
  }

  async function mutate(action: () => Promise<void>) {
    if (writeLock.current) return;
    writeLock.current = true; setBusy(true); setError(null);
    try { await action(); }
    catch (err) {
      if (err instanceof AgentRequestError && err.code === "stale_version") { pendingMessage.current = null; await refresh(); }
      setError(err instanceof Error ? err.message : "Unable to save setup. Try again.");
    } finally { writeLock.current = false; setBusy(false); }
  }
  function saveProfile(selected: WorkCategory | null) {
    void mutate(async () => {
      const response = await fetch("/api/me/work-profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category: selected }) });
      if (!response.ok) throw new Error("Unable to save your role. Please try again.");
      setCategory(selected); changeStage("sources");
    });
  }
  function selectGoal(next: typeof goal) {
    void mutate(async () => {
      const response = await fetch("/api/me/work-profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category, context: next?.context ?? "" }) });
      if (!response.ok) throw new Error("Unable to save your goal. Please try again.");
      setGoal(next);
    });
  }
  const resultKey = firstResultKey(snapshot, previews);
  async function beginSetup() {
    if (!workspaceId) return;
    const next = await agentRequest<AgentSnapshot>("/api/agent/runs", { kind: "onboarding", workspaceId, ...(clientId ? { clientId } : {}) });
    useWorkspaceStore.getState().setActiveWorkspaceId(workspaceId);
    setWorkspaceRuns(runs => ({ ...runs, [next.run.workspaceId]: next.run }));
    setClientId(next.run.clientId ?? "");
    setRunId(next.run.id);
    // Resuming an existing ID must also refresh, since setting the same ID does not.
    if (next.run.id === runId) await refresh();
  }
  async function continueSavedSources() {
    if (!snapshot) return;
    const next = await agentRequest<AgentSnapshot>(`/api/agent/runs/${snapshot.run.id}/actions`, { action: "continue_deferred", expectedVersion: snapshot.run.version });
    setWorkspaceRuns(runs => ({ ...runs, [next.run.workspaceId]: next.run }));
    setClientId(next.run.clientId ?? "");
    setReviewedTaskIds([]); setText(""); pendingMessage.current = null;
    setRunId(next.run.id);
    router.refresh();
  }
  function openAgent(id: string) {
    setActiveTaskId(id);
    requestAnimationFrame(() => {
      const card = document.getElementById(`source-agent-${id}`);
      card?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
      card?.querySelector<HTMLButtonElement>("button[aria-expanded]")?.focus({ preventScroll: true });
    });
  }
  function addProviders(providerIds: string[]) {
    if (!snapshot) return;
    void mutate(async () => {
      const missing = providerIds.filter(id => !snapshot.tasks.some(task => task.provider === id) && workspace?.enabledProviders.some(provider => provider === id));
      if (!missing.length) {
        const existing = snapshot.tasks.find(task => providerIds.includes(task.provider));
        if (existing) openAgent(existing.id);
        return;
      }
      const next = await agentRequest<AgentSnapshot>(`/api/agent/runs/${snapshot.run.id}/providers`, { providerIds: missing, expectedVersion: snapshot.run.version });
      const added = next.tasks.find(task => missing.includes(task.provider));
      if (added) setActiveTaskId(added.id);
      await refresh();
    });
  }
  function sendMessage() {
    if (!text.trim() || !snapshot) return;
    void mutate(async () => {
      if (!pendingMessage.current || pendingMessage.current.text !== text.trim()) pendingMessage.current = { messageId: crypto.randomUUID(), text: text.trim(), expectedVersion: snapshot.run.version };
      const sent = pendingMessage.current;
      setText("");
      try { await agentRequest(`/api/agent/runs/${snapshot.run.id}/messages`, sent); }
      catch (error) { setText(draft => draft || sent.text); throw error; }
      pendingMessage.current = null; await refresh();
    });
  }
  function leave() {
    void mutate(async () => {
      if (snapshot && !paused && !completed && !viewer) await agentRequest(`/api/agent/runs/${snapshot.run.id}/actions`, { expectedVersion: snapshot.run.version, action: "pause" });
      await returnToConsole();
    });
  }
  return <main className={`dark ${styles.root}`} data-onboarding-stage={stage}>
    <WorkspaceSessionSync /><header className={styles.header}><Link href={consolePath} className={styles.brand} aria-label="Monstera Cloud console"><Logo /></Link>
      {stage === "intro" ? <span className={styles.introHeaderNote}>WORKSPACE SETUP</span> : <nav className={styles.steps} aria-label="Setup progress"><span aria-current={stage === "role" ? "step" : undefined}><b>{stage === "sources" ? <Check size={12} /> : "1"}</b>Your work</span><i /><span aria-current={stage === "sources" ? "step" : undefined}><b>2</b>Your sources</span></nav>}
      <button className={styles.textButton} disabled={busy} onClick={stage === "intro" ? () => changeStage("role") : stage === "role" ? () => saveProfile(null) : leave}>{stage === "intro" ? "Skip intro" : stage === "role" ? "Skip" : "Continue later"}</button>
    </header>
    <div className={styles.stage} ref={stageRef} tabIndex={-1}><div key={stage} className={styles.stageContent}>
      {(error || loadError) && <div className={styles.error} role="alert">{error || loadError}<button className={styles.textButton} onClick={() => { setError(null); void refresh(); }}>Refresh setup</button></div>}
      {stage === "intro" ? <OnboardingIntro onStart={() => changeStage("role")} /> : stage === "role" ? <WorkRolePicker category={category} onChange={setCategory} busy={busy} onContinue={() => saveProfile(category)} onSkip={() => saveProfile(null)} /> : <>
        <div className={styles.sourceHeading}><button className={styles.back} onClick={() => changeStage("role")} disabled={busy}><ArrowLeft size={14} />Your work</button><div className={styles.sourceTitleRow}><div><p className={styles.eyebrow}>BUILD YOUR WORKSPACE</p><h1>Good work starts with the right setup.</h1></div><p>Choose your sources.<br />Your agents take it from there.</p></div></div>
        <section className={styles.goalPicker} aria-labelledby="goal-title">
          <div><p className={styles.eyebrow}>YOUR FIRST RESULT</p><h2 id="goal-title">What would you like help with first?</h2><p className={styles.small}>{goal?.id === "reporting" ? "Start with the platforms used by your selected client. Other sources can wait." : goal?.id === "spend" ? "Start with the ad platforms where you currently spend. Totals stay separate by currency." : "Optional. Start with one active ad platform; you can add other sources later."}</p></div>
          <div role="group" aria-label="Your first goal">{ONBOARDING_GOALS.map(item => <button key={item.id} aria-pressed={goal?.id === item.id} disabled={busy} onClick={() => selectGoal(item)}><strong>{item.title}</strong><span>{item.description}</span></button>)}</div>
          {goal && <button className={styles.textButton} disabled={busy} onClick={() => selectGoal(null)}>Decide later</button>}
        </section>
        <div className={styles.workbench}>
        <div className={styles.contextBar}>
          <label className={styles.scopeField}><span>Workspace</span><span className={styles.selectControl}><Building2 size={14} aria-hidden="true" /><select aria-label="Workspace" value={workspaceId ?? ""} disabled={busy || !!boot.agencySlug || boot.workspaces.length < 2} onChange={e => {
            const nextId = e.target.value;
            const nextRun = workspaceRuns[nextId];
            setWorkspaceId(nextId); setRunId(nextRun?.id ?? null); setClientId(nextRun ? nextRun.clientId ?? "" : null); setError(null); setText(""); setReviewedTaskIds([]); setActiveTaskId(null); pendingMessage.current = null; followConversation.current = true;
            useWorkspaceStore.getState().setActiveWorkspaceId(nextId);
            router.replace(`/onboarding?workspaceId=${encodeURIComponent(nextId)}`, { scroll: false });
          }}>{!workspaceId && <option value="">No workspace available</option>}{boot.workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select>{boot.agencySlug || boot.workspaces.length < 2 ? <LockKeyhole size={12} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}</span></label>
          {(!!workspace?.clients.length || !!snapshot?.run.clientId) && <label className={styles.scopeField}><span>Reporting for</span><span className={styles.selectControl}><BusinessIcon name="accounts" size={14} /><select aria-label="Reporting client" aria-describedby="scope-explanation" value={snapshot ? snapshot.run.clientId ?? "" : clientId ?? "unselected"} disabled={busy || !!runId} onChange={e => setClientId(e.target.value)}><option value="unselected" disabled>Choose a client or workspace</option><option value="">Workspace only</option>{workspace?.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}{snapshot?.run.clientId && !workspace?.clients.some(c => c.id === snapshot.run.clientId) && <option value={snapshot.run.clientId}>Original reporting client</option>}</select>{runId ? <LockKeyhole size={12} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}</span></label>}
          <span className={styles.saved} role="status">{busy ? <><span className={styles.savingIndicator} />Saving changes</> : (error || loadError) ? "Needs attention" : snapshot ? <><Check size={13} />Progress saved</> : runId ? "Restoring setup…" : <><BusinessIcon name="permission" size={14} />Private workspace</>}</span>
        </div>
        <p id="scope-explanation" className={styles.scopeExplanation}>{runId ? "Reporting scope is fixed for this setup. Agents use this workspace and its original client choice." : "Choose where your sources belong. Reporting scope is fixed when setup starts."}</p>
        {!workspace ? <div className={styles.notice}><h2>Start with a workspace</h2><p>Create a workspace in your console, then return here to choose your sources.</p><Link href={consolePath}>Go to console →</Link></div> : viewer && !runId ? <div className={styles.notice}><h2>Your workspace is ready to explore</h2><p>A workspace member needs to authorize sources. You can browse the sources already connected.</p><Link href={sourcesPath}>View sources →</Link></div> : !runId ? <div className={styles.prepare}><div className={styles.prepareIdentity}><div className={styles.prepareEmblem}><BusinessIcon name="coordinator" size={38} /></div><span className={styles.eyebrow}>MEET YOUR SETUP COORDINATOR</span><h2>A thoughtful start.<br />A connected workspace.</h2><p>{workspace.clients.length ? "Choose who you’re reporting for above. Monstera will keep the setup organized around that choice." : "Tell Monstera what you work with. Your coordinator will organize an agent for each source."}</p><button className={styles.primary} disabled={busy || (!!workspace.clients.length && clientId === null)} onClick={() => void mutate(beginSetup)}>{busy ? "Preparing…" : "Start setup"}<span>→</span></button><small>Your progress is saved as you go.</small></div><div className={styles.prepareSteps}>{[{ name: "team" as const, title: "Bring your sources", text: "Choose a platform or tell Monstera what you use." }, { name: "permission" as const, title: "Stay in control", text: "Authorize each account and choose its scope." }, { name: "report" as const, title: "Follow every step", text: "Each agent keeps its own progress in view." }].map((step, index) => <div key={step.title}><span className={styles.prepareStepIcon}><BusinessIcon name={step.name} size={24} /></span><div><small>0{index + 1}</small><h3>{step.title}</h3><p>{step.text}</p></div></div>)}</div></div> : !snapshot ? <div className={styles.notice} role="status">Restoring your workspace…</div> : <>
          {paused && <div className={styles.pauseNotice}><Pause size={16} /><span>Your setup is paused. Your choices are saved; imports already started keep running.</span><button className={styles.textButton} disabled={busy || viewer} onClick={() => void mutate(async () => { await agentRequest(`/api/agent/runs/${runId}/actions`, { expectedVersion: snapshot.run.version, action: "resume" }); await refresh(); })}>Resume setup →</button></div>}
          {completed && <div className={styles.pauseNotice}><span>Your setup has already been reviewed.{snapshot.tasks.some(task => task.state === "deferred") && " Continue saved sources with fresh account and import choices."}</span>{snapshot.tasks.some(task => task.state === "deferred") && <button className={styles.textButton} disabled={busy || viewer} onClick={() => void mutate(continueSavedSources)}>Continue saved sources →</button>}<Link href={consolePath} onClick={event => { event.preventDefault(); void mutate(returnToConsole); }}>Open console →</Link></div>}
          {viewer && <div className={styles.pauseNotice}>You have view-only access. Ask a workspace member to continue setup.</div>}
          <div className={styles.workspace}>
            <section className={styles.conversation} aria-labelledby="sources-question"><div className={styles.conversationToolbar}><span className={styles.eyebrow}>SETUP CONVERSATION</span><span>{paused ? "Paused" : busy ? "Updating setup" : "Ready when you are"}</span></div><div className={styles.agentIdentity}><span className={styles.avatar}><BusinessIcon name="coordinator" size={23} /></span><span><strong>Monstera</strong><small>Your setup coordinator</small></span></div>
              <h2 id="sources-question">{goal ? `Let’s ${goal.context.toLowerCase()}.` : "Which tools do you work with?"}</h2><p className={styles.muted}>{greeting} Pick a source below, or tell me what you have in mind.</p><p className={styles.choiceLabel}>CHOOSE A STARTING POINT</p>
              <div className={styles.chips} role="group" aria-label="Available sources">{ONBOARDING_PROVIDERS.map(provider => {
                const task = snapshot.tasks.find(t => t.provider === provider.id);
                const selected = !!task;
                const available = workspace.enabledProviders.includes(provider.id);
                return <button key={provider.id} aria-label={provider.name} aria-pressed={selected} disabled={busy || (task ? false : !writable || !available)} onClick={() => task ? openAgent(task.id) : addProviders([provider.id])} title={!available ? "Ask your workspace owner to enable this source" : undefined}><span className={styles.chipMark}><SourceLogo provider={provider.id} size={22} /></span><span className={styles.choiceCopy}><strong>{provider.name}</strong><small>{task ? taskPresentation(task, warehouseEvidence[task.id]).label : !available ? "Unavailable in this workspace" : provider.id === "shopee" ? "Orders & revenue" : "Campaign performance"}</small></span><span className={styles.choiceAction}>{selected ? <ArrowRight size={14} /> : "+"}</span></button>;
              })}</div>
              <div ref={conversationLog} onScroll={e => { const node = e.currentTarget; followConversation.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48; }} className={styles.messages} role="log" aria-label="Setup conversation" aria-live="polite" aria-relevant="additions text">{snapshot.messages.map(message => <div key={message.id} className={`${message.role === "user" ? styles.userMessage : styles.assistantMessage} ${arrivalIds.includes(message.id) ? styles.newMessage : ""}`}><span className={styles.messageAuthor}>{message.role === "user" ? "You" : "Monstera"}</span><p>{message.content}</p>{message.structuredResponse?.proposedActions?.map((action, index) => {
                const missing = action.providerIds.filter(id => !snapshot.tasks.some(t => t.provider === id));
                const supported = missing.filter(id => workspace.enabledProviders.some(provider => provider === id));
                const existing = snapshot.tasks.filter(t => action.providerIds.some(id => id === t.provider));
                return <div key={index} className={styles.proposalActions}>
                  {supported.length > 0 && <button className={styles.proposal} disabled={busy || !writable} onClick={() => addProviders(supported)}>Add {ONBOARDING_PROVIDERS.filter(p => supported.includes(p.id)).map(p => p.name).join(" + ")} agents →</button>}
                  {existing.map(task => <button key={task.id} className={styles.proposal} disabled={busy} onClick={() => openAgent(task.id)}>Open {ONBOARDING_PROVIDERS.find(p => p.id === task.provider)?.name} agent →</button>)}
                  {missing.some(id => !workspace.enabledProviders.some(provider => provider === id)) && <p className={styles.small}>Some suggested sources aren’t enabled in this workspace.</p>}
                </div>;
              })}</div>)}</div>
              <form className={styles.composer} onSubmit={e => { e.preventDefault(); sendMessage(); }}><label htmlFor="setup-request" className={styles.srOnly}>Tell Monstera which sources to connect</label><textarea id="setup-request" rows={2} maxLength={4000} value={text} disabled={!writable} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (!busy) sendMessage(); } }} onChange={e => setText(e.target.value)} placeholder="I’d like to start with TikTok Ads and Shopee…" /><button type="submit" aria-label="Send message" disabled={busy || !writable || !text.trim()}><ArrowUp size={18} /></button></form>
              <div className={styles.composerFoot}><span>{busy ? <><span className={styles.savingIndicator} />Updating your setup…</> : <><BusinessIcon name="permission" size={13} />You authorize every connection</>}</span><span>Monstera coordinates</span></div>
            </section>
            <SpecialistTaskList
              providerCount={new Set([...workspace.enabledProviders, ...snapshot.tasks.map(task => task.provider)]).size}
              workspaceId={workspace.id}
              tasks={snapshot.tasks}
              changedIds={newTaskIds}
              paused={!!paused}
              disabled={busy || !writable}
              onAction={(task, action, connectionId) => void mutate(async () => {
                await agentRequest(`/api/agent/tasks/${task.id}/actions`, { expectedVersion: task.version, action, ...(connectionId ? Array.isArray(connectionId) ? { connectionIds: connectionId } : { connectionId } : {}) });
                await refresh();
              })}
              canAuthorize={{ tiktok_business: boot.canAuthorizeTikTok, meta_ads: boot.canAuthorizeMeta, google_ads: boot.canAuthorizeGoogle, shopee: boot.canAuthorizeShopee }}
              onReviewed={markReviewed}
              warehouseEvidence={warehouseEvidence}
              activeTaskId={activeTaskId}
              onOpen={setActiveTaskId}
              explorerPath={explorerPath}
              onConfirm={(task, input) => void mutate(async () => { await agentRequest(`/api/agent/tasks/${task.id}/confirm-scope`, input); await refresh(); })}
            />
          </div>
          {snapshot.tasks.some(task => task.state === "ready") && <FirstResult tasks={snapshot.tasks} previews={previews} goal={goal} explorerPath={explorerPath} workspaceId={workspaceId!} acknowledged={acknowledgedResult === resultKey} onAcknowledge={() => setAcknowledgedResult(resultKey)} />}
          {snapshot.tasks.some(task => task.state === "ready") && !completed && <div className={styles.finishReview}><div><h3>Your workspace is taking shape.</h3><p>Review your first overview and save unfinished sources for later. Your setup agents connect sources and import data. This setup does not authorize campaign changes or activate ongoing monitoring.</p></div><button className={styles.primary} disabled={busy || !writable || acknowledgedResult !== resultKey || snapshot.tasks.some(task => !["ready", "deferred"].includes(task.state)) || snapshot.tasks.filter(task => task.state === "ready").some(task => !reviewedTaskIds.includes(task.id))} onClick={() => void mutate(async () => { await agentRequest(`/api/agent/runs/${runId}/actions`, { expectedVersion: snapshot.run.version, action: "finish" }); await returnToConsole(); })}>Open my workspace →</button></div>}
        </>}
        </div>
        <footer className={styles.footer}><span>Built around your work. Connected on your terms.</span><Link href={sourcesPath}>Manage existing sources ↗</Link></footer>
      </>}
    </div></div>
  </main>;
}

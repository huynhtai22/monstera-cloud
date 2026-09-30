"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { AppLoader } from "./AppLoader";

// Only completion of the initial request matters; background refreshes never reopen the loader.
const StartupContext = createContext<{
  configure: (session: boolean, dashboard: boolean, verified: boolean) => void;
  completeDashboard: (success?: boolean, providers?: string[]) => void;
  completeWorkspace: (providers?: string[]) => void;
  handoff: boolean;
  animateHandoff: boolean;
} | null>(null);
const StartupActions = createContext<Pick<NonNullable<React.ContextType<typeof StartupContext>>, "completeDashboard" | "completeWorkspace"> | null>(null);

export function WorkspaceStartup({ children }: { children: ReactNode }) {
  const [workspace, setWorkspace] = useState(false);
  const [success, setSuccess] = useState(false);
  const [sourcesChecked, setSourcesChecked] = useState(false);
  const [providers, setProviders] = useState<string[] | null>(null);
  const completeWorkspace = useCallback((known?: string[]) => {
    setWorkspace(true);
    if (known) { setSourcesChecked(true); setProviders([...new Set(known)].slice(0,4)); }
  }, []);
  const [handoff, setHandoff] = useState(false);
  const [animateHandoff, setAnimateHandoff] = useState(false);
  const beginHandoff = useCallback((animate = false) => { setAnimateHandoff(animate); setHandoff(true); }, []);
  const [session, setSession] = useState(false);
  const [verified, setVerified] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [dashboard, setDashboard] = useState(true);
  const [dataReturned, setDataReturned] = useState(false);
  const configure = useCallback((settled: boolean, needsDashboard: boolean, authenticated: boolean) => {
    setSession(settled);
    setVerified(authenticated);
    setDashboard(needsDashboard);
    setConfigured(true);
  }, []);
  const completeDashboard = useCallback((ok = false, known?: string[]) => {
    setDataReturned(true); setSuccess(ok);
    if (ok && known) { setSourcesChecked(true); setProviders([...new Set(known)].slice(0,4)); }
  }, []);
  const actions = useMemo(() => ({ completeDashboard, completeWorkspace }), [completeDashboard, completeWorkspace]);
  const context = useMemo(() => ({ configure, completeDashboard, completeWorkspace, handoff, animateHandoff }), [configure, completeDashboard, completeWorkspace, handoff, animateHandoff]);
  const pending = !configured || !session || (verified && dashboard && !dataReturned);
  return (
    <StartupContext.Provider value={context}>
      <StartupActions.Provider value={actions}>
      <AppLoader visible={pending} milestones={[verified, workspace, sourcesChecked, success]} providers={providers} measurable={dashboard} onExitStart={beginHandoff} />
      {children}
      </StartupActions.Provider>
    </StartupContext.Provider>
  );
}

export function useWorkspaceStartup() { return useContext(StartupContext); }
export function useWorkspaceStartupActions() { return useContext(StartupActions); }

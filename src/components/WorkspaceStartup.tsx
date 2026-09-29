"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { AppLoader } from "./AppLoader";

// Only completion of the initial request matters; background refreshes never reopen the loader.
const StartupContext = createContext<{
  configure: (session: boolean, dashboard: boolean, verified: boolean) => void;
  completeDashboard: () => void;
  handoff: boolean;
} | null>(null);

export function WorkspaceStartup({ children }: { children: ReactNode }) {
  const [handoff, setHandoff] = useState(false);
  const beginHandoff = useCallback(() => setHandoff(true), []);
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
  const completeDashboard = useCallback(() => setDataReturned(true), []);
  const pending = !configured || !session || (verified && dashboard && !dataReturned);
  return (
    <StartupContext.Provider value={{ configure, completeDashboard, handoff }}>
      <AppLoader visible={pending} sessionVerified={verified} workspaceReturned={dataReturned} measurable={dashboard} onExitStart={beginHandoff} />
      {children}
    </StartupContext.Provider>
  );
}

export function useWorkspaceStartup() { return useContext(StartupContext); }


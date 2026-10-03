"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
} from "react";
import { ArrowUpRight, FlaskConical, Menu, Play, X } from "lucide-react";
import { PreviewSidebar } from "./PreviewSidebar";
import { PreviewSections } from "./PreviewSections";
import { sectionFromHash, subscribeSection, sections } from "./sections-model";
import { ConsoleOverview } from "@/components/dashboard/ConsoleOverview";
import { previewOverview, previewStates, type PreviewState } from "./fixtures";
import styles from "./preview.module.css";
import frame from "./DashboardFrame.module.css";

export function ConsolePreview() {
  const [state, setState] = useState<PreviewState>("Overview");
  const [updating, setUpdating] = useState(false);
  const [motionPlaying, setMotionPlaying] = useState(false);
  const motionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dismissed, setDismissed] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [detail, setDetail] = useState<{ title: string; body: string } | null>(
    null,
  );
  const dialog = useRef<HTMLDialogElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const section = useSyncExternalStore(
    subscribeSection,
    sectionFromHash,
    () => "dashboard" as const,
  );
  const sectionTitle =
    sections.find((item) => item.id === section)?.title || "Dashboard";
  const availableStates = ["dashboard", "reports", "warehouse"].includes(
    section,
  )
    ? previewStates
    : ["settings", "exports"].includes(section)
      ? previewStates.filter(
          (item) => item === "Overview" || item === "New workspace",
        )
      : previewStates.filter((item) => item !== "Multi-currency");
  const mode = availableStates.includes(state) ? state : "Overview";
  const overview = previewOverview(
    section === "dashboard" && motionPlaying ? "Syncing" : mode,
  );
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    mainRef.current?.focus({ preventScroll: true });
  }, [section]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (motionTimer.current) clearTimeout(motionTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (detail) dialog.current?.showModal();
  }, [detail]);

  function refresh() {
    setUpdating(true);
    timer.current = setTimeout(() => setUpdating(false), 2200);
  }
  function playMotion() {
    if (motionTimer.current) clearTimeout(motionTimer.current);
    setMotionPlaying(true);
    motionTimer.current = setTimeout(() => setMotionPlaying(false), 6500);
  }
  function inspectLink(event: MouseEvent) {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a");
    if (!link || link.getAttribute("href")?.startsWith("#")) return;
    event.preventDefault();
    event.stopPropagation();
    const path = link.getAttribute("href") || "";
    const cleanPath = path.split("?")[0];
    const destination = sections.find(
      (item) =>
        cleanPath === item.path || cleanPath.startsWith(`${item.path}/`),
    );
    if (destination) {
      window.location.hash = destination.id;
    } else if (["/docs", "/looker-studio"].includes(cleanPath)) {
      window.location.hash = "exports";
    } else {
      setDetail({
        title: "Local preview",
        body: "Use the console navigation to explore all eight redesigned sections. This preview uses sample data and keeps live accounts unchanged.",
      });
    }
    setMobileOpen(false);
  }

  return (
    <div
      className={`${styles.preview} ${frame.frame}`}
      onClickCapture={inspectLink}
    >
      <PreviewSidebar
        active={section}
        collapsed={collapsed}
        onCollapse={() => setCollapsed((value) => !value)}
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
      />
      {mobileOpen && (
        <button
          className={styles.overlay}
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <div className={`${styles.content} ${collapsed ? styles.collapsed : ""}`}>
        <div className={styles.previewBar}>
          <div className={styles.previewLabel}>
            <button
              type="button"
              className={styles.menu}
              aria-label="Open navigation"
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={17} />
            </button>
            <FlaskConical size={14} />
            <strong>
              {section === "dashboard" ? "Dashboard study" : "Design preview"}
            </strong>
            <span>Sample data · Local only</span>
          </div>
          <div className={styles.previewControls}>
            {section === "dashboard" && (
              <button
                type="button"
                className={frame.motionButton}
                disabled={motionPlaying}
                onClick={playMotion}
              >
                <Play size={12} />
                {motionPlaying ? "Playing motion…" : "Preview motion"}
              </button>
            )}
            <label className={styles.stateControl}>
              View state
              <select
                value={mode}
                onChange={(event) => {
                  const next = event.target.value as PreviewState;
                  setState(next);
                  setDismissed(next !== "New workspace");
                }}
                aria-label="Preview state"
              >
                {availableStates.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <main
          ref={mainRef}
          tabIndex={-1}
          aria-label={`${sectionTitle} preview`}
        >
          {section === "dashboard" ? (
            <ConsoleOverview
              overview={overview}
              isUpdating={updating}
              onRefresh={refresh}
              wizardDismissed={dismissed}
              onWizardDismiss={() => setDismissed(true)}
              onWizardResume={() => setDismissed(false)}
              onReconnect={() =>
                setDetail({
                  title: "Reconnect Google Ads",
                  body: "In the live console, this opens the existing connection recovery flow. Your warehouse history is preserved while you reconnect. No authorization or account changes happen in this design preview.",
                })
              }
            />
          ) : (
            <PreviewSections
              section={section}
              overview={overview}
              mode={mode}
            />
          )}
        </main>
      </div>
      <dialog
        ref={dialog}
        className={styles.dialog}
        onClose={() => setDetail(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
      >
        <div className={styles.dialogHeading}>
          <span>
            <ArrowUpRight size={16} />
            PREVIEW INTERACTION
          </span>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            aria-label="Close preview details"
          >
            <X size={18} />
          </button>
        </div>
        <h2>{detail?.title}</h2>
        <p>{detail?.body}</p>
        <button
          className={styles.closeButton}
          type="button"
          onClick={() => dialog.current?.close()}
        >
          Back to preview
        </button>
      </dialog>
    </div>
  );
}

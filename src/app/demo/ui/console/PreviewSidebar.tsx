"use client";

import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  LayoutGrid,
  LineChart,
  PanelLeftClose,
  DatabaseZap,
  Settings,
  Users,
  X,
} from "lucide-react";
import { LogoMark } from "@/components/Logo";
import { sections, type SectionId } from "./sections-model";
import styles from "./sections.module.css";

const icons = {
  dashboard: LayoutGrid,
  operations: Activity,
  sources: DatabaseZap,
  reports: LineChart,
  warehouse: Database,
  exports: Download,
  clients: Users,
  settings: Settings,
};
export function PreviewSidebar({
  active,
  collapsed,
  onCollapse,
  mobileOpen,
  onClose,
}: {
  active: SectionId;
  collapsed: boolean;
  onCollapse: () => void;
  mobileOpen: boolean;
  onClose: () => void;
}) {
  return (
    <aside
      className={`${styles.sidebar} ${collapsed ? styles.sidebarCollapsed : ""} ${mobileOpen ? styles.sidebarOpen : ""}`}
      aria-label="Console navigation"
    >
      <a
        href="#dashboard"
        className={styles.brand}
        onClick={onClose}
        aria-label="Monstera Cloud dashboard"
      >
        <span className={styles.brandIcon}>
          <LogoMark className="h-7 w-7" />
        </span>
        <span className={styles.navText}>
          <strong>Monstera Cloud</strong>
        </span>
      </a>
      <button
        className={styles.closeMobile}
        type="button"
        onClick={onClose}
        aria-label="Close navigation"
      >
        <X size={18} />
      </button>
      <div className={styles.workspacePill}>
        <span className={styles.workspaceAvatar}>S</span>
        <div className={styles.navText}>
          <strong>Studio North</strong>
          <span>Professional workspace</span>
        </div>
        <span className={styles.planDot} />
      </div>
      <nav>
        {["Overview", "Pipelines", "Data", "Management"].map((group) => (
          <div key={group} className={styles.navGroup}>
            <p className={styles.navText}>{group}</p>
            {sections
              .filter((item) => item.group === group)
              .map((item) => {
                const Icon = icons[item.id];
                return (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    aria-current={active === item.id ? "page" : undefined}
                    title={collapsed ? item.title : undefined}
                    onClick={onClose}
                  >
                    <Icon size={17} strokeWidth={1.6} />
                    <span className={styles.navText}>{item.title}</span>
                    {active === item.id && (
                      <span className={styles.activeDot} />
                    )}
                  </a>
                );
              })}
          </div>
        ))}
      </nav>
      <div className={styles.sidebarBottom}>
        <button
          className={styles.collapse}
          type="button"
          onClick={onCollapse}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          <span className={styles.navText}>Collapse sidebar</span>
        </button>
        <a href="#settings" className={styles.profile} onClick={onClose}>
          <span className={styles.avatar}>AM</span>
          <span className={styles.navText}>
            <strong>Alex Morgan</strong>
            <small>Workspace owner · Preview</small>
          </span>
          <PanelLeftClose size={14} className={styles.navText} />
        </a>
      </div>
    </aside>
  );
}

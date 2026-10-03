"use client";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { SettingsIcon } from "./SettingsIcon";
import { settingsSections, type SettingsSectionId } from "./settings-sections";
import { useConsoleAppearance } from "./ConsoleAppearanceContext";
import styles from "./SettingsExperience.module.css";

type Props = { active: SettingsSectionId; onSelect: (id: SettingsSectionId) => void; workspaceName?: string; role?: string; children: ReactNode; previewAccessory?: ReactNode };
export function SettingsExperience({ active, onSelect, workspaceName, role, children, previewAccessory }: Props) {
  const [query, setQuery] = useState("");
  const appearance = useConsoleAppearance();
  const selected = settingsSections.find(section => section.id === active)!;
  const matches = settingsSections.filter(section => `${section.label} ${section.description} ${section.keywords}`.toLowerCase().includes(query.trim().toLowerCase()));
  const choose = (id: SettingsSectionId) => { setQuery(""); onSelect(id); };
  const hrefFor = appearance?.hrefFor ?? ((href: string) => href);
  return <div data-console-page="true" data-console-section="settings" className={`console-page ${styles.page}`}>
    <header className={styles.pageHeader}>
      <div><p className={styles.eyebrow}>WORKSPACE / PREFERENCES</p><h1>Settings</h1><p>Manage workspace access, reporting controls, and personal preferences.</p></div>
      <div className={styles.workspacePill}><SettingsIcon name="workspace"/><div><strong>{workspaceName || "Select a workspace"}</strong><span>{role ? `${role.charAt(0).toUpperCase()}${role.slice(1)} access` : "Workspace settings"}</span></div></div>
    </header>
    <div className={styles.layout} data-console-settings-panel="true">
      <aside className={styles.navigation}>
        <label className={styles.search}><SettingsIcon name="search"/><input type="search" aria-label="Search settings" placeholder="Find a setting…" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Escape") setQuery(""); if (event.key === "Enter" && query.trim() && matches.length) { event.preventDefault(); choose(matches[0].id); } }}/></label>
        <nav aria-label="Settings categories" data-console-settings-nav="true">
          {["Workspace", "Reporting", "Administration", "Personal"].map(group => <div key={group} className={styles.navGroup}><p>{group}</p>{settingsSections.filter(section => section.group === group).map(section => <button type="button" key={section.id} aria-current={active === section.id ? "page" : undefined} aria-pressed={active === section.id} onClick={() => choose(section.id)}><SettingsIcon name={section.id}/><span>{section.label}</span></button>)}</div>)}
        </nav>
        <p className={styles.scopeNote}>Workspace changes apply to your team. Personal preferences stay with you.</p>
      </aside>
      <div className={styles.content} data-console-transition-content="true">
        {query.trim() ? <section className={styles.results} aria-label="Settings search results"><p className={styles.eyebrow}>FIND A SETTING</p><h2>Results for “{query}”</h2><p role="status">{matches.length} {matches.length === 1 ? "setting" : "settings"} found</p><div className={styles.settingRows}>{matches.map(section => <button key={section.id} type="button" className={styles.settingRow} onClick={() => choose(section.id)}><SettingsIcon name={section.id}/><span><strong>{section.label}</strong><span>{section.description}</span></span><SettingsIcon name="arrow" className={styles.rowArrow}/></button>)}</div>{!matches.length && <div className={styles.empty}><SettingsIcon name="search"/><h3>No matching settings</h3><p>Try “invite”, “Sheets”, “billing”, or “theme”.</p><button type="button" onClick={() => setQuery("")}>Clear search</button></div>}</section> : active === "overview" ? <section className={styles.overview}>
          <div className={styles.sectionHeader}><h2>Workspace settings</h2><p>Configure your team’s reporting environment.</p></div>
          <div className={styles.overviewGroups}>{["Workspace", "Reporting", "Administration", "Personal"].map(group => <section className={styles.overviewGroup} key={group} aria-label={`${group} settings`}><header><h3>{group === "Personal" ? "Personal preferences" : group}</h3><span>{group === "Personal" ? "Your account and browser" : "Applies to this workspace"}</span></header><div className={styles.settingRows}>{settingsSections.filter(section => section.group === group && section.id !== "overview").map(section => <button type="button" className={styles.settingRow} key={section.id} onClick={() => choose(section.id)}><SettingsIcon name={section.id}/><span><strong>{section.label}</strong><span>{section.description}</span></span><SettingsIcon name="arrow" className={styles.rowArrow}/></button>)}</div></section>)}</div>
          <section className={styles.workflow}><div><h3>Reporting tools</h3><p>Manage sources and destinations in their dedicated sections.</p></div><div>{[{href:"/sources?tab=connected",label:"Manage sources",icon:"workspace" as const},{href:"/reports?view=readiness",label:"Report readiness",icon:"alerts" as const},{href:"/exports",label:"Export destinations",icon:"api" as const}].map(item => <Link key={item.href} href={hrefFor(item.href)}><SettingsIcon name={item.icon}/><span>{item.label}</span><SettingsIcon name="arrow"/></Link>)}</div></section>
          {previewAccessory}
        </section> : <section className={styles.detail} key={active} aria-label={selected.label}>
          <div className={styles.detailHeading}><span className={styles.iconTile}><SettingsIcon name={active}/></span><div><span className={styles.eyebrow}>{selected.group} / {selected.scope}</span><h2>{selected.label}</h2><p>{selected.description}</p></div></div>
          {active === "appearance" ? <section className={styles.appearance}><h3>Console theme</h3><p>Saved in this browser. Your team’s preferences stay independent.</p><div className={styles.themeChoices}>{(["light", "dark"] as const).map(theme => <button type="button" key={theme} data-settings-theme-choice="true" aria-label={`${theme === "light" ? "Light" : "Dark"} theme`} aria-pressed={!!appearance && (theme === "dark") === appearance.isDarkMode} disabled={!appearance} onClick={() => { if (appearance && (theme === "dark") !== appearance.isDarkMode) appearance.toggleDarkMode(); }}><span className={`${styles.themePreview} ${theme === "dark" ? styles.darkPreview : styles.lightPreview}`} aria-hidden="true"><i/><span><b/><b/><b/></span></span><strong>{theme === "light" ? "Light" : "Dark"}</strong><span>{theme === "light" ? "Light interface" : "Dark interface"}</span></button>)}</div><div className={styles.motionNote}><SettingsIcon name="appearance"/><div><strong>Reduced motion</strong><p>Transitions respect your device’s reduced-motion setting.</p></div></div>{previewAccessory}</section> : <div className={styles.existingControls}>{children}</div>}
        </section>}
      </div>
    </div>
  </div>;
}

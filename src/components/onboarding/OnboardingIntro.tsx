"use client";

import { useState, type CSSProperties } from "react";
import { ArrowRight, RotateCcw } from "lucide-react";
import { LogoMark } from "@/components/Logo";
import { ONBOARDING_PROVIDERS } from "@/lib/agent/catalog";
import { BusinessIcon, SourceLogo } from "./OnboardingIcons";
import styles from "./Onboarding.module.css";

const scenes = [
  { title: "Your sources", text: "Start with the tools behind your business. You decide what belongs in your workspace." },
  { title: "Your agents", text: "One coordinator. An agent for each source. Every permission stays in your hands." },
  { title: "Your workspace", text: "A shared home for your sources, metrics and reporting. Shaped around the way you work." },
];

export function OnboardingIntro({ onStart }: { onStart: () => void }) {
  const [scene, setScene] = useState(0);
  const [replay, setReplay] = useState(0);
  return <section className={styles.intro} aria-labelledby="intro-title">
    <div className={styles.introCopy}>
      <p className={styles.eyebrow}><span className={styles.introDot} /> BUILT AROUND YOUR BUSINESS</p>
      <h1 id="intro-title">Your business. <span>One clear view.</span></h1>
      <p className={styles.introDescription}>Bring your tools together. Give every source an agent.<br />Make space for the work that moves your business forward.</p>
      <button className={`${styles.primary} ${styles.introStart}`} onClick={onStart}>Make it yours<ArrowRight size={16} aria-hidden="true" /></button>
      <p className={styles.introHint}>Your work first. Your sources next.</p>
    </div>
    <div className={styles.showcase}>
      <div className={styles.showcaseToolbar}><span><LogoMark className={styles.showcaseLogo} />Your next workspace</span><span className={styles.previewLabel}>SETUP PREVIEW</span><button className={styles.replay} onClick={() => setReplay(value => value + 1)} aria-label="Replay introduction"><RotateCcw size={13} /></button></div>
      <div className={styles.showcaseScene} data-scene={scene} key={replay} aria-hidden="true">
        <div className={styles.intakePanel}>
          <div className={styles.previewSectionLabel}>01 / YOUR SOURCES</div>
          <div className={styles.intakeSources}>{ONBOARDING_PROVIDERS.map((provider, index) => <div className={styles.intakeSource} key={provider.id} style={{ "--item-index": index } as CSSProperties}><span><SourceLogo provider={provider.id} size={21} /></span><div>{provider.name}<small>{provider.id === "shopee" ? "Commerce" : "Advertising"}</small></div><i /></div>)}</div>
          <p>Your tools, on your terms.</p>
        </div>
        <div className={styles.coordinationPanel}>
          <div className={styles.previewSectionLabel}>02 / ONE COORDINATED SETUP</div>
          <div className={styles.coordinatorCore}><div className={styles.coreFrame}><BusinessIcon name="coordinator" size={34} /></div><strong>Monstera</strong><span>Your setup coordinator</span></div>
          <div className={styles.previewRoutes}><i /><i /><i /></div>
          <div className={styles.previewSpecialists}>{["permission", "accounts", "report"].map((name, index) => <div key={name} style={{ "--item-index": index } as CSSProperties}><BusinessIcon name={name as "permission" | "accounts" | "report"} size={23} /><span>{["Account access", "Source context", "Data preparation"][index]}</span></div>)}</div>
          <div className={styles.previewPermission}><BusinessIcon name="permission" size={14} /> You review every permission</div>
        </div>
        <div className={styles.workspacePreview}>
          <div className={styles.previewSectionLabel}>03 / YOUR WORKSPACE</div>
          <div className={styles.previewWindow}><div className={styles.previewWindowHeader}><LogoMark className={styles.showcaseLogo} /><span>Overview</span><span>•••</span></div><div className={styles.previewMetricLabels}><span>Sources</span><span>Metrics</span><span>Reports</span></div><div className={styles.previewChart}>{[31, 53, 42, 70, 59, 87, 76].map((height, index) => <i key={index} style={{ height: `${height}%`, "--item-index": index } as CSSProperties} />)}</div><div className={styles.previewTable}><i /><i /><i /></div><p>Designed for a clearer picture.</p></div>
        </div>
      </div>
      <div className={styles.sceneSelector} role="group" aria-label="Explore the setup preview">{scenes.map((item, index) => <button key={item.title} aria-pressed={scene === index} onClick={() => setScene(index)}><span>0{index + 1}</span>{item.title}<ArrowRight size={12} aria-hidden="true" /></button>)}</div>
    </div>
    <p className={styles.sceneDescription} key={scene} aria-live="polite">{scenes[scene].text}</p>
  </section>;
}

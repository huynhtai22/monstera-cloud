"use client";
import { useEffect, useState } from "react";
import { ReportingJourneyMotion, type JourneyVisual } from "@/components/onboarding/ReportingJourneyMotion";
import { LogoMark } from "@/components/Logo";
import styles from "./preview.module.css";

const steps = [
  ["Connect a source", "See which reporting data Monstera can read. You approve access on the provider’s own sign-in screen."],
  ["Choose client and accounts", "Keep the reporting scope clear. Only the accounts you select will be imported for this client."],
  ["Import a reporting window", "Follow the approved import. Counts come from completed account jobs, rather than a simulated percentage."],
  ["Verify the output", "Inspect the destination’s actual rows before confirming the result. A server receipt alone is not output verification."],
];
const accounts = [{ id: "a", name: "Linh Amour · Facebook" }, { id: "b", name: "Linh Amour · Instagram" }, { id: "c", name: "Studio North" }];
export default function ReportingJourneyPreview() {
  const [step, setStep] = useState(0), [light, setLight] = useState(false), [selected, setSelected] = useState<string[]>([]);
  const [running, setRunning] = useState(false), [completed, setCompleted] = useState(0), [inspected, setInspected] = useState(false);
  useEffect(() => {
    const previous = document.documentElement.dataset.consoleTheme;
    document.documentElement.dataset.consoleTheme = light ? "light" : "dark";
    return () => { if (previous) document.documentElement.dataset.consoleTheme = previous; else delete document.documentElement.dataset.consoleTheme; };
  }, [light]);
  const importTotal = selected.length || 3;
  const reportingWindow = { since: "2026-09-26", until: "2026-10-02" };
  const visual: JourneyVisual = step === 0 ? { step: "connect", provider: "meta_ads", running }
    : step === 1 ? { step: "scope", accounts: accounts.filter(account => selected.includes(account.id)), groupLabel: "Linh Amour · sample client" }
    : step === 2 ? { step: "import", running, status: running ? "Importing approved accounts" : completed === importTotal ? "Sample import finished" : "Import paused", completed, total: importTotal, ...reportingWindow }
    : { step: "output", destination: "Google Sheets · sample destination", inspected, rows: importTotal * 7, ...reportingWindow };
  return <main className={`${styles.root} ${light ? styles.light : ""}`}>
    <div className={styles.frame}>
      <header><span><LogoMark className="h-6 w-6" /> Monstera Cloud</span><button onClick={() => setLight(!light)}>{light ? "Dark mode" : "Light mode"}</button></header>
      <p className={styles.notice}>INTERACTIVE MOTION PREVIEW · Sample evidence only. No sign-in, import, delivery, or account changes.</p>
      <nav aria-label="Reporting journey">{steps.map(([title], index) => <button key={title} aria-current={step === index ? "step" : undefined} onClick={() => { setStep(index); setRunning(false); }}><b>{index + 1}</b>{title}</button>)}</nav>
      <section key={step} className={styles.panel} aria-labelledby="journey-title">
        <h1 id="journey-title">{steps[step][0]}</h1><p>{steps[step][1]}</p>
        <ReportingJourneyMotion visual={visual} />
        {step === 0 && <button className={styles.primary} onClick={() => setRunning(!running)}>{running ? "Stop sample handoff" : "Preview secure handoff"}</button>}
        {step === 1 && <fieldset><legend>Sample authorized accounts</legend>{accounts.map(account => <label key={account.id}><input type="checkbox" checked={selected.includes(account.id)} onChange={event => { setSelected(ids => event.target.checked ? [...ids, account.id] : ids.filter(id => id !== account.id)); setCompleted(0); setInspected(false); }} />{account.name}</label>)}</fieldset>}
        {step === 2 && <div className={styles.actions}><button onClick={() => setRunning(!running)} disabled={completed === importTotal}>{running ? "Pause sample import" : "Run sample import"}</button><button onClick={() => { setCompleted(count => Math.min(importTotal, count + 1)); if (completed === importTotal - 1) setRunning(false); }} disabled={!running || completed === importTotal}>Complete one sample account</button><button onClick={() => { setCompleted(0); setRunning(false); }}>Reset</button></div>}
        {step === 3 && <><table><caption>Sample inspected destination rows · 3 of {importTotal * 7}</caption><thead><tr><th>Date</th><th>Account</th><th>Spend</th></tr></thead><tbody>{[26, 27, 28].map(day => <tr key={day}><td>2026-09-{day}</td><td>Linh Amour · Facebook</td><td>USD {(day - 20) * 10}</td></tr>)}</tbody></table><button className={styles.primary} onClick={() => setInspected(!inspected)}>{inspected ? "Reset sample inspection" : "Confirm sample output inspected"}</button></>}
      </section>
      <footer><span>Consent → approved scope → observed import → inspected output</span><button disabled={step === 3} onClick={() => { setStep(value => value + 1); setRunning(false); }}>Next step →</button></footer>
    </div>
  </main>;
}

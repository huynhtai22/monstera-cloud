"use client";
import { useEffect, useState } from "react";
import { FeatureReminder } from "@/components/console/FeatureReminder";
import { LogoMark } from "@/components/Logo";
import styles from "./preview.module.css";

export default function FeatureReminderPreview() {
  const [open, setOpen] = useState(true), [light, setLight] = useState(false);
  useEffect(() => {
    const previous = document.documentElement.dataset.consoleTheme;
    document.documentElement.dataset.consoleTheme = light ? "light" : "dark";
    return () => { if (previous) document.documentElement.dataset.consoleTheme = previous; else delete document.documentElement.dataset.consoleTheme; };
  }, [light]);
  return <main className={`${styles.root} ${light ? styles.light : ""}`}><div className={styles.frame}>
    <header><span><LogoMark className="h-6 w-6" />Monstera Cloud</span><button onClick={() => setLight(!light)}>{light ? "Dark mode" : "Light mode"}</button></header>
    <section className={styles.background}><p>WORKSPACE OVERVIEW</p><h1>Your workspace</h1><p>A quiet feature reminder. Illustrations explain capabilities; they do not represent live account or fleet status.</p><div className={styles.placeholders}><i /><i /><i /></div><button onClick={() => setOpen(true)}>Explore Monstera features</button></section>
    <FeatureReminder open={open} onClose={() => setOpen(false)} hrefFor={path => `/demo/ui/console-structure/${({ "/sources": "sources", "/clients": "clients", "/operations": "operations", "/reports": "reports" } as Record<string,string>)[path] ?? "console"}`} />
  </div></main>;
}

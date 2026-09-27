"use client";
import {
  useEffect,
  useRef,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react";
import { ArrowUpRight, Check, Search, X } from "lucide-react";
import { ConsoleActivityLabel } from "@/components/dashboard/ConsoleActivityLabel";
import { ConsoleSyncLabel } from "@/components/dashboard/ConsoleSyncLabel";
import styles from "./sections.module.css";

export function Action({
  children,
  primary,
  busy,
  loadingLabel,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  primary?: boolean;
  busy?: string;
  loadingLabel?: string;
}) {
  return (
    <button
      type="button"
      {...props}
      disabled={Boolean(busy) || props.disabled}
      className={`${styles.button} ${primary ? styles.primary : ""} ${props.className || ""}`}
    >
      {loadingLabel || busy ? (
        <span className={styles.actionContent} data-busy={Boolean(busy)}>
          <span className={styles.actionIdle} aria-hidden={Boolean(busy)}>
            {children}
          </span>
          <span className={styles.actionBusy} aria-hidden={!busy}>
            <ConsoleActivityLabel label={busy || loadingLabel || "Working…"} />
          </span>
        </span>
      ) : (
        children
      )}
    </button>
  );
}
export function SectionHeader({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>
          {eyebrow} <span>/</span> STUDIO NORTH
        </p>
        <h1 tabIndex={-1} data-section-heading>
          {title}
        </h1>
        <p className={styles.description}>{description}</p>
      </div>
      <div className={styles.actions}>{children}</div>
    </header>
  );
}
export function Panel({
  title,
  eyebrow,
  action,
  children,
  className = "",
}: {
  title: string;
  eyebrow?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`${styles.panel} ${className}`}>
      <div className={styles.panelHeading}>
        <div>
          {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
          <h2>{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Badge({
  children,
  tone = "good",
  busy = false,
}: {
  children: string;
  tone?: "good" | "warn" | "neutral" | "blue";
  busy?: boolean;
}) {
  return (
    <span className={`${styles.badge} ${styles[tone]}`}>
      <ConsoleSyncLabel active={busy} idleLabel={children} activeLabel={children} idleIcon={<i />} />
    </span>
  );
}
export function Stats({
  items,
}: {
  items: { label: string; value: ReactNode; detail: string; tone?: string }[];
}) {
  return (
    <div className={styles.stats}>
      {items.map((item) => (
        <article key={item.label}>
          <p>{item.label}</p>
          <strong style={item.tone ? { color: item.tone } : undefined}>
            {item.value}
          </strong>
          <small>{item.detail}</small>
        </article>
      ))}
    </div>
  );
}
export function Switcher({
  options,
  value,
  onChange,
  label,
}: {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <div className={styles.switcher} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          type="button"
          key={option}
          aria-pressed={value === option}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
export function SearchBox({
  value,
  onChange,
  placeholder = "Search",
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label: string;
}) {
  return (
    <label className={styles.search}>
      <Search size={15} />
      <input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className={styles.empty}>
      <span>✳</span>
      <h3>{title}</h3>
      <p>{children || "Try a different search or filter."}</p>
    </div>
  );
}
export function TextLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a href={href} className={styles.textLink}>
      {children}
      <ArrowUpRight size={14} />
    </a>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`${styles.modal} ${wide ? styles.wideModal : ""}`}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) ref.current?.close();
      }}
    >
      <div className={styles.modalHeading}>
        <div>
          <p className={styles.eyebrow}>LOCAL DESIGN PREVIEW</p>
          <h2>{title}</h2>
        </div>
        <button
          type="button"
          aria-label="Close dialog"
          onClick={() => ref.current?.close()}
        >
          <X size={18} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className={styles.notice} role="status">
      <Check size={15} />
      {children}
    </div>
  );
}

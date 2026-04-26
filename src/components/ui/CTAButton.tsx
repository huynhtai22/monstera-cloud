import React from "react";
import styles from "./system/animations.module.css";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "solid" | "ghost" };

export default function CTAButton({ variant = "solid", className = "", children, ...rest }: Props){
  const base = variant === "ghost" ? [styles.ctaButton, styles.ctaGhost].join(" ") : styles.ctaButton;
  return (
    <button className={[base, className].join(" ")} {...rest}>{children}</button>
  );
}

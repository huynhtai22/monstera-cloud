import React from "react";
import tokens from "./system/tokens.module.css";
import styles from "./system/animations.module.css";

type Variant = "primary" | "ghost";
type Size = "sm" | "md" | "lg";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
};

export default function Button({ variant = "primary", size = "md", className = "", loading = false, children, ...rest }: Props){
  const variantClass = variant === "primary" ? tokens["btn-primary"] : tokens["btn-ghost"];
  const sizeClass = size === "sm" ? tokens["btn-sm"] : size === "lg" ? tokens["btn-lg"] : tokens["btn-md"];
  const base = [tokens.btn, variantClass, sizeClass].join(" ");

  return (
    <button className={[base, className].join(" ")} {...rest}>
      {loading ? <span aria-hidden>Loading…</span> : children}
    </button>
  );
}

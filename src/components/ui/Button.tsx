import React from "react";
import tokens from "./system/tokens.module.css";

type Variant = "primary" | "ghost";
type Size = "sm" | "md" | "lg";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
};

const Button = React.forwardRef<HTMLButtonElement, Props>(
  ({ variant = "primary", size = "md", className = "", loading = false, children, ...rest }, ref) => {
    const variantClass = variant === "primary" ? tokens["btn-primary"] : tokens["btn-ghost"];
    const sizeClass = size === "sm" ? tokens["btn-sm"] : size === "lg" ? tokens["btn-lg"] : tokens["btn-md"];
    const base = [tokens.btn, variantClass, sizeClass].join(" ");

    return (
      <button ref={ref} className={[base, className].join(" ")} {...rest}>
        {loading ? <span aria-hidden>Loading…</span> : children}
      </button>
    );
  }
);

Button.displayName = "Button";

export default Button;

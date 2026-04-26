import React from "react";
import Button from "./Button";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "solid" | "ghost" };

export default function CTAButton({ variant = "solid", className = "", children, ...rest }: Props){
  return (
    <Button variant={variant === "ghost" ? "ghost" : "primary"} className={className} {...rest}>{children}</Button>
  );
}

import React from "react";
import styles from "./animations.module.css";

type Props = React.HTMLAttributes<HTMLDivElement> & {
  width?: string | number;
  height?: string | number;
  rounded?: string;
};

export default function Skeleton({ width = "100%", height = 16, rounded = "0.375rem", style, className, ...rest }: Props){
  const s = { width, height, borderRadius: rounded, ...style } as React.CSSProperties;
  return <div className={[styles.skeleton, className || ""].join(" ")} style={s} {...rest} />;
}

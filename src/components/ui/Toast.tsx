import React, { useEffect, useState } from "react";
import styles from "./animations.module.css";

type ToastProps = {
  children: React.ReactNode;
  open?: boolean;
  duration?: number;
  onClose?: ()=>void;
};

export default function Toast({ children, open = true, duration = 3500, onClose }: ToastProps){
  const [visible, setVisible] = useState(open);

  useEffect(()=>{ setVisible(open); }, [open]);

  useEffect(()=>{
    if(!open) return;
    const t = setTimeout(()=>{
      setVisible(false);
      onClose?.();
    }, duration);
    return ()=>clearTimeout(t);
  }, [open, duration, onClose]);

  return (
    <div className={[styles.toast, visible? styles.enter : styles.exit].join(" ")}>{children}</div>
  );
}

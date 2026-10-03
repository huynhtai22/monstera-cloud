"use client";
import { useEffect, useRef, useState } from "react";
export function usePreviewTask() {
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  function run(id: string, message: string, done?: () => void) {
    if (timer.current) clearTimeout(timer.current);
    setBusy(id);
    setNotice("");
    timer.current = setTimeout(() => {
      setBusy("");
      setNotice(message);
      done?.();
    }, 1500);
  }
  return { busy, notice, setNotice, run };
}

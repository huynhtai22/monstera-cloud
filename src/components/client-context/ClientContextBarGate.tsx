"use client";

import { usePathname } from "next/navigation";
import { directoryFor } from "@/lib/console-navigation";
import { Suspense } from "react";
import { ClientContextBar } from "./ClientContextBar";

export function ClientContextBarGate() {
  const pathname = usePathname();
  if (directoryFor(pathname ?? "")) return null;
  return (
    <Suspense fallback={null}>
      <ClientContextBar />
    </Suspense>
  );
}

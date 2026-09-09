"use client";

import { Suspense } from "react";
import { ClientContextBar } from "./ClientContextBar";

export function ClientContextBarGate() {
  return (
    <Suspense fallback={null}>
      <ClientContextBar />
    </Suspense>
  );
}

import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ConsoleStructurePreview } from "./ConsoleStructurePreview";

export default function ConsoleStructureLayout() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Suspense fallback={<div className="min-h-screen bg-canvas" />}><ConsoleStructurePreview /></Suspense>;
}

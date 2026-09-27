import { notFound } from "next/navigation";
import { ConsolePreview } from "./ConsolePreview";

export default function ConsolePreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ConsolePreview />;
}

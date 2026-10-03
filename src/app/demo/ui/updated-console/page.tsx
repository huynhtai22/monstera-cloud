import { notFound } from "next/navigation";
import { UpdatedConsolePreview } from "./UpdatedConsolePreview";

export default function UpdatedConsolePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <UpdatedConsolePreview referenceNow={Date.now()} />;
}

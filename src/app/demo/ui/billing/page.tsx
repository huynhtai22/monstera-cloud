import { notFound } from "next/navigation";
import { BillingPreview } from "./preview";

export default function BillingPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <BillingPreview />;
}

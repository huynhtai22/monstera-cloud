import { redirect } from "next/navigation";

/** Legacy URL: merged into `/explorer` (warehouse + metrics). */
export default function SyncedDataRedirectPage() {
  redirect("/explorer");
}

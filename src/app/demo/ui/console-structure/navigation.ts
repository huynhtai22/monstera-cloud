export { consoleDirectory, directoryFor } from "@/lib/console-navigation";
export const PREVIEW_ROOT = "/demo/ui/console-structure";

export function previewHref(href: string) {
  if (href.startsWith(PREVIEW_ROOT)) return href;
  return `${PREVIEW_ROOT}${href.startsWith("/") ? href : `/${href}`}`;
}

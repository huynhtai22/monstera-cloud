/** Shared timing for CSS surfaces and imperative console transitions. */
export const CONSOLE_MOTION = {
  fast: 150,
  normal: 240,
  slow: 360,
  exit: 180,
  loadingDelay: 150,
  easing: "cubic-bezier(.2,.8,.2,1)",
} as const;

export function consoleTransitionKey(pathname: string, query: string) {
  const params = new URLSearchParams(query);
  if (pathname.endsWith("/sources") && params.get("tab") === "connected") params.delete("tab");
  params.sort();
  return `${pathname}?${params.toString()}`;
}

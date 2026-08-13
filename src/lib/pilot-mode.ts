export function isPilotMode(): boolean {
  if (process.env.PILOT_MODE === "1") return true;
  if (process.env.PILOT_MODE === "0") return false;
  return process.env.NODE_ENV === "production";
}

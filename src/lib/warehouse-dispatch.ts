/** Enable only after the standalone worker is running against the same DB. */
export function warehouseUsesDedicatedWorker(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.WAREHOUSE_EXECUTION_MODE === "worker";
}

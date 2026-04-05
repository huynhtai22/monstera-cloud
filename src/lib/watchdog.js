// Proactive Data Freshness Watchdog Logic
// Refinement: Add a buffer and clear "Actionable" states to avoid alert fatigue.
async function verifyDataFreshness() {
  const connections = await prisma.connection.findMany({ where: { status: 'connected' } });
  
  for (const conn of connections) {
    // 1. Get the last successful sync
    const lastSync = await prisma.ingestionLog.findFirst({
      where: { connectionId: conn.id, status: 'success' },
      orderBy: { createdAt: 'desc' }
    });

    // 2. Define "Stale" as > 26 hours (allowing for daily cron lag)
    const isStale = !lastSync || (Date.now() - lastSync.createdAt.getTime()) > 26 * 60 * 60 * 1000;
    
    // 3. Logic: Avoid Alert Fatigue
    // We only alert if it wasn't already flagged as "Action Needed" in the DB
    if (isStale && !conn.alertFlagged) {
      await logAlert(`!!! CRITICAL: Connection "${conn.name}" is stale (>24h). Action: Check credentials.`);
      
      // Mark as flagged so we don't spam the user every heartbeat cycle
      await prisma.connection.update({
        where: { id: conn.id },
        data: { alertFlagged: true }
      });
    }
  }
}

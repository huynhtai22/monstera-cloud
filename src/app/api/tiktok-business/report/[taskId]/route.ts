import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { tiktokReportClient } from '@/lib/tiktok-business';
import prisma from '@/lib/prisma';

/**
 * GET /api/tiktok-business/report/[taskId]?connectionId=...&advertiser_id=...
 * Returns: { status, rows? } — rows only when status === "COMPLETED"
 */
export async function GET(
  req: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { taskId } = await context.params;
  const { searchParams } = new URL(req.url);
  const connectionId = searchParams.get('connectionId');
  const advertiserId = searchParams.get('advertiser_id');

  if (!connectionId || !advertiserId) {
    return NextResponse.json({ error: 'connectionId and advertiser_id are required' }, { status: 400 });
  }

  try {
    const conn = await (prisma.connection as any).findFirst({
      where: { id: connectionId, provider: 'tiktok_business', status: 'connected' },
    });
    if (!conn) {
      return NextResponse.json({ error: 'TikTok Business connection not found' }, { status: 404 });
    }

    const creds = JSON.parse(conn.credentials) as { accessToken: string };
    const taskInfo = await tiktokReportClient.checkTask(creds.accessToken, advertiserId, taskId);

    if (taskInfo.status === 'COMPLETED' && taskInfo.url) {
      const rows = await tiktokReportClient.downloadRows(taskInfo.url);
      return NextResponse.json({ status: taskInfo.status, rows });
    }

    return NextResponse.json({ status: taskInfo.status });
  } catch (err: any) {
    console.error('[TIKTOK_REPORT_CHECK]', err);
    return NextResponse.json({ error: err.message || 'Failed to check report task' }, { status: 500 });
  }
}

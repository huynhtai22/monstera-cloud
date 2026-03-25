import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { tiktokReportClient, CreateReportTaskParams } from '@/lib/tiktok-business';
import { getValidTikTokToken } from '@/lib/tiktok-refresh';
import prisma from '@/lib/prisma';

/**
 * POST /api/tiktok-business/report/create
 * Body: { connectionId, advertiser_id, report_type, data_level, dimensions, metrics, start_date, end_date }
 *
 * Sandbox connections use the synchronous /report/integrated/get/ endpoint
 * and return rows directly: { mode: "sync", rows: [...] }
 *
 * Production connections start an async task and return: { mode: "async", task_id }
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { connectionId, advertiser_id, ...reportParams } = body as {
      connectionId: string;
    } & CreateReportTaskParams;

    if (!connectionId || !advertiser_id) {
      return NextResponse.json({ error: 'connectionId and advertiser_id are required' }, { status: 400 });
    }

    // Scope the lookup to workspaces the current user belongs to (prevents IDOR)
    const conn = await (prisma.connection as any).findFirst({
      where: {
        id: connectionId,
        provider: 'tiktok_business',
        status: 'connected',
        workspace: { members: { some: { userId: session.user.id } } },
      },
    });
    if (!conn) {
      return NextResponse.json({ error: 'TikTok Business connection not found' }, { status: 404 });
    }

    // Auto-refresh access token if it is close to expiry
    const accessToken = await getValidTikTokToken(conn);

    const creds = JSON.parse(conn.credentials) as { sandbox?: boolean };

    // Sandbox: use synchronous report endpoint (async tasks not supported)
    if (creds.sandbox === true) {
      const rows = await tiktokReportClient.getSyncReport(accessToken, {
        advertiser_id,
        ...reportParams,
      });
      return NextResponse.json({ mode: 'sync', rows });
    }

    // Production: create async task
    const taskId = await tiktokReportClient.createTask(
      accessToken,
      { advertiser_id, ...reportParams },
      false,
    );
    return NextResponse.json({ mode: 'async', task_id: taskId });
  } catch (err: any) {
    console.error('[TIKTOK_REPORT_CREATE]', err);
    return NextResponse.json({ error: err.message || 'Failed to create report task' }, { status: 500 });
  }
}

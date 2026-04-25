import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { metaReportClient } from '@/lib/meta-ads';
import { getValidMetaToken } from '@/lib/meta-refresh';
import prisma from '@/lib/prisma';
import { logger } from "@/lib/logger";

/**
 * GET /api/meta-ads/report/[reportRunId]?connectionId=&adAccountId=
 *
 * Polls the status of a Meta async insights job.
 * Returns { status, percent, rows } where rows is populated when Job Completed.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ reportRunId: string }> }
) {
  const { reportRunId } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const connectionId = searchParams.get('connectionId');

  if (!connectionId) {
    return NextResponse.json({ error: 'connectionId is required' }, { status: 400 });
  }

  const conn = await (prisma.connection as any).findFirst({
    where: {
      id: connectionId,
      provider: 'meta_ads',
      status: 'connected',
      workspace: { members: { some: { userId: session.user.id } } },
    },
  });
  if (!conn) {
    return NextResponse.json({ error: 'Meta Ads connection not found' }, { status: 404 });
  }

  try {
    const accessToken = await getValidMetaToken(conn);
    const status = await metaReportClient.checkAsyncReport(accessToken, reportRunId);

    if (status.async_status === 'Job Completed') {
      const rows = await metaReportClient.fetchAsyncResults(accessToken, reportRunId);
      return NextResponse.json({ status: 'COMPLETED', percent: 100, rows });
    }

    if (status.async_status === 'Job Failed' || status.async_status === 'Job Skipped') {
      return NextResponse.json({ status: 'FAILED', percent: status.async_percent_completion });
    }

    return NextResponse.json({
      status: 'RUNNING',
      percent: status.async_percent_completion,
    });
  } catch (err: any) {
    logger.error('[META_ADS_REPORT_POLL]', err);
    return NextResponse.json({ error: err.message || 'Failed to check report status' }, { status: 500 });
  }
}

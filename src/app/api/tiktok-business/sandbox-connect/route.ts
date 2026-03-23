import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

/**
 * POST /api/tiktok-business/sandbox-connect
 * Saves a manually-generated sandbox access token as a TikTok Business connection.
 * Body: { workspaceId, accessToken, advertiserId, accountName? }
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { workspaceId, accessToken, advertiserId, accountName } = await req.json();

  if (!workspaceId || !accessToken || !advertiserId) {
    return NextResponse.json(
      { error: 'workspaceId, accessToken, and advertiserId are required' },
      { status: 400 }
    );
  }

  // Verify workspace belongs to current user
  const workspace = await (prisma.workspace as any).findFirst({
    where: {
      id: workspaceId,
      members: { some: { userId: session.user.id } },
    },
  });
  if (!workspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
  }

  const conn = await (prisma.connection as any).create({
    data: {
      workspaceId,
      name: accountName || `TikTok Ads Sandbox (${advertiserId})`,
      type: 'source',
      provider: 'tiktok_business',
      status: 'connected',
      credentials: JSON.stringify({
        accessToken,
        advertiserIds: [advertiserId],
        sandbox: true,
        product: 'tiktok_business',
      }),
    },
  });

  return NextResponse.json({ id: conn.id, name: conn.name });
}

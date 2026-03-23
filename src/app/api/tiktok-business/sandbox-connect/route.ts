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

  if (!accessToken || !advertiserId) {
    return NextResponse.json(
      { error: 'accessToken and advertiserId are required' },
      { status: 400 }
    );
  }

  // Use provided workspaceId, or auto-pick the first workspace for this user
  const workspace = await (prisma.workspace as any).findFirst({
    where: {
      members: { some: { userId: session.user.id } },
      ...(workspaceId ? { id: workspaceId } : {}),
    },
    orderBy: { createdAt: 'asc' },
  });
  if (!workspace) {
    return NextResponse.json({ error: 'No workspace found for this account' }, { status: 404 });
  }

  const conn = await (prisma.connection as any).create({
    data: {
      workspaceId: workspace.id,
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

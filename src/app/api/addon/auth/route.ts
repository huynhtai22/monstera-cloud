import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

async function verifyGoogleIdToken(idToken: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.email || data.email_verified !== 'true') return null;
    if (data.exp && Number(data.exp) * 1000 < Date.now()) return null;
    return data.email as string;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { idToken } = await req.json();
    if (!idToken || typeof idToken !== 'string') {
      return NextResponse.json({ error: 'Missing idToken' }, { status: 400 });
    }

    const email = await verifyGoogleIdToken(idToken);
    if (!email) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return NextResponse.json(
        { error: 'No Monstera account found. Sign up at monsteracloud.com', code: 'NO_ACCOUNT' },
        { status: 404 }
      );
    }

    const workspace = await prisma.workspace.findFirst({
      where: {
        OR: [
          { ownerId: user.id },
          { members: { some: { userId: user.id } } },
        ],
      },
      select: { id: true, name: true },
    });

    if (!workspace) {
      return NextResponse.json({ error: 'No workspace found', code: 'NO_WORKSPACE' }, { status: 404 });
    }

    return NextResponse.json({
      email: user.email,
      name: user.name,
      plan: user.plan ?? 'free',
      workspaceId: workspace.id,
      workspaceName: workspace.name,
    });
  } catch (error) {
    console.error('[ADDON_AUTH]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

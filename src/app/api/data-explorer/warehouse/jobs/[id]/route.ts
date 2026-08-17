import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAuthSession } from "@/lib/auth-session";
import { getImportJob } from "@/lib/warehouse-import-job";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Job ID required" }, { status: 400 });
  }

  const record = await prisma.warehouseImportJob.findUnique({
    where: { id },
    select: { workspaceId: true },
  });

  if (!record) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  try {
    await requireWorkspaceAccess({
      userId: session.user.id,
      workspaceId: record.workspaceId,
      minimumRole: "viewer",
      operation: "view_warehouse_import_job",
    });
  } catch (err) {
    const rbacRes = toRbacResponse(err);
    if (rbacRes) return rbacRes;
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const job = await getImportJob(id, record.workspaceId);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json(job);
}

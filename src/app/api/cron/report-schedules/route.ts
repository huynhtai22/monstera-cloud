import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/request-auth";

export async function GET(request: Request) {
  const denied = requireCronSecret(request);
  if (denied) return denied;
  return NextResponse.json({ error: "Scheduled reports are unavailable during the agency pilot" }, { status: 410 });
}

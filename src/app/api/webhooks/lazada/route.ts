import { NextResponse } from "next/server";

function unavailable() {
  return NextResponse.json({ error: "Lazada is not enabled during the agency pilot" }, { status: 410 });
}

export const GET = unavailable;
export const POST = unavailable;

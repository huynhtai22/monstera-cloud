import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ error: "API keys cannot be revealed" }, { status: 410 });
}

import { NextResponse } from "next/server";

/** API keys are non-recoverable and are returned only once at creation time. */
export async function POST() {
  return NextResponse.json(
    { error: "API keys cannot be revealed. Revoke this key and create a replacement." },
    { status: 410 },
  );
}

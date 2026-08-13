import { NextResponse } from "next/server";

/** Async exports are disabled until a monitored worker is deployed. */
export async function POST() {
  return NextResponse.json(
    { error: "Asynchronous exports are not available during the pilot" },
    { status: 503 },
  );
}

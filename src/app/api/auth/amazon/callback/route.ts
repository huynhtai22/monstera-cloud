import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json(
    { error: "This legacy OAuth endpoint is disabled. Start the connection from Sources." },
    { status: 410 },
  );
}

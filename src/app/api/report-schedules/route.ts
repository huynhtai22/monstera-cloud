import { NextResponse } from "next/server";

function unavailable() {
  return NextResponse.json(
    {
      error: "Scheduled destination pushes are not available during the agency pilot.",
      code: "PILOT_FEATURE_DISABLED",
    },
    { status: 410 },
  );
}

export const GET = unavailable;
export const POST = unavailable;
export const PATCH = unavailable;
export const DELETE = unavailable;

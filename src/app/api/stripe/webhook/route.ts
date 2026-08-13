import { NextResponse } from "next/server";

/** Stripe is not a supported billing provider for the agency pilot. */
export async function POST() {
  return NextResponse.json({ error: "Not available" }, { status: 404 });
}

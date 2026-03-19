import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function GET() {
    try {
        const session = await getServerSession(authOptions);

        if (!session || !session.user) {
            return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
                status: 401,
            });
        }

        // Return the current authenticated user's profile
        return NextResponse.json({
            user: session.user
        });
    } catch (error) {
        console.error("Error fetching user profile:", error);
        return new NextResponse(
            JSON.stringify({ error: "Failed to fetch user profile" }),
            { status: 500 }
        );
    }
}

import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { FREE_INTERACTION_LIMIT } from "@/lib/constants";
import { getProfile } from "@/lib/services/profile";

export async function GET() {
  try {
    const auth = await getAuthUser();
    if (!auth.ok) return auth.response;

    const { plan, used } = await getProfile(auth.userId);

    return NextResponse.json({
      plan,
      used,
      limit: plan === "free" ? FREE_INTERACTION_LIMIT : null,
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

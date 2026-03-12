import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncUserProfile } from "@/lib/services/profile";

export async function GET() {
  try {
    const auth = await getAuthUser();
    if (!auth.ok) return auth.response;

    const {
      data: { user },
    } = await auth.supabase.auth.getUser();

    return NextResponse.json({
      email: user?.email ?? "",
      name: user?.user_metadata?.full_name ?? user?.email?.split("@")[0] ?? "",
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST() {
  try {
    const auth = await getAuthUser();
    if (!auth.ok) return auth.response;

    const {
      data: { user },
    } = await auth.supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = createAdminClient();
    await syncUserProfile(admin, user);

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

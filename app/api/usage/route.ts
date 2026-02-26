import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const FREE_LIMIT = 5;

export async function GET() {
  const auth = await getAuthUser();
  if (!auth.ok) return auth.response;

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("plan, interactions_used")
    .eq("id", auth.userId)
    .single();

  const plan = profile?.plan ?? "free";
  const used = profile?.interactions_used ?? 0;

  return NextResponse.json({
    plan,
    used,
    limit: plan === "free" ? FREE_LIMIT : null,
  });
}

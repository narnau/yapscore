import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const auth = await getAuthUser();
  if (!auth.ok) return auth.response;

  const { data: { user } } = await auth.supabase.auth.getUser();

  return NextResponse.json({
    email: user?.email ?? "",
    name: user?.user_metadata?.full_name ?? user?.email?.split("@")[0] ?? "",
  });
}

export async function POST() {
  const auth = await getAuthUser();
  if (!auth.ok) return auth.response;

  const { data: { user } } = await auth.supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  await admin.from("profiles").upsert(
    {
      id: user.id,
      email: user.email,
      name: user.user_metadata?.full_name ?? user.email?.split("@")[0] ?? "",
      avatar_url: user.user_metadata?.avatar_url ?? null,
    },
    { onConflict: "id" }
  );

  return NextResponse.json({ ok: true });
}

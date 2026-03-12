import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import SettingsClient from "@/components/settings/SettingsClient";

export const metadata: Metadata = {
  title: "Settings — YapScore",
};

const FREE_LIMIT = 5;

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const admin = createAdminClient();

  // Fetch profile, usage, and API keys in parallel
  const [profileResult, keysResult] = await Promise.all([
    admin
      .from("profiles")
      .select("plan, interactions_used")
      .eq("id", user.id)
      .single(),
    admin
      .from("api_keys")
      .select("id, name, key_prefix, created_at, last_used_at, revoked_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
  ]);

  const plan = profileResult.data?.plan ?? "free";
  const used = profileResult.data?.interactions_used ?? 0;

  const userData = {
    email: user.email ?? "",
    name: user.user_metadata?.full_name ?? user.email?.split("@")[0] ?? "",
  };

  const usageData = {
    plan: plan as "free" | "pro",
    used,
    limit: plan === "free" ? FREE_LIMIT : null,
  };

  const keysData = keysResult.data ?? [];

  return (
    <SettingsClient
      initialUser={userData}
      initialUsage={usageData}
      initialKeys={keysData}
    />
  );
}

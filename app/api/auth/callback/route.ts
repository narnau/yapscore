import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncUserProfile } from "@/lib/services/profile";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next") ?? "/editor";
  // Prevent open redirect — only allow relative paths within our app
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/editor";

  try {
    if (code) {
      const supabase = await createClient();
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);

      if (!error && data.user) {
        // Upsert profile row
        const admin = createAdminClient();
        await syncUserProfile(admin, data.user);

        return NextResponse.redirect(`${origin}${next}`);
      }
    }
  } catch {
    // Fall through to error redirect
  }

  // Auth failed — redirect to login with error
  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}

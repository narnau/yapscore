import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    // Sign-out best-effort — redirect to home regardless
  }
  return NextResponse.redirect(new URL("/", (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").trim()));
}

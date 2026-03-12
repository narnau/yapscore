import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { getProfile } from "@/lib/services/profile";
import { deleteUserAccount } from "@/lib/services/account";

export async function DELETE() {
  try {
    const auth = await getAuthUser();
    if (!auth.ok) return auth.response;

    const { stripeCustomerId } = await getProfile(auth.userId);

    const result = await deleteUserAccount(auth.userId, stripeCustomerId);

    if (!result.ok) {
      console.error("[account] partial deletion errors:", result.errors);
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

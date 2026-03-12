import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";

/**
 * Delete a user account and all associated data.
 *
 * Steps (order matters — cancel billing before deleting data):
 * 1. Cancel active Stripe subscriptions
 * 2. Delete user files
 * 3. Delete API keys
 * 4. Delete profile row
 * 5. Delete Supabase auth user
 *
 * Collects errors from each step so a partial failure doesn't
 * prevent the remaining cleanup from running.
 */
export async function deleteUserAccount(
  userId: string,
  stripeCustomerId?: string | null
): Promise<{ ok: boolean; errors: string[] }> {
  const admin = createAdminClient();
  const errors: string[] = [];

  // 1. Cancel Stripe subscriptions
  if (stripeCustomerId) {
    try {
      const subscriptions = await stripe.subscriptions.list({
        customer: stripeCustomerId,
        status: "active",
      });
      for (const sub of subscriptions.data) {
        await stripe.subscriptions.cancel(sub.id);
      }
    } catch (err) {
      errors.push(`Stripe cancellation failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 2. Delete all user files
  try {
    await admin.from("files").delete().eq("user_id", userId);
  } catch (err) {
    errors.push(`Files deletion failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3. Delete all API keys
  try {
    await admin.from("api_keys").delete().eq("user_id", userId);
  } catch (err) {
    errors.push(`API keys deletion failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 4. Delete profile
  try {
    await admin.from("profiles").delete().eq("id", userId);
  } catch (err) {
    errors.push(`Profile deletion failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 5. Delete Supabase auth user
  try {
    await admin.auth.admin.deleteUser(userId);
  } catch (err) {
    errors.push(`Auth user deletion failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { ok: errors.length === 0, errors };
}

"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { PostHogProvider } from "posthog-js/react";
import { initPostHog, identifyUser, resetUser, posthog } from "@/lib/posthog";
import { createBrowserClient } from "@supabase/ssr";

function PostHogPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (pathname && posthog?.capture) {
      let url = window.origin + pathname;
      if (searchParams?.toString()) url += "?" + searchParams.toString();
      posthog.capture("$pageview", { $current_url: url });
    }
  }, [pathname, searchParams]);

  return null;
}

function SupabaseIdentify() {
  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        identifyUser(session.user.id, session.user.email);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        identifyUser(session.user.id, session.user.email);
      } else {
        resetUser();
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return null;
}

export default function PHProvider({ children }: { children: React.ReactNode }) {
  // Initialize synchronously so posthog is ready before any child effects fire.
  // isProduction already guards against SSR (typeof window check) and dev.
  initPostHog();

  if (process.env.NODE_ENV !== "production") {
    return <>{children}</>;
  }

  return (
    <PostHogProvider client={posthog}>
      <PostHogPageView />
      <SupabaseIdentify />
      {children}
    </PostHogProvider>
  );
}

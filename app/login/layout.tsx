import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Log In — YapScore",
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

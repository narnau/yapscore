import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "YapScore",
  description: "AI-powered music score editor",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full bg-gray-950 text-gray-100" suppressHydrationWarning>{children}</body>
    </html>
  );
}

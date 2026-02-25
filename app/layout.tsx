import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "score-ai",
  description: "AI-powered MuseScore editor",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full bg-gray-950 text-gray-100">{children}</body>
    </html>
  );
}

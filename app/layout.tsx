import type { Metadata } from "next";
import { Suspense } from "react";
import PHProvider from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "YapScore",
  description: "AI-powered music score editor",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full bg-gray-950 text-gray-100" suppressHydrationWarning>
        <Suspense>
          <PHProvider>{children}</PHProvider>
        </Suspense>
      </body>
    </html>
  );
}

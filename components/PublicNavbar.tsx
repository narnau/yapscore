"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Logo from "@/components/Logo";

const NAV_LINKS = [
  { href: "/docs",       label: "Docs" },
  { href: "/developers", label: "Developers" },
];

export default function PublicNavbar() {
  const pathname = usePathname();

  return (
    <nav className="fixed top-0 w-full z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="text-xl font-bold text-gray-900 tracking-tight flex items-center">
          <Logo size={24} className="text-brand-primary mr-1.5" />Yap<span className="text-brand-primary">Score</span>
        </Link>
        <div className="flex items-center gap-6">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`text-sm transition ${
                pathname === href
                  ? "text-brand-primary font-medium"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              {label}
            </Link>
          ))}
          <Link
            href="/login"
            className="text-sm px-5 py-2 bg-brand-primary hover:bg-brand-primary/90 text-white rounded-lg font-medium transition shadow-sm"
          >
            Sign In
          </Link>
        </div>
      </div>
    </nav>
  );
}

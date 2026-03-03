"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Logo from "@/components/Logo";

const NAV_LINKS = [
  { href: "/docs",       label: "Docs" },
  { href: "/developers", label: "Developers" },
];

export default function PublicNavbar({ loggedIn = false }: { loggedIn?: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <nav className="fixed top-0 w-full z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="text-xl font-bold text-gray-900 tracking-tight flex items-center">
          <Logo size={24} className="text-brand-primary mr-1.5" />Yap<span className="text-brand-primary">Score</span><span className="ml-2 text-[10px] font-semibold tracking-wide uppercase px-1.5 rounded-full bg-brand-accent/15 border border-brand-accent/30 text-amber-700">Beta</span>
        </Link>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-6">
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
          {loggedIn ? (
            <Link
              href="/editor"
              className="text-sm px-5 py-2 bg-brand-primary hover:bg-brand-primary/90 text-white rounded-lg font-medium transition shadow-sm"
            >
              Go to Editor
            </Link>
          ) : (
            <Link
              href="/login"
              className="text-sm px-5 py-2 bg-brand-primary hover:bg-brand-primary/90 text-white rounded-lg font-medium transition shadow-sm"
            >
              Sign In
            </Link>
          )}
        </div>

        {/* Mobile hamburger */}
        <button
          className="md:hidden p-2 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition"
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle menu"
        >
          {open ? (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path fillRule="evenodd" d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75ZM2 10a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 10Zm0 5.25a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile dropdown */}
      {open && (
        <div className="md:hidden bg-white border-t border-gray-100 px-6 py-4 flex flex-col gap-1">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className={`py-2.5 text-sm font-medium transition ${
                pathname === href ? "text-brand-primary" : "text-gray-700 hover:text-gray-900"
              }`}
            >
              {label}
            </Link>
          ))}
          <div className="pt-3 border-t border-gray-100 mt-1">
            {loggedIn ? (
              <Link
                href="/editor"
                onClick={() => setOpen(false)}
                className="block text-center text-sm px-5 py-2.5 bg-brand-primary hover:bg-brand-primary/90 text-white rounded-lg font-medium transition shadow-sm"
              >
                Go to Editor
              </Link>
            ) : (
              <Link
                href="/login"
                onClick={() => setOpen(false)}
                className="block text-center text-sm px-5 py-2.5 bg-brand-primary hover:bg-brand-primary/90 text-white rounded-lg font-medium transition shadow-sm"
              >
                Sign In
              </Link>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}

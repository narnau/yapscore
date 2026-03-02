import Link from "next/link";
import PublicNavbar from "@/components/PublicNavbar";
import { createClient } from "@/lib/supabase/server";

type EntryGroup = {
  label: "Added" | "Improved" | "Fixed";
  items: string[];
};

type Release = {
  version: string;
  date: string;
  summary?: string;
  groups: EntryGroup[];
};

const RELEASES: Release[] = [
  {
    version: "1.1.0",
    date: "March 2026",
    summary: "Inline editing controls, expanded notation tools, and security hardening.",
    groups: [
      {
        label: "Added",
        items: [
          "Inline tempo editor — click ♩ = in the score bar to change BPM directly, no chat needed",
          "Slurs, lyrics, fermata, ottava brackets, and pedal markings via chat",
          "Arpeggio, tremolo, glissando, and breath marks",
          "Score metadata editing (title, subtitle, composer, lyricist, copyright)",
          "Navigation marks: segno, coda, D.C., D.S., fine, to coda",
        ],
      },
      {
        label: "Fixed",
        items: [
          "MIDI player failing to load soundfonts due to Content Security Policy",
          "\"Clear left hand\" incorrectly wiping both staves — now only clears the targeted staff",
          "Adding chord symbols to non-existent measures no longer silently succeeds",
        ],
      },
      {
        label: "Improved",
        items: [
          "Rate limiting on AI requests (5 per 10 seconds)",
          "File upload validation — type and size limits enforced on all endpoints",
          "Server errors no longer leak internal details to the client",
          "Content Security Policy header added across all pages",
        ],
      },
    ],
  },
  {
    version: "1.0.0",
    date: "February 2026",
    summary: "Initial launch of YapScore.",
    groups: [
      {
        label: "Added",
        items: [
          "Upload .mscz or .musicxml files and edit them with natural language",
          "Generate scores from scratch — \"Write a 12-bar blues in Bb for piano\"",
          "MIDI playback with General MIDI soundfonts",
          "Click measures to target edits to a specific range",
          "Version history with undo / redo (up to 30 states)",
          "Sing a melody to transcribe it into the score",
          "Jazz swing toggle for playback",
          "Download edits as .musicxml for use in MuseScore, Finale, Sibelius, Dorico",
          "Google OAuth sign-in",
          "Free tier (5 AI interactions) and Pro plan (unlimited)",
        ],
      },
    ],
  },
];

const GROUP_STYLES: Record<EntryGroup["label"], { dot: string; text: string; bg: string }> = {
  Added:    { dot: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50 border-emerald-100" },
  Improved: { dot: "bg-blue-500",    text: "text-blue-700",    bg: "bg-blue-50 border-blue-100" },
  Fixed:    { dot: "bg-amber-500",   text: "text-amber-700",   bg: "bg-amber-50 border-amber-100" },
};

export default async function ChangelogPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <PublicNavbar loggedIn={!!user} />

      <div className="pt-28 pb-20 px-6">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight">Changelog</h1>
          <p className="mt-3 text-lg text-brand-secondary">
            What&apos;s new in YapScore, version by version.
          </p>

          <div className="mt-12 space-y-12">
            {RELEASES.map((release) => (
              <div key={release.version} className="relative pl-6 border-l-2 border-gray-200">
                {/* Version dot */}
                <div className="absolute -left-[9px] top-1.5 w-4 h-4 rounded-full bg-brand-primary border-2 border-white shadow-sm" />

                {/* Header */}
                <div className="flex flex-wrap items-baseline gap-3 mb-1">
                  <span className="text-lg font-bold text-gray-900">v{release.version}</span>
                  <span className="text-sm text-brand-secondary">{release.date}</span>
                </div>
                {release.summary && (
                  <p className="text-sm text-brand-secondary mb-5">{release.summary}</p>
                )}

                {/* Groups */}
                <div className="space-y-4">
                  {release.groups.map((group) => {
                    const s = GROUP_STYLES[group.label];
                    return (
                      <div key={group.label}>
                        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-full border ${s.bg} ${s.text} mb-2`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                          {group.label}
                        </span>
                        <ul className="space-y-1.5">
                          {group.items.map((item, i) => (
                            <li key={i} className="flex gap-2 text-sm text-gray-700">
                              <span className="mt-1.5 w-1 h-1 rounded-full bg-gray-300 shrink-0" />
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <footer className="py-10 px-6 border-t border-gray-200 bg-white">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-sm text-brand-secondary">
            &copy; {new Date().getFullYear()} YapScore. All rights reserved.
          </div>
          <div className="flex items-center gap-6 text-sm text-brand-secondary">
            <Link href="/" className="hover:text-gray-900 transition">Home</Link>
            <Link href="/docs" className="hover:text-gray-900 transition">Docs</Link>
            <Link href="/login" className="hover:text-gray-900 transition">Sign In</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

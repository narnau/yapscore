import type { Metadata } from "next";
import Link from "next/link";
import PublicNavbar from "@/components/layout/PublicNavbar";
import { createClient } from "@/lib/supabase/server";
import { detectCurrency } from "@/lib/stripe/currency";

export const metadata: Metadata = {
  title: "Documentation — YapScore",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl p-8 border border-gray-100 shadow-sm">
      <h2 className="text-xl font-bold text-gray-900 mb-4">{title}</h2>
      <div className="text-brand-secondary leading-relaxed space-y-3">{children}</div>
    </section>
  );
}

export default async function DocsPage() {
  const [supabase, currency] = await Promise.all([createClient(), detectCurrency()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <PublicNavbar loggedIn={!!user} />

      <div className="pt-28 pb-20 px-6">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight">Documentation</h1>
          <p className="mt-3 text-lg text-brand-secondary">Everything you need to know to get started with YapScore.</p>

          <div className="mt-12 space-y-6">
            <Section title="Getting Started">
              <p>You can start in two ways:</p>
              <ul className="list-disc list-inside space-y-1.5 ml-1">
                <li>
                  <strong>Upload a file</strong> — Drop a{" "}
                  <code className="text-brand-primary bg-brand-primary/5 px-1.5 py-0.5 rounded">.musicxml</code> or{" "}
                  <code className="text-brand-primary bg-brand-primary/5 px-1.5 py-0.5 rounded">.mscz</code> file into
                  the editor
                </li>
                <li>
                  <strong>Create from scratch</strong> — Ask the AI to generate a score for you (e.g., &ldquo;Write a
                  12-bar blues in Bb for piano&rdquo;)
                </li>
              </ul>
              <p>Then simply describe your edits in plain language.</p>
            </Section>

            <Section title="Editing Scores">
              <ul className="list-disc list-inside space-y-1.5 ml-1">
                <li>Click measures in the score to select them for targeted edits</li>
                <li>
                  Hold{" "}
                  <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-200 rounded text-xs font-mono">
                    Shift
                  </kbd>{" "}
                  or{" "}
                  <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-200 rounded text-xs font-mono">Cmd</kbd>{" "}
                  to select multiple measures
                </li>
                <li>
                  Type instructions like &ldquo;transpose up a major third&rdquo; or &ldquo;change the tempo&rdquo;
                </li>
                <li>
                  Use{" "}
                  <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-200 rounded text-xs font-mono">
                    Ctrl+Z
                  </kbd>{" "}
                  /{" "}
                  <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-200 rounded text-xs font-mono">
                    Ctrl+Y
                  </kbd>{" "}
                  to undo/redo changes
                </li>
              </ul>
            </Section>

            <Section title="Direct Editing">
              <p>
                Click a note or measure in the score to select it, then use the toolbar buttons or keyboard shortcuts.
              </p>

              <p className="font-semibold text-gray-800 mt-4">Note editing</p>
              <table className="w-full text-sm border-collapse mt-2">
                <tbody>
                  {[
                    [["↑", "↓"], "Move note up / down one semitone"],
                    [["Ctrl+↑", "Ctrl+↓"], "Move note up / down one octave"],
                    [["Delete", "Backspace"], "Replace note with a rest"],
                    [
                      ["1", "2", "3", "4", "5", "6", "7"],
                      "Change duration: 1=64th, 2=32nd, 3=16th, 4=eighth, 5=quarter, 6=half, 7=whole",
                    ],
                  ].map(([keys, desc], i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="py-1.5 pr-4 align-top whitespace-nowrap">
                        {(keys as string[]).map((k) => (
                          <kbd
                            key={k}
                            className="mr-1 px-1.5 py-0.5 bg-gray-100 border border-gray-200 rounded text-xs font-mono"
                          >
                            {k}
                          </kbd>
                        ))}
                      </td>
                      <td className="py-1.5 text-brand-secondary">{desc as string}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <p className="font-semibold text-gray-800 mt-4">Measure editing</p>
              <table className="w-full text-sm border-collapse mt-2">
                <tbody>
                  {[
                    [["Ctrl+C"], "Copy selected measures"],
                    [["Ctrl+V"], "Paste onto selected measures"],
                    [["Ctrl+D"], "Duplicate selected measures (inserts after)"],
                  ].map(([keys, desc], i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="py-1.5 pr-4 align-top whitespace-nowrap">
                        {(keys as string[]).map((k) => (
                          <kbd
                            key={k}
                            className="mr-1 px-1.5 py-0.5 bg-gray-100 border border-gray-200 rounded text-xs font-mono"
                          >
                            {k}
                          </kbd>
                        ))}
                      </td>
                      <td className="py-1.5 text-brand-secondary">{desc as string}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>

            <Section title="Example Prompts">
              <p>Not sure what to say? Here are some ideas:</p>
              <div className="grid sm:grid-cols-2 gap-3 mt-3">
                {[
                  "Transpose the whole piece to G major",
                  "Add a forte at measure 12",
                  "Write a waltz intro in 3/4 time",
                  "Move the bass line down an octave",
                  "Add a crescendo from measure 4 to 8",
                  "Change the tempo to 120 bpm",
                ].map((prompt) => (
                  <div
                    key={prompt}
                    className="bg-gray-50 rounded-lg px-4 py-3 text-sm italic text-gray-700 border border-gray-100"
                  >
                    &ldquo;{prompt}&rdquo;
                  </div>
                ))}
              </div>
            </Section>

            <Section title="File Compatibility">
              <p>
                YapScore uses <strong>MusicXML</strong>, the universal standard for music notation. Your scores are
                compatible with:
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                {["MuseScore", "Finale", "Sibelius", "Dorico", "Noteflight", "Flat.io"].map((app) => (
                  <span
                    key={app}
                    className="px-3 py-1 bg-gray-50 border border-gray-200 rounded-full text-sm font-medium text-gray-700"
                  >
                    {app}
                  </span>
                ))}
              </div>
              <p className="mt-3">
                You can also upload{" "}
                <code className="text-brand-primary bg-brand-primary/5 px-1.5 py-0.5 rounded">.mscz</code> files
                directly — they&apos;re converted automatically.
              </p>
            </Section>

            <Section title="Score Library">
              <p>
                All your scores are saved to your personal library. Access them from the dashboard at any time, continue
                editing, or download updated versions.
              </p>
            </Section>

            <Section title="Plans & Pricing">
              <div className="grid sm:grid-cols-2 gap-4 mt-2">
                <div className="bg-gray-50 rounded-xl p-5 border border-gray-200">
                  <h3 className="font-bold text-gray-900">Free</h3>
                  <ul className="mt-3 space-y-1.5 text-sm">
                    <li>5 AI interactions</li>
                    <li>Upload or generate scores</li>
                    <li>MIDI playback</li>
                  </ul>
                </div>
                <div className="bg-brand-primary/5 rounded-xl p-5 border border-brand-primary/20">
                  <h3 className="font-bold text-gray-900">Pro — {currency.proFormatted}/month</h3>
                  <p className="text-xs text-brand-primary font-medium mt-1">3-day free trial included</p>
                  <ul className="mt-3 space-y-1.5 text-sm">
                    <li>Unlimited AI interactions</li>
                    <li>Priority processing</li>
                    <li>Full version history</li>
                  </ul>
                </div>
              </div>
            </Section>

            {/* Developer API teaser */}
            <div className="flex items-center justify-between px-6 py-4 bg-brand-primary/5 rounded-2xl border border-brand-primary/20">
              <div>
                <p className="text-sm font-medium text-gray-900">Building something with YapScore?</p>
                <p className="text-xs text-brand-secondary mt-0.5">
                  Generate and modify sheet music programmatically via REST API.
                </p>
              </div>
              <Link
                href="/developers"
                className="shrink-0 text-sm px-4 py-2 rounded-lg bg-brand-primary text-white font-medium hover:bg-brand-primary/90 transition shadow-sm"
              >
                API Reference →
              </Link>
            </div>
          </div>
        </div>
      </div>

      <footer className="py-10 px-6 border-t border-gray-200 bg-white">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-sm text-brand-secondary">
            &copy; {new Date().getFullYear()} YapScore. All rights reserved.
          </div>
          <div className="flex items-center gap-6 text-sm text-brand-secondary">
            <Link href="/" className="hover:text-gray-900 transition">
              Home
            </Link>
            <Link href="/login" className="hover:text-gray-900 transition">
              Sign In
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

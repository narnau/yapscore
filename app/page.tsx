import Link from "next/link";
import ScoreAnimation from "@/components/shared/ScoreAnimation";
import PublicNavbar from "@/components/layout/PublicNavbar";
import { createClient } from "@/lib/supabase/server";
import { detectCurrency, type Currency } from "@/lib/stripe/currency";

function Hero() {
  return (
    <section className="pt-28 pb-16 px-6 overflow-hidden">
      <div className="max-w-6xl mx-auto">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">

          {/* Left — copy */}
          <div className="text-center lg:text-left">
            <div className="inline-block mb-6 px-4 py-1.5 bg-brand-accent/15 border border-brand-accent/30 rounded-full">
              <span className="text-sm font-medium text-amber-700">
                Powered by AI — Edit scores in seconds
              </span>
            </div>
            <h1 className="text-5xl sm:text-6xl font-extrabold text-gray-900 tracking-tight leading-[1.1]">
              Craft music scores{" "}
              <span className="text-brand-primary">with your words</span>
            </h1>
            <p className="mt-6 text-lg text-brand-secondary leading-relaxed">
              Generate scores from scratch or upload an existing file. Describe what you want
              in plain language and let AI do the rest. No manual editing needed.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row items-center lg:justify-start justify-center gap-4">
              <Link
                href="/editor"
                className="w-full sm:w-auto px-8 py-4 bg-brand-primary hover:bg-brand-primary/90 text-white rounded-xl text-base font-semibold transition shadow-lg shadow-brand-primary/25 hover:shadow-brand-primary/40"
              >
                Start Editing — It&apos;s Free
              </Link>
              <Link
                href="/docs"
                className="w-full sm:w-auto px-8 py-4 bg-white hover:bg-gray-50 text-gray-700 rounded-xl text-base font-semibold transition border border-gray-200"
              >
                See How It Works
              </Link>
            </div>
            <p className="mt-4 text-sm text-brand-secondary text-center lg:text-left">
              No credit card required. 5 free AI edits to start.
            </p>
          </div>

          {/* Right — animated score demo */}
          <div className="flex justify-center lg:justify-end">
            <ScoreAnimation />
          </div>

        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      number: "1",
      title: "Upload or create from scratch",
      description: "Drop an existing MusicXML or .mscz file, or start fresh — just tell the AI what to compose.",
      icon: (
        <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
      ),
    },
    {
      number: "2",
      title: "Describe what you want",
      description: "Type in plain language: \"Transpose the melody up a fifth\", \"Add a crescendo in measures 4-8\", or \"Write a 12-bar blues in Bb.\"",
      icon: (
        <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      ),
    },
    {
      number: "3",
      title: "Preview, play & download",
      description: "See the rendered score instantly, listen with MIDI playback, and download as MusicXML — compatible with any notation app.",
      icon: (
        <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
      ),
    },
  ];

  return (
    <section className="py-20 px-6 bg-gray-50">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 text-center">
          Three steps. That&apos;s it.
        </h2>
        <p className="mt-4 text-lg text-brand-secondary text-center max-w-2xl mx-auto">
          No learning curve. No complex menus. Just tell the AI what you want.
        </p>
        <div className="mt-16 grid md:grid-cols-3 gap-8">
          {steps.map((step) => (
            <div key={step.number} className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100 hover:shadow-md transition">
              <div className="w-12 h-12 rounded-xl bg-brand-primary/10 text-brand-primary flex items-center justify-center mb-5">
                {step.icon}
              </div>
              <div className="text-xs font-bold text-brand-primary uppercase tracking-widest mb-2">
                Step {step.number}
              </div>
              <h3 className="text-xl font-bold text-gray-900">{step.title}</h3>
              <p className="mt-3 text-brand-secondary leading-relaxed">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Features() {
  const features = [
    {
      title: "Natural Language Editing",
      description: "Just describe what you want changed. Transpose, add dynamics, modify rhythms — all with plain English.",
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
      ),
    },
    {
      title: "Instant Preview",
      description: "See your changes rendered in real-time. Every edit updates the score instantly so you always know what you get.",
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
      ),
    },
    {
      title: "Select & Edit Measures",
      description: "Click on specific measures to edit just a section. The AI understands context and keeps everything else intact.",
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6z" />
        </svg>
      ),
    },
    {
      title: "Version History",
      description: "Every edit is saved. Browse previous versions and restore any earlier state of your score with one click.",
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      title: "Works with Any Notation App",
      description: "Import and export standard MusicXML. Compatible with MuseScore, Finale, Sibelius, Dorico, and more.",
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
    },
    {
      title: "MIDI Playback",
      description: "Listen to your score directly in the browser. Hear exactly how your edits sound before downloading.",
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
        </svg>
      ),
    },
  ];

  return (
    <section className="py-20 px-6">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 text-center">
          Everything you need to edit scores faster
        </h2>
        <p className="mt-4 text-lg text-brand-secondary text-center max-w-2xl mx-auto">
          Built for musicians, composers, and music students who want to spend less time clicking and more time creating.
        </p>
        <div className="mt-16 grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature) => (
            <div key={feature.title} className="p-6 rounded-2xl border border-gray-100 hover:border-brand-primary/20 hover:bg-brand-primary/[0.02] transition">
              <div className="w-10 h-10 rounded-lg bg-brand-primary/10 text-brand-primary flex items-center justify-center mb-4">
                {feature.icon}
              </div>
              <h3 className="text-lg font-bold text-gray-900">{feature.title}</h3>
              <p className="mt-2 text-brand-secondary leading-relaxed text-sm">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function UseCases() {
  const cases = [
    { prompt: "\"Write a 16-bar jazz waltz in Bb major for piano\"", tag: "Generate" },
    { prompt: "\"Transpose the whole piece from C major to G major\"", tag: "Transposition" },
    { prompt: "\"Add a forte marking at measure 12\"", tag: "Dynamics" },
    { prompt: "\"Change the time signature to 3/4\"", tag: "Time Signature" },
    { prompt: "\"Add a trill on the first note of measure 3\"", tag: "Ornaments" },
    { prompt: "\"Move the bass line down an octave\"", tag: "Octave Shift" },
  ];

  return (
    <section className="py-20 px-6 bg-gray-50">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 text-center">
          Just type what you want
        </h2>
        <p className="mt-4 text-lg text-brand-secondary text-center max-w-2xl mx-auto">
          Here are some things you can say to YapScore. It understands music.
        </p>
        <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {cases.map((c) => (
            <div key={c.tag} className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
              <span className="inline-block text-xs font-bold uppercase tracking-wider text-brand-primary mb-2">
                {c.tag}
              </span>
              <p className="text-gray-700 italic">{c.prompt}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Pricing({ currency }: { currency: Currency }) {
  return (
    <section className="py-20 px-6">
      <div className="max-w-4xl mx-auto text-center">
        <h2 className="text-3xl sm:text-4xl font-bold text-gray-900">
          Start for free
        </h2>
        <p className="mt-4 text-lg text-brand-secondary max-w-xl mx-auto">
          Try YapScore with 5 free AI edits. Upgrade when you need more.
        </p>
        <div className="mt-12 grid sm:grid-cols-2 gap-6 max-w-2xl mx-auto">
          {/* Free */}
          <div className="bg-white rounded-2xl p-8 border border-gray-200 text-left">
            <h3 className="text-lg font-bold text-gray-900">Free</h3>
            <div className="mt-3">
              <span className="text-4xl font-extrabold text-gray-900">{currency.freeFormatted}</span>
              <span className="text-brand-secondary ml-1">/month</span>
            </div>
            <ul className="mt-6 space-y-3 text-sm text-gray-700">
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-brand-primary flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                5 AI edits
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-brand-primary flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                Upload or generate scores
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-brand-primary flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                MIDI playback
              </li>
            </ul>
            <Link
              href="/editor"
              className="mt-8 block text-center py-3 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition"
            >
              Get Started
            </Link>
          </div>
          {/* Pro */}
          <div className="bg-white rounded-2xl p-8 border-2 border-brand-primary text-left relative">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-brand-accent text-xs font-bold rounded-full text-gray-900">
              MOST POPULAR
            </div>
            <h3 className="text-lg font-bold text-gray-900">Pro</h3>
            <div className="mt-3">
              <span className="text-4xl font-extrabold text-gray-900">{currency.proFormatted}</span>
              <span className="text-brand-secondary ml-1">/month</span>
            </div>
            <ul className="mt-6 space-y-3 text-sm text-gray-700">
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-brand-primary flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                Unlimited AI edits
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-brand-primary flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                Priority processing
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-brand-primary flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                Full version history
              </li>
            </ul>
            <Link
              href="/editor?plan=pro"
              className="mt-8 block text-center py-3 rounded-xl bg-brand-primary text-white text-sm font-semibold hover:bg-brand-primary/90 transition shadow-md shadow-brand-primary/20"
            >
              Try Pro Free for 3 Days
            </Link>
            <p className="mt-2 text-xs text-brand-secondary text-center">Cancel anytime. No charge until trial ends.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section className="py-20 px-6">
      <div className="max-w-4xl mx-auto">
        <div className="bg-gray-900 rounded-3xl p-10 sm:p-16 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white">
            Ready to edit scores <span className="text-brand-primary">the easy way</span>?
          </h2>
          <p className="mt-4 text-lg text-gray-400 max-w-xl mx-auto">
            Join musicians who are saving hours on score editing. Create your first score in seconds.
          </p>
          <Link
            href="/editor"
            className="mt-8 inline-block px-8 py-4 bg-brand-primary hover:bg-brand-primary/90 text-white rounded-xl text-base font-semibold transition shadow-lg shadow-brand-primary/30"
          >
            Start Editing for Free
          </Link>
        </div>
      </div>
    </section>
  );
}

function Contact() {
  return (
    <section className="py-20 px-6 bg-gray-50">
      <div className="max-w-2xl mx-auto text-center">
        <h2 className="text-3xl sm:text-4xl font-bold text-gray-900">
          Questions? Let&apos;s talk.
        </h2>
        <p className="mt-4 text-lg text-brand-secondary">
          Whether you have feedback, need help, or want to partner with us — we&apos;d love to hear from you.
        </p>
        <a
          href="mailto:hello@yapscore.com"
          className="mt-8 inline-flex items-center gap-2 px-8 py-4 bg-white hover:bg-gray-50 text-gray-900 rounded-xl text-base font-semibold transition border border-gray-200 shadow-sm"
        >
          <svg className="w-5 h-5 text-brand-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          hello@yapscore.com
        </a>
      </div>
    </section>
  );
}

function Footer({ loggedIn }: { loggedIn: boolean }) {
  return (
    <footer className="py-10 px-6 border-t border-gray-100">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="text-sm text-brand-secondary">
          &copy; {new Date().getFullYear()} YapScore. All rights reserved.
        </div>
        <div className="flex items-center gap-6 text-sm text-brand-secondary">
          <Link href="/docs" className="hover:text-gray-900 transition">Docs</Link>
{loggedIn ? (
            <Link href="/editor" className="hover:text-gray-900 transition">Editor</Link>
          ) : (
            <Link href="/login" className="hover:text-gray-900 transition">Sign In</Link>
          )}
        </div>
      </div>
    </footer>
  );
}

export default async function LandingPage() {
  const [supabase, currency] = await Promise.all([createClient(), detectCurrency()]);
  const { data: { user } } = await supabase.auth.getUser();
  const loggedIn = !!user;

  return (
    <main className="min-h-screen bg-white text-gray-900">
      <PublicNavbar loggedIn={loggedIn} />
      <Hero />
      <HowItWorks />
      <Features />
      <UseCases />
      <Pricing currency={currency} />
      <CTA />
      <Contact />
      <Footer loggedIn={loggedIn} />
    </main>
  );
}

import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6">
      <div className="max-w-lg text-center space-y-6">
        <h1 className="text-4xl font-bold tracking-tight">score-ai</h1>
        <p className="text-lg text-gray-400">
          Edit music scores with natural language. Upload a MuseScore file, describe your changes, and let AI do the rest.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Link
            href="/editor"
            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-sm font-medium transition"
          >
            Open Editor
          </Link>
          <Link
            href="/docs"
            className="px-6 py-3 bg-gray-800 hover:bg-gray-700 rounded-xl text-sm font-medium transition"
          >
            Documentation
          </Link>
        </div>
      </div>
    </main>
  );
}

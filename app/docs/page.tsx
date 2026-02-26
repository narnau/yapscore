import Link from "next/link";

export default function DocsPage() {
  return (
    <main className="min-h-screen p-8 max-w-2xl mx-auto">
      <div className="mb-6">
        <Link href="/" className="text-sm text-indigo-400 hover:text-indigo-300 transition">
          ← Home
        </Link>
      </div>

      <h1 className="text-2xl font-bold tracking-tight mb-6">Documentation</h1>

      <div className="space-y-6 text-sm text-gray-300 leading-relaxed">
        <section>
          <h2 className="text-lg font-semibold text-gray-100 mb-2">Getting Started</h2>
          <p>
            Upload a <code className="text-indigo-400">.mscz</code> or{" "}
            <code className="text-indigo-400">.musicxml</code> file, or ask the AI to create a score from scratch.
            Then use natural language to make edits.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-100 mb-2">Editing Scores</h2>
          <ul className="list-disc list-inside space-y-1">
            <li>Click measures in the score to select them for targeted edits</li>
            <li>Hold Shift or Cmd to select multiple measures</li>
            <li>Type instructions like &ldquo;transpose up a major third&rdquo; or &ldquo;add a drum part&rdquo;</li>
            <li>Use Ctrl+Z / Ctrl+Y to undo/redo changes</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-100 mb-2">Score Library</h2>
          <p>
            Save scores to your personal library for quick access. Upload .mscz files and load them
            into the editor at any time.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-100 mb-2">Plans</h2>
          <ul className="list-disc list-inside space-y-1">
            <li><strong>Free:</strong> 5 AI interactions per account</li>
            <li><strong>Pro:</strong> Unlimited AI interactions</li>
          </ul>
        </section>
      </div>
    </main>
  );
}

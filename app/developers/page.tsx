import Link from "next/link";
import PublicNavbar from "@/components/PublicNavbar";

// ─── Code block ──────────────────────────────────────────────────────────────

function Code({ children }: { children: string }) {
  return (
    <pre className="bg-gray-950 text-green-400 text-xs rounded-xl p-4 overflow-x-auto leading-relaxed font-mono whitespace-pre">
      {children}
    </pre>
  );
}

// ─── Inline code ─────────────────────────────────────────────────────────────

function Inline({ children }: { children: string }) {
  return (
    <code className="text-brand-primary bg-brand-primary/5 px-1.5 py-0.5 rounded text-sm font-mono">
      {children}
    </code>
  );
}

// ─── Section wrapper ─────────────────────────────────────────────────────────

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">{title}</h2>
      <div className="space-y-4 text-brand-secondary leading-relaxed">{children}</div>
    </section>
  );
}

// ─── Endpoint card ────────────────────────────────────────────────────────────

function Endpoint({
  method,
  path,
  description,
  request,
  response,
  note,
}: {
  method: string;
  path: string;
  description: string;
  request: string;
  response: string;
  note?: string;
}) {
  const methodColor =
    method === "POST" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700";

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100">
        <span className={`text-xs font-bold px-2 py-1 rounded ${methodColor}`}>{method}</span>
        <code className="text-sm font-mono text-gray-800">{path}</code>
      </div>
      <div className="px-6 py-5 space-y-5">
        <p className="text-brand-secondary">{description}</p>
        {note && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            {note}
          </p>
        )}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Request</p>
          <Code>{request}</Code>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Response</p>
          <Code>{response}</Code>
        </div>
      </div>
    </div>
  );
}

// ─── Sidebar nav ─────────────────────────────────────────────────────────────

const NAV = [
  { id: "overview",       label: "Overview" },
  { id: "authentication", label: "Authentication" },
  { id: "generate",       label: "POST /v1/generate" },
  { id: "modify",         label: "POST /v1/modify" },
  { id: "render",         label: "POST /v1/render" },
  { id: "errors",         label: "Errors" },
  { id: "typescript",     label: "TypeScript example" },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DevelopersPage() {
  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <PublicNavbar />

      <div className="pt-16">
        <div className="max-w-6xl mx-auto px-6 flex gap-10 py-14">

          {/* Sidebar */}
          <aside className="hidden lg:block w-52 shrink-0">
            <div className="sticky top-24 space-y-1">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-3 mb-3">
                API Reference
              </p>
              {NAV.map(({ id, label }) => (
                <a
                  key={id}
                  href={`#${id}`}
                  className="block text-sm px-3 py-1.5 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-white hover:shadow-sm transition"
                >
                  {label}
                </a>
              ))}
              <div className="pt-4 border-t border-gray-200 mt-4">
                <Link
                  href="/settings"
                  className="block text-sm px-3 py-2 rounded-lg bg-brand-primary text-white text-center font-medium hover:bg-brand-primary/90 transition"
                >
                  Get an API key →
                </Link>
              </div>
            </div>
          </aside>

          {/* Content */}
          <div className="flex-1 min-w-0 space-y-16">

            {/* Header */}
            <div>
              <span className="text-xs font-semibold text-brand-primary uppercase tracking-wider">
                Developer Docs
              </span>
              <h1 className="mt-2 text-4xl font-extrabold text-gray-900 tracking-tight">
                YapScore API
              </h1>
              <p className="mt-3 text-lg text-brand-secondary max-w-xl">
                Generate and modify sheet music programmatically with a simple REST API.
              </p>
              <div className="mt-5">
                <Link
                  href="/settings"
                  className="inline-flex items-center gap-2 text-sm px-5 py-2.5 rounded-lg bg-brand-primary text-white font-medium hover:bg-brand-primary/90 transition shadow-sm"
                >
                  Get your API key →
                </Link>
              </div>
            </div>

            {/* Overview */}
            <Section id="overview" title="Overview">
              <p>
                The YapScore API is a REST interface that accepts JSON and returns JSON (or SVG for the render endpoint).
                All endpoints live under <Inline>https://yapscore.ai/api/v1/</Inline>.
              </p>
              <div className="grid sm:grid-cols-3 gap-4 mt-2">
                {[
                  { endpoint: "POST /v1/generate", desc: "Create a score from a prompt" },
                  { endpoint: "POST /v1/modify",   desc: "Edit a score with instructions" },
                  { endpoint: "POST /v1/render",   desc: "Render MusicXML to SVG" },
                ].map(({ endpoint, desc }) => (
                  <div key={endpoint} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
                    <code className="text-xs font-mono text-brand-primary">{endpoint}</code>
                    <p className="text-sm text-brand-secondary mt-1">{desc}</p>
                  </div>
                ))}
              </div>
              <p className="mt-2">
                Generate and modify calls use your interaction quota (same as the editor). Render is free — no LLM involved.
              </p>
            </Section>

            {/* Authentication */}
            <Section id="authentication" title="Authentication">
              <p>
                Pass your API key in the <Inline>Authorization</Inline> header as a Bearer token.
                Keys start with <Inline>ys_</Inline>. You can create and revoke keys in your{" "}
                <Link href="/settings" className="text-brand-primary hover:underline">
                  Settings page
                </Link>.
              </p>
              <Code>{`Authorization: Bearer ys_<your-api-key>`}</Code>
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                Keep your API key secret. Do not expose it in client-side code or public repositories.
                If a key is compromised, revoke it from Settings immediately.
              </p>
            </Section>

            {/* Generate */}
            <Section id="generate" title="POST /v1/generate">
              <Endpoint
                method="POST"
                path="/api/v1/generate"
                description="Generate a new score from a plain-language prompt. Returns a MusicXML string and an optional message from the AI."
                request={`curl -X POST https://yapscore.ai/api/v1/generate \\
  -H "Authorization: Bearer ys_..." \\
  -H "Content-Type: application/json" \\
  -d '{"prompt": "A 4-bar waltz in D minor for piano"}'`}
                response={`{
  "musicxml": "<?xml version=\\"1.0\\" ...>",
  "message": "Here is a 4-bar waltz in D minor."
}`}
              />
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Parameters</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b border-gray-100">
                      <th className="pb-2 font-medium w-32">Name</th>
                      <th className="pb-2 font-medium w-20">Type</th>
                      <th className="pb-2 font-medium">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    <tr>
                      <td className="py-2 font-mono text-xs text-brand-primary">prompt</td>
                      <td className="py-2 text-gray-500">string</td>
                      <td className="py-2 text-brand-secondary">Required. Natural language description of the score to create.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Section>

            {/* Modify */}
            <Section id="modify" title="POST /v1/modify">
              <Endpoint
                method="POST"
                path="/api/v1/modify"
                description="Edit an existing score with a natural language instruction. Returns the modified MusicXML."
                request={`curl -X POST https://yapscore.ai/api/v1/modify \\
  -H "Authorization: Bearer ys_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "musicxml": "<?xml version=\\"1.0\\" ...>",
    "prompt": "Transpose up a fifth and add a forte marking at measure 1"
  }'`}
                response={`{
  "musicxml": "<?xml version=\\"1.0\\" ...>"
}`}
              />
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Parameters</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b border-gray-100">
                      <th className="pb-2 font-medium w-32">Name</th>
                      <th className="pb-2 font-medium w-20">Type</th>
                      <th className="pb-2 font-medium">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    <tr>
                      <td className="py-2 font-mono text-xs text-brand-primary">musicxml</td>
                      <td className="py-2 text-gray-500">string</td>
                      <td className="py-2 text-brand-secondary">Required. The MusicXML string to modify.</td>
                    </tr>
                    <tr>
                      <td className="py-2 font-mono text-xs text-brand-primary">prompt</td>
                      <td className="py-2 text-gray-500">string</td>
                      <td className="py-2 text-brand-secondary">Required. Natural language edit instruction.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Section>

            {/* Render */}
            <Section id="render" title="POST /v1/render">
              <Endpoint
                method="POST"
                path="/api/v1/render"
                description="Render a MusicXML score to SVG. Returns image/svg+xml directly — not JSON."
                note="This endpoint does not count toward your interaction quota. Use it freely to preview scores."
                request={`# Save SVG to file
curl -X POST https://yapscore.ai/api/v1/render \\
  -H "Authorization: Bearer ys_..." \\
  -H "Content-Type: application/json" \\
  -d '{"musicxml": "<?xml version=\\"1.0\\" ...>", "page": 1}' \\
  -o score.svg`}
                response={`<!-- Returns SVG directly, Content-Type: image/svg+xml -->
<svg xmlns="http://www.w3.org/2000/svg" ...>
  ...
</svg>`}
              />
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Parameters</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b border-gray-100">
                      <th className="pb-2 font-medium w-32">Name</th>
                      <th className="pb-2 font-medium w-20">Type</th>
                      <th className="pb-2 font-medium">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    <tr>
                      <td className="py-2 font-mono text-xs text-brand-primary">musicxml</td>
                      <td className="py-2 text-gray-500">string</td>
                      <td className="py-2 text-brand-secondary">Required. The MusicXML string to render.</td>
                    </tr>
                    <tr>
                      <td className="py-2 font-mono text-xs text-brand-primary">page</td>
                      <td className="py-2 text-gray-500">number</td>
                      <td className="py-2 text-brand-secondary">Optional. Page number to render (default: 1).</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Section>

            {/* Errors */}
            <Section id="errors" title="Errors">
              <p>All error responses return JSON with an <Inline>error</Inline> field.</p>
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr className="text-left text-gray-500 border-b border-gray-100">
                      <th className="px-5 py-3 font-medium w-20">Status</th>
                      <th className="px-5 py-3 font-medium">Meaning</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {[
                      { code: "400", meaning: "Bad request — missing or invalid parameters." },
                      { code: "401", meaning: "Unauthorized — API key missing, invalid, or revoked." },
                      { code: "402", meaning: 'Usage limit reached. Upgrade to Pro for unlimited access. Response includes { "error": "limit_reached", "usage": { "used": 5, "limit": 5 } }.' },
                      { code: "500", meaning: "Internal server error — try again later." },
                    ].map(({ code, meaning }) => (
                      <tr key={code}>
                        <td className="px-5 py-3 font-mono text-xs font-bold text-gray-700">{code}</td>
                        <td className="px-5 py-3 text-brand-secondary">{meaning}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>

            {/* TypeScript */}
            <Section id="typescript" title="Example: TypeScript fetch">
              <p>A minimal end-to-end example: generate a score, modify it, and render it to SVG.</p>
              <Code>{`const BASE = "https://yapscore.ai/api/v1";
const KEY  = "ys_..."; // from Settings → API Keys

const headers = {
  "Authorization": \`Bearer \${KEY}\`,
  "Content-Type": "application/json",
};

// 1. Generate
const gen = await fetch(\`\${BASE}/generate\`, {
  method: "POST",
  headers,
  body: JSON.stringify({ prompt: "A 4-bar waltz in D minor" }),
});
const { musicxml } = await gen.json();

// 2. Modify
const mod = await fetch(\`\${BASE}/modify\`, {
  method: "POST",
  headers,
  body: JSON.stringify({ musicxml, prompt: "Add a forte at measure 1" }),
});
const { musicxml: modified } = await mod.json();

// 3. Render → SVG
const render = await fetch(\`\${BASE}/render\`, {
  method: "POST",
  headers,
  body: JSON.stringify({ musicxml: modified, page: 1 }),
});
const svg = await render.text(); // <svg ...>...</svg>`}</Code>
            </Section>

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

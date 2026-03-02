import { NextRequest, NextResponse } from "next/server";
import { getApiKeyUser } from "@/lib/apiKeyAuth";

// No usage counting — pure rendering, no LLM
export async function POST(req: NextRequest) {
  const auth = await getApiKeyUser(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const musicxml = typeof body.musicxml === "string" ? body.musicxml : null;
  const page = typeof body.page === "number" ? body.page : 1;

  if (!musicxml) {
    return NextResponse.json({ error: "musicxml is required" }, { status: 400 });
  }

  try {
    // Server-side Verovio (in serverExternalPackages — runs in Node, not browser)
    const { default: createVerovioModule } = await import("verovio/wasm");
    const { VerovioToolkit } = await import("verovio/esm");

    const VerovioModule = await createVerovioModule();
    const tk = new VerovioToolkit(VerovioModule);

    tk.setOptions({
      inputFrom: "musicxml",
      adjustPageHeight: false,
      pageWidth: 2100,
      pageHeight: 2970,
      scale: 40,
    });

    tk.loadData(musicxml);
    const totalPages = tk.getPageCount();
    const clampedPage = Math.max(1, Math.min(page, totalPages));
    const svg = tk.renderToSVG(clampedPage);

    return new NextResponse(svg, {
      status: 200,
      headers: { "Content-Type": "image/svg+xml" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[v1/render] error:", msg);
    return NextResponse.json({ error: "Render failed" }, { status: 500 });
  }
}

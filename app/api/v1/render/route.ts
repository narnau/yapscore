import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getApiKeyUser, checkApiAccess } from "@/lib/apiKeyAuth";
import { getVerovioToolkit } from "@/lib/verovio";

const renderSchema = z.object({
  musicxml: z.string().min(1, "musicxml is required"),
  page:     z.number().int().min(1).optional().default(1),
});

export async function POST(req: NextRequest) {
  const auth = await getApiKeyUser(req);
  if (!auth.ok) return auth.response;

  const access = await checkApiAccess(auth.userId);
  if (!access.ok) return access.response;

  const body = await req.json().catch(() => ({}));
  const parsed = renderSchema.safeParse(body);
  if (!parsed.success) {
    const firstError = parsed.error.errors[0]?.message ?? "Invalid request";
    return NextResponse.json({ error: firstError }, { status: 400 });
  }

  const { musicxml, page } = parsed.data;

  try {
    const tk = await getVerovioToolkit();

    tk.setOptions({
      inputFrom: "musicxml",
      adjustPageHeight: false,
      pageWidth: 2100,
      pageHeight: 2970,
      scale: 40,
    });

    tk.loadData(musicxml);
    const totalPages  = tk.getPageCount();
    const clampedPage = Math.max(1, Math.min(page, totalPages));
    const svg         = tk.renderToSVG(clampedPage);

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

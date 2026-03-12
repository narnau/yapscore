import type { VerovioToolkit as VerovioToolkitType } from "verovio/esm";

let toolkit: VerovioToolkitType | null = null;

export interface VerovioRenderOptions {
  inputFrom?: string;
  adjustPageHeight?: boolean;
  pageWidth?: number;
  pageHeight?: number;
  scale?: number;
}

const DEFAULT_OPTIONS: VerovioRenderOptions = {
  inputFrom: "musicxml",
  adjustPageHeight: false,
  pageWidth: 2100,
  pageHeight: 2970,
  scale: 40,
};

/**
 * Get or initialize a cached Verovio toolkit instance.
 * The WASM module is loaded once and reused across requests.
 */
export async function getVerovioToolkit(): Promise<VerovioToolkitType> {
  if (toolkit) return toolkit;

  const { default: createVerovioModule } = await import("verovio/wasm");
  const { VerovioToolkit } = await import("verovio/esm");

  const VerovioModule = await createVerovioModule();
  toolkit = new VerovioToolkit(VerovioModule);
  return toolkit;
}

/**
 * Render MusicXML to an array of SVG pages using Verovio.
 */
export function renderToSvg(
  tk: VerovioToolkitType,
  musicXml: string,
  options?: Partial<VerovioRenderOptions>,
): string[] {
  tk.setOptions({ ...DEFAULT_OPTIONS, ...options });
  tk.loadData(musicXml);

  const totalPages = tk.getPageCount();
  const pages: string[] = [];
  for (let i = 1; i <= totalPages; i++) {
    pages.push(tk.renderToSVG(i));
  }
  return pages;
}

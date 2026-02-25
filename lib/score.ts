import AdmZip from "adm-zip";
import path from "path";

export function unzipMscz(msczPath: string, destDir: string): string {
  const zip = new AdmZip(msczPath);
  zip.extractAllTo(destDir, true);

  const entry = zip.getEntries().find((e) => e.entryName.endsWith(".mscx"));
  if (!entry) throw new Error(`No .mscx file found in ${msczPath}`);
  return path.join(destDir, entry.entryName);
}

export function rezipMscz(srcDir: string, outputPath: string): void {
  const zip = new AdmZip();
  zip.addLocalFolder(srcDir);
  zip.writeZip(outputPath);
}

import { Buffer } from "node:buffer";
import unzipper from "unzipper";

export interface ExtractedCsv {
  name: string;
  content: string;
}

/**
 * Extract all CSV files contained in a ZIP buffer (multiple SF exports).
 * Non-CSV entries are ignored. Throws on a corrupt/invalid archive.
 */
export async function extractCsvsFromZip(buffer: Buffer): Promise<ExtractedCsv[]> {
  let directory;
  try {
    directory = await unzipper.Open.buffer(buffer);
  } catch (err) {
    throw new Error(
      `Archivio ZIP non valido: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const out: ExtractedCsv[] = [];
  for (const file of directory.files) {
    if (file.type !== "File") continue;
    if (!file.path.toLowerCase().endsWith(".csv")) continue;
    const content = await file.buffer();
    out.push({ name: file.path, content: content.toString("utf8") });
  }
  return out;
}

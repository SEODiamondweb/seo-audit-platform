import { describe, it, expect } from "vitest";
import { Buffer } from "node:buffer";
import { ingestFiles } from "@/lib/import/ingest";

const internal = `Address,Status Code,Indexability,Title 1,Title 1 Length
https://example.com/,200,Indexable,Home,4
https://example.com/about,200,Indexable,About,5`;

// A second export contributing different columns for the same URLs.
const meta = `Address,Meta Description 1,Word Count
https://example.com/,Welcome home,800
https://example.com/about,About us page,400`;

describe("ingestFiles", () => {
  it("merges multiple CSV exports by URL", async () => {
    const res = await ingestFiles({
      files: [
        { name: "internal_all.csv", buffer: Buffer.from(internal) },
        { name: "meta_description_all.csv", buffer: Buffer.from(meta) },
      ],
    });
    expect(res.urls).toHaveLength(2);
    const home = res.urls.find((u) => u.url === "https://example.com/")!;
    expect(home.title).toBe("Home");
    expect(home.metaDescription).toBe("Welcome home");
    expect(home.wordCount).toBe(800);
    expect(res.rowsImported).toBe(2);
  });

  it("handles unsupported and empty files gracefully", async () => {
    const res = await ingestFiles({
      files: [
        { name: "notes.txt", buffer: Buffer.from("hello") },
        { name: "empty.csv", buffer: Buffer.from("Address,Status Code\n") },
      ],
    });
    expect(res.urls).toHaveLength(0);
    expect(res.warnings.length).toBeGreaterThan(0);
  });

  it("reports an invalid ZIP without throwing", async () => {
    const res = await ingestFiles({
      files: [{ name: "broken.zip", buffer: Buffer.from("not a real zip") }],
    });
    expect(res.urls).toHaveLength(0);
    expect(res.warnings.join(" ")).toMatch(/ZIP|Errore/i);
  });
});

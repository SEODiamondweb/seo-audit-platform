import { describe, it, expect } from "vitest";
import { parseScreamingFrogCsv } from "@/lib/import/csv";

const CSV = `Address,Content Type,Status Code,Indexability,Title 1,Title 1 Length,Meta Description 1,Canonical Link Element 1,Word Count,Crawl Depth,Inlinks,Response Time
https://example.com/,text/html,200,Indexable,Home Page,9,A home page desc,https://example.com/,850,0,42,120
https://example.com/about,text/html,200,Indexable,,0,,https://example.com/about,150,1,3,90
https://example.com/old,text/html,301,Non-Indexable,Old,3,,,0,2,1,60`;

describe("parseScreamingFrogCsv", () => {
  it("parses rows and maps to canonical fields", () => {
    const parsed = parseScreamingFrogCsv(CSV);
    expect(parsed.rows).toHaveLength(3);
    const home = parsed.rows[0];
    expect(home.url).toBe("https://example.com/");
    expect(home.statusCode).toBe(200);
    expect(home.indexability).toBe("INDEXABLE");
    expect(home.wordCount).toBe(850);
    expect(home.responseTimeMs).toBe(120);
  });

  it("skips rows without a URL and reports counts", () => {
    const parsed = parseScreamingFrogCsv(`Address,Status Code\n,200\nhttps://a.com,200`);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rowsSkipped).toBe(1);
  });

  it("detects header even with a leading title line", () => {
    const withTitle = `"Internal - HTML"\n${CSV}`;
    const parsed = parseScreamingFrogCsv(withTitle);
    expect(parsed.rows.length).toBe(3);
  });
});

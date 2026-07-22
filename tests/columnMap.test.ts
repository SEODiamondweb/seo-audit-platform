import { describe, it, expect } from "vitest";
import { buildColumnMapping, coerceValue } from "@/lib/screamingfrog/columnMap";

describe("buildColumnMapping", () => {
  it("maps standard Screaming Frog headers to canonical keys", () => {
    const headers = ["Address", "Status Code", "Indexability", "Title 1", "Title 1 Length", "Meta Description 1"];
    const { mapping, unknown } = buildColumnMapping(headers);
    expect(mapping["Address"]).toBe("url");
    expect(mapping["Status Code"]).toBe("statusCode");
    expect(mapping["Title 1"]).toBe("title");
    expect(mapping["Title 1 Length"]).toBe("titleLength");
    expect(unknown).toHaveLength(0);
  });

  it("handles version aliases and reports unknown columns", () => {
    const headers = ["URL", "HTTP Status Code", "Some Custom Column"];
    const { mapping, unknown } = buildColumnMapping(headers);
    expect(mapping["URL"]).toBe("url");
    expect(mapping["HTTP Status Code"]).toBe("statusCode");
    expect(unknown).toContain("Some Custom Column");
  });

  it("is case and whitespace insensitive", () => {
    const { mapping } = buildColumnMapping(["  address  ", "STATUS CODE"]);
    expect(Object.values(mapping)).toContain("url");
    expect(Object.values(mapping)).toContain("statusCode");
  });
});

describe("coerceValue", () => {
  it("coerces ints, bools and indexability", () => {
    expect(coerceValue("int", "1,234")).toBe(1234);
    expect(coerceValue("int", "")).toBeUndefined();
    expect(coerceValue("bool", "Yes")).toBe(true);
    expect(coerceValue("bool", "no")).toBe(false);
    expect(coerceValue("indexability", "Non-Indexable")).toBe("NON_INDEXABLE");
    expect(coerceValue("indexability", "Indexable")).toBe("INDEXABLE");
  });
});

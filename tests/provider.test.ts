import { describe, it, expect } from "vitest";
import { ScreamingFrogProvider } from "@/lib/screamingfrog/provider";
import { defaultCrawlConfig } from "@/lib/screamingfrog/config";

describe("ScreamingFrogProvider", () => {
  it("reports unavailable when no CLI path is configured", () => {
    const p = new ScreamingFrogProvider("");
    expect(p.isAvailable()).toBe(false);
  });

  it("reports unavailable when the CLI path does not exist", () => {
    const p = new ScreamingFrogProvider("/nonexistent/screamingfrog");
    expect(p.isAvailable()).toBe(false);
  });

  it("builds headless CLI args from config without running anything", () => {
    const p = new ScreamingFrogProvider("/opt/sf/screamingfrog", "/tmp/exports");
    const args = p.buildArgs({
      jobId: "job1",
      domain: "https://example.com",
      config: { ...defaultCrawlConfig, crawlSubdomains: true },
    });
    expect(args).toContain("--crawl");
    expect(args).toContain("https://example.com");
    expect(args).toContain("--headless");
    expect(args).toContain("--crawl-subdomains");
    expect(args).toContain("--save-crawl");
    expect(args).toContain("--output-folder");
  });

  it("maps numeric/regex/robots config into a config overlay", () => {
    const p = new ScreamingFrogProvider("/opt/sf/screamingfrog");
    const overlay = p.buildConfigOverlay({
      ...defaultCrawlConfig,
      maxUrls: 5000,
      maxDepth: 4,
      respectRobots: false,
      jsRendering: true,
      userAgent: "Bot",
      includePatterns: ["/blog/.*"],
    });
    expect(overlay["spider.limit.max.url"]).toBe(5000);
    expect(overlay["spider.limit.max.depth"]).toBe(4);
    expect(overlay["spider.robots.respect"]).toBe(false);
    expect(overlay["spider.rendering.js"]).toBe(true);
    expect(overlay["spider.user.agent"]).toBe("Bot");
    expect(overlay["spider.include"]).toEqual(["/blog/.*"]);
  });

  it("throws NOT_AVAILABLE when run() is called without a CLI", async () => {
    const p = new ScreamingFrogProvider("");
    await expect(
      p.run({ jobId: "j", domain: "https://example.com", config: defaultCrawlConfig }),
    ).rejects.toMatchObject({ kind: "NOT_AVAILABLE" });
  });
});

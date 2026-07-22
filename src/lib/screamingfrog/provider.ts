import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { env } from "../env";
import type { CrawlConfig } from "./config";

/**
 * Abstraction over a technical crawl engine. Application/queue code depends on
 * this interface only — never on CLI strings — so the engine can be swapped.
 */
export interface CrawlProvider {
  isAvailable(): boolean;
  run(input: RunInput, hooks?: RunHooks): Promise<RunResult>;
}

export interface RunInput {
  jobId: string;
  domain: string;
  config: CrawlConfig;
  /** Output folder for this job's exports. Defaults under SF_EXPORT_DIR. */
  outputDir?: string;
}

export interface RunHooks {
  onStatus?: (status: string, progress?: number, message?: string) => void | Promise<void>;
  /** Abort signal to support cooperative cancellation. */
  signal?: AbortSignal;
}

export interface RunResult {
  outputDir: string;
  exportedFiles: string[];
  code: number | null;
  timedOut: boolean;
}

export class ScreamingFrogError extends Error {
  constructor(
    message: string,
    readonly kind: "NOT_AVAILABLE" | "PROCESS_FAILED" | "TIMEOUT" | "NO_EXPORTS",
  ) {
    super(message);
    this.name = "ScreamingFrogError";
  }
}

/**
 * Adapter for Screaming Frog SEO Spider running headless via its CLI.
 * All paths and license concerns are resolved from the environment.
 */
export class ScreamingFrogProvider implements CrawlProvider {
  constructor(
    private readonly cliPath: string = env.SF_CLI_PATH,
    private readonly exportRoot: string = env.SF_EXPORT_DIR,
    private readonly defaultConfigPath: string = env.SF_DEFAULT_CONFIG,
    private readonly timeoutMs: number = env.SF_JOB_TIMEOUT_MS,
  ) {}

  /** True when a usable CLI executable is configured and present on disk. */
  isAvailable(): boolean {
    return Boolean(this.cliPath) && existsSync(this.cliPath);
  }

  /**
   * Build the CLI argument vector from a crawl configuration.
   * Pure and side-effect free → unit-testable without running SF.
   */
  buildArgs(input: RunInput): string[] {
    const { domain, config, outputDir } = input;
    const out = outputDir ?? this.outputDirFor(input.jobId);
    const args: string[] = ["--crawl", domain, "--headless", "--output-folder", out, "--overwrite"];

    // Custom config file wins over individual flags.
    const configPath = config.customConfigPath || this.defaultConfigPath;
    if (configPath) args.push("--config", configPath);

    if (config.crawlSubdomains) args.push("--crawl-subdomains");
    // Screaming Frog CLI overlays --save-crawl to persist the .seospider file.
    args.push("--save-crawl");

    // Requested export tabs / bulk exports (env-driven, with defaults).
    const tabs = env.SF_EXPORT_TABS || DEFAULT_EXPORT_TABS.join(",");
    const bulk = env.SF_BULK_EXPORTS || DEFAULT_BULK_EXPORTS.join(",");
    if (tabs) args.push("--export-tabs", tabs);
    if (bulk) args.push("--bulk-export", bulk);
    args.push("--export-format", "csv");

    // Sitemaps.
    if (config.crawlSitemap && config.sitemapUrls.length > 0) {
      args.push("--crawl-list", config.sitemapUrls.join(","));
    }

    // NOTE: numeric limits (max URLs, depth, speed), include/exclude regex,
    // robots handling, JS rendering and user-agent are configured inside SF's
    // .seospiderconfig. buildConfigOverlay() documents the intended values so a
    // config file can be generated; SF's CLI does not accept them all as flags.
    return args;
  }

  /**
   * The subset of config that must be materialised into a .seospiderconfig,
   * exposed for transparency/testing (SF has no CLI flag for these).
   */
  buildConfigOverlay(config: CrawlConfig): Record<string, unknown> {
    return {
      "spider.limit.max.url": config.maxUrls ?? null,
      "spider.limit.max.depth": config.maxDepth ?? null,
      "spider.include": config.includePatterns,
      "spider.exclude": config.excludePatterns,
      "spider.robots.respect": config.respectRobots,
      "spider.rendering.js": config.jsRendering,
      "spider.user.agent": config.userAgent ?? null,
      "spider.speed.max.uri.per.second": config.maxUrlsPerSecond ?? null,
      "spider.speed.max.threads": config.maxThreads ?? null,
    };
  }

  outputDirFor(jobId: string): string {
    return resolve(join(this.exportRoot, jobId));
  }

  async run(input: RunInput, hooks: RunHooks = {}): Promise<RunResult> {
    if (!this.isAvailable()) {
      throw new ScreamingFrogError(
        "Screaming Frog CLI non disponibile: configurare SF_CLI_PATH. Solo import manuale.",
        "NOT_AVAILABLE",
      );
    }

    const outputDir = input.outputDir ?? this.outputDirFor(input.jobId);
    await mkdir(outputDir, { recursive: true });

    const args = this.buildArgs({ ...input, outputDir });
    await hooks.onStatus?.("RUNNING", 5, "Avvio Screaming Frog headless");

    const result = await this.execProcess(this.cliPath, args, hooks);

    if (result.timedOut) {
      throw new ScreamingFrogError(
        `Timeout dopo ${this.timeoutMs}ms: processo terminato.`,
        "TIMEOUT",
      );
    }
    if (result.code !== 0) {
      throw new ScreamingFrogError(
        `Screaming Frog terminato con codice ${result.code}.`,
        "PROCESS_FAILED",
      );
    }

    await hooks.onStatus?.("EXPORTING", 80, "Individuazione export");
    const exportedFiles = await this.locateExports(outputDir);
    if (exportedFiles.length === 0) {
      throw new ScreamingFrogError(
        "Nessun file di export trovato: esportazioni mancanti.",
        "NO_EXPORTS",
      );
    }

    return { outputDir, exportedFiles, code: result.code, timedOut: false };
  }

  /** Find CSV exports produced by the crawl. */
  async locateExports(dir: string): Promise<string[]> {
    try {
      await access(dir);
    } catch {
      return [];
    }
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".csv"))
      .map((e) => join(dir, e.name));
  }

  private execProcess(
    cmd: string,
    args: string[],
    hooks: RunHooks,
  ): Promise<{ code: number | null; timedOut: boolean }> {
    return new Promise((resolvePromise) => {
      const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, this.timeoutMs);

      const onAbort = () => child.kill("SIGKILL");
      hooks.signal?.addEventListener("abort", onAbort);

      child.stdout.on("data", (buf: Buffer) => {
        const line = buf.toString();
        // SF prints progress lines; surface them coarsely.
        void hooks.onStatus?.("RUNNING", undefined, line.trim().slice(0, 200));
      });
      child.stderr.on("data", (buf: Buffer) => {
        void hooks.onStatus?.("RUNNING", undefined, buf.toString().trim().slice(0, 200));
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        hooks.signal?.removeEventListener("abort", onAbort);
        resolvePromise({ code, timedOut });
      });
      child.on("error", () => {
        clearTimeout(timer);
        resolvePromise({ code: -1, timedOut });
      });
    });
  }
}

export const DEFAULT_EXPORT_TABS = [
  "Internal:All",
  "Response Codes:All",
  "Page Titles:All",
  "Meta Description:All",
  "H1:All",
  "H2:All",
  "Canonicals:All",
  "Directives:All",
  "Hreflang:All",
  "Images:Missing Alt Text",
  "Structured Data:All",
];

export const DEFAULT_BULK_EXPORTS = [
  "Response Codes:Redirection (3xx) Inlinks",
  "Response Codes:Client Error (4xx) Inlinks",
  "Canonicals:Canonical Chains",
  "Hreflang:All",
];

/** Singleton used by the queue/worker. */
export const screamingFrog = new ScreamingFrogProvider();

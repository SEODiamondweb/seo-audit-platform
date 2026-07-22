/**
 * Centralised, validated access to environment variables.
 * Secrets (DB, Redis, SF paths, license) live only in the environment.
 */
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1).optional(),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().default("http://localhost:3000"),

  SF_CLI_PATH: z.string().default(""),
  SF_EXPORT_DIR: z.string().default("./data/exports"),
  UPLOAD_DIR: z.string().default("./data/uploads"),
  SF_DEFAULT_CONFIG: z.string().default(""),
  SF_JOB_TIMEOUT_MS: z.coerce.number().int().positive().default(3_600_000),
  SF_EXPORT_TABS: z.string().default(""),
  SF_BULK_EXPORTS: z.string().default(""),
});

export type Env = z.infer<typeof schema>;

export const env: Env = schema.parse(process.env);

export const paths = {
  exports: env.SF_EXPORT_DIR,
  uploads: env.UPLOAD_DIR,
};

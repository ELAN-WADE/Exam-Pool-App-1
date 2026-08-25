import { z } from "zod";

try {
  const envFile = Bun.file(".env");
  if (await envFile.exists()) {
    const envText = await envFile.text();
    for (const line of envText.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const [key, ...valueParts] = trimmed.split("=");
        if (key && valueParts.length > 0) {
          process.env[key.trim()] = valueParts.join("=").trim();
        }
      }
    }
  }
} catch (e) {
  console.warn("Failed to load .env file:", e);
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8001),
  JWT_SECRET: z.string().min(32),
  JWT_SECRET_GENERATED: z.string().optional(),
  IS_HTTPS: z.enum(["true", "false"]).default("false"),
  ALLOWED_ORIGIN: z.string().url().default("http://localhost:3000"),
  TRUST_PROXY: z.enum(["true", "false"]).default("false"),
  EXAMPOOL_DB: z.string().optional(),
  MLF_PUBLIC_KEY: z.string().optional(),
  VERCEL: z.enum(["1", "0"]).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let cachedEnv: Env | null = null;

function getEnvSource(): Record<string, string | undefined> {
  if (typeof Bun !== "undefined" && Bun.env) {
    return Bun.env;
  }
  return process.env;
}

export function getEnv(): Env {
  if (cachedEnv) return cachedEnv;
  const parsed = EnvSchema.safeParse(getEnvSource());
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    const msg = Object.entries(errors)
      .map(([k, v]) => `${k}: ${v.join(", ")}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${msg}`);
  }
  cachedEnv = parsed.data;
  return cachedEnv;
}

export function validateEnvAtStartup(): void {
  getEnv();
  const env = getEnvSource();
  if (env.NODE_ENV === "production") {
    if (!env.MLF_PUBLIC_KEY) {
      console.warn("[config] WARNING: MLF_PUBLIC_KEY not set — license validation will fail");
    }
    if (!env.JWT_SECRET || env.JWT_SECRET === "changeme") {
      throw new Error("[config] FATAL: JWT_SECRET must be set in production");
    }
  }
}

export const config = {
  get env() { return getEnv(); },
  validate: validateEnvAtStartup,
};
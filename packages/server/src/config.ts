import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

export interface ServerConfig {
  port: number;
  clientOrigins: string[];
  databaseUrl?: string;
  webDistPath?: string;
  authRequired: boolean;
  supabaseUrl?: string;
  supabaseJwtSecret?: string;
  supabaseJwtAudience: string;
}

let dotenvLoaded = false;

function loadDotEnvFromCandidates(): void {
  if (dotenvLoaded) {
    return;
  }
  dotenvLoaded = true;

  const runtimeDir = fileURLToPath(new URL(".", import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../.env"),
    path.resolve(process.cwd(), "../../.env"),
    path.resolve(runtimeDir, "../../.env"),
    path.resolve(runtimeDir, "../../../../.env"),
  ];

  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath, override: false });
      break;
    }
  }
}

export function loadConfig(): ServerConfig {
  loadDotEnvFromCandidates();
  const rawClientOrigin = process.env.CLIENT_ORIGIN ?? "http://localhost:5173,http://127.0.0.1:5173";
  const clientOrigins = rawClientOrigin
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    port: Number(process.env.PORT ?? "3001"),
    clientOrigins: clientOrigins.length ? clientOrigins : ["http://localhost:5173", "http://127.0.0.1:5173"],
    databaseUrl: process.env.DATABASE_URL,
    webDistPath: process.env.WEB_DIST_PATH,
    authRequired: process.env.AUTH_REQUIRED !== "false",
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseJwtSecret: process.env.SUPABASE_JWT_SECRET,
    supabaseJwtAudience: process.env.SUPABASE_JWT_AUDIENCE ?? "authenticated",
  };
}

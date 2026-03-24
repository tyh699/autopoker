export interface ServerConfig {
  port: number;
  clientOrigin: string;
  databaseUrl?: string;
  webDistPath?: string;
}

export function loadConfig(): ServerConfig {
  return {
    port: Number(process.env.PORT ?? "3001"),
    clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
    databaseUrl: process.env.DATABASE_URL,
    webDistPath: process.env.WEB_DIST_PATH,
  };
}

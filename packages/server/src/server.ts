import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import type { ClientToServerEvents, RoomSettlementSnapshot, ServerToClientEvents } from "@poker/shared";
import { AuthService, type AuthenticatedUser } from "./auth.js";
import { loadConfig } from "./config.js";
import { Persistence } from "./persistence.js";
import { PokerRoomManager } from "./poker-room-manager.js";

interface AppLocals {
  authUser?: AuthenticatedUser;
}

function normalizeLimit(raw: unknown, fallback: number): number {
  const value = Number(raw ?? fallback);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.min(100, Math.floor(value));
}

export function createAppServer() {
  const config = loadConfig();
  const app = express();
  const runtimeDir = fileURLToPath(new URL(".", import.meta.url));
  const webDistCandidates = [
    ...(config.webDistPath ? [config.webDistPath] : []),
    path.resolve(runtimeDir, "../../web/dist"),
    path.resolve(runtimeDir, "../../../../web/dist"),
    path.resolve(process.cwd(), "../web/dist"),
    path.resolve(process.cwd(), "packages/web/dist"),
  ];
  const webDistPath =
    webDistCandidates.find((candidate) => fs.existsSync(path.join(candidate, "index.html"))) ?? webDistCandidates[0];
  const webIndexPath = path.join(webDistPath, "index.html");

  app.use(cors({ origin: config.clientOrigins, credentials: true }));
  app.use(express.json());

  app.get("/health", (_request, response) => {
    response.json({ ok: true, timestamp: new Date().toISOString() });
  });

  const authService = new AuthService({
    authRequired: config.authRequired,
    supabaseUrl: config.supabaseUrl,
    supabaseJwtSecret: config.supabaseJwtSecret,
    supabaseJwtAudience: config.supabaseJwtAudience,
  });

  const persistence = new Persistence(config.databaseUrl);

  const requireApiAuth = async (
    request: express.Request,
    response: express.Response<unknown, AppLocals>,
    next: express.NextFunction,
  ) => {
    if (!authService.isAuthRequired()) {
      response.status(503).json({ error: "服务器未开启认证模式，无法访问账号数据接口" });
      return;
    }
    const authorizationHeader = Array.isArray(request.headers.authorization)
      ? request.headers.authorization[0]
      : request.headers.authorization;
    const token = authService.getTokenFromAuthorizationHeader(authorizationHeader);
    if (!token) {
      response.status(401).json({ error: "缺少访问令牌，请先登录" });
      return;
    }
    try {
      const user = await authService.verifyAccessToken(token);
      response.locals.authUser = user;
      next();
    } catch {
      response.status(401).json({ error: "访问令牌无效或已过期" });
    }
  };

  app.get("/api/me/history", requireApiAuth, async (request, response: express.Response<unknown, AppLocals>) => {
    const authUser = response.locals.authUser;
    if (!authUser) {
      response.status(401).json({ error: "未登录" });
      return;
    }
    const limit = normalizeLimit(request.query.limit, 20);
    const items = await persistence.listUserHandHistory(authUser.userId, limit);
    response.json({ items });
  });

  app.get("/api/leaderboard", requireApiAuth, async (request, response: express.Response<unknown, AppLocals>) => {
    const limit = normalizeLimit(request.query.limit, 20);
    const roomCode = typeof request.query.roomCode === "string" ? request.query.roomCode.trim().toUpperCase() : "";
    const items = roomCode ? await persistence.listRoomLeaderboard(roomCode, limit) : await persistence.listLeaderboard(limit);
    response.json({ items });
  });

  app.get(
    "/api/rooms/:roomCode/leaderboard",
    requireApiAuth,
    async (request, response: express.Response<unknown, AppLocals>) => {
      const roomCode = String(request.params.roomCode ?? "").trim().toUpperCase();
      if (!roomCode) {
        response.status(400).json({ error: "缺少房间号" });
        return;
      }
      const limit = normalizeLimit(request.query.limit, 20);
      const items = await persistence.listRoomLeaderboard(roomCode, limit);
      response.json({ items });
    },
  );

  app.get(
    "/api/rooms/:roomCode/settlements",
    requireApiAuth,
    async (request, response: express.Response<{ items: RoomSettlementSnapshot[] } | { error: string }, AppLocals>) => {
      const roomCode = String(request.params.roomCode ?? "").trim().toUpperCase();
      if (!roomCode) {
        response.status(400).json({ error: "缺少房间号" });
        return;
      }
      const limit = normalizeLimit(request.query.limit, 10);
      const items = await persistence.listRoomSettlementSnapshots(roomCode, limit);
      response.json({ items });
    },
  );

  app.get(
    "/api/rooms/:roomCode/hands",
    requireApiAuth,
    async (request, response: express.Response<unknown, AppLocals>) => {
      const roomCode = String(request.params.roomCode ?? "").trim().toUpperCase();
      if (!roomCode) {
        response.status(400).json({ error: "缺少房间号" });
        return;
      }
      const limit = normalizeLimit(request.query.limit, 20);
      const before = typeof request.query.before === "string" ? request.query.before : undefined;
      const items = await persistence.listRoomHands(roomCode, limit, before);
      response.json({ items });
    },
  );

  const server = http.createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, { authUser: AuthenticatedUser }>(server, {
    cors: {
      origin: config.clientOrigins,
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    if (!authService.isAuthRequired()) {
      socket.data.authUser = { userId: `guest_${socket.id}`, email: null };
      next();
      return;
    }
    const token = authService.getTokenFromSocketAuth(
      (socket.handshake.auth as { token?: string } | undefined)?.token,
      Array.isArray(socket.handshake.headers.authorization)
        ? socket.handshake.headers.authorization[0]
        : socket.handshake.headers.authorization,
    );
    if (!token) {
      next(new Error("未登录，请先完成账号登录"));
      return;
    }
    try {
      const user = await authService.verifyAccessToken(token);
      socket.data.authUser = user;
      next();
    } catch {
      next(new Error("登录状态已过期，请重新登录"));
    }
  });

  const manager = new PokerRoomManager(io, persistence);

  io.on("connection", (socket) => {
    manager.bindSocket(socket);
  });

  if (fs.existsSync(webIndexPath)) {
    app.use(express.static(webDistPath));
    app.get("*", (request, response, next) => {
      if (request.path.startsWith("/socket.io") || request.path === "/health" || request.path.startsWith("/api/")) {
        next();
        return;
      }
      response.sendFile(webIndexPath);
    });
  } else {
    app.get("/", (_request, response) => {
      response
        .status(200)
        .send("Web dist not found. Run `npm.cmd run build -w @poker/web` or use `start-share.cmd`.");
    });
  }

  return { server, config, persistence };
}

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "@poker/shared";
import { loadConfig } from "./config.js";
import { Persistence } from "./persistence.js";
import { PokerRoomManager } from "./poker-room-manager.js";

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

  app.use(cors({ origin: config.clientOrigin, credentials: true }));
  app.use(express.json());

  app.get("/health", (_request, response) => {
    response.json({ ok: true, timestamp: new Date().toISOString() });
  });

  const server = http.createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
    cors: {
      origin: config.clientOrigin,
      credentials: true,
    },
  });

  const persistence = new Persistence(config.databaseUrl);
  const manager = new PokerRoomManager(io, persistence);

  io.on("connection", (socket) => {
    manager.bindSocket(socket);
  });

  if (fs.existsSync(webIndexPath)) {
    app.use(express.static(webDistPath));
    app.get("*", (request, response, next) => {
      if (request.path.startsWith("/socket.io") || request.path === "/health") {
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

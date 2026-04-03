# 中文多人联机德州扑克（账号版）

单仓多包项目，包含：

- `@poker/shared`：共享类型、Socket 协议、历史/排行榜类型
- `@poker/server`：Node.js + Socket.IO 权威牌局服务（Supabase JWT 鉴权）
- `@poker/web`：React + Vite 中文牌桌界面（Supabase 邮箱登录）
- `@poker/desktop`：Tauri 桌面壳（复用 `@poker/web`）

## 目标能力

- 每个玩家必须注册/登录账号后才能进入房间
- 实时牌局仍由 Socket.IO 驱动
- PostgreSQL 保存牌局历史、用户统计、排行榜数据
- 支持桌面客户端打包（Windows 优先）

## 开发启动

```bash
npm.cmd install
npm.cmd run dev:server
npm.cmd run dev:web
```

可先复制 `.env.example` 为 `.env` 再填入 Supabase 与数据库配置。

前端默认跑在 `5173`，服务端默认跑在 `3001`。

## 环境变量

### 服务端（`@poker/server`）

- `PORT`：默认 `3001`
- `CLIENT_ORIGIN`：默认 `http://localhost:5173,http://127.0.0.1:5173`
- `DATABASE_URL`：PostgreSQL 连接串（建议 Supabase Postgres）
- `AUTH_REQUIRED`：默认 `true`，设为 `false` 可关闭鉴权（仅本地调试）
- `SUPABASE_URL`：例如 `https://xxx.supabase.co`
- `SUPABASE_JWT_SECRET`：可选，若不填则走 Supabase JWKS 校验
- `SUPABASE_JWT_AUDIENCE`：默认 `authenticated`
- `WEB_DIST_PATH`：可选，手动指定前端构建目录

### 前端（`@poker/web`）

- `VITE_SERVER_URL`：默认同源或 `http://localhost:3001`
- `VITE_SUPABASE_URL`：Supabase 项目 URL
- `VITE_SUPABASE_ANON_KEY`：Supabase 匿名公钥

## 密钥与隐私

- 仓库应只保留 `.env.example` 模板，不要提交真实 `.env`。
- `VITE_*` 变量会被打进前端产物，属于公开信息，不要放私钥。
- 以下字段必须只放在服务器环境变量（如 Render）：
  - `DATABASE_URL`
  - `SUPABASE_JWT_SECRET`
  - 任何 `service_role` 或私钥
- 若密钥曾在聊天、截图或日志中暴露，建议立刻轮换（重置）并更新部署环境。

## 提 PR 前检查

```bash
git status --ignored
git ls-files | rg -n "\\.env|secret|key|password"
git diff --cached | rg -n "DATABASE_URL|JWT_SECRET|service_role|password|SUPABASE"
```

如命中敏感值，先改为占位符并轮换真实密钥，再提交。

## 数据库

SQL 脚本位置：

- `packages/server/db/schema.sql`

新增关键表：

- `app_users`：账号资料
- `user_stats`：累计统计（手数、胜局、净筹码）
- `hand_player_results`：每手每人结果（用于历史和排行榜）

## 新增 HTTP API（需 Bearer Token）

- `GET /api/me/history?limit=12`
- `GET /api/leaderboard?limit=8`
- `GET /api/rooms/:roomCode/hands?limit=8`

## 桌面端（Tauri）

```bash
npm.cmd run dev:desktop
npm.cmd run build:desktop
```

目录：

- `packages/desktop/src-tauri`

说明：

- 开发模式会先启动 `@poker/web`，再打开桌面窗口
- 打包依赖 Rust 工具链（`rustup`）与平台编译环境

Linux/WSL 打包前建议先装系统依赖（需 sudo）：

```bash
sudo apt-get update
sudo apt-get install -y build-essential pkg-config \
  libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
  librsvg2-dev patchelf
```

项目里提供了本地环境与检查脚本：

```bash
source tools/local-env.sh
./tools/check-all.sh
./tools/build-desktop.sh
```

桌面打包产物默认在：

- `./.tools/target/release/bundle/`

### Windows 打包（最终安装包）

建议在 Windows 原生终端（PowerShell/CMD）执行：

```bash
npm.cmd install
npm.cmd run build:desktop:win
```

产物通常在：

- `packages\desktop\src-tauri\target\release\bundle\msi\`
- `packages\desktop\src-tauri\target\release\bundle\nsis\`

## 单网址分享给别人

仍可用 `start-share.cmd`：

- 服务端托管前端构建产物
- Cloudflare Quick Tunnel 暴露 `3001`

## Render 免费部署（公网后端）

仓库已提供 `render.yaml`，可用 Blueprint 一键创建服务。

1. 先把代码推到 GitHub（Render 需要拉取仓库）。
2. 打开 [Render Dashboard](https://dashboard.render.com/)。
3. 选择 `New` -> `Blueprint`，连接你的仓库并创建。
4. 在 Render 服务里填环境变量：

- `AUTH_REQUIRED=true`
- `SUPABASE_JWT_AUDIENCE=authenticated`
- `SUPABASE_URL=https://你的项目ref.supabase.co`
- `SUPABASE_JWT_SECRET=`（可留空，走 JWKS）
- `DATABASE_URL=你的 Supabase Postgres 连接串`（建议 `?sslmode=require`）
- `CLIENT_ORIGIN=http://localhost:5173,http://127.0.0.1:5173,tauri://localhost,http://tauri.localhost,https://你的前端域名`

5. 部署成功后，用 `https://你的-render-服务.onrender.com/health` 验证。

桌面端联调时，把本地 `.env` 的 `VITE_SERVER_URL` 改为 Render 公网地址并重启前端/桌面进程。

## 构建与测试

```bash
npm.cmd run typecheck
npm.cmd run build -w @poker/shared
npm.cmd run build -w @poker/server
npm.cmd run build -w @poker/web
npm.cmd run test -w @poker/server
```

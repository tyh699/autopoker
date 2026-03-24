# 中文多人联机德州扑克

单仓多包项目，包含：

- `@poker/shared`：共享类型、Socket 协议、中文文案工具
- `@poker/server`：Node.js + Socket.IO 权威牌局服务
- `@poker/web`：React + Vite 中文牌桌界面

## 开发

```bash
npm.cmd install
npm.cmd run dev:server
npm.cmd run dev:web
```

前端默认跑在 `5173`，服务端默认跑在 `3001`。

Windows 下一键启动：

```bash
start-dev.cmd
```

它会自动打开两个终端窗口，分别启动前端和后端开发服务。

## 单网址分享给别人

推荐方案是让后端同时托管前端构建产物，然后用 Cloudflare Quick Tunnel 暴露 `3001` 端口。这样别人只需要打开一个网址。

准备：

1. 安装 `cloudflared`，或者把官方 `cloudflared.exe` 放到 `tools/cloudflared/`
2. 保持你的电脑开机并联网
3. 在项目根目录运行：

```bash
start-share.cmd
```

脚本会自动：

- 构建前后端
- 启动本地 Node 服务
- 打开一个 Cloudflare 临时隧道窗口

当 `Poker Tunnel` 窗口里出现 `https://xxxx.trycloudflare.com` 后，把这个网址发给别人即可。

说明：

- 别人访问这个网址后，前端、接口和 Socket.IO 都走同一个域名
- 这种方式适合测试、朋友局和临时分享
- 关闭你的电脑、关闭服务窗口，或者关闭 tunnel 窗口后，公网网址会失效

## 构建与测试

```bash
npm.cmd run typecheck
npm.cmd run build -w @poker/shared
npm.cmd run build -w @poker/server
npm.cmd run build -w @poker/web
npm.cmd run test -w @poker/server
```

## 环境变量

服务端可选：

- `PORT`：默认 `3001`
- `DATABASE_URL`：可选 PostgreSQL 连接串
- `CLIENT_ORIGIN`：允许的前端来源，默认 `http://localhost:5173`

前端可选：

- `VITE_SERVER_URL`：默认 `http://localhost:3001`

## 数据库

PostgreSQL 建表脚本在：

- `packages/server/db/schema.sql`

如果不提供 `DATABASE_URL`，服务端仍然可以用内存房间正常跑多人联机，只是不写入持久化记录。

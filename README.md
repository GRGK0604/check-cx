# 模型中转状态检测

模型中转状态检测是一个用于监控 AI 模型 API 可用性与延迟的健康面板。当前仓库基于 `BingZi-233/check-cx` 的公开代码继续演化，但后续功能、运维方式与发布内容均由本仓库独立维护。

![模型中转状态检测 Dashboard](docs/images/index.png)

## 当前能力

- 后台管理控制面：维护检测配置、请求模板、Telegram 推送、站点设置和存储诊断
- 自建存储后端：支持直连 Postgres 与 SQLite，首次启动自动建表
- 首页直接展示全部监控内容，不再提供 `/group/xxx` 分组详情页
- Provider 健康检查：OpenAI / Gemini / Anthropic，支持 Chat Completions 与 Responses 端点
- 延迟、Ping 延迟、历史时间线与 7/15/30 天可用性统计
- Telegram 推送：连续失败 3 次发故障，故障中连续成功 1 次发恢复
- 官方状态链接与官方状态轮询（当前实现 OpenAI / Anthropic）
- 站点图标上传与自定义后台入口

## 快速开始

### 1. 环境准备

- Node.js 18 及以上（建议 20 LTS）
- pnpm 10
- 可选：PostgreSQL；不配置时会使用 SQLite

### 2. 安装依赖

```bash
pnpm install
```

### 3. 配置环境变量

```bash
cp .env.example .env.local
```

最小可选变量：

```env
DATABASE_PROVIDER=
DATABASE_URL=
POSTGRES_URL=
POSTGRES_PRISMA_URL=
SQLITE_DATABASE_PATH=.sisyphus/local-data/app.db
ADMIN_SESSION_SECRET=...
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
CHECK_POLL_INTERVAL_SECONDS=300
HISTORY_RETENTION_DAYS=30
OFFICIAL_STATUS_CHECK_INTERVAL_SECONDS=300
CHECK_CONCURRENCY=5
```

如果没有提供 Postgres 连接，应用会先使用 SQLite 启动，让你可以直接进入首轮 Setup Wizard / 后台初始化流程。

### 4. 启动开发服务器

```bash
pnpm dev
```

访问 http://localhost:3000 查看 Dashboard。

## 数据库后端

### 解析规则

1. `DATABASE_PROVIDER` 显式值优先：`postgres` | `sqlite`
2. 未显式指定时，若 `DATABASE_URL` / `POSTGRES_URL` / `POSTGRES_PRISMA_URL` 任一完整，则使用 Postgres
3. 否则回退到 SQLite，默认写入 `.sisyphus/local-data/app.db`

### 自动初始化

Postgres 与 SQLite 都会在首次访问时自动创建控制面表与 `check_history`，无需手动执行 SQL 迁移文件。覆盖的数据包括管理员、站点设置、检测配置、请求模板、Telegram 推送、系统通知、历史快照与可用性统计。

## 运行与部署

```bash
pnpm dev
pnpm build
pnpm start
pnpm lint
```

### Docker Compose

默认镜像启动：

```bash
cp .env.example .env
docker compose pull
docker compose up -d
```

应用 + PostgreSQL 一键启动：

```bash
docker compose -f docker-compose.postgres.yml up -d
```

本地源码构建覆盖：

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

如需把 `应用 + PostgreSQL` 变体改为本地构建镜像：

```bash
docker compose -f docker-compose.postgres.yml -f docker-compose.build.yml up -d --build
```

常用命令：

```bash
docker compose logs -f check-cx
docker compose down
```

## 环境变量

| 变量 | 必需 | 默认值 | 说明 |
|---|---|---|---|
| `DATABASE_PROVIDER` | 否 | 自动解析 | 显式指定 `postgres` / `sqlite` |
| `DATABASE_URL` | 否 | - | 直连 Postgres 连接串 |
| `POSTGRES_URL` | 否 | - | 直连 Postgres 连接串备用变量 |
| `POSTGRES_PRISMA_URL` | 否 | - | 兼容 Prisma / 平台注入的 Postgres 连接串 |
| `SQLITE_DATABASE_PATH` | 否 | `.sisyphus/local-data/app.db` | SQLite 文件路径 |
| `ADMIN_SESSION_SECRET` | 否 | 自动生成到本地 bootstrap SQLite | 后台登录 session 签名密钥；部署环境建议显式填写 |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | 否 | - | Cloudflare Turnstile 站点 Key |
| `TURNSTILE_SECRET_KEY` | 否 | - | Cloudflare Turnstile 服务端 Secret |
| `CHECK_POLL_INTERVAL_SECONDS` | 否 | `300` | 检测间隔（15-600 秒） |
| `CHECK_CONCURRENCY` | 否 | `5` | 最大并发（1-20） |
| `OFFICIAL_STATUS_CHECK_INTERVAL_SECONDS` | 否 | `300` | 官方状态轮询间隔（60-3600 秒） |
| `HISTORY_RETENTION_DAYS` | 否 | `30` | 历史保留天数（7-365） |

## Provider 配置要点

- `check_configs.type` 目前支持 `openai` / `gemini` / `anthropic`
- `endpoint` 必须是完整端点：
  - `/v1/chat/completions` 使用 Chat Completions
  - `/v1/responses` 使用 Responses API
- `request_header` 与 `metadata` 允许注入自定义请求头与请求体参数
- 可选 `template_id` 关联 `check_request_templates`，用于复用默认请求头与 metadata
- `is_maintenance = true` 会保留卡片但停止轮询；`enabled = false` 则完全不纳入检测

## API 概览

- `GET /api/dashboard?trendPeriod=7d|15d|30d`：Dashboard 聚合数据（带 ETag）
- `GET /api/v1/status?model=...`：对外只读状态 API

## 文档

- 架构说明：`docs/ARCHITECTURE.md`
- 运维手册：`docs/OPERATIONS.md`
- Provider 扩展：`docs/EXTENDING_PROVIDERS.md`

## 许可证

本项目基于上游开源项目继续演化，保留原许可证约束。

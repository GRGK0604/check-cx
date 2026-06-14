# Check CX 运维手册

本文面向运维与平台工程，描述当前仓库的部署方式、数据库初始化、后台管理与日常排障要点。当前实现面向自建部署，仅支持 **直连 Postgres** 与 **SQLite** 两种后端；没有外部数据库连接时会自动回退到本地 SQLite。

## 1. 运行环境

- Node.js 18 及以上（建议 20 LTS）
- pnpm 10
- 二选一的存储后端：
  - **直连 Postgres**：完整单实例部署
  - **SQLite**：本地 / 单机完整部署

## 2. 环境变量

### 2.1 后端解析顺序

应用按以下顺序解析当前控制面存储：

1. 若显式设置 `DATABASE_PROVIDER`，则必须是 `postgres` 或 `sqlite`
2. 否则若 `DATABASE_URL` / `POSTGRES_URL` / `POSTGRES_PRISMA_URL` 任一存在，则使用直连 Postgres
3. 否则回退到 SQLite（默认 `.sisyphus/local-data/app.db`）

### 2.2 核心变量

- `DATABASE_PROVIDER`
- `DATABASE_URL` / `POSTGRES_URL` / `POSTGRES_PRISMA_URL`
- `SQLITE_DATABASE_PATH`
- `ADMIN_SESSION_SECRET`
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`
- `CHECK_POLL_INTERVAL_SECONDS`
- `CHECK_CONCURRENCY`
- `OFFICIAL_STATUS_CHECK_INTERVAL_SECONDS`
- `HISTORY_RETENTION_DAYS`

`ADMIN_SESSION_SECRET` 建议在所有部署中显式设置；未设置时会自动生成到本地 bootstrap SQLite 文件。仅当 `NEXT_PUBLIC_TURNSTILE_SITE_KEY` 与 `TURNSTILE_SECRET_KEY` 同时存在时，后台登录页才会启用 Turnstile。

## 3. 数据库初始化

直连 Postgres 与 SQLite 都会在首次访问时自动创建控制面表与 `check_history`，无需手动执行迁移文件。自动建表覆盖：

- `admin_users`
- `site_settings`
- `check_configs`
- `check_request_templates`
- `system_notifications`
- `telegram_push_config`
- `telegram_alert_states`
- `telegram_push_records`
- `check_history`

SQLite 适合本地开发、单机演示和轻量部署；Postgres 适合正式自托管部署。当前不提供数据库租约选主或多实例去重。

## 4. 部署模式

### Docker Compose

- `docker-compose.yml`：默认镜像入口，未配置 Postgres 时使用持久化 SQLite
- `docker-compose.postgres.yml`：一键拉起应用和 PostgreSQL 16
- `docker-compose.build.yml`：本地源码构建覆盖文件

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

## 5. 日常运维入口

当前仓库的首选运维入口是后台管理页面。后台可直接维护：

- 检测配置
- 请求模板
- Telegram 推送配置与记录
- 系统通知
- 站点设置
- 站点浏览器图标
- 存储诊断

SQL 仍适合首次批量导入配置或紧急修复控制面数据。

## 6. 监控与日志

关键日志通常包括：

- `[check-cx] 初始化本地后台轮询器...`
- `[check-cx] 后台轮询完成：写入 ...`
- `[check-cx] 本轮检测失败：...`
- `[官方状态] openai: operational - ...`

建议至少对 `check-cx` 与 `[官方状态]` 关键字建立检索或告警。

## 7. 常见问题

### 页面没有任何卡片

- 确认 `check_configs` 至少一条 `enabled = true`
- 检查当前控制面后端是否初始化成功
- 检查后台存储诊断是否报告存储能力或连接错误

### 时间线一直为空

- 确认至少存在一条 `enabled = true` 的检测配置
- 检查后台存储诊断是否报告历史仓库或可用性统计错误
- 点击首页刷新按钮可手动触发一次完整检测；该检测会写历史并进入 Telegram 推送状态机

### 官方状态显示 unknown

- 当前仅 OpenAI / Anthropic 实现官方状态
- 检查外网访问、DNS 与目标状态页可达性

### 后台登录失败

- 确认已设置 `ADMIN_SESSION_SECRET`，或确认本地 bootstrap SQLite 文件可写
- 若启用了 Turnstile，确认站点 Key 与 Secret 成对配置

### Docker Compose 中 SQLite 数据丢失

- 确认使用仓库自带的 `docker-compose.yml`
- 不要移除 `check-cx-data` 命名卷
- 如自定义 `SQLITE_DATABASE_PATH`，请同步调整卷挂载目录

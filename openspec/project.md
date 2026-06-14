# Project Context

## Purpose

Check CX 是一个 AI 模型健康监控面板，用于实时监控 OpenAI、Gemini、Anthropic 及兼容中转端点的 API 可用性、延迟和错误信息。

核心功能：

- 后台轮询检测多个 AI Provider 的 API 健康状态
- 首页展示全部监控内容、延迟、状态和历史时间线
- 后台维护检测配置、请求模板、Telegram 推送、站点设置和存储诊断
- 支持自定义请求头和请求参数

## Tech Stack

- **框架**: Next.js App Router
- **语言**: TypeScript
- **数据库**: 直连 Postgres 或 SQLite
- **样式**: Tailwind CSS
- **包管理**: pnpm
- **部署**: Docker / Docker Compose

## Architecture Patterns

```text
app/                 # 页面和 API 路由
components/          # Dashboard 与后台 UI
lib/core/            # 轮询器、Dashboard 数据、缓存
lib/providers/       # Provider 检查逻辑
lib/storage/         # Postgres / SQLite 存储实现
lib/database/        # 历史与统计 facade
lib/admin/           # 后台认证、聚合数据、诊断
```

数据流向：

- **检测执行**: `poller.ts` / Dashboard 手动刷新 -> `runProviderChecksAndPersist()` -> 历史写入 + Telegram 状态机
- **前端展示**: 当前存储后端 -> `dashboard-data.ts` -> `app/page.tsx` -> `dashboard-view.tsx`

## Status Rules

- `operational`: 请求成功且延迟小于等于阈值
- `degraded`: 请求成功但延迟超过阈值
- `failed`: 请求失败或超时
- `validation_failed`: 请求成功但挑战题验证失败
- `error`: 检测链路内部错误
- `pending`: 配置已启用但尚无检测记录
- `maintenance`: 配置维护中

## Polling

- 默认间隔: 300 秒
- 支持范围: 15-600 秒
- 环境变量: `CHECK_POLL_INTERVAL_SECONDS`
- 官方状态默认间隔: 300 秒

## Storage

支持：

- Postgres：正式自托管部署
- SQLite：本地开发、单机演示和轻量部署

两者都会自动创建控制面表与 `check_history`。当前不提供多实例数据库租约选主。

## External APIs

- OpenAI API 或兼容端点
- Google Gemini API
- Anthropic API
- Telegram Bot API
- OpenAI / Anthropic 官方状态 API

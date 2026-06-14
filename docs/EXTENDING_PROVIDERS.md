# 扩展 Provider 与官方状态

本文档说明如何在当前架构下新增 Provider 类型或接入官方状态检查。若目标服务兼容 OpenAI Chat/Responses 接口，优先直接使用 `type = openai` 并配置对应 `endpoint`。

## 1. 扩展 Provider 类型

当前仓库支持直连 Postgres 与 SQLite，两者的 `check_configs.type` 都是文本字段，不需要数据库枚举迁移。新增类型主要改代码和后台 UI。

需要修改：

- `lib/types/provider.ts`：扩展 `ProviderType` 与 `DEFAULT_ENDPOINTS`
- `lib/core/status.ts`：补充 `PROVIDER_LABEL`
- `components/provider-icon.tsx`：为新 Provider 提供图标或占位图标
- `lib/admin/data.ts` / 后台配置页相关选项：让后台表单允许新类型

## 2. 实现健康检查

健康检查由 `lib/providers/ai-sdk-check.ts` 统一负责。

步骤：

1. 在 `createModel` 中新增 `case`，返回 AI SDK 模型实例。
2. 选择合适的 Provider SDK（如 `@ai-sdk/openai-compatible`）。
3. 如需自定义请求头与请求体参数，使用已有的 `request_header` 与 `metadata` 机制。

示例结构：

```ts
case "myvendor": {
  const provider = createOpenAICompatible({
    name: "myvendor",
    apiKey: config.apiKey,
    baseURL,
    fetch: customFetch,
  });
  return { model: provider(modelId), reasoningEffort: undefined, isResponses: false };
}
```

如果 Provider 不支持流式输出或行为异常，请直接在 `ai-sdk-check.ts` 内处理错误与超时分支，保持返回结构不变。

## 3. 官方状态检查（可选）

官方状态检查位于 `lib/official-status/`。

步骤：

1. 新增 `lib/official-status/<provider>.ts`，实现 `check<Provider>Status()`。
2. 在 `lib/official-status/index.ts` 注册新方法。
3. 在 `lib/core/official-status-poller.ts` 的 `allTypes` 列表中加入新类型。

## 4. 数据库配置

新增 Provider 后，插入配置：

```sql
INSERT INTO check_configs (name, type, model, endpoint, api_key, enabled)
VALUES ('MyVendor 主力', 'myvendor', 'my-model', 'https://api.myvendor.com/v1/chat/completions', 'sk-xxx', true);
```

也可以直接在后台“检测配置”页面创建。

## 5. 验证清单

- 后台配置页能创建 / 编辑新 Provider
- 轮询日志出现新 Provider 记录
- Dashboard 卡片可见并显示延迟
- 官方状态（若已实现）显示正确
- 状态 API `GET /api/v1/status` 返回新 Provider

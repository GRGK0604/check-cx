import "server-only";

import {
  getControlPlaneStorage,
  getRuntimeStorageResolution,
  getStorageCapabilities,
  resolveDatabaseBackend,
} from "@/lib/storage/resolver";
import type {ControlPlaneStorage, StorageCapabilities} from "@/lib/storage/types";
import {SITE_SETTINGS_SINGLETON_KEY} from "@/lib/types/site-settings";
import {getErrorMessage} from "@/lib/utils";

export type StorageCheckStatus = "pass" | "warn" | "fail";
type StorageCapabilityKey = Exclude<keyof StorageCapabilities, "provider">;

export interface StorageDiagnosticCheck {
  id: string;
  label: string;
  status: StorageCheckStatus;
  detail: string;
  hint?: string;
  durationMs?: number;
}

export interface StorageCapabilityItem {
  id: StorageCapabilityKey;
  label: string;
  enabled: boolean;
  detail: string;
}

export interface StorageDiagnosticsReport {
  generatedAt: string;
  provider: string;
  resolutionReason: string;
  preferredProvider: string;
  preferredReason: string;
  isFailover: boolean;
  failoverError: string | null;
  sqliteFilePath: string | null;
  postgresConnectionSource: string | null;
  storageReady: boolean;
  storageError: string | null;
  capabilities: StorageCapabilities;
  backendChecks: StorageDiagnosticCheck[];
  repositoryChecks: StorageDiagnosticCheck[];
  capabilityItems: StorageCapabilityItem[];
}

const CAPABILITY_LABELS: Array<{
  id: StorageCapabilityKey;
  label: string;
  enabledDetail: string;
  disabledDetail: string;
}> = [
  {
    id: "adminAuth",
    label: "管理员认证",
    enabledDetail: "当前后端支持管理员账号、密码哈希与会话登录。",
    disabledDetail: "当前后端不支持管理员认证。",
  },
  {
    id: "siteSettings",
    label: "站点设置",
    enabledDetail: "支持读取和保存站点品牌、首页文案与后台标题。",
    disabledDetail: "当前后端不支持站点设置持久化。",
  },
  {
    id: "controlPlaneCrud",
    label: "控制面 CRUD",
    enabledDetail: "支持配置、模板、通知等控制面数据写入。",
    disabledDetail: "当前后端无法管理控制面数据。",
  },
  {
    id: "requestTemplates",
    label: "请求模板",
    enabledDetail: "支持请求模板的读取、保存和删除。",
    disabledDetail: "当前后端不支持请求模板管理。",
  },
  {
    id: "notifications",
    label: "系统通知",
    enabledDetail: "支持系统通知与 Telegram 推送配置持久化。",
    disabledDetail: "当前后端不支持通知数据持久化。",
  },
  {
    id: "historySnapshots",
    label: "历史快照",
    enabledDetail: "支持历史状态快照与相关仪表盘聚合。",
    disabledDetail: "当前后端不提供历史快照，相关区域会降级为空结果。",
  },
  {
    id: "availabilityStats",
    label: "可用性统计",
    enabledDetail: "支持可用性统计视图与运行态概览。",
    disabledDetail: "当前后端不提供可用性统计，会以空结果降级。",
  },
  {
    id: "pollerLease",
    label: "轮询租约",
    enabledDetail: "当前后端支持跨实例轮询租约。",
    disabledDetail: "当前自建后端按单节点轮询模型运行。",
  },
  {
    id: "autoProvisionControlPlane",
    label: "自动建表",
    enabledDetail: "当前后端会在首次使用时自动准备控制面表结构。",
    disabledDetail: "当前后端依赖已有结构，不会自动建表。",
  },
];

function buildCapabilityItems(capabilities: StorageCapabilities): StorageCapabilityItem[] {
  return CAPABILITY_LABELS.map((item) => ({
    id: item.id,
    label: item.label,
    enabled: capabilities[item.id],
    detail: capabilities[item.id] ? item.enabledDetail : item.disabledDetail,
  }));
}

async function timedCheck(
  id: string,
  label: string,
  operation: () => Promise<{status: StorageCheckStatus; detail: string; hint?: string}>
): Promise<StorageDiagnosticCheck> {
  const startedAt = Date.now();

  try {
    const result = await operation();
    return {
      id,
      label,
      status: result.status,
      detail: result.detail,
      hint: result.hint,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      id,
      label,
      status: "fail",
      detail: `检查失败：${getErrorMessage(error)}`,
      hint: "优先确认当前后端配置、建表状态或本地文件权限。",
      durationMs: Date.now() - startedAt,
    };
  }
}

function getBackendChecks(
  capabilities: StorageCapabilities,
  input: {
    storageReady: boolean;
    storageError: string | null;
  }
): StorageDiagnosticCheck[] {
  const backend = resolveDatabaseBackend();
  const runtime = getRuntimeStorageResolution();
  const activeProvider = runtime?.activeProvider ?? backend.provider;
  const preferredProvider = runtime?.preferredProvider ?? backend.provider;
  const activeReason = runtime?.activeReason ?? backend.reason;

  const checks: StorageDiagnosticCheck[] = [
    {
      id: "backend-provider",
      label: "当前后端",
      status: input.storageReady ? "pass" : "fail",
      detail: input.storageReady
        ? `当前实际后端为 ${activeProvider}，来源：${activeReason}`
        : `当前目标后端为 ${activeProvider}，但初始化未完成，来源：${activeReason}`,
    },
  ];

  if (runtime?.isBlocked) {
    checks.push({
      id: "backend-blocked",
      label: "后端初始化已阻断",
      status: "fail",
      detail: `首选后端 ${preferredProvider} 未能完成初始化，当前不会自动切换到其他可写后端。`,
      hint: input.storageError ?? runtime.failoverError ?? "请先修复当前后端配置或数据库可用性。",
    });
  }

  if (activeProvider === "sqlite") {
    checks.push({
      id: "backend-sqlite-path",
      label: "SQLite 文件路径",
      status: "warn",
      detail: backend.sqliteFilePath,
      hint: "SQLite 适合本地或轻量单节点运行。如需容器化持久运行，建议挂载该目录。",
    });
  }

  if (activeProvider === "postgres") {
    const source = runtime?.postgresConnectionSource ?? backend.postgresConnectionSource;
    checks.push({
      id: "backend-postgres-source",
      label: "Postgres 连接来源",
      status: source ? "pass" : "fail",
      detail: source
        ? `已从 ${source} 解析到当前 PostgreSQL 连接`
        : "未解析到直连数据库连接串",
      hint: source
        ? "当前后端由环境连接串自动解析。"
        : "请补齐 DATABASE_URL / POSTGRES_URL / POSTGRES_PRISMA_URL。",
    });
  }

  checks.push({
    id: "backend-control-plane",
    label: "控制面能力",
    status: capabilities.controlPlaneCrud ? "pass" : "fail",
    detail: capabilities.controlPlaneCrud
      ? "控制面数据（管理员、站点设置、配置、模板、通知）可读写。"
      : "当前后端未提供控制面 CRUD 能力。",
  });

  return checks;
}

async function getRepositoryChecks(storage: ControlPlaneStorage): Promise<StorageDiagnosticCheck[]> {
  return Promise.all([
    timedCheck("repo-admin-users", "管理员仓库", async () => {
      const hasAny = await storage.adminUsers.hasAny();
      return {
        status: "pass",
        detail: hasAny ? "已检测到至少一个管理员账号。" : "当前还没有管理员账号，适合首次初始化。",
      };
    }),
    timedCheck("repo-site-settings", "站点设置仓库", async () => {
      const row = await storage.siteSettings.getSingleton(SITE_SETTINGS_SINGLETON_KEY);
      return {
        status: row ? "pass" : "warn",
        detail: row ? `已读取站点设置：${row.site_name}` : "未找到站点设置单例记录。",
        hint: row ? undefined : "可在后台站点设置页保存一次，或让自动建表/种子逻辑补齐默认记录。",
      };
    }),
    timedCheck("repo-check-configs", "检测配置仓库", async () => {
      const rows = await storage.checkConfigs.list();
      return {
        status: "pass",
        detail: `已成功读取 ${rows.length} 条检测配置。`,
      };
    }),
    timedCheck("repo-request-templates", "请求模板仓库", async () => {
      const rows = await storage.requestTemplates.list();
      return {
        status: "pass",
        detail: `已成功读取 ${rows.length} 条请求模板。`,
      };
    }),
    timedCheck("repo-notifications", "通知仓库", async () => {
      const rows = await storage.notifications.list();
      return {
        status: "pass",
        detail: `已成功读取 ${rows.length} 条系统通知。`,
      };
    }),
    timedCheck("repo-telegram-alert-states", "Telegram 告警状态仓库", async () => {
      const row = await storage.telegramAlertStates.get("__diagnostic__:__probe__");
      return {
        status: "pass",
        detail: row
          ? "Telegram 告警状态仓库读取正常。"
          : "Telegram 告警状态仓库读取正常，当前无诊断探测记录。",
      };
    }),
    timedCheck("repo-telegram-push-config", "Telegram 推送配置仓库", async () => {
      const row = await storage.telegramPushConfig.getSingleton("global");
      return {
        status: row ? "pass" : "warn",
        detail: row ? `已读取 Telegram 推送配置：${row.project_name}` : "未找到 Telegram 推送配置单例记录。",
        hint: row ? undefined : "可在 Telegram 推送页保存一次配置，或让自动建表/种子逻辑补齐默认记录。",
      };
    }),
    timedCheck("repo-telegram-push-records", "Telegram 推送记录仓库", async () => {
      const rows = await storage.telegramPushRecords.list({limit: 1});
      return {
        status: "pass",
        detail:
          rows.length > 0
            ? "Telegram 推送记录仓库读取正常，已采样到最近记录。"
            : "Telegram 推送记录仓库读取正常，当前尚无推送记录。",
      };
    }),
    timedCheck("repo-history", "历史快照仓库", async () => {
      const rows = await storage.runtime.history.fetchRows({limitPerConfig: 1});
      return {
        status: "pass",
        detail:
          rows.length > 0
            ? `历史快照读取正常，当前已采样到 ${rows.length} 条最近记录。`
            : "历史快照读取正常，当前尚无检测历史。",
      };
    }),
    timedCheck("repo-availability", "可用性统计仓库", async () => {
      const rows = await storage.runtime.availability.listStats();
      return {
        status: "pass",
        detail:
          rows.length > 0
            ? `可用性统计读取正常，当前返回 ${rows.length} 条聚合结果。`
            : "可用性统计读取正常，当前尚无可聚合的历史样本。",
      };
    }),
  ]);
}

export async function runStorageDiagnostics(): Promise<StorageDiagnosticsReport> {
  const backend = resolveDatabaseBackend();
  let storage: ControlPlaneStorage | null = null;
  let storageReady = false;
  let storageError: string | null = null;

  try {
    storage = await getControlPlaneStorage();
    storageReady = true;
  } catch (error) {
    storageError = getErrorMessage(error);
  }

  const runtime = getRuntimeStorageResolution();
  const capabilities = storage?.capabilities ?? getStorageCapabilities();
  const repositoryChecks = storageReady && storage
    ? await getRepositoryChecks(storage)
    : [
        {
          id: "repo-storage-init",
          label: "存储初始化",
          status: "fail" as const,
          detail: storageError
            ? `当前后端未能完成初始化：${storageError}`
            : "当前后端未能完成初始化。",
          hint: runtime?.isBlocked
            ? "项目已保持阻断状态，不会自动切换到其他可写后端。"
            : "请检查当前数据库后端配置、凭据或数据库可用性。",
        },
      ];

  return {
    generatedAt: new Date().toISOString(),
    provider: runtime?.activeProvider ?? backend.provider,
    resolutionReason: runtime?.activeReason ?? backend.reason,
    preferredProvider: runtime?.preferredProvider ?? backend.provider,
    preferredReason: runtime?.preferredReason ?? backend.reason,
    isFailover: runtime?.isFailover ?? false,
    failoverError: runtime?.failoverError ?? null,
    sqliteFilePath: (runtime?.activeProvider ?? backend.provider) === "sqlite" ? backend.sqliteFilePath : null,
    postgresConnectionSource: runtime?.postgresConnectionSource ?? backend.postgresConnectionSource,
    storageReady,
    storageError,
    capabilities,
    backendChecks: getBackendChecks(capabilities, {storageReady, storageError}),
    repositoryChecks,
    capabilityItems: buildCapabilityItems(capabilities),
  };
}

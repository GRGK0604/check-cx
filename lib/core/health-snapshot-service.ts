/**
 * 健康快照服务
 * - 统一管理历史读取、刷新和时间线装配
 */

import type {CheckResult, HistorySnapshot, PingCacheEntry, ProviderConfig, ProviderTimeline, RefreshMode,} from "../types";
import {historySnapshotStore} from "../database/history";
import {runProviderChecks} from "../providers";
import {notifyTelegramForCheckResults} from "@/lib/notifications/telegram";
import {getPingCacheEntry} from "./global-state";
import {getOfficialStatus} from "./official-status-poller";

export interface SnapshotScope {
  cacheKey: string;
  pollIntervalMs: number;
  activeConfigs: ProviderConfig[];
  allowedIds: Set<string>;
  limitPerConfig?: number;
}

const activeSharedCheckRuns = new Map<string, Promise<CheckResult[]>>();

function getCheckRunKey(configs: ProviderConfig[]): string {
  return configs
    .map((config) =>
      [
        config.id,
        config.name,
        config.type,
        config.endpoint,
        config.model,
        config.apiKey.length,
        config.apiKey.slice(-6),
        JSON.stringify(config.requestHeaders ?? null),
        JSON.stringify(config.metadata ?? null),
      ].join(":")
    )
    .sort()
    .join("|");
}

async function readHistoryForScope(scope: SnapshotScope): Promise<HistorySnapshot> {
  if (scope.allowedIds.size === 0) {
    return {};
  }
  return historySnapshotStore.fetch({
    allowedIds: scope.allowedIds,
    limitPerConfig: scope.limitPerConfig,
  });
}

function getLatestHistoryTimestamp(history: HistorySnapshot): number {
  let latest = 0;
  for (const items of Object.values(history)) {
    for (const item of items) {
      const checkedAtMs = Date.parse(item.checkedAt);
      if (Number.isFinite(checkedAtMs) && checkedAtMs > latest) {
        latest = checkedAtMs;
      }
    }
  }
  return latest;
}

function primeCacheEntryFromHistory(
  cacheEntry: PingCacheEntry,
  history: HistorySnapshot,
  loadedAt: number
): void {
  const latestCheckedAt = getLatestHistoryTimestamp(history);
  cacheEntry.history = history;
  cacheEntry.lastHistoryLoadedAt = loadedAt;

  if (latestCheckedAt > cacheEntry.lastPingAt) {
    cacheEntry.lastPingAt = latestCheckedAt;
  }
}

export async function runProviderChecksAndPersist(
  configs: ProviderConfig[],
  options?: Parameters<typeof runProviderChecks>[1],
  guards?: {
    shouldPersist?: () => boolean;
    shouldNotify?: () => boolean;
  }
): Promise<CheckResult[]> {
  if (configs.length === 0) {
    return [];
  }

  const executeRun = async (): Promise<CheckResult[]> => {
    const results = await runProviderChecks(configs, options);
    if (guards?.shouldPersist && !guards.shouldPersist()) {
      return results;
    }

    await historySnapshotStore.append(results);
    if (!guards?.shouldNotify || guards.shouldNotify()) {
      await notifyTelegramForCheckResults(results);
    }
    return results;
  };

  const checkRunKey = getCheckRunKey(configs);
  const existingRun = activeSharedCheckRuns.get(checkRunKey);
  if (existingRun) {
    return existingRun;
  }

  const run = executeRun();
  activeSharedCheckRuns.set(checkRunKey, run);
  try {
    return await run;
  } finally {
    if (activeSharedCheckRuns.get(checkRunKey) === run) {
      activeSharedCheckRuns.delete(checkRunKey);
    }
  }
}

export async function loadSnapshotForScope(
  scope: SnapshotScope,
  refreshMode: RefreshMode
): Promise<HistorySnapshot> {
  if (scope.allowedIds.size === 0) {
    return {};
  }

  const cacheEntry = getPingCacheEntry(scope.cacheKey);
  const now = Date.now();
  let shouldForceRefresh = refreshMode === "always";

  if (refreshMode === "never") {
    if (
      cacheEntry.history &&
      now - (cacheEntry.lastHistoryLoadedAt ?? 0) < scope.pollIntervalMs
    ) {
      return cacheEntry.history;
    }
    const snapshot = await readHistoryForScope(scope);
    cacheEntry.history = snapshot;
    cacheEntry.lastHistoryLoadedAt = now;
    const latestCheckedAt = getLatestHistoryTimestamp(snapshot);
    if (latestCheckedAt > cacheEntry.lastPingAt) {
      cacheEntry.lastPingAt = latestCheckedAt;
    }
    return snapshot;
  }

  const refreshHistory = async (): Promise<HistorySnapshot> => {
    if (scope.activeConfigs.length === 0) {
      return {};
    }

    if (
      !shouldForceRefresh &&
      cacheEntry.history &&
      now - cacheEntry.lastPingAt < scope.pollIntervalMs
    ) {
      return cacheEntry.history;
    }

    if (cacheEntry.inflight) {
      return cacheEntry.inflight;
    }

    const inflightPromise = (async () => {
      await runProviderChecksAndPersist(scope.activeConfigs);
      const nextHistory = await readHistoryForScope(scope);
      cacheEntry.history = nextHistory;
      const completedAt = Date.now();
      cacheEntry.lastPingAt = completedAt;
      cacheEntry.lastHistoryLoadedAt = completedAt;
      return nextHistory;
    })();

    cacheEntry.inflight = inflightPromise;
    try {
      return await inflightPromise;
    } finally {
      if (cacheEntry.inflight === inflightPromise) {
        cacheEntry.inflight = undefined;
      }
    }
  };

  let history = await readHistoryForScope(scope);
  primeCacheEntryFromHistory(cacheEntry, history, now);
  const missingActiveHistory = scope.activeConfigs.some((config) => !history[config.id]?.length);

  if (refreshMode === "always" || refreshMode === "interval") {
    history = await refreshHistory();
  } else if (
    refreshMode === "missing" &&
    scope.activeConfigs.length > 0 &&
    missingActiveHistory
  ) {
    shouldForceRefresh = true;
    history = await refreshHistory();
  }

  return history;
}

export function buildProviderTimelines(
  history: HistorySnapshot,
  maintenanceConfigs: ProviderConfig[],
  activeConfigs: ProviderConfig[]
): ProviderTimeline[] {
  const mapped = Object.entries(history)
    .map<ProviderTimeline | null>(([id, items]) => {
      if (items.length === 0) {
        return null;
      }
      // historySnapshotStore 已按 checkedAt 倒序返回
      const latest = attachOfficialStatus({ ...items[0] });
      return {
        id,
        items,
        latest,
      };
    })
    .filter((timeline): timeline is ProviderTimeline => Boolean(timeline));

  const historyIds = new Set(mapped.map((timeline) => timeline.id));
  const pendingTimelines = activeConfigs
    .filter((config) => !historyIds.has(config.id))
    .map(createPendingTimeline);
  const maintenanceTimelines = maintenanceConfigs.map(createMaintenanceTimeline);

  return [...mapped, ...pendingTimelines, ...maintenanceTimelines].sort((a, b) =>
    a.latest.name.localeCompare(b.latest.name)
  );
}

function attachOfficialStatus(result: CheckResult): CheckResult {
  const officialStatus = getOfficialStatus(result.type);
  if (!officialStatus) {
    return result;
  }
  return { ...result, officialStatus };
}

function createMaintenanceTimeline(config: ProviderConfig): ProviderTimeline {
  const base: CheckResult = {
    id: config.id,
    name: config.name,
    type: config.type,
    endpoint: config.endpoint,
    model: config.model,
    status: "maintenance",
    latencyMs: null,
    pingLatencyMs: null,
    message: "配置处于维护模式",
    checkedAt: "",
    groupName: config.groupName || null,
  };

  return {
    id: config.id,
    items: [],
    latest: attachOfficialStatus(base),
  };
}

function createPendingTimeline(config: ProviderConfig): ProviderTimeline {
  const base: CheckResult = {
    id: config.id,
    name: config.name,
    type: config.type,
    endpoint: config.endpoint,
    model: config.model,
    status: "pending",
    latencyMs: null,
    pingLatencyMs: null,
    message: "配置已启用，等待首次检查结果",
    checkedAt: "",
    groupName: config.groupName || null,
  };

  return {
    id: config.id,
    items: [],
    latest: attachOfficialStatus(base),
  };
}

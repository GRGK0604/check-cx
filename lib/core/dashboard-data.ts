/**
 * Dashboard 数据聚合模块
 *
 * 职责：
 * - 从当前后端数据库读取最近的检查历史（按 Provider 聚合）
 * - 在必要时触发一次新的 Provider 检测并写入历史
 * - 结合轮询配置与官方状态，生成 DashboardView 所需的完整数据结构
 */
import {loadProviderConfigsFromDB} from "../database/config-loader";
import {getDailyHistoryLimitPerConfig} from "../database/history";
import {getControlPlaneStorage} from "../storage/resolver";
import {SITE_SETTINGS_SINGLETON_KEY} from "../types/site-settings";
import {getStatusDayKey} from "./calendar-day";
import {getPollingIntervalLabel, getPollingIntervalMs} from "./polling-config";
import {ensureOfficialStatusPoller} from "./official-status-poller";
import {ensureCheckPoller} from "./poller";
import {buildProviderTimelines, loadSnapshotForScope} from "./health-snapshot-service";
import {isBuildPhase} from "../utils/build-phase";
import type {AvailabilityPeriod, DashboardData, RefreshMode} from "../types";

interface DashboardCacheEntry {
  data?: DashboardData;
  etag?: string;
  expiresAt: number;
  inflight?: Promise<DashboardLoadResult>;
}

interface DashboardCacheMetrics {
  hits: number;
  misses: number;
  inflightHits: number;
}

const dashboardCacheMetrics: DashboardCacheMetrics = {
  hits: 0,
  misses: 0,
  inflightHits: 0,
};

export function getDashboardCacheMetrics(): DashboardCacheMetrics {
  return { ...dashboardCacheMetrics };
}

export function resetDashboardCacheMetrics(): void {
  dashboardCacheMetrics.hits = 0;
  dashboardCacheMetrics.misses = 0;
  dashboardCacheMetrics.inflightHits = 0;
}

const DEFAULT_DASHBOARD_CACHE_TTL_MS = 5 * 60 * 1000;
const MONITORED_DAYS_BASELINE = 67;
const DAY_MS = 24 * 60 * 60 * 1000;
const dashboardCache = new Map<string, DashboardCacheEntry>();

export function invalidateDashboardCache(): void {
  dashboardCache.clear();
}

function getDashboardCacheKey(
  pollIntervalMs: number,
  providerKey: string,
  trendPeriod: AvailabilityPeriod
): string {
  return `dashboard:${pollIntervalMs}:${trendPeriod}:${providerKey}`;
}

function getDashboardCacheTtlMs(pollIntervalMs: number): number {
  if (Number.isFinite(pollIntervalMs) && pollIntervalMs > 0) {
    return pollIntervalMs;
  }
  return DEFAULT_DASHBOARD_CACHE_TTL_MS;
}

function generateETag(data: string): string {
  let hash = 5381;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) + hash) ^ data.charCodeAt(i);
  }
  return `"${(hash >>> 0).toString(16)}"`;
}

function buildDashboardEtag(data: DashboardData): string {
  const { generatedAt, ...etagPayload } = data;
  void generatedAt;
  const jsonBody = JSON.stringify(etagPayload);
  return generateETag(jsonBody);
}

function getEmptyDashboardData(trendPeriod: AvailabilityPeriod): DashboardLoadResult {
  const pollIntervalMs = getPollingIntervalMs();
  const data: DashboardData = {
    providerTimelines: [],
    lastUpdated: null,
    total: 0,
    pollIntervalLabel: getPollingIntervalLabel(),
    pollIntervalMs,
    trendPeriod,
    monitoredDays: MONITORED_DAYS_BASELINE,
    generatedAt: Date.now(),
  };

  return {data, etag: buildDashboardEtag(data)};
}

function getDayNumber(value: Date | string): number {
  const dayKey = getStatusDayKey(value);
  const [year, month, day] = dayKey.split("-").map(Number);
  if (!year || !month || !day) {
    return Number.NaN;
  }

  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

async function getMonitoredDays(now: Date = new Date()): Promise<number> {
  const storage = await getControlPlaneStorage();
  const settings = await storage.siteSettings.getSingleton(SITE_SETTINGS_SINGLETON_KEY);
  let startedAt = settings?.monitor_started_at ?? null;

  if (!startedAt) {
    const earliestCheckedAt = await storage.runtime.history.getEarliestCheckedAt();
    if (earliestCheckedAt) {
      startedAt = await storage.siteSettings.setMonitorStartedAtIfEmpty(
        SITE_SETTINGS_SINGLETON_KEY,
        earliestCheckedAt
      );
    }
  }

  if (!startedAt) {
    return MONITORED_DAYS_BASELINE;
  }

  const startedDay = getDayNumber(startedAt);
  const currentDay = getDayNumber(now);
  if (!Number.isFinite(startedDay) || !Number.isFinite(currentDay)) {
    return MONITORED_DAYS_BASELINE;
  }

  return MONITORED_DAYS_BASELINE + Math.max(0, currentDay - startedDay);
}

export interface DashboardLoadResult {
  data: DashboardData;
  etag: string;
}

/**
 * 加载 Dashboard 数据
 *
 * @param options.refreshMode
 *  - "always"  ：每次请求都触发一次新的检测
 *  - "missing"：仅在历史为空时触发检测（避免首屏空白）
 *  - "never"  ：只读取历史，不触发新的检测
 */
export async function loadDashboardData(options?: {
  refreshMode?: RefreshMode;
  trendPeriod?: AvailabilityPeriod;
  bypassCache?: boolean;
}): Promise<DashboardData> {
  const result = await loadDashboardDataInternal(options);
  return result.data;
}

export async function loadDashboardDataWithEtag(options?: {
  refreshMode?: RefreshMode;
  trendPeriod?: AvailabilityPeriod;
  bypassCache?: boolean;
}): Promise<DashboardLoadResult> {
  return loadDashboardDataInternal(options);
}

async function loadDashboardDataInternal(options?: {
  refreshMode?: RefreshMode;
  trendPeriod?: AvailabilityPeriod;
  bypassCache?: boolean;
}): Promise<DashboardLoadResult> {
  const trendPeriod = options?.trendPeriod ?? "7d";
  if (isBuildPhase()) {
    return getEmptyDashboardData(trendPeriod);
  }

  ensureOfficialStatusPoller();
  ensureCheckPoller();
  const allConfigs = await loadProviderConfigsFromDB();
  const maintenanceConfigs = allConfigs.filter((cfg) => cfg.is_maintenance);
  const activeConfigs = allConfigs.filter((cfg) => !cfg.is_maintenance);

  const allowedIds = new Set(activeConfigs.map((item) => item.id));
  const pollIntervalMs = getPollingIntervalMs();
  const pollIntervalLabel = getPollingIntervalLabel();
  const providerKey =
    allowedIds.size > 0 ? [...allowedIds].sort().join("|") : "__empty__";
  const refreshMode = options?.refreshMode ?? "missing";
  const cacheKey = `dashboard:${pollIntervalMs}:${providerKey}`;
  const historyLimitPerConfig = getDailyHistoryLimitPerConfig(pollIntervalMs);
  const cacheKeyWithPeriod = getDashboardCacheKey(
    pollIntervalMs,
    providerKey,
    trendPeriod
  );
  const cacheTtlMs = getDashboardCacheTtlMs(pollIntervalMs);
  const now = Date.now();
  const shouldBypassCache =
    refreshMode === "always" ||
    refreshMode === "interval" ||
    options?.bypassCache === true;

  const loadData = async (): Promise<DashboardLoadResult> => {
    const history = await loadSnapshotForScope(
      {
        cacheKey,
        pollIntervalMs,
        activeConfigs,
        allowedIds,
        limitPerConfig: historyLimitPerConfig,
      },
      refreshMode
    );

    const providerTimelines = buildProviderTimelines(history, maintenanceConfigs, activeConfigs);
    const monitoredDays = await getMonitoredDays();

    let lastUpdated: string | null = null;
    let lastUpdatedMs = 0;
    for (const timeline of providerTimelines) {
      if (timeline.items.length === 0) {
        continue;
      }
      const checkedAtMs =
        timeline.latest.checkedAt && timeline.items.length > 0
          ? Date.parse(timeline.latest.checkedAt)
          : Number.NaN;
      if (Number.isFinite(checkedAtMs) && checkedAtMs > lastUpdatedMs) {
        lastUpdatedMs = checkedAtMs;
        lastUpdated = timeline.latest.checkedAt;
      }
    }

    const generatedAt = Date.now();

    const data: DashboardData = {
      providerTimelines,
      lastUpdated,
      total: providerTimelines.length,
      pollIntervalLabel,
      pollIntervalMs,
      trendPeriod,
      monitoredDays,
      generatedAt,
    };

    const etag = buildDashboardEtag(data);
    dashboardCache.set(cacheKeyWithPeriod, {
      data,
      etag,
      expiresAt: Date.now() + cacheTtlMs,
    });

    return { data, etag };
  };

  if (!shouldBypassCache) {
    const cached = dashboardCache.get(cacheKeyWithPeriod);
    if (cached?.data && now < cached.expiresAt) {
      dashboardCacheMetrics.hits += 1;
      cached.data.generatedAt = now;
      if (!cached.etag) {
        cached.etag = buildDashboardEtag(cached.data);
      }
      return { data: cached.data, etag: cached.etag };
    }
    if (cached?.inflight) {
      dashboardCacheMetrics.inflightHits += 1;
      const result = await cached.inflight;
      const entry = dashboardCache.get(cacheKeyWithPeriod);
      if (entry && !entry.etag) {
        entry.etag = result.etag;
      }
      return result;
    }

    dashboardCacheMetrics.misses += 1;
    const inflight = loadData().finally(() => {
      const entry = dashboardCache.get(cacheKeyWithPeriod);
      if (entry?.inflight === inflight) {
        delete entry.inflight;
      }
    });
    dashboardCache.set(cacheKeyWithPeriod, {
      data: cached?.data,
      etag: cached?.etag,
      expiresAt: cached?.expiresAt ?? 0,
      inflight,
    });
    return inflight;
  }

  return loadData();
}

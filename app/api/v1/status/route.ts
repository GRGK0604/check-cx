import { NextRequest, NextResponse } from "next/server";
import {
  MAX_POINTS_PER_PROVIDER,
  getDailyHistoryLimitPerConfig,
  loadHistory,
} from "@/lib/database/history";
import { loadProviderConfigsFromDB } from "@/lib/database/config-loader";
import {getStatusDayKey} from "@/lib/core/calendar-day";
import { getPollingIntervalMs, getPollingIntervalLabel } from "@/lib/core/polling-config";
import {COUNTED_STATUSES, SUCCESS_STATUSES} from "@/lib/core/status";
import type { CheckResult, HealthStatus } from "@/lib/types";

export const revalidate = 0;
export const dynamic = "force-dynamic";

interface ProviderStatistics {
  totalChecks: number;
  operationalCount: number;
  degradedCount: number;
  failedCount: number;
  validationFailedCount: number;
  errorCount: number;
  successRate: number;
  avgLatencyMs: number | null;
  minLatencyMs: number | null;
  maxLatencyMs: number | null;
}

interface ProviderStatus {
  id: string;
  name: string;
  type: string;
  model: string;
  endpoint: string;
  latest: {
    status: HealthStatus;
    latencyMs: number | null;
    pingLatencyMs: number | null;
    checkedAt: string | null;
    message: string;
  } | null;
  statistics: ProviderStatistics;
  timeline: Array<{
    status: HealthStatus;
    latencyMs: number | null;
    pingLatencyMs: number | null;
    checkedAt: string;
    message: string;
  }>;
}

interface StatusSummary {
  total: number;
  operational: number;
  degraded: number;
  failed: number;
  validationFailed: number;
  error: number;
  pending: number;
  maintenance: number;
  avgLatencyMs: number | null;
}

interface ApiResponse {
  providers: ProviderStatus[];
  summary: StatusSummary;
  metadata: {
    generatedAt: string;
    pollIntervalMs: number;
    pollIntervalLabel: string;
    filters: {
      model: string | null;
    };
  };
}

function createPendingLatest(config: {
  name: string;
}): ProviderStatus["latest"] {
  return {
    status: "pending",
    latencyMs: null,
    pingLatencyMs: null,
    checkedAt: null,
    message: `${config.name} is waiting for the first check result`,
  };
}

function createMaintenanceLatest(config: {
  name: string;
}): ProviderStatus["latest"] {
  return {
    status: "maintenance",
    latencyMs: null,
    pingLatencyMs: null,
    checkedAt: null,
    message: `${config.name} is in maintenance mode`,
  };
}

function getEmptyStatistics(): ProviderStatistics {
  return {
    totalChecks: 0,
    operationalCount: 0,
    degradedCount: 0,
    failedCount: 0,
    validationFailedCount: 0,
    errorCount: 0,
    successRate: 100,
    avgLatencyMs: null,
    minLatencyMs: null,
    maxLatencyMs: null,
  };
}

function computeStatistics(items: CheckResult[]): ProviderStatistics {
  const todayKey = getStatusDayKey(new Date());
  const todayItems = items.filter(
    (item) => getStatusDayKey(item.checkedAt) === todayKey && COUNTED_STATUSES.has(item.status)
  );

  if (todayItems.length === 0) {
    return getEmptyStatistics();
  }

  let operationalCount = 0;
  let degradedCount = 0;
  let failedCount = 0;
  let validationFailedCount = 0;
  let errorCount = 0;
  const latencies: number[] = [];

  for (const item of todayItems) {
    switch (item.status) {
      case "operational":
        operationalCount++;
        break;
      case "degraded":
        degradedCount++;
        break;
      case "failed":
        failedCount++;
        break;
      case "validation_failed":
        validationFailedCount++;
        break;
      case "error":
        errorCount++;
        break;
    }
    if (item.latencyMs !== null) {
      latencies.push(item.latencyMs);
    }
  }

  const successCount = todayItems.filter((item) => SUCCESS_STATUSES.has(item.status)).length;
  const successRate = (successCount / todayItems.length) * 100;

  let avgLatencyMs: number | null = null;
  let minLatencyMs: number | null = null;
  let maxLatencyMs: number | null = null;

  if (latencies.length > 0) {
    avgLatencyMs = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
    minLatencyMs = Math.min(...latencies);
    maxLatencyMs = Math.max(...latencies);
  }

  return {
    totalChecks: todayItems.length,
    operationalCount,
    degradedCount,
    failedCount,
    validationFailedCount,
    errorCount,
    successRate: Math.round(successRate * 100) / 100,
    avgLatencyMs,
    minLatencyMs,
    maxLatencyMs,
  };
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const modelFilter = searchParams.get("model");

  const allConfigs = await loadProviderConfigsFromDB();
  const activeConfigs = allConfigs.filter((cfg) => !cfg.is_maintenance);
  const maintenanceConfigIds = new Set(
    allConfigs.filter((cfg) => cfg.is_maintenance).map((cfg) => cfg.id)
  );

  const allowedIds = new Set(activeConfigs.map((cfg) => cfg.id));
  const pollIntervalMs = getPollingIntervalMs();
  const history = await loadHistory({
    allowedIds,
    limitPerConfig: getDailyHistoryLimitPerConfig(pollIntervalMs),
  });

  const providers: ProviderStatus[] = [];

  for (const config of allConfigs) {
    if (modelFilter && config.model !== modelFilter) {
      continue;
    }

    const items = history[config.id] || [];

    const latest = items[0] || null;
    const statistics = computeStatistics(items);

    const isMaintenance = maintenanceConfigIds.has(config.id);
    const fallbackLatest = isMaintenance
      ? createMaintenanceLatest(config)
      : createPendingLatest(config);
    const currentLatest = latest
      ? {
          status: isMaintenance ? "maintenance" : latest.status,
          latencyMs: latest.latencyMs,
          pingLatencyMs: latest.pingLatencyMs,
          checkedAt: latest.checkedAt,
          message: latest.message,
        }
      : fallbackLatest;

    providers.push({
      id: config.id,
      name: config.name,
      type: config.type,
      model: config.model,
      endpoint: config.endpoint,
      latest: currentLatest,
      statistics,
      timeline: items.slice(0, MAX_POINTS_PER_PROVIDER).map((item) => ({
        status: isMaintenance ? "maintenance" : item.status,
        latencyMs: item.latencyMs,
        pingLatencyMs: item.pingLatencyMs,
        checkedAt: item.checkedAt,
        message: item.message,
      })),
    });
  }

  let summaryOperational = 0;
  let summaryDegraded = 0;
  let summaryFailed = 0;
  let summaryValidationFailed = 0;
  let summaryError = 0;
  let summaryPending = 0;
  let summaryMaintenance = 0;
  const allLatencies: number[] = [];

  for (const provider of providers) {
    if (!provider.latest) continue;

    switch (provider.latest.status) {
      case "operational":
        summaryOperational++;
        break;
      case "degraded":
        summaryDegraded++;
        break;
      case "failed":
        summaryFailed++;
        break;
      case "validation_failed":
        summaryValidationFailed++;
        break;
      case "error":
        summaryError++;
        break;
      case "pending":
        summaryPending++;
        break;
      case "maintenance":
        summaryMaintenance++;
        break;
    }

    if (provider.latest.latencyMs !== null) {
      allLatencies.push(provider.latest.latencyMs);
    }
  }

  const summary: StatusSummary = {
    total: providers.length,
    operational: summaryOperational,
    degraded: summaryDegraded,
    failed: summaryFailed,
    validationFailed: summaryValidationFailed,
    error: summaryError,
    pending: summaryPending,
    maintenance: summaryMaintenance,
    avgLatencyMs:
      allLatencies.length > 0
        ? Math.round(allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length)
        : null,
  };

  const response: ApiResponse = {
    providers,
    summary,
    metadata: {
      generatedAt: new Date().toISOString(),
      pollIntervalMs,
      pollIntervalLabel: getPollingIntervalLabel(),
      filters: {
        model: modelFilter,
      },
    },
  };

  return NextResponse.json(response);
}

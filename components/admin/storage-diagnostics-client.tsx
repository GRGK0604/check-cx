"use client";

import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {HardDrive, Loader2, Sparkles} from "lucide-react";

import {AdminPanel, AdminStatCard, AdminStatusBanner} from "@/components/admin/admin-primitives";
import {buttonVariants} from "@/components/ui/button";
import type {StorageDiagnosticCheck} from "@/lib/admin/storage-diagnostics";
import type {StorageDiagnosticsSnapshot} from "@/lib/admin/storage-diagnostics-cache";
import {formatAdminTimestamp} from "@/lib/admin/view";
import {cn} from "@/lib/utils";

const REQUEST_TIMEOUT_MS = 30_000;

function getToneClass(status: "pass" | "warn" | "fail") {
  switch (status) {
    case "pass":
      return "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300";
    case "warn":
      return "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300";
    default:
      return "bg-rose-500/10 text-rose-700 ring-rose-500/20 dark:text-rose-300";
  }
}

function getStatusLabel(status: "pass" | "warn" | "fail") {
  switch (status) {
    case "pass":
      return "通过";
    case "warn":
      return "警告";
    default:
      return "失败";
  }
}

function renderStorageCheckCard(check: StorageDiagnosticCheck) {
  return (
    <div
      key={check.id}
      className="rounded-[1.5rem] border border-border/40 bg-background/70 px-4 py-4 shadow-sm"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-medium text-foreground">{check.label}</div>
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] ring-1",
                getToneClass(check.status)
              )}
            >
              {getStatusLabel(check.status)}
            </span>
          </div>
          <p className="text-sm leading-6 text-muted-foreground">{check.detail}</p>
          {check.hint ? (
            <p className="text-xs leading-5 text-muted-foreground/90">建议：{check.hint}</p>
          ) : null}
        </div>
        {typeof check.durationMs === "number" ? (
          <div className="text-xs text-muted-foreground">{check.durationMs} ms</div>
        ) : null}
      </div>
    </div>
  );
}

function renderCapabilityCard(item: {
  id: string;
  label: string;
  enabled: boolean;
  detail: string;
}) {
  return (
    <div
      key={item.id}
      className="rounded-[1.5rem] border border-border/40 bg-background/70 px-4 py-4 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm font-medium text-foreground">{item.label}</div>
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] ring-1",
            item.enabled ? getToneClass("pass") : getToneClass("warn")
          )}
        >
          {item.enabled ? "已启用" : "未启用"}
        </span>
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.detail}</p>
    </div>
  );
}

async function fetchSnapshot(dataEndpoint: string, force = false): Promise<StorageDiagnosticsSnapshot> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const search = new URLSearchParams();
  if (force) {
    search.set("force", "1");
  }

  try {
    const response = await fetch(search.size > 0 ? `${dataEndpoint}?${search.toString()}` : dataEndpoint, {
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`状态快照请求失败（${response.status}）`);
    }

    return (await response.json()) as StorageDiagnosticsSnapshot;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function StorageDiagnosticsClient(props: {
  initialSnapshot: StorageDiagnosticsSnapshot;
  refreshAfterMount: boolean;
  dataEndpoint?: string;
}) {
  const [snapshot, setSnapshot] = useState(props.initialSnapshot);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [isManualRefreshPending, setIsManualRefreshPending] = useState(false);
  const requestLockRef = useRef(false);
  const didMountRefreshRef = useRef(false);

  const loadSnapshot = useCallback(async (force = false) => {
    if (requestLockRef.current) {
      return;
    }

    requestLockRef.current = true;
    if (force) {
      setIsManualRefreshPending(true);
    }

    try {
      const nextSnapshot = await fetchSnapshot(
        props.dataEndpoint ?? "/api/internal/storage-diagnostics",
        force
      );
      setSnapshot(nextSnapshot);
      setRequestError(null);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "状态快照请求失败");
    } finally {
      requestLockRef.current = false;
      if (force) {
        setIsManualRefreshPending(false);
      }
    }
  }, [props.dataEndpoint]);

  useEffect(() => {
    if (didMountRefreshRef.current) {
      return;
    }

    didMountRefreshRef.current = true;
    void loadSnapshot(props.refreshAfterMount || !props.initialSnapshot.report);
  }, [loadSnapshot, props.initialSnapshot.report, props.refreshAfterMount]);

  useEffect(() => {
    const intervalMs = !snapshot.report || snapshot.refreshing || snapshot.stale
      ? snapshot.pendingPollIntervalMs
      : snapshot.pollIntervalMs;
    const timer = window.setTimeout(() => {
      void loadSnapshot(false);
    }, intervalMs);

    return () => window.clearTimeout(timer);
  }, [loadSnapshot, snapshot.pendingPollIntervalMs, snapshot.pollIntervalMs, snapshot.refreshing, snapshot.report, snapshot.stale]);

  const diagnostics = snapshot.report;
  const summary = useMemo(() => {
    if (!diagnostics) {
      return null;
    }

    return {
      enabledCapabilityCount: diagnostics.capabilityItems.filter((item) => item.enabled).length,
      repositoryFailCount: diagnostics.repositoryChecks.filter((item) => item.status === "fail").length,
      repositoryWarnCount: diagnostics.repositoryChecks.filter((item) => item.status === "warn").length,
    };
  }, [diagnostics]);

  const refreshButton = (
    <button
      type="button"
      onClick={() => void loadSnapshot(true)}
      disabled={isManualRefreshPending}
      className={cn(buttonVariants({variant: diagnostics ? "outline" : "default", size: "lg"}), "rounded-full px-5")}
    >
      {isManualRefreshPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
      刷新快照
    </button>
  );

  if (!diagnostics) {
    return (
      <AdminPanel
        title="存储状态快照"
        description="打开后会自动生成当前后端数据库快照，之后定时刷新。"
        trailing={refreshButton}
      >
        <div className="space-y-4">
          {requestError ? <AdminStatusBanner type="error" message={requestError} /> : null}
          <div className="rounded-[1.5rem] border border-dashed border-border/50 px-4 py-6 text-sm leading-7 text-muted-foreground">
            {snapshot.refreshing ? "正在生成首份状态快照。" : "暂无状态快照，正在自动生成。"}
            {snapshot.lastStartedAt ? (
              <span>
                {" "}
                最近启动：
                <span className="font-medium text-foreground">
                  {formatAdminTimestamp(snapshot.lastStartedAt)}
                </span>
              </span>
            ) : null}
          </div>
        </div>
      </AdminPanel>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        {refreshButton}
        <span className="text-xs text-muted-foreground">
          缓存 {Math.round(snapshot.refreshIntervalMs / 1000)} 秒；页面轮询 {Math.round(snapshot.pollIntervalMs / 1000)} 秒。
        </span>
      </div>

      {requestError ? <AdminStatusBanner type="error" message={requestError} /> : null}

      {snapshot.refreshing ? (
        <AdminStatusBanner
          type="success"
          message="正在刷新状态快照，先显示上一版结果。"
        />
      ) : null}

      {!diagnostics.storageReady ? (
        <AdminStatusBanner
          type="error"
          message={`当前数据库后端未准备好：${diagnostics.storageError ?? "请检查配置与可用性。"}`}
        />
      ) : summary && summary.repositoryFailCount > 0 ? (
        <AdminStatusBanner
          type="error"
          message={`当前管理数据有 ${summary.repositoryFailCount} 项失败，${summary.repositoryWarnCount} 项警告。`}
        />
      ) : summary ? (
        <AdminStatusBanner
          type="success"
          message={`当前自动后端为 ${diagnostics.provider}${summary.repositoryWarnCount > 0 ? `，另有 ${summary.repositoryWarnCount} 项警告` : ""}。`}
        />
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard label="当前后端" value={diagnostics.provider} helper={`来源：${diagnostics.resolutionReason}`} />
        <AdminStatCard label="启用能力" value={`${summary?.enabledCapabilityCount ?? 0}/${diagnostics.capabilityItems.length}`} helper="当前后端启用的能力数量" />
        <AdminStatCard label="失败项" value={summary?.repositoryFailCount ?? 0} helper={diagnostics.storageReady ? `警告 ${summary?.repositoryWarnCount ?? 0} 项` : "后端未就绪"} />
        <AdminStatCard label="更新时间" value={formatAdminTimestamp(diagnostics.generatedAt)} helper={`缓存刷新间隔 ${Math.round(snapshot.refreshIntervalMs / 1000)} 秒`} />
        <AdminStatCard label="SQLite 文件" value={diagnostics.sqliteFilePath ?? "-"} helper="SQLite 模式下显示" />
        <AdminStatCard label="Postgres 来源" value={diagnostics.postgresConnectionSource ?? "-"} helper="Postgres 模式下显示" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <AdminPanel
          title="当前后端与准备情况"
          description="自动解析后端数据库，不再允许后台手动切换。"
          trailing={<HardDrive className="h-4 w-4 text-muted-foreground" />}
        >
          <div className="space-y-3">{[...diagnostics.backendChecks, ...diagnostics.repositoryChecks].map(renderStorageCheckCard)}</div>
        </AdminPanel>

        <AdminPanel
          title="功能范围"
          description="当前后端数据库提供的能力。"
          trailing={<Sparkles className="h-4 w-4 text-muted-foreground" />}
        >
          <div className="space-y-3">{diagnostics.capabilityItems.map(renderCapabilityCard)}</div>
        </AdminPanel>
      </div>
    </div>
  );
}

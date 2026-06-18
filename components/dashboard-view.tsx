"use client";

import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {Activity, ExternalLink, RefreshCcw} from "lucide-react";

import {ClientTime} from "@/components/client-time";
import {ProviderCard} from "@/components/provider-card";
import {ThemeToggle} from "@/components/theme-toggle";
import {fetchWithCache, setCache} from "@/lib/core/frontend-cache";
import type {AvailabilityPeriod, DashboardData} from "@/lib/types";
import type {SiteSettings} from "@/lib/types/site-settings";
import {cn} from "@/lib/utils";

interface DashboardViewProps {
  initialData: DashboardData;
  siteSettings: SiteSettings;
  canForceRefresh: boolean;
}

const DEFAULT_PERIOD: AvailabilityPeriod = "7d";
const AUTO_SYNC_RETRY_MS = 5_000;

const OFFICIAL_STATUS_LINKS = [
  {label: "OpenAI 官方状态页", href: "https://status.openai.com/"},
  {label: "Claude 官方状态页", href: "https://status.claude.com/"},
  {label: "Gemini 官方状态页", href: "https://aistudio.google.com/status"},
];

function getLatestCheckTimestamp(timelines: DashboardData["providerTimelines"]) {
  const timestamps = timelines
    .filter((timeline) => timeline.items.length > 0 && timeline.latest.checkedAt)
    .map((timeline) => new Date(timeline.latest.checkedAt).getTime())
    .filter(Number.isFinite);
  return timestamps.length > 0 ? Math.max(...timestamps) : null;
}

function hasPendingTimelines(timelines: DashboardData["providerTimelines"]) {
  return timelines.some((timeline) => timeline.latest.status === "pending");
}

function computeRemainingMs(
  pollIntervalMs: number | null | undefined,
  latestCheckTimestamp: number | null,
  clock: number = Date.now()
) {
  if (!pollIntervalMs || pollIntervalMs <= 0 || latestCheckTimestamp === null) {
    return null;
  }

  return Math.max(0, pollIntervalMs - (clock - latestCheckTimestamp));
}

const CornerPlus = ({className}: {className?: string}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1"
    className={cn("absolute h-4 w-4 text-muted-foreground/40", className)}
  >
    <line x1="12" y1="0" x2="12" y2="24" />
    <line x1="0" y1="12" x2="24" y2="12" />
  </svg>
);

export function DashboardView({
  initialData,
  siteSettings,
  canForceRefresh,
}: DashboardViewProps) {
  const [data, setData] = useState(initialData);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshLockRef = useRef(false);
  const autoSyncRetryAtRef = useRef(0);
  const [nextRefreshAnchor, setNextRefreshAnchor] = useState<number | null>(() =>
    getLatestCheckTimestamp(initialData.providerTimelines)
  );
  const [timeToNextRefresh, setTimeToNextRefresh] = useState<number | null>(() =>
    computeRemainingMs(
      initialData.pollIntervalMs,
      getLatestCheckTimestamp(initialData.providerTimelines),
      initialData.generatedAt
    )
  );
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);
  const [activeOfficialCardId, setActiveOfficialCardId] = useState<string | null>(null);

  const {providerTimelines, total, lastUpdated, pollIntervalLabel} = data;

  const refresh = useCallback(
    async (forceFresh?: boolean, revalidateIfFresh?: boolean) => {
      if (refreshLockRef.current) {
        return;
      }

      refreshLockRef.current = true;
      setIsRefreshing(true);
      try {
        const result = await fetchWithCache({
          trendPeriod: DEFAULT_PERIOD,
          forceFresh,
          revalidateIfFresh,
          onBackgroundUpdate: (newData) => {
            autoSyncRetryAtRef.current = 0;
            setNextRefreshAnchor(getLatestCheckTimestamp(newData.providerTimelines));
            setData(newData);
          },
        });
        autoSyncRetryAtRef.current = 0;
        setNextRefreshAnchor(getLatestCheckTimestamp(result.data.providerTimelines));
        setData(result.data);
      } catch (error) {
        console.error("[check-cx] 刷新失败", error);
      } finally {
        setIsRefreshing(false);
        refreshLockRef.current = false;
      }
    },
    []
  );

  useEffect(() => {
    setData(initialData);
    autoSyncRetryAtRef.current = 0;
    setNextRefreshAnchor(getLatestCheckTimestamp(initialData.providerTimelines));
    setCache(DEFAULT_PERIOD, initialData);
  }, [initialData]);

  useEffect(() => {
    if (!hasPendingTimelines(data.providerTimelines) || refreshLockRef.current) {
      return;
    }

    refresh(canForceRefresh, true).catch(() => undefined);
  }, [canForceRefresh, data.providerTimelines, refresh]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const media = window.matchMedia("(pointer: coarse)");
    const updatePointerType = () => {
      const hasTouch = typeof navigator !== "undefined" && navigator.maxTouchPoints > 0;
      setIsCoarsePointer(media.matches || hasTouch);
    };

    updatePointerType();
    media.addEventListener("change", updatePointerType);
    return () => media.removeEventListener("change", updatePointerType);
  }, []);

  useEffect(() => {
    if (!isCoarsePointer) {
      setActiveOfficialCardId(null);
    }
  }, [isCoarsePointer]);

  useEffect(() => {
    if (!data.pollIntervalMs || data.pollIntervalMs <= 0 || nextRefreshAnchor === null) {
      setTimeToNextRefresh(null);
      return;
    }

    const updateCountdown = () => {
      const now = Date.now();
      const remaining = computeRemainingMs(data.pollIntervalMs, nextRefreshAnchor, now);

      if (remaining === null) {
        setTimeToNextRefresh(null);
        return;
      }

      if (remaining > 0) {
        setTimeToNextRefresh(remaining);
        return;
      }

      if (autoSyncRetryAtRef.current > now) {
        setTimeToNextRefresh(autoSyncRetryAtRef.current - now);
        return;
      }

      autoSyncRetryAtRef.current = now + AUTO_SYNC_RETRY_MS;
      setTimeToNextRefresh(AUTO_SYNC_RETRY_MS);

      if (!refreshLockRef.current) {
        refresh(false, true).catch(() => undefined);
      }
    };

    updateCountdown();
    const countdownTimer = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(countdownTimer);
  }, [data.pollIntervalMs, nextRefreshAnchor, refresh]);

  const gridColsClass = useMemo(() => {
    if (providerTimelines.length > 4) {
      return "grid-cols-1 md:grid-cols-2 xl:grid-cols-3";
    }

    return "grid-cols-1 md:grid-cols-2";
  }, [providerTimelines.length]);

  return (
    <div className="relative isolate">
      <div className="pointer-events-none fixed inset-x-0 -top-40 -z-10 transform-gpu overflow-hidden blur-3xl sm:-top-80">
        <div className="relative left-[calc(50%-11rem)] aspect-[1155/678] w-[36.125rem] -translate-x-1/2 rotate-[30deg] bg-gradient-to-tr from-primary/30 to-primary/10 opacity-20 sm:left-[calc(50%-30rem)] sm:w-[72.1875rem]" />
      </div>
      <div className="pointer-events-none fixed inset-x-0 top-[calc(100%-13rem)] -z-10 transform-gpu overflow-hidden blur-3xl sm:top-[calc(100%-30rem)]">
        <div className="relative left-[calc(50%+3rem)] aspect-[1155/678] w-[36.125rem] -translate-x-1/2 bg-gradient-to-tr from-primary/20 to-primary/5 opacity-20 sm:left-[calc(50%+36rem)] sm:w-[72.1875rem]" />
      </div>

      <CornerPlus className="fixed left-4 top-4 h-6 w-6 text-border md:left-8 md:top-8" />
      <CornerPlus className="fixed right-4 top-4 h-6 w-6 text-border md:right-8 md:top-8" />
      <CornerPlus className="fixed bottom-4 left-4 h-6 w-6 text-border md:bottom-8 md:left-8" />
      <CornerPlus className="fixed bottom-4 right-4 h-6 w-6 text-border md:bottom-8 md:right-8" />

      <header className="relative z-10 mb-8 flex flex-col gap-5 sm:mb-12">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-3 sm:gap-4">
            <div
              aria-label="站点图标"
              role="img"
              className="h-12 w-12 rounded-xl border border-border/50 bg-background bg-cover bg-center shadow-sm sm:h-14 sm:w-14"
              style={{backgroundImage: `url(${siteSettings.siteIconUrl})`}}
            />
            <h1 className="min-w-0 text-3xl font-black leading-none text-foreground sm:text-5xl">
              {siteSettings.siteName}
            </h1>
            <ThemeToggle />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
            {OFFICIAL_STATUS_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/50 px-3 py-1.5 transition-colors hover:border-border/80 hover:text-foreground"
              >
                {link.label}
                <ExternalLink className="h-3 w-3" />
              </a>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 text-xs font-medium text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
            </span>
            <span>在线</span>
          </div>
          <div className="flex items-center gap-1.5">
            <RefreshCcw className={cn("h-3 w-3", isRefreshing && "animate-spin")} />
            <span>
              {lastUpdated ? (
                <>
                  更新于 <ClientTime value={lastUpdated} />
                </>
              ) : (
                "暂无检测记录"
              )}
            </span>
          </div>
          <span className="opacity-30">|</span>
          <span>{pollIntervalLabel} 轮询</span>
          <button
            type="button"
            onClick={() => refresh(canForceRefresh)}
            disabled={isRefreshing}
            className={cn(
              "rounded-full border border-border/60 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:border-border/80 hover:text-foreground",
              isRefreshing && "cursor-not-allowed opacity-60"
            )}
          >
            {canForceRefresh ? "立即检测" : "刷新"}
          </button>
        </div>
      </header>

      <main className="relative z-10 min-h-[50vh]">
        {total === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-border/50 bg-muted/20 py-20 text-center">
            <div className="mb-4 rounded-full bg-muted/50 p-4">
              <Activity className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold">尚无监控目标</h3>
            <p className="text-muted-foreground">请配置检查端点以开始监控</p>
          </div>
        ) : (
          <div className={`grid gap-6 ${gridColsClass}`}>
            {providerTimelines.map((timeline) => (
              <ProviderCard
                key={timeline.id}
                timeline={timeline}
                timeToNextRefresh={timeToNextRefresh}
                monitoredDays={data.monitoredDays}
                isCoarsePointer={isCoarsePointer}
                activeOfficialCardId={activeOfficialCardId}
                setActiveOfficialCardId={setActiveOfficialCardId}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

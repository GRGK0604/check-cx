"use client";

import {useEffect, useState} from "react";
import {Clock} from "lucide-react";
import {HoverCard, HoverCardContent, HoverCardTrigger} from "@/components/ui/hover-card";
import {Badge} from "@/components/ui/badge";
import {ClientTime} from "@/components/client-time";
import {getStatusDayKey} from "@/lib/core/calendar-day";
import {STATUS_META} from "@/lib/core/status";
import type {TimelineItem} from "@/lib/types";
import {cn} from "@/lib/utils";

interface StatusTimelineProps {
  /** 时间线条目列表，通常为最近 60 条按时间倒序的检测结果 */
  items: TimelineItem[];
  /** 距离下一次轮询刷新的剩余毫秒数，用于展示倒计时徽标 */
  nextRefreshInMs?: number | null;
  /** 是否处于维护模式 */
  isMaintenance?: boolean;
}

/** 时间线最多绘制的片段数量 */
const SEGMENT_LIMIT = 60;

const formatRemainingTime = (ms: number) => {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  }
  return `${seconds}s`;
};

const formatLatency = (value: number | null | undefined) =>
  typeof value === "number" ? `${value} ms` : "—";

const SUCCESS_STATUSES = new Set(["operational", "degraded"]);
const COUNTED_STATUSES = new Set([
  "operational",
  "degraded",
  "failed",
  "validation_failed",
  "error",
]);

function getTodayItems(items: TimelineItem[]) {
  const todayKey = getStatusDayKey(new Date());
  return items.filter((item) => getStatusDayKey(item.checkedAt) === todayKey);
}

function getAvailabilityPercentage(items: TimelineItem[]) {
  const countedItems = items.filter((item) => COUNTED_STATUSES.has(item.status));
  if (countedItems.length === 0) {
    return 100;
  }

  const successCount = countedItems.filter((item) => SUCCESS_STATUSES.has(item.status)).length;
  return (successCount / countedItems.length) * 100;
}

export function StatusTimeline({ items, nextRefreshInMs, isMaintenance }: StatusTimelineProps) {
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);
  const [activeSegmentKey, setActiveSegmentKey] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const media = window.matchMedia("(pointer: coarse)");
    const updatePointerType = () => {
      const hasTouch = typeof navigator !== "undefined" && navigator.maxTouchPoints > 0;
      const nextIsCoarse = media.matches || hasTouch;
      setIsCoarsePointer((prev) => {
        if (prev && !nextIsCoarse) {
          setActiveSegmentKey(null);
        }
        return nextIsCoarse;
      });
    };

    updatePointerType();
    media.addEventListener("change", updatePointerType);

    return () => media.removeEventListener("change", updatePointerType);
  }, []);

  if (isMaintenance) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-blue-500/30 bg-blue-500/5 p-4 text-xs text-blue-500">
        维护中 · 已暂停时间线采集
      </div>
    );
  }

  const todayItems = getTodayItems(items);
  const hasTodayItems = todayItems.length > 0;
  const displayItems = hasTodayItems ? todayItems.slice(0, SEGMENT_LIMIT) : [];
  const segments = Array.from({ length: SEGMENT_LIMIT }, (_, index) => displayItems[index] ?? null);
  const availabilityPercentage = getAvailabilityPercentage(todayItems);
  const nextRefreshLabel =
    typeof nextRefreshInMs === "number" ? formatRemainingTime(nextRefreshInMs) : null;

  return (
    <div className="space-y-3">
      {/* Header / Legend */}
      <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        <div className="flex items-center gap-2">
          <span>成功率 {availabilityPercentage.toFixed(2)}%</span>
        </div>
        <div className="flex items-center gap-2">
           {nextRefreshLabel ? (
             <span className="flex items-center gap-1.5 text-primary">
               <Clock className="h-3 w-3" />
               下次更新 {nextRefreshLabel}
             </span>
           ) : (
             <span className="opacity-50">手动刷新</span>
           )}
        </div>
      </div>

      {/* Timeline Bar */}
      <div className="relative h-8 w-full overflow-hidden rounded-sm">
        <div className="flex h-full w-full flex-row-reverse items-stretch gap-[3px]">
          {segments.map((segment, index) => {
            if (!segment) {
              return (
                <div
                  key={`placeholder-${index}`}
                  className={cn(
                    "h-full w-[6px] flex-1 rounded-[1px]",
                    hasTodayItems
                      ? "border border-dashed border-border/30 bg-muted/10"
                      : "bg-emerald-500"
                  )}
                  aria-label={hasTodayItems ? "暂无记录" : "今日默认正常"}
                />
              );
            }

            const preset = STATUS_META[segment.status];
            const segmentKey = `${segment.id}-${segment.checkedAt}`;
            const isOpen = activeSegmentKey === segmentKey;

            return (
              <HoverCard
                key={segmentKey}
                open={isOpen}
                openDelay={isCoarsePointer ? 0 : 100}
                onOpenChange={(nextOpen) =>
                  setActiveSegmentKey((current) => {
                    if (nextOpen) {
                      return segmentKey;
                    }
                    return current === segmentKey ? null : current;
                  })
                }
              >
                <HoverCardTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "relative block h-full w-[6px] flex-1 rounded-[1px] transition-all duration-200",
                      preset?.dot, // Use the existing bg utility from meta
                      "hover:opacity-80 hover:scale-y-110",
                      isOpen && "ring-1 ring-foreground/20 scale-y-110 z-10"
                    )}
                    aria-label={`${segment.checkedAt} · ${preset.label}`}
                    onClick={() =>
                      setActiveSegmentKey((current) =>
                        current === segmentKey ? null : segmentKey
                      )
                    }
                  />
                </HoverCardTrigger>
                <HoverCardContent
                  side="top"
                  className="w-64 space-y-3 rounded-xl border-border/50 bg-background/95 p-4 shadow-xl backdrop-blur-xl"
                >
                   <div className="flex items-center justify-between border-b border-border/50 pb-2">
                      <Badge variant={preset.badge} className="h-5 px-1.5 text-[10px]">{preset.label}</Badge>
                      <ClientTime value={segment.checkedAt} className="font-mono text-[10px] text-muted-foreground" />
                   </div>
                   
                   <div className="grid gap-2 text-xs">
                      <div className="flex items-center justify-between">
                         <span className="text-muted-foreground">延迟</span>
                         <span className="font-mono font-medium">{formatLatency(segment.latencyMs)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                         <span className="text-muted-foreground">连通</span>
                         <span className="font-mono font-medium">{formatLatency(segment.pingLatencyMs)}</span>
                      </div>
                   </div>
                   
                   {segment.message && (
                     <div className="rounded bg-muted/30 p-2 text-[10px] text-muted-foreground break-words">
                       {segment.message}
                     </div>
                   )}
                </HoverCardContent>
              </HoverCard>
            );
          })}
        </div>
      </div>
      
      {/* Axis labels */}
      <div className="flex justify-between text-[9px] font-medium uppercase tracking-widest text-muted-foreground/50">
        <span>较早</span>
        <span>现在</span>
      </div>
    </div>
  );
}

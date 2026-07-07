import type {TelegramAlertStateRecord, TelegramPushRecord} from "@/lib/storage/types";

/**
 * 判断 value 时间戳是否不早于 baseline 时间戳
 * 任一为空或非法时间返回 false
 */
export function isTimestampAtOrAfter(
  value: string | null | undefined,
  baseline: string | null
): boolean {
  if (!value || !baseline) {
    return false;
  }

  const timestamp = Date.parse(value);
  const baselineTimestamp = Date.parse(baseline);
  return (
    Number.isFinite(timestamp) &&
    Number.isFinite(baselineTimestamp) &&
    timestamp >= baselineTimestamp
  );
}

/**
 * 判断推送记录是否创建于本轮故障开始之前(属于历史故障)
 */
export function isRecordBeforeCurrentFailure(
  record: TelegramPushRecord,
  state: TelegramAlertStateRecord
): boolean {
  const recordCreatedAt = Date.parse(record.created_at);
  const failureStartedAt = Date.parse(state.failure_started_at ?? state.last_failure_at ?? "");

  return (
    Number.isFinite(recordCreatedAt) &&
    Number.isFinite(failureStartedAt) &&
    recordCreatedAt < failureStartedAt
  );
}

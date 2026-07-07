const DEFAULT_INTERVAL_SECONDS = 300;
const MIN_INTERVAL_SECONDS = 15;
const MAX_INTERVAL_SECONDS = 600;

// 官方状态检查默认间隔(5 分钟)
const DEFAULT_OFFICIAL_STATUS_INTERVAL_SECONDS = 300;
const MIN_OFFICIAL_STATUS_INTERVAL_SECONDS = 60;
const MAX_OFFICIAL_STATUS_INTERVAL_SECONDS = 3600; // 最长 1 小时

// 检查并发数配置
const DEFAULT_CHECK_CONCURRENCY = 5;
const MIN_CHECK_CONCURRENCY = 1;
const MAX_CHECK_CONCURRENCY = 20;

function parseIntervalSeconds() {
  const raw = process.env.CHECK_POLL_INTERVAL_SECONDS;
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return DEFAULT_INTERVAL_SECONDS;
}

function parseOfficialStatusIntervalSeconds() {
  const raw = process.env.OFFICIAL_STATUS_CHECK_INTERVAL_SECONDS;
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return DEFAULT_OFFICIAL_STATUS_INTERVAL_SECONDS;
}

export function getPollingIntervalSeconds() {
  const seconds = parseIntervalSeconds();
  return Math.max(MIN_INTERVAL_SECONDS, Math.min(MAX_INTERVAL_SECONDS, seconds));
}

export function getPollingIntervalMs() {
  return getPollingIntervalSeconds() * 1000;
}

export function getPollingIntervalLabel() {
  const seconds = getPollingIntervalSeconds();
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} 分钟`;
  }
  return `${seconds} 秒`;
}

/**
 * 获取官方状态检查间隔(秒)
 */
export function getOfficialStatusIntervalSeconds() {
  const seconds = parseOfficialStatusIntervalSeconds();
  return Math.max(
    MIN_OFFICIAL_STATUS_INTERVAL_SECONDS,
    Math.min(MAX_OFFICIAL_STATUS_INTERVAL_SECONDS, seconds)
  );
}

/**
 * 获取官方状态检查间隔(毫秒)
 */
export function getOfficialStatusIntervalMs() {
  return getOfficialStatusIntervalSeconds() * 1000;
}

function parseCheckConcurrency() {
  const raw = process.env.CHECK_CONCURRENCY;
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return DEFAULT_CHECK_CONCURRENCY;
}

/**
 * 获取检查并发数
 * 环境变量: CHECK_CONCURRENCY (默认 5, 范围 1-20)
 */
export function getCheckConcurrency() {
  const concurrency = parseCheckConcurrency();
  return Math.max(
    MIN_CHECK_CONCURRENCY,
    Math.min(MAX_CHECK_CONCURRENCY, concurrency)
  );
}

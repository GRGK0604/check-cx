const DEFAULT_STATUS_DAY_TIME_ZONE = "Asia/Shanghai";

const dayFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getStatusDayTimeZone(): string {
  const configured = process.env.NEXT_PUBLIC_STATUS_DAY_TIME_ZONE?.trim();
  return configured || DEFAULT_STATUS_DAY_TIME_ZONE;
}

function getDayFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = dayFormatterCache.get(timeZone);
  if (cached) {
    return cached;
  }

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    if (timeZone === DEFAULT_STATUS_DAY_TIME_ZONE) {
      formatter = new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    } else {
      formatter = getDayFormatter(DEFAULT_STATUS_DAY_TIME_ZONE);
    }
  }
  dayFormatterCache.set(timeZone, formatter);
  return formatter;
}

export function getStatusDayKey(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return getDayFormatter(getStatusDayTimeZone()).format(date);
}

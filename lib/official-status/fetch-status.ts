/**
 * 官方状态检查通用请求封装
 * 统一处理超时、HTTP 错误与异常，具体解析逻辑由各 Provider 传入
 */

import type {OfficialStatusResult} from "../types";
import {logError} from "../utils/error-handler";

const TIMEOUT_MS = 15000; // 15 秒超时

export async function fetchOfficialStatus<T>(
  label: string,
  url: string,
  parse: (data: T, checkedAt: string) => OfficialStatusResult
): Promise<OfficialStatusResult> {
  const checkedAt = new Date().toISOString();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        status: "unknown",
        message: `HTTP ${response.status}`,
        checkedAt,
      };
    }

    const data = (await response.json()) as T;
    return parse(data, checkedAt);
  } catch (error) {
    logError(label, error);

    if ((error as Error).name === "AbortError") {
      return {
        status: "unknown",
        message: "检查超时",
        checkedAt,
      };
    }

    return {
      status: "unknown",
      message: "检查失败",
      checkedAt,
    };
  }
}

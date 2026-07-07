/**
 * Anthropic 官方状态检查器
 * 状态 API: https://status.claude.com/api/v2/summary.json
 */

import type {OfficialHealthStatus, OfficialStatusResult} from "../types";
import {fetchOfficialStatus} from "./fetch-status";

const ANTHROPIC_STATUS_URL = "https://status.claude.com/api/v2/summary.json";

/**
 * Anthropic 状态 API 响应接口
 */
interface AnthropicSummaryResponse {
  page: {
    id: string;
    name: string;
    url: string;
    time_zone: string;
    updated_at: string;
  };
  components: Array<{
    id: string;
    name: string;
    status: string; // 'operational' | 'degraded_performance' | 'partial_outage' | 'major_outage'
    created_at: string;
    updated_at: string;
    position: number;
    description: string | null;
    showcase: boolean;
    group_id: string | null;
    page_id: string;
    group: boolean;
    only_show_if_degraded: boolean;
  }>;
  incidents: Array<unknown>;
  scheduled_maintenances: Array<unknown>;
  status: {
    indicator: string; // 'none' | 'minor' | 'major' | 'critical'
    description: string; // 'All Systems Operational' | ...
  };
}

/**
 * 检查 Anthropic 官方服务状态
 */
export async function checkAnthropicStatus(): Promise<OfficialStatusResult> {
  return fetchOfficialStatus<AnthropicSummaryResponse>(
    "checkAnthropicStatus",
    ANTHROPIC_STATUS_URL,
    parseAnthropicSummary
  );
}

/**
 * 解析 Anthropic 状态响应
 *
 * indicator 值映射:
 * - 'none': 所有系统正常
 * - 'minor': 轻微问题/性能降级
 * - 'major': 重大问题/部分服务不可用
 * - 'critical': 严重故障/服务中断
 *
 * component status 值:
 * - 'operational': 正常运行
 * - 'degraded_performance': 性能降级
 * - 'partial_outage': 部分中断
 * - 'major_outage': 重大故障
 */
function parseAnthropicSummary(
  data: AnthropicSummaryResponse,
  checkedAt: string
): OfficialStatusResult {
  const indicator = data.status.indicator.toLowerCase();
  const description = data.status.description;
  const components = data.components || [];

  // 收集非正常运行的组件
  const affectedComponents: string[] = [];
  let hasDownComponents = false;
  let hasDegradedComponents = false;

  for (const component of components) {
    const compStatus = component.status.toLowerCase();

    if (compStatus !== "operational") {
      affectedComponents.push(component.name);

      if (
        compStatus.includes("outage") ||
        compStatus.includes("down") ||
        compStatus === "major_outage"
      ) {
        hasDownComponents = true;
      } else if (
        compStatus.includes("degraded") ||
        compStatus === "degraded_performance"
      ) {
        hasDegradedComponents = true;
      }
    }
  }

  // 判断整体状态
  let status: OfficialHealthStatus;

  if (indicator === "none" && affectedComponents.length === 0) {
    status = "operational";
  } else if (
    indicator === "critical" ||
    indicator === "major" ||
    hasDownComponents
  ) {
    status = "down";
  } else if (indicator === "minor" || hasDegradedComponents) {
    status = "degraded";
  } else {
    status = "unknown";
  }

  // 生成状态消息
  let message = description;

  if (affectedComponents.length > 0) {
    const componentList = affectedComponents.slice(0, 3).join(", ");
    const suffix =
      affectedComponents.length > 3
        ? ` 等 ${affectedComponents.length} 个组件`
        : "";
    message = `${componentList}${suffix} 受影响`;
  }

  return {
    status,
    message: message || "未知状态",
    checkedAt,
    affectedComponents:
      affectedComponents.length > 0 ? affectedComponents : undefined,
  };
}

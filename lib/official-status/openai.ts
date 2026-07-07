/**
 * OpenAI 官方状态检查器
 * 状态 API: https://status.openai.com/proxy/status.openai.com
 */

import type {OfficialHealthStatus, OfficialStatusResult} from "../types";
import {fetchOfficialStatus} from "./fetch-status";

const OPENAI_STATUS_URL = "https://status.openai.com/proxy/status.openai.com";

/**
 * OpenAI 状态 API 响应接口
 */
interface OpenAIStatusResponse {
  summary: {
    components?: Array<{
      id: string;
      name: string;
      status_page_id: string;
    }>;
    affected_components?: Array<{
      component_id: string;
      status: string;
    }>;
    ongoing_incidents?: Array<{
      name: string;
      status: string;
      affected_components?: Array<{
        component_id: string;
        status: string;
      }>;
    }>;
  };
}

/**
 * 检查 OpenAI 官方服务状态
 */
export async function checkOpenAIStatus(): Promise<OfficialStatusResult> {
  return fetchOfficialStatus<OpenAIStatusResponse>(
    "checkOpenAIStatus",
    OPENAI_STATUS_URL,
    parseOpenAIStatus
  );
}

/**
 * 解析 OpenAI 状态响应
 */
function parseOpenAIStatus(
  data: OpenAIStatusResponse,
  checkedAt: string
): OfficialStatusResult {
  const components = data.summary.components || [];
  const affectedComponents = data.summary.affected_components || [];
  const ongoingIncidents = data.summary.ongoing_incidents || [];

  // 如果没有受影响的组件和进行中的事件,则服务正常
  if (affectedComponents.length === 0 && ongoingIncidents.length === 0) {
    return {
      status: "operational",
      message: "所有系统正常运行",
      checkedAt,
    };
  }

  // 构建组件 ID 到名称的映射
  const componentIdToName = new Map<string, string>();
  components.forEach((comp) => {
    componentIdToName.set(comp.id, comp.name);
  });

  // 收集受影响组件的 ID 和状态
  const affectedComponentIds = new Set<string>();
  affectedComponents.forEach((comp) => {
    affectedComponentIds.add(comp.component_id);
  });

  // 判断状态严重程度
  let status: OfficialHealthStatus = "degraded";
  let hasDownComponents = false;

  for (const comp of affectedComponents) {
    const compStatus = comp.status.toLowerCase();
    if (
      compStatus.includes("down") ||
      compStatus.includes("outage") ||
      compStatus.includes("major")
    ) {
      hasDownComponents = true;
      status = "down";
      break;
    }
  }

  // 检查进行中的事件
  for (const incident of ongoingIncidents) {
    const incidentStatus = incident.status.toLowerCase();
    if (
      incidentStatus.includes("down") ||
      incidentStatus.includes("outage") ||
      incidentStatus.includes("major")
    ) {
      hasDownComponents = true;
      status = "down";
    }

    // 收集事件中受影响的组件 ID
    if (incident.affected_components) {
      incident.affected_components.forEach((comp) => {
        affectedComponentIds.add(comp.component_id);
      });
    }
  }

  // 将组件 ID 转换为组件名称
  const componentList = Array.from(affectedComponentIds)
    .map((id) => componentIdToName.get(id))
    .filter((name): name is string => Boolean(name));

  // 生成状态消息
  const message =
    componentList.length > 0
      ? `${componentList.length} 个组件受影响: ${componentList.slice(0, 3).join(", ")}${componentList.length > 3 ? "..." : ""}`
      : hasDownComponents
        ? "服务出现故障"
        : "服务性能降级";

  return {
    status,
    message,
    checkedAt,
    affectedComponents: componentList,
  };
}

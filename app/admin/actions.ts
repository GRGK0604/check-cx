"use server";

import type {
  CheckConfigMutationInput,
  SiteSettingsMutationInput,
  StoredCheckConfigRow,
} from "@/lib/storage/types";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {isRedirectError} from "next/dist/client/components/redirect-error";

import {
  authenticateAdminUser,
  clearAdminSession,
  createInitialAdminUser,
  requireAdminSession,
  verifyTurnstile,
} from "@/lib/admin/auth";
import {ADMIN_NOTIFICATION_LEVELS, ADMIN_PROVIDER_TYPES} from "@/lib/admin/data";
import {invalidateStorageDiagnosticsCache} from "@/lib/admin/storage-diagnostics-cache";
import {invalidateDashboardCache} from "@/lib/core/dashboard-data";
import {clearPingCache} from "@/lib/core/global-state";
import {invalidateAvailabilityCache} from "@/lib/database/availability";
import {invalidateConfigCache} from "@/lib/database/config-loader";
import {
  retryTelegramPushRecord,
  saveTelegramPushConfig,
  sendTelegramPushTestMessage,
} from "@/lib/notifications/telegram";
import {normalizeProviderEndpoint} from "@/lib/providers/endpoint-utils";
import {deleteManagedSiteIconByUrl, ensureUploadedSiteIcon, saveUploadedSiteIcon, SITE_ICON_UPLOAD_FIELD_NAME} from "@/lib/site-icons";
import {invalidateSiteSettingsCache} from "@/lib/site-settings";
import {getControlPlaneStorage} from "@/lib/storage/resolver";
import {
  DEFAULT_SITE_SETTINGS,
  normalizeAdminEntryPath,
  SITE_SETTINGS_SINGLETON_KEY,
} from "@/lib/types/site-settings";
import {getErrorMessage, logError} from "@/lib/utils";

type JsonRecord = Record<string, unknown>;

function getText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function getOptionalText(formData: FormData, key: string): string | null {
  const value = getText(formData, key);
  return value ? value : null;
}

function splitReturnTo(value: string): {pathname: string; search: string} {
  const hashIndex = value.indexOf("#");
  const withoutHash = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
  const queryIndex = withoutHash.indexOf("?");

  if (queryIndex < 0) {
    return {pathname: withoutHash, search: ""};
  }

  return {
    pathname: withoutHash.slice(0, queryIndex),
    search: withoutHash.slice(queryIndex + 1),
  };
}

function normalizeInternalReturnTo(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (
    !raw ||
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    raw.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(raw)
  ) {
    return null;
  }

  const {pathname: rawPathname, search} = splitReturnTo(raw);
  if (!rawPathname || !rawPathname.startsWith("/") || rawPathname.startsWith("//")) {
    return null;
  }
  if (/%2f|%5c/i.test(rawPathname)) {
    return null;
  }

  let pathname: string;
  try {
    pathname = new URL(rawPathname, "https://modelhealthcheck.local").pathname;
  } catch {
    return null;
  }

  if (!pathname.startsWith("/") || pathname.startsWith("//")) {
    return null;
  }

  const normalizedPathname = pathname === "/" ? pathname : pathname.replace(/\/+$/, "");
  const normalizedSearch = search ? new URLSearchParams(search).toString() : "";
  return normalizedSearch ? `${normalizedPathname}?${normalizedSearch}` : normalizedPathname;
}

function normalizeReturnTo(value: string | null | undefined, fallback: string): string {
  return normalizeInternalReturnTo(value) ?? normalizeInternalReturnTo(fallback) ?? "/admin";
}

function getReturnTo(formData: FormData, key: string, fallback: string): string {
  return normalizeReturnTo(getOptionalText(formData, key), fallback);
}

function getBoolean(formData: FormData, key: string): boolean {
  return formData.get(key) === "on";
}

function normalizeSettingValue(value: string | null | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized ? normalized : fallback;
}

async function resolveSiteSettingsPayload(
  storage: Awaited<ReturnType<typeof getControlPlaneStorage>>
): Promise<SiteSettingsMutationInput> {
  const current = await storage.siteSettings.getSingleton(SITE_SETTINGS_SINGLETON_KEY);

  return {
    singleton_key: SITE_SETTINGS_SINGLETON_KEY,
    site_name: normalizeSettingValue(current?.site_name, DEFAULT_SITE_SETTINGS.siteName),
    site_description: normalizeSettingValue(
      current?.site_description,
      DEFAULT_SITE_SETTINGS.siteDescription
    ),
    site_icon_url: normalizeSettingValue(current?.site_icon_url, DEFAULT_SITE_SETTINGS.siteIconUrl),
    hero_badge: normalizeSettingValue(current?.hero_badge, DEFAULT_SITE_SETTINGS.heroBadge),
    hero_title_primary: normalizeSettingValue(
      current?.hero_title_primary,
      DEFAULT_SITE_SETTINGS.heroTitlePrimary
    ),
    hero_title_secondary: normalizeSettingValue(
      current?.hero_title_secondary,
      DEFAULT_SITE_SETTINGS.heroTitleSecondary
    ),
    hero_description: normalizeSettingValue(
      current?.hero_description,
      DEFAULT_SITE_SETTINGS.heroDescription
    ),
    footer_brand: normalizeSettingValue(current?.footer_brand, DEFAULT_SITE_SETTINGS.footerBrand),
    admin_console_title: normalizeSettingValue(
      current?.admin_console_title,
      DEFAULT_SITE_SETTINGS.adminConsoleTitle
    ),
    admin_console_description: normalizeSettingValue(
      current?.admin_console_description,
      DEFAULT_SITE_SETTINGS.adminConsoleDescription
    ),
    admin_entry_path: normalizeAdminEntryPath(
      current?.admin_entry_path ?? DEFAULT_SITE_SETTINGS.adminEntryPath
    ),
    telegram_notification_name: normalizeSettingValue(
      current?.telegram_notification_name,
      DEFAULT_SITE_SETTINGS.telegramNotificationName
    ),
  };
}

function parseJsonRecord(formData: FormData, key: string, label: string): JsonRecord | null {
  const raw = getOptionalText(formData, key);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${label} 必须是 JSON 对象`);
    }
    return parsed as JsonRecord;
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : `${label} 不是合法的 JSON 对象`
    );
  }
}

function parseModelList(raw: string): string[] {
  const seen = new Set<string>();

  return raw
    .split(/[\n,，;；、]+/)
    .map((item) => item.trim())
    .filter((item) => {
      if (!item || seen.has(item)) {
        return false;
      }

      seen.add(item);
      return true;
    });
}

function stripGeneratedModelSuffix(name: string, currentModel: string): string {
  const suffix = ` · ${currentModel}`;
  return name.endsWith(suffix) ? name.slice(0, -suffix.length).trim() : name;
}

function buildConfigName(baseName: string, model: string, totalModels: number): string {
  return totalModels > 1 ? `${baseName} · ${model}` : baseName;
}

function toCheckConfigMutationInput(
  row: StoredCheckConfigRow,
  overrides: Partial<CheckConfigMutationInput> = {}
): CheckConfigMutationInput {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    model: row.model,
    endpoint: row.endpoint,
    api_key: row.api_key,
    enabled: row.enabled,
    is_maintenance: row.is_maintenance,
    template_id: row.template_id ?? null,
    request_header: row.request_header ?? null,
    metadata: row.metadata ?? null,
    group_name: null,
    ...overrides,
  };
}

function getSelectedIds(formData: FormData, key = "selected_ids"): string[] {
  return formData
    .getAll(key)
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
}

function ensureProviderType(value: string): asserts value is (typeof ADMIN_PROVIDER_TYPES)[number] {
  if (!ADMIN_PROVIDER_TYPES.includes(value as (typeof ADMIN_PROVIDER_TYPES)[number])) {
    throw new Error("不支持的 Provider 类型");
  }
}

function ensureNotificationLevel(
  value: string
): asserts value is (typeof ADMIN_NOTIFICATION_LEVELS)[number] {
  if (
    !ADMIN_NOTIFICATION_LEVELS.includes(
      value as (typeof ADMIN_NOTIFICATION_LEVELS)[number]
    )
  ) {
    throw new Error("不支持的通知级别");
  }
}

function buildRedirectUrl(
  returnTo: string,
  noticeType: "success" | "error",
  message: string
): string {
  const {pathname, search} = splitReturnTo(normalizeReturnTo(returnTo, "/admin"));
  const params = new URLSearchParams(search);
  params.set("notice", message);
  params.set("noticeType", noticeType);
  return `${pathname}?${params.toString()}`;
}

function getPathnameFromReturnTo(returnTo: string): string {
  const {pathname} = splitReturnTo(normalizeReturnTo(returnTo, "/admin"));
  return pathname.replace(/\/+$/, "") || "/admin";
}

function getLoginPathFromReturnTo(returnTo: string): string {
  const pathname = getPathnameFromReturnTo(returnTo);
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    return "/admin/login";
  }

  const adminChildSegments = new Set([
    "configs",
    "templates",
    "notifications",
    "storage",
    "settings",
  ]);
  const segments = pathname.split("/").filter(Boolean);
  const lastSegment = segments.at(-1);
  const baseSegments = lastSegment && segments.length > 1 && adminChildSegments.has(lastSegment)
    ? segments.slice(0, -1)
    : segments;
  const basePath = baseSegments.length > 0 ? `/${baseSegments.join("/")}` : "/admin";

  return `${basePath}/login`;
}

function getActionLoginPath(formData: FormData, returnTo: string): string {
  return getReturnTo(formData, "loginReturnTo", getLoginPathFromReturnTo(returnTo));
}

function revalidateAdminPaths(returnTo: string): void {
  const basePaths = [
    "/",
    "/admin",
    "/admin/configs",
    "/admin/templates",
    "/admin/notifications",
    "/admin/storage",
    "/admin/settings",
    returnTo.split("?")[0],
  ];

  for (const path of new Set(basePaths)) {
    revalidatePath(path);
  }
}

function invalidateOperationalCaches(): void {
  invalidateConfigCache();
  invalidateDashboardCache();
  invalidateAvailabilityCache();
  invalidateStorageDiagnosticsCache();
  invalidateSiteSettingsCache();
  clearPingCache();
}

function getPasswordConfirmation(formData: FormData): string {
  const password = getText(formData, "password");
  const confirmPassword = getText(formData, "confirm_password");
  if (!password || !confirmPassword) {
    throw new Error("密码和确认密码不能为空");
  }
  if (password !== confirmPassword) {
    throw new Error("两次输入的密码不一致");
  }
  return password;
}

async function resolveApiKey(formData: FormData, id: string | null): Promise<string> {
  const apiKey = getOptionalText(formData, "api_key");
  if (apiKey) {
    return apiKey;
  }

  if (!id) {
    throw new Error("新增配置时必须填写密钥");
  }

  const storage = await getControlPlaneStorage();
  const data = await storage.checkConfigs.getById(id);

  if (!data?.api_key) {
    throw new Error("原有配置缺少密钥，请重新填写");
  }

  return data.api_key;
}

async function handleAction(
  formData: FormData,
  actionName: string,
  successMessage: string,
  operation: () => Promise<void>
): Promise<never> {
  const returnTo = getReturnTo(formData, "returnTo", "/admin");
  await requireAdminSession(getActionLoginPath(formData, returnTo));

  try {
    await operation();
    invalidateOperationalCaches();
    revalidateAdminPaths(returnTo);
    redirect(buildRedirectUrl(returnTo, "success", successMessage));
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }

    logError(`admin action failed: ${actionName}`, error);
    const message = error instanceof Error ? error.message : getErrorMessage(error);
    redirect(buildRedirectUrl(returnTo, "error", message));
  }
}

export async function bootstrapAdminAction(formData: FormData): Promise<never> {
  const returnTo = getReturnTo(formData, "returnTo", "/admin/storage");
  const loginReturnTo = getReturnTo(formData, "loginReturnTo", "/admin/login");

  try {
    await verifyTurnstile(formData, "admin_bootstrap");
    await createInitialAdminUser({
      username: getText(formData, "username"),
      password: getPasswordConfirmation(formData),
    });
    revalidateAdminPaths(returnTo);
    redirect(
      buildRedirectUrl(
        returnTo,
        "success",
        "首个管理员已创建。当前后端数据库已自动接入，可在存储诊断页查看状态。"
      )
    );
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }

    const message = error instanceof Error ? error.message : getErrorMessage(error);
    redirect(buildRedirectUrl(loginReturnTo, "error", message));
  }
}

export async function loginAdminAction(formData: FormData): Promise<never> {
  const returnTo = getReturnTo(formData, "returnTo", "/admin");
  const loginReturnTo = getReturnTo(formData, "loginReturnTo", "/admin/login");

  try {
    await verifyTurnstile(formData, "login");
    await authenticateAdminUser({
      username: getText(formData, "username"),
      password: getText(formData, "password"),
    });
    revalidateAdminPaths(returnTo);
    redirect(returnTo);
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }

    const message = error instanceof Error ? error.message : getErrorMessage(error);
    redirect(buildRedirectUrl(loginReturnTo, "error", message));
  }
}

export async function logoutAdminAction(formData?: FormData): Promise<never> {
  const returnTo = formData ? getReturnTo(formData, "returnTo", "/admin/login") : "/admin/login";
  await clearAdminSession();
  redirect(buildRedirectUrl(returnTo, "success", "已退出登录"));
}

export async function upsertSiteSettingsAction(formData: FormData): Promise<never> {
  const fallbackReturnTo = getReturnTo(formData, "returnTo", "/admin/settings");
  await requireAdminSession(getActionLoginPath(formData, fallbackReturnTo));
  let successReturnTo = fallbackReturnTo;

  try {
    const siteName = getText(formData, "site_name");
    const siteDescription = getText(formData, "site_description");
    const adminConsoleTitle = getText(formData, "admin_console_title");
    const adminConsoleDescription = getText(formData, "admin_console_description");
    const adminEntryPath = normalizeAdminEntryPath(getText(formData, "admin_entry_path"));
    successReturnTo = `${adminEntryPath}/settings`;

    if (
      !siteName ||
      !siteDescription ||
      !adminConsoleTitle ||
      !adminConsoleDescription
    ) {
      throw new Error("站点设置字段不能为空");
    }

    const storage = await getControlPlaneStorage();
    const currentSettings = await resolveSiteSettingsPayload(storage);
    await storage.siteSettings.upsert({
      ...currentSettings,
      site_name: siteName,
      site_description: siteDescription,
      footer_brand: siteName,
      admin_console_title: adminConsoleTitle,
      admin_console_description: adminConsoleDescription,
      admin_entry_path: adminEntryPath,
      telegram_notification_name: currentSettings.telegram_notification_name,
    });

    invalidateOperationalCaches();
    revalidateAdminPaths(successReturnTo);
    redirect(buildRedirectUrl(successReturnTo, "success", "站点设置已保存"));
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }

    logError("admin action failed: upsertSiteSettings", error);
    const message = error instanceof Error ? error.message : getErrorMessage(error);
    redirect(buildRedirectUrl(fallbackReturnTo, "error", message));
  }
}

export async function uploadSiteIconAction(formData: FormData): Promise<never> {
  return handleAction(formData, "uploadSiteIcon", "站点图标已上传并应用", async () => {
    const uploadedFile = ensureUploadedSiteIcon(formData.get(SITE_ICON_UPLOAD_FIELD_NAME));
    const storage = await getControlPlaneStorage();
    const currentSettings = await resolveSiteSettingsPayload(storage);
    const nextIconUrl = await saveUploadedSiteIcon(uploadedFile);

    try {
      await storage.siteSettings.upsert({
        ...currentSettings,
        site_icon_url: nextIconUrl,
      });
    } catch (error) {
      await deleteManagedSiteIconByUrl(nextIconUrl);
      throw error;
    }

    await deleteManagedSiteIconByUrl(currentSettings.site_icon_url);
  });
}

export async function resetSiteIconAction(formData: FormData): Promise<never> {
  return handleAction(formData, "resetSiteIcon", "站点图标已恢复默认", async () => {
    const storage = await getControlPlaneStorage();
    const currentSettings = await resolveSiteSettingsPayload(storage);

    await storage.siteSettings.upsert({
      ...currentSettings,
      site_icon_url: DEFAULT_SITE_SETTINGS.siteIconUrl,
    });

    await deleteManagedSiteIconByUrl(currentSettings.site_icon_url);
  });
}

export async function saveTelegramPushConfigAction(formData: FormData): Promise<never> {
  return handleAction(formData, "saveTelegramPushConfig", "Telegram 推送配置已保存", async () => {
    await saveTelegramPushConfig({
      projectName: getText(formData, "project_name"),
      botToken: getText(formData, "bot_token"),
      chatId: getText(formData, "chat_id"),
      autoPushEnabled: getBoolean(formData, "auto_push_enabled"),
    });
  });
}

export async function sendTelegramPushTestAction(formData: FormData): Promise<never> {
  return handleAction(formData, "sendTelegramPushTest", "Telegram 测试推送已发送", async () => {
    await sendTelegramPushTestMessage(getText(formData, "test_message"));
  });
}

export async function retryTelegramPushRecordAction(formData: FormData): Promise<never> {
  return handleAction(formData, "retryTelegramPushRecord", "Telegram 推送记录已重试", async () => {
    const id = getText(formData, "id");
    if (!id) {
      throw new Error("缺少推送记录 ID");
    }

    const record = await retryTelegramPushRecord(id);
    if (record.status !== "sent") {
      throw new Error(record.failure_reason || "Telegram 推送重试失败");
    }
  });
}

export async function upsertConfigAction(formData: FormData): Promise<never> {
  return handleAction(formData, "upsertConfig", "检测配置已保存", async () => {
    const id = getOptionalText(formData, "id");
    const name = getText(formData, "name");
    const type = getText(formData, "type");
    const modelInput = getText(formData, "model");
    const endpoint = getText(formData, "endpoint");

    if (!name || !type || !modelInput || !endpoint) {
      throw new Error("名称、类型、模型和接口地址不能为空");
    }

    ensureProviderType(type);
    const normalizedEndpoint = normalizeProviderEndpoint(type, endpoint);
    const models = parseModelList(modelInput);

    if (models.length === 0) {
      throw new Error("请至少填写一个模型");
    }

    const storage = await getControlPlaneStorage();
    const existingConfig = id ? await storage.checkConfigs.getById(id) : null;

    if (id && !existingConfig) {
      throw new Error("配置不存在或已被删除");
    }

    const payload = {
      name,
      type,
      endpoint: normalizedEndpoint,
      api_key: await resolveApiKey(formData, id),
      enabled: getBoolean(formData, "enabled"),
      is_maintenance: getBoolean(formData, "is_maintenance"),
      template_id: getOptionalText(formData, "template_id"),
      group_name: null,
      request_header: parseJsonRecord(formData, "request_header", "请求头"),
      metadata: parseJsonRecord(formData, "metadata", "附加参数"),
    };

    if (!id) {
      await Promise.all(
        models.map((model) =>
          storage.checkConfigs.upsert({
            ...payload,
            name: buildConfigName(name, model, models.length),
            model,
          })
        )
      );
      return;
    }

    if (models.length === 1) {
      await storage.checkConfigs.upsert({id, ...payload, model: models[0]});
      return;
    }

    const baseName = stripGeneratedModelSuffix(name, existingConfig?.model ?? "");
    const [primaryModel, ...extraModels] = models;

    await storage.checkConfigs.upsert({
      id,
      ...payload,
      name: buildConfigName(baseName, primaryModel, models.length),
      model: primaryModel,
    });

    await Promise.all(
      extraModels.map((model) =>
        storage.checkConfigs.upsert({
          ...payload,
          name: buildConfigName(baseName, model, models.length),
          model,
        })
      )
    );
  });
}

export async function deleteConfigAction(formData: FormData): Promise<never> {
  return handleAction(formData, "deleteConfig", "检测配置已删除", async () => {
    const id = getText(formData, "id");
    if (!id) {
      throw new Error("缺少配置 ID");
    }

    const storage = await getControlPlaneStorage();
    await storage.checkConfigs.delete(id);
  });
}

export async function manageConfigsAction(formData: FormData): Promise<never> {
  return handleAction(formData, "manageConfigs", "批量操作已完成", async () => {
    const ids = getSelectedIds(formData);
    const action = getText(formData, "batch_action");

    if (ids.length === 0) {
      throw new Error("请先至少选择一个配置");
    }

    const storage = await getControlPlaneStorage();

    if (action === "delete") {
      await Promise.all(ids.map((itemId) => storage.checkConfigs.delete(itemId)));
      return;
    }

    const nextStateByAction: Record<string, Partial<CheckConfigMutationInput>> = {
      enable: {enabled: true},
      disable: {enabled: false},
      maintenance_on: {is_maintenance: true},
      maintenance_off: {is_maintenance: false},
    };

    const nextState = nextStateByAction[action];
    if (!nextState) {
      throw new Error("不支持的批量操作");
    }

    const rows = await Promise.all(ids.map((itemId) => storage.checkConfigs.getById(itemId)));
    const existingRows = rows.filter((row): row is StoredCheckConfigRow => Boolean(row));

    if (existingRows.length === 0) {
      throw new Error("选中的配置不存在或已被删除");
    }

    await Promise.all(
      existingRows.map((row) => storage.checkConfigs.upsert(toCheckConfigMutationInput(row, nextState)))
    );
  });
}

export async function upsertTemplateAction(formData: FormData): Promise<never> {
  return handleAction(formData, "upsertTemplate", "请求模板已保存", async () => {
    const id = getOptionalText(formData, "id");
    const name = getText(formData, "name");
    const type = getText(formData, "type");

    if (!name || !type) {
      throw new Error("模板名称和类型不能为空");
    }

    ensureProviderType(type);

    const storage = await getControlPlaneStorage();
    await storage.requestTemplates.upsert({
      id,
      name,
      type,
      request_header: parseJsonRecord(formData, "request_header", "模板请求头"),
      metadata: parseJsonRecord(formData, "metadata", "模板附加参数"),
    });
  });
}

export async function deleteTemplateAction(formData: FormData): Promise<never> {
  return handleAction(formData, "deleteTemplate", "请求模板已删除", async () => {
    const id = getText(formData, "id");
    if (!id) {
      throw new Error("缺少模板 ID");
    }

    const storage = await getControlPlaneStorage();
    await storage.requestTemplates.delete(id);
  });
}

export async function upsertNotificationAction(formData: FormData): Promise<never> {
  return handleAction(formData, "upsertNotification", "系统通知已保存", async () => {
    const id = getOptionalText(formData, "id");
    const message = getText(formData, "message");
    const level = getText(formData, "level");

    if (!message || !level) {
      throw new Error("通知内容和级别不能为空");
    }

    ensureNotificationLevel(level);

    const storage = await getControlPlaneStorage();
    await storage.notifications.upsert({
      id,
      message,
      level,
      is_active: getBoolean(formData, "is_active"),
    });
  });
}

export async function deleteNotificationAction(formData: FormData): Promise<never> {
  return handleAction(
    formData,
    "deleteNotification",
    "系统通知已删除",
    async () => {
      const id = getText(formData, "id");
      if (!id) {
        throw new Error("缺少通知 ID");
      }

      const storage = await getControlPlaneStorage();
      await storage.notifications.delete(id);
    }
  );
}

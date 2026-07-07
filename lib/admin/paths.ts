export const DEFAULT_ADMIN_BASE_PATH = "/admin";

export function getAdminPath(basePath: string | null | undefined, suffix = ""): string {
  const normalizedBase = (basePath?.trim() || DEFAULT_ADMIN_BASE_PATH).replace(/\/+$/, "");
  const normalizedSuffix = suffix.replace(/^\/+/, "");

  if (!normalizedSuffix) {
    return normalizedBase || DEFAULT_ADMIN_BASE_PATH;
  }

  return `${normalizedBase || DEFAULT_ADMIN_BASE_PATH}/${normalizedSuffix}`;
}

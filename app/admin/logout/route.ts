import {NextResponse} from "next/server";
import {notFound} from "next/navigation";

import {clearAdminSession} from "@/lib/admin/auth";
import {loadSiteSettings} from "@/lib/site-settings";
import {DEFAULT_ADMIN_ENTRY_PATH} from "@/lib/types/site-settings";

export async function POST(request: Request) {
  const siteSettings = await loadSiteSettings();
  if (siteSettings.adminEntryPath !== DEFAULT_ADMIN_ENTRY_PATH) {
    notFound();
  }

  await clearAdminSession();
  const loginPath = `${siteSettings.adminEntryPath}/login`;

  const url = new URL(
    `${loginPath}?notice=%E5%B7%B2%E9%80%80%E5%87%BA%E7%99%BB%E5%BD%95&noticeType=success`,
    request.url
  );
  return NextResponse.redirect(url, {status: 303});
}

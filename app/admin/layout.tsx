import type {ReactNode} from "react";
import {notFound} from "next/navigation";

import {AdminShell} from "@/components/admin/admin-shell";
import {getAdminSession} from "@/lib/admin/auth";
import {loadSiteSettings} from "@/lib/site-settings";
import {DEFAULT_ADMIN_ENTRY_PATH} from "@/lib/types/site-settings";

export const dynamic = "force-dynamic";

export default async function AdminLayout({children}: {children: ReactNode}) {
  const [session, siteSettings] = await Promise.all([getAdminSession(), loadSiteSettings()]);

  if (siteSettings.adminEntryPath !== DEFAULT_ADMIN_ENTRY_PATH) {
    notFound();
  }

  return (
    <AdminShell
      username={session?.username}
      siteName={siteSettings.siteName}
      consoleTitle={siteSettings.adminConsoleTitle}
      adminBasePath="/admin"
    >
      {children}
    </AdminShell>
  );
}

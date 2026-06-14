import {DashboardBootstrap} from "@/components/dashboard-bootstrap";
import {getAdminSession} from "@/lib/admin/auth";
import {loadDashboardData} from "@/lib/core/dashboard-data";
import {loadSiteSettings} from "@/lib/site-settings";

export default async function Home() {
  const [siteSettings, adminSession, initialData] = await Promise.all([
    loadSiteSettings(),
    getAdminSession(),
    loadDashboardData({refreshMode: "missing", trendPeriod: "7d"}),
  ]);

  return (
    <div className="py-8 md:py-16">
      <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-3 sm:gap-8 sm:px-6 lg:px-12">
        <DashboardBootstrap
          initialData={initialData}
          siteSettings={siteSettings}
          canForceRefresh={Boolean(adminSession)}
        />
      </main>
    </div>
  );
}

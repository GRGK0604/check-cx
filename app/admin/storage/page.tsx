import {StorageDiagnosticsClient} from "@/components/admin/storage-diagnostics-client";
import {AdminPageIntro, AdminStatusBanner} from "@/components/admin/admin-primitives";
import {requireAdminSession} from "@/lib/admin/auth";
import {getAdminPath} from "@/lib/admin/paths";
import {getStorageDiagnosticsSnapshot} from "@/lib/admin/storage-diagnostics-cache";
import {getAdminFeedback} from "@/lib/admin/view";

export const dynamic = "force-dynamic";

interface AdminStoragePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  adminBasePath?: string;
}

export default async function AdminStoragePage({
  searchParams,
  adminBasePath = "/admin",
}: AdminStoragePageProps) {
  await requireAdminSession(getAdminPath(adminBasePath, "login"));
  const params = await searchParams;
  const feedback = getAdminFeedback(params);
  const initialSnapshot = getStorageDiagnosticsSnapshot({
    force: Boolean(feedback),
    triggerRefresh: true,
  });

  return (
    <div className="space-y-6">
      <AdminPageIntro
        title="存储诊断"
        description="自动读取当前后端数据库状态，不再允许后台手动修改存储后端。"
      />

      {feedback ? <AdminStatusBanner type={feedback.type} message={feedback.message} /> : null}

      <StorageDiagnosticsClient
        initialSnapshot={initialSnapshot}
        refreshAfterMount={Boolean(feedback)}
        dataEndpoint="/api/internal/storage-diagnostics"
      />
    </div>
  );
}

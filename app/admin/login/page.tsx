import Link from "next/link";

import {bootstrapAdminAction, loginAdminAction} from "@/app/admin/actions";
import {AdminField, AdminInput, AdminStatusBanner} from "@/components/admin/admin-primitives";
import {TurnstileWidget} from "@/components/admin/turnstile-widget";
import {Button} from "@/components/ui/button";
import {
  ensureLoggedOutForLoginPage,
  getTurnstileSiteKey,
  hasAdminUsers,
  isTurnstileEnabled,
} from "@/lib/admin/auth";
import {getAdminPath} from "@/lib/admin/paths";
import {getAdminFeedback} from "@/lib/admin/view";
import {resolveDatabaseBackend} from "@/lib/storage/resolver";

export const dynamic = "force-dynamic";

interface AdminLoginPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  adminBasePath?: string;
}

export default async function AdminLoginPage({
  searchParams,
  adminBasePath = "/admin",
}: AdminLoginPageProps) {
  const adminHomePath = getAdminPath(adminBasePath);
  const adminLoginPath = getAdminPath(adminBasePath, "login");
  const adminStoragePath = getAdminPath(adminBasePath, "storage");

  await ensureLoggedOutForLoginPage(adminHomePath);

  const params = await searchParams;
  const feedback = getAdminFeedback(params);
  const turnstileSiteKey = getTurnstileSiteKey();
  const turnstileEnabled = isTurnstileEnabled();
  const backend = resolveDatabaseBackend();
  let adminExists = false;
  let availabilityError: string | null = null;

  try {
    adminExists = await hasAdminUsers();
  } catch (error) {
    availabilityError =
      error instanceof Error && error.message.trim()
        ? error.message
        : "当前无法连接管理员账号存储，请确认数据库后端已正确配置。";
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-background p-4 text-foreground selection:bg-primary/20">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute left-[20%] top-[20%] h-96 w-96 rounded-full bg-primary/10 blur-[120px] mix-blend-screen" />
        <div className="absolute bottom-[20%] right-[20%] h-96 w-96 rounded-full bg-blue-500/10 blur-[120px] mix-blend-screen" />
      </div>

      <div className="relative w-full max-w-md space-y-8">
        <div className="space-y-4 text-center">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-full bg-muted/40 px-4 py-1.5 text-sm font-medium text-muted-foreground backdrop-blur-md transition-all hover:bg-muted/60 hover:text-foreground active:scale-[0.97]"
          >
            返回公开页面
          </Link>
          <div className="space-y-2">
            <h1 className="bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text text-3xl font-semibold tracking-tight text-transparent sm:text-4xl">
              {adminExists ? "验证管理员身份" : "初始化控制面板"}
            </h1>
            <p className="text-sm text-muted-foreground/80">
              {adminExists ? "继续操作前请先登录。" : "没有检测到可用凭证，请创建初始管理员账号。"}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-center gap-3 text-xs font-medium text-muted-foreground">
          <div className="flex items-center gap-1.5 rounded-md border border-border/40 bg-background/50 px-2.5 py-1 backdrop-blur-sm">
            <div className="h-1.5 w-1.5 rounded-full bg-primary" />
            {backend.provider.toUpperCase()}
          </div>
          {turnstileEnabled ? (
            <div className="flex items-center gap-1.5 rounded-md border border-border/40 bg-background/50 px-2.5 py-1 backdrop-blur-sm">
              <div className="h-1.5 w-1.5 rounded-full bg-green-500" />
              TURNSTILE
            </div>
          ) : null}
        </div>

        <div className="overflow-hidden rounded-2xl border border-border/40 bg-background/40 shadow-2xl backdrop-blur-xl">
          <div className="p-6 sm:p-8">
            {feedback ? (
              <div className="mb-6">
                <AdminStatusBanner type={feedback.type} message={feedback.message} />
              </div>
            ) : null}

            {availabilityError ? (
              <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
                {availabilityError}
              </div>
            ) : (
              <form action={adminExists ? loginAdminAction : bootstrapAdminAction} className="space-y-5">
                <input type="hidden" name="returnTo" value={adminExists ? adminHomePath : adminStoragePath} />
                <input type="hidden" name="loginReturnTo" value={adminLoginPath} />

                <AdminField label="用户名">
                  <AdminInput name="username" placeholder="admin" required className="bg-background/50 focus:bg-background" />
                </AdminField>

                <AdminField label="密码">
                  <AdminInput name="password" type="password" placeholder="输入密码" required className="bg-background/50 focus:bg-background" />
                </AdminField>

                {adminExists ? null : (
                  <AdminField label="确认密码">
                    <AdminInput
                      name="confirm_password"
                      type="password"
                      placeholder="再次输入密码"
                      required
                      className="bg-background/50 focus:bg-background"
                    />
                  </AdminField>
                )}

                <div className="mt-2">
                  <TurnstileWidget
                    action={adminExists ? "login" : "admin_bootstrap"}
                    siteKey={turnstileSiteKey}
                  />
                </div>

                <Button type="submit" className="h-11 w-full text-base font-medium shadow-lg shadow-primary/20 transition-all hover:shadow-primary/30">
                  {adminExists ? "登录" : "初始化"}
                </Button>
              </form>
            )}
          </div>
        </div>

        <div className="text-center text-xs text-muted-foreground/60">
          自建后端数据库
        </div>
      </div>
    </div>
  );
}

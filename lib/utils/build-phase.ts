/**
 * 判断当前是否处于 Next.js 生产构建阶段
 * 构建期不应启动轮询器或访问数据库
 */
export function isBuildPhase(): boolean {
  const maybeProcess = Reflect.get(globalThis, "process");
  if (!maybeProcess || typeof maybeProcess !== "object") {
    return false;
  }

  const maybeEnv = Reflect.get(maybeProcess, "env");
  if (!maybeEnv || typeof maybeEnv !== "object") {
    return false;
  }

  return Reflect.get(maybeEnv, "NEXT_PHASE") === "phase-production-build";
}

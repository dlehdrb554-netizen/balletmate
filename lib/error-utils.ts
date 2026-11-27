type AppErrorLike = { code?: string; message?: string; details?: string; hint?: string; status?: number } | string | null | undefined;

const SAFE_MESSAGES = [
  "이미 사용 중인 계정입니다.",
  "현재 비밀번호가 올바르지 않습니다.",
  "이미 사용 중인 닉네임입니다.",
];

export function getUserErrorMessage(error: AppErrorLike, fallback = "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."): string {
  const value = typeof error === "string" ? { message: error } : (error || {});
  const code = String(value.code || "");
  const raw = String(value.message || "");
  if (SAFE_MESSAGES.includes(raw)) return raw;

  if (__DEV__) {
    console.error("[Balletmate][APP_ERROR]", {
      code: code || "UNKNOWN",
      message: raw.slice(0, 500),
      details: String(value.details || "").slice(0, 300) || undefined,
      hint: String(value.hint || "").slice(0, 200) || undefined,
    });
  }

  if (code === "23505") return "이미 등록된 정보입니다. 입력 내용을 확인해 주세요.";
  if (code === "23503") return "연결된 정보가 있어 처리할 수 없습니다. 관련 항목을 먼저 확인해 주세요.";
  if (code === "23514" || code === "22P02") return "입력한 정보의 형식이 올바르지 않습니다. 내용을 확인해 주세요.";
  if (code === "42501" || code === "PGRST301") return "로그인이 필요하거나 해당 작업을 수행할 권한이 없습니다.";
  if (code === "PGRST116") return "요청한 정보를 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.";
  if (code.startsWith("08") || code === "PGRST000" || /network request failed|failed to fetch|timeout/i.test(raw)) return "네트워크 연결을 확인한 뒤 다시 시도해 주세요.";
  return fallback;
}

export function logAppError(scope: string, error: AppErrorLike): void {
  if (!__DEV__) return;
  const value = typeof error === "string" ? { message: error } : (error || {});
  console.error("[Balletmate][" + scope + "]", {
    code: String(value.code || "UNKNOWN"),
    message: String(value.message || error || "Unknown error").slice(0, 500),
    details: String(value.details || "").slice(0, 300) || undefined,
    hint: String(value.hint || "").slice(0, 200) || undefined,
  });
}

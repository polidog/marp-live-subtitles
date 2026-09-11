/** spec2 §38 — Translation Error の分類 */
import type { TranslationError, TranslationErrorCode } from "../types";

export function translationError(
  code: TranslationErrorCode,
  message: string,
  recoverable = false,
): TranslationError {
  return { code, message, recoverable };
}

/** popup / トレースに出す表示形式。複数箇所で同じ文字列を組み立てない。 */
export function formatError(error: TranslationError): string {
  return `${error.code}: ${error.message}`;
}

/** API から返ってきた文言・WebSocket close code から原因を推定する */
export function classify(message: string, closeCode?: number): TranslationError {
  const m = message || "";

  if (/API key|UNAUTHENTICATED|401|403|PERMISSION_DENIED/i.test(m) || closeCode === 1008) {
    return translationError("AUTH_FAILED", `認証に失敗しました: ${m}`);
  }
  if (/expired|EXPIRED/i.test(m)) {
    return translationError("TOKEN_EXPIRED", `トークンの期限が切れました: ${m}`, true);
  }
  // 課金上限は張り直しても直らない。回さずにそのまま見せる。
  if (/spending cap|billing|exceeded its monthly/i.test(m)) {
    return translationError("RATE_LIMITED", `Gemini の利用上限に達しています: ${m}`);
  }
  if (/RESOURCE_EXHAUSTED|429|quota|rate limit/i.test(m)) {
    return translationError("RATE_LIMITED", `レート制限に達しました: ${m}`, true);
  }
  if (/Invalid JSON payload|Unknown name|Cannot find field/i.test(m)) {
    return translationError("SESSION_FAILED", `setup がサーバーに受け付けられません: ${m}`);
  }
  if (/model|not found|404|INVALID_ARGUMENT/i.test(m)) {
    return translationError("SESSION_FAILED", `セッションを開始できません: ${m}`);
  }
  if (closeCode != null) {
    return translationError("WEBSOCKET_FAILED", m || `接続が切断されました (${closeCode})`, true);
  }
  return translationError("PROVIDER_ERROR", m || "Gemini Live API エラー", true);
}

export function micError(e: unknown): TranslationError {
  const name = (e as Error)?.name ?? "";
  const message = String((e as Error)?.message ?? e);
  // 原因を握りつぶさない。NotAllowedError なのか NotFoundError なのかで対処が変わる。
  const detail = name ? `${name}: ${message}` : message;

  if (/NotAllowedError|SecurityError|Permission/i.test(name + message)) {
    return translationError(
      "MIC_PERMISSION_DENIED",
      `マイクが許可されていません (${detail})。拡張 ${chrome.runtime.id} の Options で許可してください。`,
    );
  }
  return translationError("MIC_UNAVAILABLE", `マイクを利用できません (${detail})`);
}

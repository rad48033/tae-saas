/**
 * 트랜잭션 메일 발송.
 *
 * 현재 taest에는 SMTP·Resend 키가 등록돼 있지 않으므로, 키가 없으면 "발송하지 못함"을
 * 정확히 돌려주고 관리자(/admin)가 링크를 직접 전달하는 경로로 이어집니다.
 * RESEND_API_KEY를 넣으면 같은 코드가 그대로 실제 발송으로 바뀝니다.
 */
export interface MailStatus {
  configured: boolean;
  provider: "resend" | null;
  from: string;
  /** 화면·로그에 보여 줄 짧은 사유 */
  reason: string | null;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface MailResult {
  ok: boolean;
  /** 키가 없어 보내지 않았는지(실패가 아니라 "미설정") */
  skipped: boolean;
  error: string | null;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export function mailStatus(env: Record<string, string | undefined> = process.env): MailStatus {
  const key = env.RESEND_API_KEY?.trim();
  const from = env.MAIL_FROM?.trim() || "taest <onboarding@resend.dev>";
  if (!key) {
    return {
      configured: false,
      provider: null,
      from,
      reason:
        "RESEND_API_KEY가 없어 메일을 보낼 수 없습니다. Vercel 환경변수에 RESEND_API_KEY와 MAIL_FROM(인증된 도메인 주소)을 넣으면 바로 발송됩니다.",
    };
  }
  return { configured: true, provider: "resend", from, reason: null };
}

export async function sendMail(
  message: MailMessage,
  options: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch } = {},
): Promise<MailResult> {
  const env = options.env ?? process.env;
  const status = mailStatus(env);
  if (!status.configured) {
    return { ok: false, skipped: true, error: status.reason };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY?.trim()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: status.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { ok: false, skipped: false, error: `메일 발송 실패(HTTP ${response.status}): ${body.slice(0, 200)}` };
    }
    return { ok: true, skipped: false, error: null };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      error: `메일 발송 요청에 실패했습니다: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** 비밀번호 재설정 안내 메일 본문(플레인 텍스트 + 간단한 HTML). */
export function resetMailBody(input: { link: string; displayName: string | null; expiresMinutes: number }): {
  text: string;
  html: string;
} {
  const who = input.displayName?.trim() ? `${input.displayName.trim()}님` : "안녕하세요";
  const text = [
    `${who}, taest 비밀번호 재설정 안내입니다.`,
    "",
    "아래 링크를 열어 새 비밀번호를 정해 주세요.",
    input.link,
    "",
    `- 링크는 ${input.expiresMinutes}분 동안 한 번만 쓸 수 있습니다.`,
    "- 본인이 요청하지 않았다면 이 메일을 무시하세요. 비밀번호는 바뀌지 않습니다.",
    "",
    "taest · 콘텐츠 스튜디오",
  ].join("\n");

  const html = `<!doctype html><html lang="ko"><body style="margin:0;background:#f8fafc;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#0f172a">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:28px">
    <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.08em;color:#64748b">TAEST</p>
    <h1 style="margin:0 0 12px;font-size:20px">비밀번호 재설정</h1>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#334155">${escapeHtml(who)}, 아래 버튼을 눌러 새 비밀번호를 정해 주세요.</p>
    <a href="${input.link}" style="display:inline-block;background:#5b3bf0;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 20px;border-radius:12px">비밀번호 다시 정하기</a>
    <p style="margin:20px 0 0;font-size:12px;line-height:1.6;color:#64748b">링크는 ${input.expiresMinutes}분 동안 한 번만 쓸 수 있습니다.<br/>본인이 요청하지 않았다면 이 메일을 무시하세요.</p>
    <p style="margin:16px 0 0;font-size:11px;word-break:break-all;color:#94a3b8">${escapeHtml(input.link)}</p>
  </div>
</body></html>`;

  return { text, html };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

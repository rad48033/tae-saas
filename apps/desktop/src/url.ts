/**
 * 서버 주소 정규화·검증 (Electron 메인/설정 화면 공용, 순수 함수).
 *
 * - 스킴이 없으면 https:// 를 붙입니다.
 * - 원격 주소는 https:// 만 허용하고, 로컬 개발(localhost·127.0.0.1)은 http:// 도 허용합니다.
 * - 끝의 "/" 와 쿼리·해시는 떼어 저장합니다.
 */
export type UrlCheck = { ok: true; url: string; origin: string } | { ok: false; error: string };

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

export function normalizeServerUrl(input: string | null | undefined): UrlCheck {
  const raw = (input ?? "").trim();
  if (!raw) return { ok: false, error: "서버 주소를 입력해 주세요." };
  if (/\s/.test(raw)) return { ok: false, error: "주소에는 공백이 들어갈 수 없습니다." };

  const candidate = HAS_SCHEME.test(raw) ? raw : `https://${raw}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, error: "주소 형식을 확인해 주세요. 예: https://taest.info" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "http:// 또는 https:// 주소만 연결할 수 있습니다." };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "주소에 아이디나 비밀번호를 넣을 수 없습니다." };
  }
  if (!parsed.hostname) {
    return { ok: false, error: "주소에 서버 이름이 필요합니다." };
  }

  const isLocal = LOCAL_HOSTNAMES.has(parsed.hostname.toLowerCase());
  if (parsed.protocol === "http:" && !isLocal) {
    return { ok: false, error: "보안을 위해 외부 서버는 https:// 주소만 연결할 수 있습니다." };
  }

  const pathname = parsed.pathname.replace(/\/+$/, "");
  return { ok: true, url: `${parsed.origin}${pathname}`, origin: parsed.origin };
}

/** 두 주소가 같은 사이트(스킴+호스트+포트)인지 확인합니다. */
export function isSameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/** 창 제목·설정 화면에 보여줄 짧은 이름(예: taest.info). */
export function displayHost(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "") + (parsed.port ? `:${parsed.port}` : "");
  } catch {
    return url;
  }
}

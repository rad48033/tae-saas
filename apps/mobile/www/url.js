/**
 * 서버 주소 정규화 (브라우저·Node 공용).
 * 데스크톱(Electron) src/url.ts 와 같은 규칙을 씁니다.
 *  - 스킴이 없으면 https:// 를 붙입니다.
 *  - 원격은 https:// 만, localhost·127.0.0.1 은 http:// 도 허용합니다.
 *  - 끝 "/" 와 쿼리·해시는 떼고 저장합니다.
 */
(function (global) {
  var LOCAL_HOSTNAMES = { localhost: true, "127.0.0.1": true, "::1": true, "[::1]": true, "0.0.0.0": true };
  var HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

  function normalizeServerUrl(input) {
    var raw = (input == null ? "" : String(input)).trim();
    if (!raw) return { ok: false, error: "서버 주소를 입력해 주세요." };
    if (/\s/.test(raw)) return { ok: false, error: "주소에는 공백이 들어갈 수 없습니다." };

    var candidate = HAS_SCHEME.test(raw) ? raw : "https://" + raw;
    var parsed;
    try {
      parsed = new URL(candidate);
    } catch (error) {
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

    var isLocal = LOCAL_HOSTNAMES[parsed.hostname.toLowerCase()] === true;
    if (parsed.protocol === "http:" && !isLocal) {
      return { ok: false, error: "보안을 위해 외부 서버는 https:// 주소만 연결할 수 있습니다." };
    }

    var pathname = parsed.pathname.replace(/\/+$/, "");
    return { ok: true, url: parsed.origin + pathname, origin: parsed.origin };
  }

  var api = { normalizeServerUrl: normalizeServerUrl };
  global.TaestUrl = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);

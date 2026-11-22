# taest 데스크톱 (Windows)

taest 웹 서비스를 윈도우 네이티브 창에서 그대로 쓰는 Electron 셸입니다. 웹을 다시 만들지 않고, 연결할
서버 주소만 받아 띄웁니다.

## 실행

```bash
pnpm --filter @tae/desktop build
pnpm --filter @tae/desktop start
```

## 서버 주소 설정

우선순위(앞이 이김):

| 순서 | 위치 | 쓰임 |
| --- | --- | --- |
| 1 | 사용자 설정 (`%APPDATA%\taest\settings.json`) | 설정 화면에서 저장한 값 |
| 2 | 환경변수 `TAE_SAAS_WEB_URL` | 실행 환경에서 주입 |
| 3 | `resources/default-url.json` | 빌드에 박아 둔 기본값(CI 입력값) |
| 4 | 실행 파일 옆 `tae-saas-url.txt` | 포터블용 사이드카(첫 줄) |

주소가 없거나 서버에 닿지 않으면 내장된 연결 화면(`renderer/index.html`)이 열리고, 여기서 주소를 입력·저장할 수
있습니다. 주소는 `https://`(로컬은 `http://localhost`)만 허용합니다.

## 패키징

```bash
# 윈도우에서 실행 (NSIS 설치파일 + Portable)
pnpm --filter @tae/desktop pack:win
```

산출물은 `apps/desktop/release/`에 `taest-Setup-<version>.exe`, `taest-Portable-<version>.exe`로 떨어집니다.
리눅스에서는 NSIS 빌드에 wine이 필요하므로 GitHub Actions(`windows-latest`)에서 빌드합니다.

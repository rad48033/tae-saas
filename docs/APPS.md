# 앱 가이드 — PWA · Windows · Android · iOS

taest를 휴대폰·PC 앱처럼 쓰는 네 가지 방법을 정리했습니다. 웹(`apps/youtube-blog`)은 그대로 두고,
**PWA(설치형 웹)** + **Electron(윈도우)** + **Capacitor(안드로이드·iOS)** 껍데기를 씌운 구조입니다.

| 형태 | 무엇 | 어디에 있나 | 만드는 곳 |
| --- | --- | --- | --- |
| PWA | 브라우저에서 "홈 화면에 추가" | `apps/youtube-blog/public/` (manifest·sw·icons) | Vercel 배포만 하면 끝 |
| Windows | NSIS 설치파일 + Portable `.exe` | `apps/desktop/` | GitHub Actions `windows-latest` |
| Android | `.apk` (debug / release unsigned) | `apps/mobile/android/` | GitHub Actions `ubuntu-latest` |
| iOS | 서명 없는 `.xcarchive` | `apps/mobile/ios/` | GitHub Actions `macos-latest` |

> 앱은 웹을 다시 만들지 않습니다. 앱을 열면 **설정한 서버 주소**(예: `https://taest.info`)로 이동해 웹과 똑같이
> 동작합니다. 그래서 서버를 먼저 배포하고, 그 주소를 앱에 알려 주는 순서로 진행하세요.

---

## 0. 준비: 서버 주소 만들기

### 0-1. 웹(Vercel)

`docs/DEPLOY.md`의 1~4장을 따라 `apps/youtube-blog`를 Vercel에 올립니다. 최소한 아래 두 값은 꼭 넣습니다.

```
NEXT_PUBLIC_APP_URL=https://<내 도메인>     # manifest·아이콘 절대 주소의 기준
SESSION_SECRET=<openssl rand -hex 32>
```

배포가 끝나면 확인:

```bash
curl -s https://<내 도메인>/api/health
curl -sI https://<내 도메인>/manifest.webmanifest   # 200 + application/manifest+json
```

> Vercel 프로젝트 설정에서 **Include source files outside of the Root Directory**를 켜야 `packages/*`를
> 읽습니다(모노레포).

### 0-2. 영상 워커(선택, MP4 렌더용)

MP4 렌더는 서버리스에서 돌 수 없어 `apps/video-worker`를 따로 띄웁니다.

```bash
# Railway/Fly.io: apps/video-worker/Dockerfile 사용, 포트 8080
# 필요한 값
VIDEO_WORKER_URL=https://<worker-host>      # youtube-blog(Vercel) 환경변수에
VIDEO_WORKER_TOKEN=<openssl rand -hex 32>   # 워커와 웹 양쪽에 같은 값
```

워커가 없어도 블로그·인스타·페이스북 글 변환과 스토리보드까지는 동작하고, MP4 버튼만 안내 문구로 바뀝니다.

---

## 1. PWA — 설치형 웹 (가장 빠른 길)

별도 빌드가 필요 없습니다. 배포한 주소를 휴대폰 브라우저로 열고 홈 화면에 추가하면 됩니다.

### 아이폰 (Safari)

1. **Safari**로 `https://<내 도메인>`을 엽니다. (Chrome·네이버 앱에서는 "홈 화면에 추가"가 제한됩니다.)
2. 하단 **공유** 버튼 → **홈 화면에 추가** → 이름 확인 후 **추가**.
3. 홈 화면의 **taest** 아이콘으로 열면 주소창 없는 전체 화면 앱으로 뜹니다.

### 안드로이드 (Chrome)

1. Chrome으로 주소를 엽니다.
2. 우측 상단 **⋮** → **앱 설치** 또는 **홈 화면에 추가**.
3. 설치 후 앱 서랍에 **taest**가 생깁니다.

### PC (Chrome·Edge)

주소창 오른쪽 **설치** 아이콘(모니터+화살표)을 누르면 독립 창 앱으로 설치됩니다.

### 확인할 것

- `public/manifest.webmanifest` — 한국어 이름·설명, `standalone`, 테마색 `#4f46e5`, 192/512/maskable 아이콘
- `public/sw.js` — 앱 셸 프리캐시 + 네트워크 우선, `/api/`는 캐시하지 않음, 오프라인이면 `offline.html`
- `layout.tsx` — `apple-mobile-web-app-capable`, `viewport-fit=cover`, apple-touch-icon
- `globals.css` — 노치·홈 인디케이터 세이프 에어리어(`--safe-top/bottom`), standalone에서 텍스트 선택 제한

아이콘을 다시 만들려면:

```bash
pnpm --filter @tae/youtube-blog icons   # public/icons/*.png, favicon.svg, src/app/icon.png 재생성
```

> 아이콘은 순수 Node(zlib)로 PNG를 직접 그리는 스크립트(`apps/youtube-blog/scripts/generate-icons.mjs`)입니다.
> 외부 이미지 도구 설치가 필요 없습니다.

---

## 2. GitHub Actions로 앱 빌드하기

워크플로우: `.github/workflows/build-apps.yml`

1. GitHub 저장소 → **Actions** → **Build apps (Windows · Android · iOS)** → **Run workflow**
2. 입력값
   - `web_url`: 앱이 접속할 서버 주소. 예 `https://taest.info`. **비워 두면** 앱 첫 실행 시 설정 화면에서 입력합니다.
   - `targets`: `all` / `windows` / `android` / `ios`
3. 실행이 끝나면 해당 실행 화면 아래 **Artifacts**에서 내려받습니다.

| Artifact | 내용 |
| --- | --- |
| `taest-windows` | `taest-Setup-0.1.0.exe`(설치형), `taest-Portable-0.1.0.exe`(무설치) |
| `taest-android` | `app-debug.apk`, `app-release-unsigned.apk` |
| `taest-ios-unsigned` | `taest-ios.xcarchive` (서명 없음) |

태그(`app-v1.0.0`)를 푸시해도 세 플랫폼이 모두 빌드됩니다.

---

## 3. Windows 앱

### 내려받아 쓰기

1. Actions 실행 → `taest-windows` artifact 다운로드 → 압축 해제
2. **설치형**: `taest-Setup-0.1.0.exe` 실행. 설치 위치 선택 가능, 바탕화면·시작 메뉴 바로가기 생성
3. **무설치**: `taest-Portable-0.1.0.exe` 더블클릭

> 서명 인증서가 없어 처음 실행 시 Windows SmartScreen이 **"Windows의 PC 보호"** 경고를 띄울 수 있습니다.
> **추가 정보 → 실행**을 누르면 됩니다. 배포용으로 쓰려면 코드 서명 인증서(EV/OV)를 구입해
> `CSC_LINK`·`CSC_KEY_PASSWORD`를 GitHub Secrets에 넣고 서명 빌드하세요.

### 서버 주소를 바꾸는 방법

우선순위(앞이 이김):

1. 앱 설정 화면에서 저장한 값 (`%APPDATA%\taest\settings.json`)
2. 환경변수 `TAE_SAAS_WEB_URL`
3. 빌드에 넣은 기본값 (`resources/default-url.json` ← Actions의 `web_url` 입력)
4. 실행 파일 옆 `tae-saas-url.txt` 파일의 첫 줄 (포터블 배포에 편함)

주소가 없거나 서버가 응답하지 않으면 앱이 **연결 화면**을 띄웁니다. 주소 입력 → **연결 테스트** → **연결하기**.
메뉴 **파일 → 서버 연결 설정**(`Ctrl+,`)으로 언제든 다시 열 수 있습니다.
보안상 외부 주소는 `https://`만, 로컬 개발만 `http://localhost`를 허용합니다.

### 로컬에서 빌드 (윈도우 PC)

```powershell
pnpm install
pnpm --filter @tae/desktop build
pnpm --filter @tae/desktop pack:win    # release\*.exe
```

리눅스·macOS에서 `--win` 패키징은 wine이 필요하므로 GitHub Actions를 쓰는 편이 간단합니다.

---

## 4. Android 앱

### 내려받아 설치

1. Actions 실행 → `taest-android` artifact 다운로드 → 압축 해제
2. `app-debug.apk`를 휴대폰으로 옮깁니다(카카오톡 나에게 보내기·USB·클라우드 등).
3. 파일을 열고 **출처를 알 수 없는 앱 설치 허용**을 켠 뒤 설치합니다.

`app-release-unsigned.apk`는 **서명이 없어 설치되지 않습니다**. 배포용은 아래처럼 서명하세요.

```bash
# 1) 키 생성 (한 번만, 백업 필수)
keytool -genkeypair -v -keystore taest-release.keystore -alias taest \
  -keyalg RSA -keysize 2048 -validity 10000

# 2) 서명 (build-tools의 apksigner)
$ANDROID_HOME/build-tools/36.0.0/apksigner sign \
  --ks taest-release.keystore --out taest-release.apk app-release-unsigned.apk
```

> 키를 잃으면 같은 앱으로 업데이트할 수 없습니다. `android/app/build.gradle`의 `signingConfigs`에 넣고
> GitHub Secrets(`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
> `ANDROID_KEY_PASSWORD`)로 넘기는 방식이 일반적입니다.
> Play 스토어 배포는 `.aab`(`./gradlew bundleRelease`)가 필요합니다.

### 로컬에서 빌드

필요: **JDK 21**, **Android SDK 36** (`ANDROID_HOME` 설정)

```bash
pnpm install
TAE_SAAS_WEB_URL=https://taest.info pnpm --filter @tae/mobile build
pnpm --filter @tae/mobile exec cap sync android
cd apps/mobile/android && ./gradlew assembleDebug
# → app/build/outputs/apk/debug/app-debug.apk
```

### 앱 아이콘·스플래시

`apps/mobile/assets/icon.png`(1024), `assets/splash.png`(2732)을 바꾼 뒤:

```bash
pnpm --filter @tae/mobile assets   # android/ios 리소스 재생성
```

---

## 5. iOS 앱

### 왜 바로 설치할 수 없나

- iOS는 **macOS + Xcode**에서만 빌드·서명할 수 있습니다. 이 저장소의 CI는 `macos-latest`에서
  **서명 없는 `.xcarchive`**(빌드 검증용)까지만 만듭니다.
- 실기기 설치·TestFlight·App Store 배포에는 **Apple Developer Program**(연 $99)과 배포 인증서·프로비저닝
  프로파일이 필요합니다.

### 준비물

| 항목 | 설명 |
| --- | --- |
| Mac + Xcode 16 이상 | Capacitor 8 / iOS 15+ 기준 |
| Apple Developer Program | App Store·TestFlight 배포에 필수 |
| Bundle ID | `info.taest.app` (Xcode에서 팀 선택 시 자동 등록) |

### 실기기에서 바로 테스트 (무료 계정도 가능)

1. `pnpm --filter @tae/mobile build && pnpm --filter @tae/mobile exec cap sync ios`
2. `npx cap open ios` → Xcode에서 `App` 프로젝트 열기
3. **App 타겟 → Signing & Capabilities** → Team 선택, Bundle Identifier 확인, **Automatically manage signing** 켬
4. 아이폰 연결 → 실행. (무료 계정은 7일마다 다시 서명해야 합니다.)

### TestFlight / App Store

1. Xcode → **Product → Archive**
2. Organizer → **Distribute App → App Store Connect → Upload**
3. App Store Connect에서 앱 정보·스크린샷·개인정보 처리방침을 채우고 **TestFlight**로 테스트 → 심사 제출

> ⚠️ **심사 주의**: 웹 화면을 그대로 감싼 앱은 App Store 심사 지침 **4.2 Minimum Functionality**로 반려될 수
> 있습니다. iOS는 PWA(홈 화면에 추가)로 쓰거나, 앱에 오프라인 편집·알림 같은 네이티브 기능을 더한 뒤
> 제출하는 편이 안전합니다.

### 서버 주소

- 첫 실행 시 설정 화면에서 입력 → 기기 `localStorage`에 저장
- 입력한 주소는 **앱 안(웹뷰)에서** 열립니다. `capacitor.config.ts`의 `server.allowNavigation: ["*"]`가
  Capacitor의 기본 동작(외부 호스트는 기기 브라우저로 넘김)을 막아 주기 때문입니다.
- 서버가 응답하지 않으면 `server.errorPath`(www/error.html)로 돌아와 **설정 화면 열기**로 주소를 바꿀 수 있습니다.
- 빌드에 기본값을 넣으려면 `TAE_SAAS_WEB_URL`과 함께 `pnpm --filter @tae/mobile build`
- 주소를 바꾸려면 오류 화면의 **설정 화면 열기** 또는 앱 삭제 후 재설치(또는 `www/index.html?setup=1`)
- iOS ATS 때문에 `https://`만 동작합니다(로컬 개발 예외 외).

---

## 6. 문제 해결

| 증상 | 원인·해결 |
| --- | --- |
| PWA인데 주소창이 보임 | 홈 화면 아이콘으로 열었는지 확인. iOS는 Safari에서만 설치됩니다. |
| 앱을 열면 흰 화면 | 서버 주소 오류 또는 서버 다운. 모바일은 오류 화면의 **설정 화면 열기**, 윈도우는 `Ctrl+,`로 연결 화면 |
| PWA가 예전 화면을 보여 줌 | 서비스 워커 캐시. 새로고침 2회 또는 브라우저 설정에서 사이트 데이터 삭제 |
| MP4 렌더 버튼이 안내 문구로 바뀜 | `VIDEO_WORKER_URL` 미설정. 영상 워커를 배포하고 Vercel 환경변수 갱신 |
| Android 빌드가 SDK 오류 | `compileSdk 36`에 맞춰 `sdkmanager "platforms;android-36"` 설치 |
| `electron-builder`가 리눅스에서 실패 | NSIS는 wine 필요. GitHub Actions(`windows-latest`) 사용 |

---

## 7. 이 저장소에서 실제로 검증한 범위

| 항목 | 상태 |
| --- | --- |
| `apps/desktop` typecheck · 테스트(23) · `tsc` 빌드 | ✅ 이 환경에서 통과 |
| `electron-builder` 패키징 설정(리눅스 dir 패키지로 asar·기본 주소 파일 검증) | ✅ 통과 (26.18.0) |
| `apps/mobile` build · typecheck · 테스트(5), `cap add android/ios`, `cap sync` | ✅ 통과 |
| PWA 자산(manifest·아이콘 크기·서비스 워커 규칙) 테스트 | ✅ 통과 |
| `.exe`(.NSIS/.Portable) 실빌드 | ⛔ 리눅스 환경(서명·wine 없음) → GitHub Actions 위임 |
| `.apk` 실빌드 | ⛔ JDK/Android SDK 없음 → GitHub Actions 위임 |
| `.ipa`/`.xcarchive` 실빌드 | ⛔ macOS/Xcode 없음 → GitHub Actions 위임 |
| 실기기 설치·스토어 배포 | ⛔ 서명 인증서·Apple Developer 계정 필요(사용자 준비) |

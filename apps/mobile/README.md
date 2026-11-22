# taest 모바일 (Android · iOS)

Capacitor 껍데기 앱입니다. 웹 자산(`www/`)은 설정 화면만 담고 있고, 저장된 서버 주소가 있으면
앱을 열 때 그 주소로 이동합니다.

## 준비

```bash
pnpm install
pnpm --filter @tae/mobile build      # www 자산 확인 + 기본 주소 주입
pnpm --filter @tae/mobile sync       # android/ios 네이티브 프로젝트에 www 복사
```

## 네이티브 프로젝트

| 폴더 | 생성 명령 | 빌드 요구 사항 |
| --- | --- | --- |
| `android/` | `pnpm --filter @tae/mobile add:android` | JDK 21 + Android SDK |
| `ios/` | `pnpm --filter @tae/mobile add:ios` | macOS + Xcode 16 이상 |

## 서버 주소

1. 앱 첫 실행 시 설정 화면에서 `https://` 주소를 입력합니다(로컬 개발은 `http://localhost` 허용).
2. 주소는 기기 `localStorage`에만 저장됩니다.
3. 빌드 시 기본 주소를 넣으려면 `TAE_SAAS_WEB_URL`을 주고 `build`를 실행합니다.
   (`www/default-config.js`에 기록되고, `sync`로 네이티브 프로젝트에 복사됩니다.)
4. 주소를 바꾸려면 서버가 응답하지 않을 때 뜨는 오류 화면(`www/error.html`)의 **설정 화면 열기**를 누르거나,
   앱을 지우고 다시 설치하거나 `www/index.html?setup=1`로 진입합니다.
5. 입력한 주소는 앱 안(웹뷰)에서 열립니다. `capacitor.config.ts`의 `server.allowNavigation: ["*"]`가
   외부 호스트 이동을 기기 브라우저로 넘기는 Capacitor 기본 동작을 막습니다(주소는 https만 허용).

## 빌드

- Android: `cd android && ./gradlew assembleDebug` → `android/app/build/outputs/apk/debug/app-debug.apk`
- iOS: `xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Release -sdk iphoneos CODE_SIGNING_ALLOWED=NO archive`

실기기 설치·스토어 배포에는 각각 서명 키(Android)와 Apple Developer 계정 + Mac(Xcode)이 필요합니다.
자세한 절차는 `docs/APPS.md`를 보세요.

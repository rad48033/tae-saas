import type { CapacitorConfig } from "@capacitor/cli";

/**
 * taest 모바일 앱 설정.
 *
 * 앱은 웹 자산(www)을 품고 있다가, 설정된 taest 서버 주소로 이동합니다.
 * 네이티브 프로젝트(android/, ios/)를 다시 만들려면 `pnpm --filter @tae/mobile add:android`(또는 add:ios).
 */
const config: CapacitorConfig = {
  appId: "info.taest.app",
  appName: "taest",
  webDir: "www",
  // 원격 https 서버를 불러오므로 로컬 자산도 https 스킴으로 서빙합니다.
  server: {
    androidScheme: "https",
    iosScheme: "capacitor",
    // 설정 화면에서 입력한 서버 주소를 앱 안(웹뷰)에서 열기 위한 허용 목록입니다.
    // Capacitor는 기본적으로 앱 출처가 아닌 호스트로의 이동을 기기 브라우저로 넘기므로,
    // 주소를 빌드 시점에 고정하지 않고 사용자가 고르는 이 앱에서는 모든 호스트를 허용합니다.
    // (주소는 https만 허용하도록 앱 화면에서 검증합니다.)
    allowNavigation: ["*"],
    // 원격 페이지를 불러오지 못하면 앱의 오류 안내 화면으로 돌아와 주소를 바꿀 수 있게 합니다.
    errorPath: "error.html",
  },
  android: {
    allowMixedContent: false,
    backgroundColor: "#ffffff",
  },
  ios: {
    contentInset: "always",
    backgroundColor: "#ffffff",
    limitsNavigationsToAppBoundDomains: false,
  },
};

export default config;

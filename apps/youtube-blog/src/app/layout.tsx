import type { Metadata, Viewport } from "next";

import { PwaRegister } from "@/components/pwa-register";

import "./globals.css";

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://taest.info";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: "taest — 유튜브 하나로 블로그·인스타·페이스북 콘텐츠",
    template: "%s · taest",
  },
  applicationName: "taest",
  description:
    "유튜브 링크만 넣으면 자막을 분석해 2,000자 SEO 블로그 글, 인스타 카드뉴스 10장, 페이스북 20줄 피드 글을 한 번에 만들어 줍니다.",
  keywords: ["유튜브 블로그 변환", "유튜브 요약", "인스타 카드뉴스", "페이스북 콘텐츠", "SEO 블로그", "taest"],
  manifest: "/manifest.webmanifest",
  openGraph: {
    type: "website",
    locale: "ko_KR",
    url: appUrl,
    siteName: "taest",
    title: "유튜브 하나로 블로그·인스타·페이스북 콘텐츠",
    description: "영상 자막을 근거로 발행 채널에 맞는 글을 만들어 드립니다.",
  },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true },
  // 아이폰 홈 화면 추가 시 전체 화면 앱처럼 동작하도록 합니다.
  appleWebApp: {
    capable: true,
    title: "taest",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    shortcut: ["/favicon.ico"],
  },
  formatDetection: { telephone: false, address: false, email: false },
  // Next.js는 표준 mobile-web-app-capable만 내보내므로, 구형 iOS용 레거시 태그를 함께 넣습니다.
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  themeColor: "#0b0922",
  width: "device-width",
  initialScale: 1,
  // 노치·홈 인디케이터 영역까지 배경을 채웁니다(세이프 에어리어는 globals.css에서 처리).
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";

import "./globals.css";

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://taest.info";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: "taest — 유튜브 하나로 블로그·인스타·페이스북 콘텐츠",
    template: "%s · taest",
  },
  description:
    "유튜브 링크만 넣으면 자막을 분석해 2,000자 SEO 블로그 글, 인스타 카드뉴스 10장, 페이스북 20줄 피드 글을 한 번에 만들어 줍니다.",
  keywords: ["유튜브 블로그 변환", "유튜브 요약", "인스타 카드뉴스", "페이스북 콘텐츠", "SEO 블로그", "taest"],
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
};

export const viewport: Viewport = {
  themeColor: "#4f46e5",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}

import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // 아이콘의 파랑→보라 그라디언트를 브랜드 색으로 씁니다.
        brand: {
          50: "#f0f1ff",
          100: "#e2e3ff",
          200: "#c8c7ff",
          300: "#a9a2ff",
          400: "#8b78ff",
          500: "#6f4dfb",
          600: "#5b3bf0",
          700: "#4a2bd0",
          800: "#3b22a6",
          900: "#2b1a7a",
        },
        night: {
          50: "#f4f5ff",
          700: "#241f52",
          800: "#161238",
          850: "#12102e",
          900: "#0b0922",
          950: "#06041a",
        },
        ink: "#0f172a",
      },
      fontFamily: {
        sans: [
          "Pretendard",
          "-apple-system",
          "BlinkMacSystemFont",
          "Apple SD Gothic Neo",
          "Noto Sans KR",
          "Segoe UI",
          "sans-serif",
        ],
      },
      boxShadow: {
        card: "0 1px 2px rgba(15, 23, 42, 0.04), 0 12px 32px -12px rgba(15, 23, 42, 0.12)",
        app: "0 10px 40px -12px rgba(43, 26, 122, 0.35)",
        float: "0 8px 30px -8px rgba(15, 23, 42, 0.18)",
      },
      backgroundImage: {
        "brand-gradient": "linear-gradient(135deg, #2b4bff 0%, #5b3bf0 55%, #8b1fd6 100%)",
        "brand-soft": "linear-gradient(135deg, #eef0ff 0%, #f6f0ff 60%, #fdf3ff 100%)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.45" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(14px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.35s ease-out both",
        "fade-in": "fade-in 0.25s ease-out both",
        "pulse-soft": "pulse-soft 1.4s ease-in-out infinite",
        "slide-up": "slide-up 0.28s cubic-bezier(0.22, 1, 0.36, 1) both",
      },
    },
  },
  plugins: [typography],
};

export default config;

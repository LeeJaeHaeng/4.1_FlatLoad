import type { Metadata } from "next";
import { Geist } from "next/font/google";
import NavLink from "@/components/NavLink";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "FlatRoad Admin",
  description: "FlatRoad 백엔드 관리 대시보드",
};

const navItems = [
  { href: "/",           icon: "📊", label: "대시보드" },
  { href: "/obstacles",  icon: "🚧", label: "장애물 관리" },
  { href: "/posts",      icon: "💬", label: "게시글 관리" },
  { href: "/certified",  icon: "⭐", label: "인증 사용자" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${geistSans.variable} h-full`}>
      <body className="min-h-full flex" style={{ background: "#f8f9fa" }}>

        {/* ── 사이드바 ── */}
        <nav
          className="w-60 shrink-0 flex flex-col"
          style={{
            background: "#4285F4",
            boxShadow: "2px 0 12px rgba(66,133,244,0.18)",
          }}
        >
          {/* 로고 */}
          <div className="px-6 py-7">
            <div className="flex items-center gap-2.5">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center text-lg font-bold"
                style={{ background: "#F5A623", color: "#fff" }}
              >
                F
              </div>
              <div>
                <p className="text-white font-bold text-base leading-tight tracking-tight">FlatRoad</p>
                <p className="text-white/60 text-xs">Admin Dashboard</p>
              </div>
            </div>
          </div>

          {/* 구분선 */}
          <div className="mx-5 mb-4" style={{ height: 1, background: "rgba(255,255,255,0.15)" }} />

          {/* 네비게이션 */}
          <ul className="flex flex-col gap-1 px-3 flex-1">
            {navItems.map(({ href, icon, label }) => (
              <li key={href}>
                <NavLink href={href} icon={icon} label={label} />
              </li>
            ))}
          </ul>

          {/* 하단 서버 정보 */}
          <div
            className="mx-4 mb-5 px-4 py-3 rounded-xl"
            style={{ background: "rgba(255,255,255,0.12)" }}
          >
            <p className="text-white/50 text-xs mb-0.5">백엔드 서버</p>
            <p className="text-white/80 text-xs font-mono">localhost:8000</p>
            <div className="flex items-center gap-1.5 mt-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[#34A853]" />
              <span className="text-white/60 text-xs">실행 중</span>
            </div>
          </div>
        </nav>

        {/* ── 메인 콘텐츠 ── */}
        <main className="flex-1 overflow-auto p-8" style={{ background: "#f8f9fa" }}>
          {children}
        </main>

      </body>
    </html>
  );
}

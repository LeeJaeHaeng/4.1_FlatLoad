"use client";

import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={handleLogout}
      className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
      style={{ color: "rgba(255,255,255,0.75)", background: "transparent", border: "none", cursor: "pointer" }}
      onMouseOver={(e) => ((e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.12)")}
      onMouseOut={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
    >
      <span className="text-base">🚪</span>
      로그아웃
    </button>
  );
}

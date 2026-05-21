"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavLinkProps {
  href: string;
  icon: string;
  label: string;
}

export default function NavLink({ href, icon, label }: NavLinkProps) {
  const pathname = usePathname();
  const active = pathname === href;

  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
      style={{
        color: active ? "#fff" : "rgba(255,255,255,0.75)",
        background: active ? "rgba(255,255,255,0.2)" : "transparent",
      }}
      onMouseOver={(e) => {
        if (!active) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.12)";
      }}
      onMouseOut={(e) => {
        if (!active) (e.currentTarget as HTMLElement).style.background = "transparent";
      }}
    >
      <span className="text-base">{icon}</span>
      {label}
    </Link>
  );
}

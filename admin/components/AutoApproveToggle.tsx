"use client";

import { useState, useTransition } from "react";
import { updateSetting } from "@/lib/api";

interface Props {
  initialValue: boolean;
}

export default function AutoApproveToggle({ initialValue }: Props) {
  const [enabled, setEnabled] = useState(initialValue);
  const [isPending, startTransition] = useTransition();

  function handleToggle() {
    const next = !enabled;
    setEnabled(next);
    startTransition(async () => {
      try {
        await updateSetting("auto_approve_images", next);
      } catch {
        setEnabled(!next);
      }
    });
  }

  return (
    <div
      className="mt-6 rounded-2xl p-5 flex items-center justify-between gap-4"
      style={{ background: "#fff", boxShadow: "0 1px 6px rgba(0,0,0,0.07)" }}
    >
      <div className="flex items-center gap-4">
        <div
          className="w-10 h-10 rounded-xl shrink-0 flex items-center justify-center text-xl"
          style={{ background: enabled ? "#e6f4ea" : "#fef3e2" }}
        >
          {enabled ? "✅" : "⏳"}
        </div>
        <div>
          <p className="text-sm font-semibold" style={{ color: "#1a1a1a" }}>
            이미지 자동 승인
          </p>
          <p className="text-xs mt-0.5" style={{ color: "#999" }}>
            {enabled
              ? "사용자가 올린 이미지가 즉시 앱에 표시됩니다."
              : "관리자가 승인해야 앱에 이미지가 표시됩니다."}
          </p>
        </div>
      </div>

      <button
        onClick={handleToggle}
        disabled={isPending}
        aria-pressed={enabled}
        className="relative shrink-0 rounded-full transition-colors duration-200 focus:outline-none"
        style={{
          width: 48,
          height: 28,
          background: enabled ? "#34A853" : "#ccc",
          opacity: isPending ? 0.6 : 1,
          cursor: isPending ? "not-allowed" : "pointer",
          border: "none",
          padding: 0,
        }}
      >
        <span
          className="absolute rounded-full bg-white transition-transform duration-200"
          style={{
            width: 22,
            height: 22,
            top: 3,
            left: enabled ? 23 : 3,
            boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
          }}
        />
      </button>
    </div>
  );
}

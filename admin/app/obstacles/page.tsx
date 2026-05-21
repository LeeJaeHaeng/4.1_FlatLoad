"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { getObstacles, toggleApprove, deleteObstacle, Obstacle } from "@/lib/api";

/* ── 작은 뱃지 ─────────────────────────────────── */
function Badge({
  children,
  color,
  bg,
}: {
  children: React.ReactNode;
  color: string;
  bg: string;
}) {
  return (
    <span
      className="inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-bold tracking-wide"
      style={{ color, background: bg }}
    >
      {children}
    </span>
  );
}

/* ── 버튼 ───────────────────────────────────────── */
function Btn({
  onClick,
  color,
  bg,
  hoverBg,
  children,
}: {
  onClick: () => void;
  color: string;
  bg: string;
  hoverBg: string;
  children: React.ReactNode;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      className="px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
      style={{ color, background: hover ? hoverBg : bg }}
    >
      {children}
    </button>
  );
}

/* ── 메인 페이지 ────────────────────────────────── */
export default function ObstaclesPage() {
  const [obstacles, setObstacles] = useState<Obstacle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Obstacle | null>(null);

  async function load() {
    try {
      setError(null);
      setObstacles(await getObstacles());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleApprove(obs: Obstacle) {
    const updated = await toggleApprove(obs.id);
    setObstacles((prev) =>
      prev.map((o) => (o.id === obs.id ? { ...o, isApproved: updated.isApproved } : o))
    );
  }

  async function handleDelete(id: number) {
    if (!confirm("이 장애물을 삭제할까요?")) return;
    await deleteObstacle(id);
    setObstacles((prev) => prev.filter((o) => o.id !== id));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="w-8 h-8 rounded-full border-4 border-t-transparent animate-spin" style={{ borderColor: "#4285F4", borderTopColor: "transparent" }} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-2xl p-5" style={{ background: "#fff", border: "1px solid #fde8e8" }}>
        <p className="text-sm font-semibold" style={{ color: "#e53935" }}>⚠️ {error}</p>
      </div>
    );
  }

  const approved = obstacles.filter((o) => o.isApproved).length;
  const pending  = obstacles.length - approved;

  return (
    <div>
      {/* 헤더 */}
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: "#1a1a1a" }}>장애물 관리</h1>
          <p className="text-sm mt-1" style={{ color: "#999" }}>
            전체 {obstacles.length}건 ·{" "}
            <span style={{ color: "#34A853" }}>승인 {approved}</span> ·{" "}
            <span style={{ color: "#F5A623" }}>미승인 {pending}</span>
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
          style={{ background: "#e8f0fe", color: "#4285F4" }}
        >
          ↻ 새로고침
        </button>
      </div>

      {obstacles.length === 0 ? (
        <div className="rounded-2xl p-12 text-center" style={{ background: "#fff", boxShadow: "0 1px 6px rgba(0,0,0,0.07)" }}>
          <p className="text-4xl mb-3">🚧</p>
          <p className="font-semibold" style={{ color: "#555" }}>등록된 장애물이 없습니다</p>
        </div>
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", boxShadow: "0 1px 6px rgba(0,0,0,0.07)" }}>
          <table className="min-w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid #f0f0f0" }}>
                {["사진", "ID", "AI 분류", "신뢰도", "추천 / 비추천", "등록자", "날짜", "상태", "액션"].map((h) => (
                  <th key={h} className="px-4 py-3.5 text-left text-xs font-bold uppercase tracking-wider" style={{ color: "#aaa" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {obstacles.map((obs, i) => (
                <tr
                  key={obs.id}
                  style={{ borderBottom: i < obstacles.length - 1 ? "1px solid #f5f5f5" : "none" }}
                >
                  {/* 사진 */}
                  <td className="px-4 py-3">
                    {obs.photoUrl ? (
                      <button onClick={() => setPreview(obs)}>
                        <Image
                          src={obs.photoUrl}
                          alt={`장애물 ${obs.id}`}
                          width={56}
                          height={56}
                          className="rounded-xl object-cover transition-opacity hover:opacity-75"
                          style={{ width: 56, height: 56 }}
                        />
                      </button>
                    ) : (
                      <div
                        className="rounded-xl flex items-center justify-center text-xs"
                        style={{ width: 56, height: 56, background: "#f5f5f5", color: "#bbb" }}
                      >없음</div>
                    )}
                  </td>

                  {/* ID */}
                  <td className="px-4 py-3 tabular-nums font-mono text-xs" style={{ color: "#bbb" }}>#{obs.id}</td>

                  {/* AI 분류 */}
                  <td className="px-4 py-3">
                    {obs.aiLabel ? (
                      <Badge color="#4285F4" bg="#e8f0fe">{obs.aiLabel}</Badge>
                    ) : (
                      <span style={{ color: "#ddd" }}>—</span>
                    )}
                  </td>

                  {/* 신뢰도 */}
                  <td className="px-4 py-3 tabular-nums" style={{ color: "#555" }}>
                    {obs.aiConfidence != null ? (
                      <span className="font-semibold">
                        {(obs.aiConfidence * 100).toFixed(1)}
                        <span className="text-xs font-normal" style={{ color: "#bbb" }}>%</span>
                      </span>
                    ) : <span style={{ color: "#ddd" }}>—</span>}
                  </td>

                  {/* 추천/비추천 */}
                  <td className="px-4 py-3">
                    <span className="font-bold" style={{ color: "#34A853" }}>👍 {obs.likes}</span>
                    <span style={{ color: "#ddd" }}> / </span>
                    <span className="font-bold" style={{ color: "#e53935" }}>👎 {obs.dislikes}</span>
                  </td>

                  {/* 등록자 */}
                  <td className="px-4 py-3 max-w-[120px]">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                        style={{ background: "#e8f0fe", color: "#4285F4" }}
                      >
                        {(obs.displayName || obs.userEmail || "?")[0].toUpperCase()}
                      </div>
                      <span className="truncate text-xs" style={{ color: "#555" }}>
                        {obs.displayName || obs.userEmail || "익명"}
                      </span>
                    </div>
                  </td>

                  {/* 날짜 */}
                  <td className="px-4 py-3 tabular-nums text-xs whitespace-nowrap" style={{ color: "#bbb" }}>
                    {obs.createdAt ? obs.createdAt.slice(0, 10) : "—"}
                  </td>

                  {/* 상태 */}
                  <td className="px-4 py-3">
                    {obs.isApproved
                      ? <Badge color="#34A853" bg="#e6f4ea">승인됨</Badge>
                      : <Badge color="#F5A623" bg="#fef3e2">미승인</Badge>}
                  </td>

                  {/* 액션 */}
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Btn
                        onClick={() => handleApprove(obs)}
                        color={obs.isApproved ? "#F5A623" : "#4285F4"}
                        bg={obs.isApproved ? "#fef3e2" : "#e8f0fe"}
                        hoverBg={obs.isApproved ? "#fde8c3" : "#c5dbfd"}
                      >
                        {obs.isApproved ? "거부" : "승인"}
                      </Btn>
                      <Btn
                        onClick={() => handleDelete(obs.id)}
                        color="#e53935"
                        bg="#fde8e8"
                        hoverBg="#fbc7c7"
                      >
                        삭제
                      </Btn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 사진 확대 모달 */}
      {preview && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50 p-4"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={() => setPreview(null)}
        >
          <div
            className="rounded-3xl overflow-hidden max-w-lg w-full p-6"
            style={{ background: "#fff", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 모달 헤더 */}
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="font-extrabold text-lg" style={{ color: "#1a1a1a" }}>
                  장애물 #{preview.id}
                </p>
                {preview.aiLabel && (
                  <Badge color="#4285F4" bg="#e8f0fe">{preview.aiLabel}</Badge>
                )}
              </div>
              <button
                onClick={() => setPreview(null)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-lg"
                style={{ background: "#f5f5f5", color: "#555" }}
              >
                ×
              </button>
            </div>

            {/* 사진 */}
            {preview.photoUrl && (
              <Image
                src={preview.photoUrl}
                alt="장애물 사진"
                width={480}
                height={320}
                className="w-full rounded-2xl object-cover"
                style={{ maxHeight: 320 }}
              />
            )}

            {/* 상세 정보 */}
            <div className="mt-4 grid grid-cols-2 gap-3">
              {[
                { label: "위치", value: `${preview.latitude?.toFixed(4)}, ${preview.longitude?.toFixed(4)}` },
                { label: "등록자", value: preview.displayName || preview.userEmail || "익명" },
                { label: "추천 / 비추천", value: `👍 ${preview.likes}  👎 ${preview.dislikes}` },
                { label: "신뢰도", value: preview.aiConfidence != null ? `${(preview.aiConfidence * 100).toFixed(1)}%` : "—" },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-xl p-3" style={{ background: "#f8f9fa" }}>
                  <p className="text-xs font-semibold mb-0.5" style={{ color: "#aaa" }}>{label}</p>
                  <p className="text-sm font-semibold" style={{ color: "#333" }}>{value}</p>
                </div>
              ))}
            </div>

            {/* 모달 액션 */}
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => { handleApprove(preview); setPreview(null); }}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all"
                style={{
                  background: preview.isApproved ? "#fef3e2" : "#4285F4",
                  color: preview.isApproved ? "#F5A623" : "#fff",
                }}
              >
                {preview.isApproved ? "승인 취소" : "승인하기"}
              </button>
              <button
                onClick={() => { handleDelete(preview.id); setPreview(null); }}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold"
                style={{ background: "#fde8e8", color: "#e53935" }}
              >
                삭제하기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

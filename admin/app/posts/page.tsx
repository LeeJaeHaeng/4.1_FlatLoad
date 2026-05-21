"use client";

import { useEffect, useState } from "react";
import { getPosts, deletePost, Post } from "@/lib/api";

function Badge({ children, color, bg }: { children: React.ReactNode; color: string; bg: string }) {
  return (
    <span
      className="inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-bold tracking-wide"
      style={{ color, background: bg }}
    >
      {children}
    </span>
  );
}

export default function PostsPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Post | null>(null);

  async function load() {
    try {
      setError(null);
      setPosts(await getPosts());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleDelete(id: number) {
    if (!confirm("이 게시글과 댓글을 모두 삭제할까요?")) return;
    await deletePost(id);
    setPosts((prev) => prev.filter((p) => p.id !== id));
    if (detail?.id === id) setDetail(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div
          className="w-8 h-8 rounded-full border-4 animate-spin"
          style={{ borderColor: "#4285F4", borderTopColor: "transparent" }}
        />
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

  const totalLikes = posts.reduce((s, p) => s + p.likes, 0);
  const totalComments = posts.reduce((s, p) => s + p.commentCount, 0);

  return (
    <div>
      {/* 헤더 */}
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: "#1a1a1a" }}>게시글 관리</h1>
          <p className="text-sm mt-1" style={{ color: "#999" }}>
            전체 {posts.length}건 · 추천 합계 {totalLikes} · 댓글 합계 {totalComments}
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold"
          style={{ background: "#e8f0fe", color: "#4285F4" }}
        >
          ↻ 새로고침
        </button>
      </div>

      {posts.length === 0 ? (
        <div
          className="rounded-2xl p-12 text-center"
          style={{ background: "#fff", boxShadow: "0 1px 6px rgba(0,0,0,0.07)" }}
        >
          <p className="text-4xl mb-3">💬</p>
          <p className="font-semibold" style={{ color: "#555" }}>등록된 게시글이 없습니다</p>
        </div>
      ) : (
        <div
          className="rounded-2xl overflow-hidden"
          style={{ background: "#fff", boxShadow: "0 1px 6px rgba(0,0,0,0.07)" }}
        >
          <table className="min-w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid #f0f0f0" }}>
                {["ID", "제목", "작성자", "추천", "댓글", "날짜", "액션"].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3.5 text-left text-xs font-bold uppercase tracking-wider"
                    style={{ color: "#aaa" }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {posts.map((post, i) => (
                <tr
                  key={post.id}
                  style={{ borderBottom: i < posts.length - 1 ? "1px solid #f5f5f5" : "none" }}
                >
                  {/* ID */}
                  <td className="px-4 py-3 tabular-nums font-mono text-xs" style={{ color: "#bbb" }}>
                    #{post.id}
                  </td>

                  {/* 제목 */}
                  <td className="px-4 py-3 max-w-[220px]">
                    <button
                      onClick={() => setDetail(post)}
                      className="text-left font-semibold truncate block max-w-full hover:underline"
                      style={{ color: "#1a1a1a" }}
                    >
                      {post.title}
                    </button>
                  </td>

                  {/* 작성자 */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                        style={{ background: "#e8f0fe", color: "#4285F4" }}
                      >
                        {(post.displayName || post.userEmail || "?")[0].toUpperCase()}
                      </div>
                      <span className="truncate text-xs max-w-[100px]" style={{ color: "#555" }}>
                        {post.displayName || post.userEmail || "익명"}
                      </span>
                    </div>
                  </td>

                  {/* 추천 */}
                  <td className="px-4 py-3">
                    <Badge color="#34A853" bg="#e6f4ea">👍 {post.likes}</Badge>
                  </td>

                  {/* 댓글 */}
                  <td className="px-4 py-3">
                    <Badge color="#4285F4" bg="#e8f0fe">💬 {post.commentCount}</Badge>
                  </td>

                  {/* 날짜 */}
                  <td className="px-4 py-3 text-xs tabular-nums whitespace-nowrap" style={{ color: "#bbb" }}>
                    {post.createdAt ? post.createdAt.slice(0, 10) : "—"}
                  </td>

                  {/* 액션 */}
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleDelete(post.id)}
                      className="px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
                      style={{ background: "#fde8e8", color: "#e53935" }}
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 게시글 상세 모달 */}
      {detail && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50 p-4"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={() => setDetail(null)}
        >
          <div
            className="rounded-3xl w-full max-w-lg p-6"
            style={{ background: "#fff", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 모달 헤더 */}
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1 pr-4">
                <p className="font-extrabold text-lg leading-snug" style={{ color: "#1a1a1a" }}>
                  {detail.title}
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                    style={{ background: "#e8f0fe", color: "#4285F4" }}
                  >
                    {(detail.displayName || detail.userEmail || "?")[0].toUpperCase()}
                  </div>
                  <span className="text-xs" style={{ color: "#999" }}>
                    {detail.displayName || detail.userEmail} · {detail.createdAt?.slice(0, 10)}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setDetail(null)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-lg shrink-0"
                style={{ background: "#f5f5f5", color: "#555" }}
              >
                ×
              </button>
            </div>

            {/* 통계 */}
            <div className="flex gap-3 mb-4">
              <div className="flex-1 rounded-xl p-3 text-center" style={{ background: "#e6f4ea" }}>
                <p className="text-lg font-extrabold" style={{ color: "#34A853" }}>👍 {detail.likes}</p>
                <p className="text-xs" style={{ color: "#34A853" }}>추천</p>
              </div>
              <div className="flex-1 rounded-xl p-3 text-center" style={{ background: "#e8f0fe" }}>
                <p className="text-lg font-extrabold" style={{ color: "#4285F4" }}>💬 {detail.commentCount}</p>
                <p className="text-xs" style={{ color: "#4285F4" }}>댓글</p>
              </div>
            </div>

            {/* 본문 */}
            <div
              className="rounded-2xl p-4 text-sm leading-relaxed overflow-y-auto max-h-48"
              style={{ background: "#f8f9fa", color: "#333" }}
            >
              {detail.content}
            </div>

            {/* 삭제 버튼 */}
            <button
              onClick={() => handleDelete(detail.id)}
              className="mt-4 w-full py-3 rounded-2xl text-sm font-bold transition-all"
              style={{ background: "#fde8e8", color: "#e53935" }}
            >
              게시글 삭제
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import {
  getCertifiedUsers,
  createCertifiedUser,
  updateCertifiedUser,
  deleteCertifiedUser,
  CertifiedUser,
} from "@/lib/api";

function MaskKey({ certKey }: { certKey: string }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const display = revealed ? certKey : `${certKey.slice(0, 8)}${"•".repeat(16)}`;

  const copy = () => {
    navigator.clipboard.writeText(certKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <span className="flex items-center gap-1.5">
      <span className="font-mono text-xs text-gray-600">{display}</span>
      <button
        onClick={() => setRevealed((v) => !v)}
        className="text-xs text-blue-500 hover:underline"
      >
        {revealed ? "숨기기" : "보기"}
      </button>
      <button onClick={copy} className="text-xs text-blue-500 hover:underline">
        {copied ? "복사됨!" : "복사"}
      </button>
    </span>
  );
}

interface AddModalProps {
  onClose: () => void;
  onCreated: (userId: string, displayName: string) => Promise<string>;
}

function AddModal({ onClose, onCreated }: AddModalProps) {
  const [userId, setUserId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async () => {
    if (!userId.trim() || !displayName.trim()) return;
    setLoading(true);
    try {
      const key = await onCreated(userId.trim(), displayName.trim());
      setNewKey(key);
    } finally {
      setLoading(false);
    }
  };

  const copy = () => {
    if (!newKey) return;
    navigator.clipboard.writeText(newKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.45)" }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md mx-4"
        style={{ maxHeight: "90vh", overflowY: "auto" }}
      >
        {newKey ? (
          <>
            <h2 className="text-lg font-bold mb-1" style={{ color: "#1a1a1a" }}>
              ⭐ 인증 키가 발급되었습니다
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              이 키를 앱 사용자에게 전달하세요. 앱 마이페이지에서 입력하면 인증됩니다.
            </p>
            <div
              className="rounded-xl p-4 mb-4 font-mono text-sm break-all"
              style={{ background: "#F1F8E9", color: "#2E7D32" }}
            >
              {newKey}
            </div>
            <div className="flex gap-2">
              <button
                onClick={copy}
                className="flex-1 py-2.5 rounded-xl font-bold text-sm"
                style={{ background: "#4285F4", color: "#fff" }}
              >
                {copied ? "복사됨!" : "클립보드에 복사"}
              </button>
              <button
                onClick={onClose}
                className="flex-1 py-2.5 rounded-xl font-bold text-sm"
                style={{ background: "#f1f3f4", color: "#444" }}
              >
                닫기
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-lg font-bold mb-5" style={{ color: "#1a1a1a" }}>
              인증된 사용자 추가
            </h2>
            <div className="flex flex-col gap-3 mb-6">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  사용자 ID (UUID) *
                </label>
                <input
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  placeholder="예) 550e8400-e29b-41d4-a716-446655440000"
                  className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none font-mono"
                  style={{ borderColor: "#ddd" }}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  표시 이름 (기관 / 담당자) *
                </label>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="예) 행정안전부 도로점검팀"
                  className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
                  style={{ borderColor: "#ddd" }}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={submit}
                disabled={!userId.trim() || !displayName.trim() || loading}
                className="flex-1 py-2.5 rounded-xl font-bold text-sm disabled:opacity-50"
                style={{ background: "#4285F4", color: "#fff" }}
              >
                {loading ? "발급 중..." : "저장 및 키 자동 발급"}
              </button>
              <button
                onClick={onClose}
                className="flex-1 py-2.5 rounded-xl font-bold text-sm"
                style={{ background: "#f1f3f4", color: "#444" }}
              >
                취소
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

interface EditModalProps {
  user: CertifiedUser;
  onClose: () => void;
  onSaved: (id: number, displayName: string) => Promise<void>;
}

function EditModal({ user, onClose, onSaved }: EditModalProps) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!displayName.trim()) return;
    setLoading(true);
    try {
      await onSaved(user.id, displayName.trim());
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.45)" }}
    >
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md mx-4">
        <h2 className="text-lg font-bold mb-5" style={{ color: "#1a1a1a" }}>
          인증 사용자 편집
        </h2>
        <div className="flex flex-col gap-3 mb-6">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">
              사용자 ID
            </label>
            <p className="px-3 py-2.5 rounded-xl border text-sm font-mono text-gray-400 truncate"
               style={{ borderColor: "#eee", background: "#fafafa" }}>
              {user.userId}
            </p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">
              표시 이름 *
            </label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
              style={{ borderColor: "#ddd" }}
            />
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={submit}
            disabled={!displayName.trim() || loading}
            className="flex-1 py-2.5 rounded-xl font-bold text-sm disabled:opacity-50"
            style={{ background: "#4285F4", color: "#fff" }}
          >
            {loading ? "저장 중..." : "저장"}
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl font-bold text-sm"
            style={{ background: "#f1f3f4", color: "#444" }}
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CertifiedPage() {
  const [users, setUsers] = useState<CertifiedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState<CertifiedUser | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setUsers(await getCertifiedUsers());
      setError(null);
    } catch {
      setError("백엔드 서버에 연결할 수 없습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (userId: string, displayName: string): Promise<string> => {
    const result = await createCertifiedUser(userId, displayName, "");
    await load();
    return result.certifiedKey;
  };

  const handleEdit = async (id: number, displayName: string) => {
    await updateCertifiedUser(id, displayName);
    await load();
  };

  const handleDelete = async (user: CertifiedUser) => {
    if (!confirm(`"${user.displayName}" 인증 사용자를 삭제하시겠습니까?\n발급된 키가 즉시 무효화됩니다.`))
      return;
    await deleteCertifiedUser(user.id);
    await load();
  };

  return (
    <div>
      {showAdd && (
        <AddModal
          onClose={() => setShowAdd(false)}
          onCreated={handleCreate}
        />
      )}
      {editTarget && (
        <EditModal
          user={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={handleEdit}
        />
      )}

      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#1a1a1a" }}>
            ⭐ 인증된 사용자 관리
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            발급된 키를 앱에 입력하면 기여 내용에 인증 마크가 표시됩니다.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="px-5 py-2.5 rounded-xl font-bold text-sm shadow-sm"
          style={{ background: "#4285F4", color: "#fff" }}
        >
          + 인증된 사용자 추가
        </button>
      </div>

      {/* 안내 박스 */}
      <div
        className="rounded-xl px-5 py-4 mb-6 text-sm"
        style={{ background: "#E8F0FE", color: "#1967D2" }}
      >
        <strong>인증 방법:</strong> 사용자 UUID와 이름을 입력하면 키가 자동 발급됩니다.
        키를 앱 마이페이지에서 입력하면 해당 사용자의 기여에 ⭐ 인증 마크가 표시됩니다.
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="text-center py-16 text-gray-400">불러오는 중...</div>
      ) : error ? (
        <div
          className="rounded-xl p-5 text-sm"
          style={{ background: "#FDECEA", color: "#D93025" }}
        >
          {error}
        </div>
      ) : users.length === 0 ? (
        <div
          className="rounded-2xl py-16 text-center text-gray-400"
          style={{ background: "#fff", border: "1px dashed #ddd" }}
        >
          등록된 인증 사용자가 없습니다.
        </div>
      ) : (
        <div
          className="rounded-2xl overflow-hidden shadow-sm"
          style={{ background: "#fff", border: "1px solid #eee" }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "#f8f9fa", borderBottom: "1px solid #eee" }}>
                {["표시 이름", "사용자 ID", "발급된 키", "등록일", ""].map((h) => (
                  <th
                    key={h}
                    className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u, i) => (
                <tr
                  key={u.id}
                  style={{
                    borderBottom: i < users.length - 1 ? "1px solid #f0f0f0" : "none",
                  }}
                >
                  <td className="px-5 py-4 font-semibold" style={{ color: "#1a1a1a" }}>
                    ⭐ {u.displayName}
                  </td>
                  <td className="px-5 py-4 text-gray-400 font-mono text-xs truncate max-w-[160px]">
                    {u.userId}
                  </td>
                  <td className="px-5 py-4">
                    <MaskKey certKey={u.certifiedKey} />
                  </td>
                  <td className="px-5 py-4 text-gray-400 text-xs">
                    {new Date(u.createdAt).toLocaleDateString("ko-KR")}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => setEditTarget(u)}
                        className="px-3 py-1.5 rounded-xl text-xs font-bold"
                        style={{ background: "#E8F0FE", color: "#1967D2" }}
                      >
                        편집
                      </button>
                      <button
                        onClick={() => handleDelete(u)}
                        className="px-3 py-1.5 rounded-xl text-xs font-bold"
                        style={{ background: "#FDECEA", color: "#D93025" }}
                      >
                        삭제
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const API = "http://localhost:8000";

export interface Obstacle {
  id: number;
  photoUrl: string | null;
  latitude: number;
  longitude: number;
  createdAt: string;
  userId: string;
  userEmail: string;
  displayName: string;
  likes: number;
  dislikes: number;
  aiLabel: string | null;
  aiConfidence: number | null;
  aiDetections: { label: string; confidence: number }[] | null;
  isApproved: boolean;
}

export interface Post {
  id: number;
  title: string;
  content: string;
  userId: string;
  userEmail: string;
  displayName: string;
  createdAt: string;
  likes: number;
  commentCount: number;
}

export interface Stats {
  totalObstacles: number;
  approvedObstacles: number;
  pendingObstacles: number;
  totalPosts: number;
  totalComments: number;
}

export async function getStats(): Promise<Stats> {
  const res = await fetch(`${API}/admin/stats`, { cache: "no-store" });
  return res.json();
}

export async function getObstacles(): Promise<Obstacle[]> {
  const res = await fetch(`${API}/admin/obstacles`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export async function toggleApprove(id: number): Promise<{ id: number; isApproved: boolean }> {
  const res = await fetch(`${API}/admin/obstacles/${id}/approve`, { method: "PATCH" });
  return res.json();
}

export async function deleteObstacle(id: number, reason = ""): Promise<void> {
  const qs = reason ? `?reason=${encodeURIComponent(reason)}` : "";
  await fetch(`${API}/admin/obstacles/${id}${qs}`, { method: "DELETE" });
}

export async function getPosts(): Promise<Post[]> {
  const res = await fetch(`${API}/admin/posts`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export async function deletePost(id: number): Promise<void> {
  await fetch(`${API}/admin/posts/${id}`, { method: "DELETE" });
}

export async function deleteComment(id: number): Promise<void> {
  await fetch(`${API}/admin/comments/${id}`, { method: "DELETE" });
}

// ── 인증 사용자 ───────────────────────────────────────────────────

export interface CertifiedUser {
  id: number;
  userId: string;
  displayName: string;
  certifiedKey: string;
  createdAt: string;
}

export async function getCertifiedUsers(): Promise<CertifiedUser[]> {
  const res = await fetch(`${API}/admin/certified`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export async function createCertifiedUser(userId: string, displayName: string, certifiedKey: string): Promise<CertifiedUser> {
  const res = await fetch(`${API}/admin/certified`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, display_name: displayName, certified_key: certifiedKey }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function updateCertifiedUser(id: number, displayName?: string, certifiedKey?: string): Promise<void> {
  const body: Record<string, string> = {};
  if (displayName !== undefined) body.display_name = displayName;
  if (certifiedKey !== undefined) body.certified_key = certifiedKey;
  const res = await fetch(`${API}/admin/certified/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function deleteCertifiedUser(id: number): Promise<void> {
  await fetch(`${API}/admin/certified/${id}`, { method: "DELETE" });
}

// ── 자동 승인 설정 ────────────────────────────────────────────────

export async function getAutoApprove(): Promise<boolean> {
  const res = await fetch(`${API}/admin/settings/auto-approve`, { cache: "no-store" });
  if (!res.ok) return true;
  const data = await res.json();
  return data.autoApprove;
}

export async function setAutoApprove(enabled: boolean): Promise<void> {
  await fetch(`${API}/admin/settings/auto-approve?enabled=${enabled}`, { method: "PATCH" });
}

// ── 레거시 호환 (AutoApproveToggle / dashboard page) ───────────────

export async function getSettings(): Promise<Record<string, string>> {
  const enabled = await getAutoApprove();
  return { auto_approve_images: enabled ? "true" : "false" };
}

export async function updateSetting(key: string, value: boolean): Promise<void> {
  if (key === "auto_approve_images") await setAutoApprove(value);
}

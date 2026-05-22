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

export async function deleteObstacle(id: number): Promise<void> {
  await fetch(`${API}/admin/obstacles/${id}`, { method: "DELETE" });
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

// ── 인증된 사용자 ─────────────────────────────────────────────────

export interface CertifiedUser {
  id: number;
  name: string;
  affiliation: string;
  apiKey: string;
  createdAt: string;
  expiresAt: string;
  daysLeft: number;
}

export async function getCertifiedUsers(): Promise<CertifiedUser[]> {
  const res = await fetch(`${API}/admin/certified`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export async function createCertifiedUser(
  name: string,
  affiliation: string
): Promise<{ id: number; name: string; affiliation: string; apiKey: string; expiresAt: string }> {
  const res = await fetch(`${API}/admin/certified`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, affiliation }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function updateCertifiedUser(
  id: number,
  name: string,
  affiliation: string
): Promise<CertifiedUser> {
  const res = await fetch(`${API}/admin/certified/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, affiliation }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function deleteCertifiedUser(id: number): Promise<void> {
  await fetch(`${API}/admin/certified/${id}`, { method: "DELETE" });
}

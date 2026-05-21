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

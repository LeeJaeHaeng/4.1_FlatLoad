export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://192.168.0.40:8000';

async function apiFetch(url: string, options?: RequestInit, timeoutMs = 12000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface ApiObstacle {
  id: number;
  photoUri: string;
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
  aiDetections: { label: string; confidence: number; bbox: [number, number, number, number] }[] | null;
  isCertified: boolean;
}

// ── 장애물 ────────────────────────────────────────────────────────

export async function apiGetObstacles(): Promise<ApiObstacle[]> {
  const res = await apiFetch(`${API_BASE_URL}/api/obstacles`);
  if (!res.ok) throw new Error('장애물 목록 조회 실패');
  return res.json();
}

export async function apiCreateObstacle(
  photoUri: string,
  latitude: number,
  longitude: number,
  userId: string,
  userEmail: string,
  displayName: string,
  certifiedKey: string = ''
): Promise<ApiObstacle> {
  const form = new FormData();
  form.append('photo', { uri: photoUri, name: 'obstacle.jpg', type: 'image/jpeg' } as any);
  form.append('latitude', String(latitude));
  form.append('longitude', String(longitude));
  form.append('user_id', userId);
  form.append('user_email', userEmail);
  form.append('display_name', displayName);
  if (certifiedKey) form.append('certified_key', certifiedKey);

  const res = await apiFetch(`${API_BASE_URL}/api/obstacles`, { method: 'POST', body: form }, 30000);
  if (!res.ok) throw new Error('장애물 등록 실패');
  return res.json();
}

export async function apiVoteObstacle(
  obstacleId: number,
  userId: string,
  voteType: 'like' | 'dislike'
): Promise<{ likes: number; dislikes: number; userVote: string | null }> {
  const res = await apiFetch(`${API_BASE_URL}/api/obstacles/${obstacleId}/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, vote_type: voteType }),
  });
  if (!res.ok) throw new Error('투표 실패');
  return res.json();
}

export async function apiGetUserVote(
  obstacleId: number,
  userId: string
): Promise<'like' | 'dislike' | null> {
  const res = await apiFetch(`${API_BASE_URL}/api/obstacles/${obstacleId}/vote/${userId}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.userVote;
}

export async function apiGetMyObstacles(userId: string): Promise<ApiObstacle[]> {
  const res = await apiFetch(`${API_BASE_URL}/api/obstacles/mine/${userId}`);
  if (!res.ok) throw new Error('내 장애물 조회 실패');
  return res.json();
}

export async function apiGetTopContributors(): Promise<
  { userId: string; displayName: string; userEmail: string; totalLikes: number }[]
> {
  const res = await apiFetch(`${API_BASE_URL}/api/obstacles/contributors/top`);
  if (!res.ok) throw new Error('기여자 조회 실패');
  return res.json();
}

// ── 커뮤니티 ────────────────────────────────────────────────────────

export async function apiGetPosts() {
  const res = await apiFetch(`${API_BASE_URL}/api/community/posts`);
  if (!res.ok) throw new Error('게시글 조회 실패');
  return res.json();
}

export async function apiCreatePost(
  title: string, content: string,
  userId: string, userEmail: string, displayName: string,
  certifiedKey: string = ''
) {
  const res = await apiFetch(`${API_BASE_URL}/api/community/posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title, content,
      user_id: userId, user_email: userEmail, display_name: displayName,
      certified_key: certifiedKey,
    }),
  });
  if (!res.ok) throw new Error('게시글 작성 실패');
  return res.json();
}

export async function apiTogglePostLike(postId: number, userId: string) {
  const res = await apiFetch(`${API_BASE_URL}/api/community/posts/${postId}/like?user_id=${userId}`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('좋아요 실패');
  return res.json();
}

export async function apiGetPostLiked(postId: number, userId: string): Promise<boolean> {
  const res = await apiFetch(`${API_BASE_URL}/api/community/posts/${postId}/liked/${userId}`);
  if (!res.ok) return false;
  const data = await res.json();
  return data.liked;
}

export async function apiDeletePost(postId: number, userId: string) {
  const res = await apiFetch(`${API_BASE_URL}/api/community/posts/${postId}?user_id=${userId}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('게시글 삭제 실패');
  return res.json();
}

export async function apiGetComments(postId: number) {
  const res = await apiFetch(`${API_BASE_URL}/api/community/posts/${postId}/comments`);
  if (!res.ok) throw new Error('댓글 조회 실패');
  return res.json();
}

export async function apiAddComment(
  postId: number, content: string,
  userId: string, userEmail: string, displayName: string,
  certifiedKey: string = ''
) {
  const res = await apiFetch(`${API_BASE_URL}/api/community/posts/${postId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content, user_id: userId, user_email: userEmail, display_name: displayName,
      certified_key: certifiedKey,
    }),
  });
  if (!res.ok) throw new Error('댓글 작성 실패');
  return res.json();
}

export async function apiDeleteComment(commentId: number, userId: string) {
  const res = await apiFetch(`${API_BASE_URL}/api/community/comments/${commentId}?user_id=${userId}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('댓글 삭제 실패');
  return res.json();
}

// ── AI 분석 상태 확인 ─────────────────────────────────────────────

export async function apiCheckAiStatus(): Promise<{ ready: boolean; classes: string[] }> {
  try {
    const res = await apiFetch(`${API_BASE_URL}/api/analyze/status`, undefined, 5000);
    return res.json();
  } catch {
    return { ready: false, classes: [] };
  }
}

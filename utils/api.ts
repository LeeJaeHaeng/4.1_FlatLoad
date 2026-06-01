import { Platform } from 'react-native';

export const DEFAULT_API_BASE_URL = 'https://backend-jaehaeng2001-2614s-projects.vercel.app';
function normalizeApiBaseUrl(value: string | undefined): string {
  const cleaned = (value ?? '')
    .replace(/^\uFEFF+/, '')
    .replace(/[\r\n\t]/g, '')
    .trim()
    .replace(/\/+$/, '');
  if (/^https?:\/\//i.test(cleaned)) return cleaned;
  return DEFAULT_API_BASE_URL;
}

export const API_BASE_URL =
  normalizeApiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL);

async function appendPhoto(form: FormData, fieldName: string, photoUri: string): Promise<void> {
  if (Platform.OS === 'web') {
    const response = await fetch(photoUri);
    if (!response.ok) throw new Error('사진 파일을 읽을 수 없습니다.');
    const blob = await response.blob();
    const type = blob.type || 'image/jpeg';
    const file =
      typeof File !== 'undefined'
        ? new File([blob], 'obstacle.jpg', { type })
        : blob;
    form.append(fieldName, file as any);
    return;
  }

  form.append(fieldName, { uri: photoUri, name: 'obstacle.jpg', type: 'image/jpeg' } as any);
}

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
  certifiedKey: string = '',
  manualLabel: string = '',
  previewAnalysis?: {
    aiLabel: string | null;
    aiConfidence: number | null;
    aiDetections: { label: string; confidence: number; bbox: [number, number, number, number] }[];
  },
): Promise<ApiObstacle> {
  const form = new FormData();
  await appendPhoto(form, 'photo', photoUri);
  form.append('latitude', String(latitude));
  form.append('longitude', String(longitude));
  form.append('user_id', userId);
  form.append('user_email', userEmail);
  form.append('display_name', displayName);
  if (certifiedKey) form.append('certified_key', certifiedKey);
  if (manualLabel) form.append('manual_label', manualLabel);
  if (previewAnalysis?.aiLabel) form.append('ai_label', previewAnalysis.aiLabel);
  if (previewAnalysis?.aiConfidence != null) form.append('ai_confidence', String(previewAnalysis.aiConfidence));
  if (previewAnalysis?.aiDetections?.length) form.append('ai_detections', JSON.stringify(previewAnalysis.aiDetections));

  const res = await apiFetch(`${API_BASE_URL}/api/obstacles`, { method: 'POST', body: form }, 30000);
  if (!res.ok) throw new Error('장애물 등록 실패');
  return res.json();
}

export async function apiVoteObstacle(
  obstacleId: number,
  userId: string,
  voteType: 'like' | 'dislike'
): Promise<{ likes: number; dislikes: number; userVote: 'like' | 'dislike' | null }> {
  const res = await apiFetch(`${API_BASE_URL}/api/obstacles/${obstacleId}/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, vote_type: voteType }),
  });
  if (!res.ok) throw new Error('투표 실패');
  const data = await res.json();
  return {
    likes: data.likes,
    dislikes: data.dislikes,
    userVote: data.userVote === 'like' || data.userVote === 'dislike' ? data.userVote : null,
  };
}

export async function apiGetUserVote(
  obstacleId: number,
  userId: string
): Promise<'like' | 'dislike' | null> {
  const res = await apiFetch(`${API_BASE_URL}/api/obstacles/${obstacleId}/vote/${userId}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.userVote === 'like' || data.userVote === 'dislike' ? data.userVote : null;
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

export async function apiUpdateObstacleLabel(
  obstacleId: number,
  selectedLabel: string,
): Promise<ApiObstacle> {
  const res = await apiFetch(`${API_BASE_URL}/api/obstacles/${obstacleId}/label`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selected_label: selectedLabel }),
  });
  if (!res.ok) throw new Error('레이블 업데이트 실패');
  return res.json();
}

// ── 삭제 알림 ────────────────────────────────────────────────────────

export interface DeleteNotification {
  id: number;
  obstacleId: number;
  reason: string;
  createdAt: string;
}

export async function apiGetDeleteNotifications(userId: string): Promise<DeleteNotification[]> {
  try {
    const res = await apiFetch(`${API_BASE_URL}/api/route/notifications/${userId}`, undefined, 8000);
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function apiMarkNotificationRead(notificationId: number): Promise<void> {
  try {
    await apiFetch(`${API_BASE_URL}/api/route/notifications/${notificationId}/read`, { method: 'POST' }, 8000);
  } catch {}
}

// ── 안전 경로 ────────────────────────────────────────────────────────

export async function apiGetAvoidLocations(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): Promise<{ lat: number; lon: number }[]> {
  const res = await apiFetch(`${API_BASE_URL}/api/route/avoid-locations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from_lat: fromLat, from_lng: fromLng, to_lat: toLat, to_lng: toLng }),
  }, 10000);
  if (!res.ok) return [];
  const data = await res.json();
  return data.avoid_locations ?? [];
}

export async function apiGetRamps(lat: number, lng: number): Promise<{ lat: number; lon: number }[]> {
  try {
    const res = await apiFetch(`${API_BASE_URL}/api/route/ramps?lat=${lat}&lng=${lng}`, undefined, 20000);
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export type RouteFacilityType = 'ramp' | 'elevator' | 'toilet' | 'charger' | 'parking';

export interface ApiRouteFacility {
  id: string;
  type: RouteFacilityType;
  name: string;
  address: string;
  detail?: string;
  phone?: string;
  source: 'disabled_facility_api' | 'wheelchair_charger_csv' | 'kakao_local_fallback' | 'overpass_fallback';
  lat: number;
  lng: number;
  distance: number;
}

export async function apiGetRouteFacilities(
  lat: number,
  lng: number,
  types: RouteFacilityType[],
  radiusM: number = 3000,
): Promise<ApiRouteFacility[]> {
  const params = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    radius_m: String(radiusM),
    types: types.join(','),
  });
  const res = await apiFetch(`${API_BASE_URL}/api/route/facilities?${params.toString()}`, undefined, 30000);
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.detail || '편의시설 조회 실패');
  }
  return res.json();
}

export async function apiGetSlopeWarnings(
  routePoints: [number, number][],
): Promise<{ lat: number; lng: number }[]> {
  const points = routePoints
    .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng))
    .slice(0, 500);
  if (!points.length) return [];

  try {
    const res = await apiFetch(`${API_BASE_URL}/api/route/slope-warnings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points }),
    }, 25000);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.warnings) ? data.warnings : [];
  } catch {
    return [];
  }
}

// ── AI 분석 ───────────────────────────────────────────────────────

export async function apiAnalyzeImage(photoUri: string): Promise<{
  aiLabel: string | null;
  aiConfidence: number | null;
  aiDetections: { label: string; confidence: number; bbox: [number, number, number, number] }[];
}> {
  try {
    const form = new FormData();
    await appendPhoto(form, 'photo', photoUri);
    const res = await apiFetch(`${API_BASE_URL}/api/analyze/detect`, { method: 'POST', body: form }, 30000);
    if (!res.ok) return { aiLabel: null, aiConfidence: null, aiDetections: [] };
    const data = await res.json();
    return {
      aiLabel: data.ai_label ?? null,
      aiConfidence: data.ai_confidence ?? null,
      aiDetections: data.ai_detections ?? [],
    };
  } catch {
    return { aiLabel: null, aiConfidence: null, aiDetections: [] };
  }
}

export async function apiCheckAiStatus(): Promise<{ ready: boolean; classes: string[] }> {
  try {
    const res = await apiFetch(`${API_BASE_URL}/api/analyze/status`, undefined, 5000);
    if (!res.ok) return { ready: false, classes: [] };
    const data = await res.json();
    return {
      ready: !!data.ready,
      classes: Array.isArray(data.classes) ? data.classes : [],
    };
  } catch {
    return { ready: false, classes: [] };
  }
}

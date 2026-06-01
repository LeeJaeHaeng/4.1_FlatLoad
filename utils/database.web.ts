export interface ObstacleRecord {
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
}

export interface TopContributor {
  userId: string;
  displayName: string;
  userEmail: string;
  totalLikes: number;
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
  isCertified: boolean;
}

export interface Comment {
  id: number;
  postId: number;
  content: string;
  userId: string;
  userEmail: string;
  displayName: string;
  createdAt: string;
  isCertified: boolean;
}

type VoteRecord = {
  obstacleId: number;
  userId: string;
  voteType: 'like' | 'dislike';
};

type PostLikeRecord = {
  postId: number;
  userId: string;
};

const OBSTACLES_KEY = '@flatroad/web/obstacles';
const VOTES_KEY = '@flatroad/web/votes';
const POSTS_KEY = '@flatroad/web/posts';
const POST_LIKES_KEY = '@flatroad/web/post_likes';
const COMMENTS_KEY = '@flatroad/web/comments';

function storage(): Storage | null {
  return typeof globalThis !== 'undefined' ? ((globalThis as any).localStorage ?? null) : null;
}

function readList<T>(key: string): T[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeList<T>(key: string, rows: T[]): void {
  const store = storage();
  if (!store) return;
  store.setItem(key, JSON.stringify(rows));
}

function nextId(rows: { id: number }[]): number {
  return rows.reduce((max, row) => Math.max(max, row.id), 0) + 1;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function persistWebPhotoUri(photoUri: string): Promise<string> {
  if (!photoUri.startsWith('blob:')) return photoUri;
  try {
    const response = await fetch(photoUri);
    if (!response.ok) return '';
    return await blobToDataUrl(await response.blob());
  } catch {
    return '';
  }
}

function stripStaleBlobPhoto<T extends { photoUri?: string }>(item: T): T {
  if (typeof item.photoUri !== 'string' || !item.photoUri.startsWith('blob:')) return item;
  return { ...item, photoUri: '' };
}

function sanitizeObstacleRows(rows: ObstacleRecord[]): ObstacleRecord[] {
  const sanitized = rows.map(stripStaleBlobPhoto);
  if (JSON.stringify(sanitized) !== JSON.stringify(rows)) {
    writeList(OBSTACLES_KEY, sanitized);
  }
  return sanitized;
}

export async function getDatabase(): Promise<null> {
  return null;
}

export async function saveObstacle(
  tempUri: string,
  latitude: number,
  longitude: number,
  userId: string = '',
  userEmail: string = '',
  displayName: string = '',
): Promise<number> {
  const rows = readList<ObstacleRecord>(OBSTACLES_KEY);
  const id = nextId(rows);
  const photoUri = await persistWebPhotoUri(tempUri);
  rows.unshift({
    id,
    photoUri,
    latitude,
    longitude,
    createdAt: new Date().toISOString(),
    userId,
    userEmail,
    displayName,
    likes: 0,
    dislikes: 0,
  });
  writeList(OBSTACLES_KEY, rows);
  return id;
}

export async function getAllObstacles(): Promise<ObstacleRecord[]> {
  return sanitizeObstacleRows(readList<ObstacleRecord>(OBSTACLES_KEY))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getAllObstaclesWithBase64(): Promise<(ObstacleRecord & { photoBase64: string })[]> {
  const rows = await getAllObstacles();
  return rows.map(row => ({ ...row, photoBase64: row.photoUri }));
}

export async function deleteObstacle(id: number): Promise<void> {
  writeList(OBSTACLES_KEY, readList<ObstacleRecord>(OBSTACLES_KEY).filter(row => row.id !== id));
  writeList(VOTES_KEY, readList<VoteRecord>(VOTES_KEY).filter(row => row.obstacleId !== id));
}

export async function getUserVote(
  obstacleId: number,
  userId: string,
): Promise<'like' | 'dislike' | null> {
  return readList<VoteRecord>(VOTES_KEY)
    .find(row => row.obstacleId === obstacleId && row.userId === userId)
    ?.voteType ?? null;
}

export async function castVote(
  obstacleId: number,
  userId: string,
  voteType: 'like' | 'dislike',
): Promise<{ likes: number; dislikes: number; userVote: 'like' | 'dislike' | null }> {
  const obstacles = readList<ObstacleRecord>(OBSTACLES_KEY);
  const obstacle = obstacles.find(row => row.id === obstacleId);
  let votes = readList<VoteRecord>(VOTES_KEY);
  const existing = votes.find(row => row.obstacleId === obstacleId && row.userId === userId);
  let userVote: 'like' | 'dislike' | null = voteType;

  if (existing?.voteType === voteType) {
    votes = votes.filter(row => !(row.obstacleId === obstacleId && row.userId === userId));
    userVote = null;
  } else if (existing) {
    existing.voteType = voteType;
  } else {
    votes.push({ obstacleId, userId, voteType });
  }

  if (obstacle) {
    const currentVotes = votes.filter(row => row.obstacleId === obstacleId);
    obstacle.likes = currentVotes.filter(row => row.voteType === 'like').length;
    obstacle.dislikes = currentVotes.filter(row => row.voteType === 'dislike').length;
  }
  writeList(VOTES_KEY, votes);
  writeList(OBSTACLES_KEY, obstacles);

  return { likes: obstacle?.likes ?? 0, dislikes: obstacle?.dislikes ?? 0, userVote };
}

export async function getMyObstacles(userId: string): Promise<ObstacleRecord[]> {
  return (await getAllObstacles()).filter(row => row.userId === userId);
}

export async function getTopContributors(limit: number = 3): Promise<TopContributor[]> {
  const totals = new Map<string, TopContributor>();
  for (const row of readList<ObstacleRecord>(OBSTACLES_KEY)) {
    if (!row.userId) continue;
    const existing = totals.get(row.userId) ?? {
      userId: row.userId,
      displayName: row.displayName,
      userEmail: row.userEmail,
      totalLikes: 0,
    };
    existing.totalLikes += row.likes;
    totals.set(row.userId, existing);
  }
  return [...totals.values()].sort((a, b) => b.totalLikes - a.totalLikes).slice(0, limit);
}

export async function getPosts(): Promise<Post[]> {
  const comments = readList<Comment>(COMMENTS_KEY);
  return readList<Post>(POSTS_KEY)
    .map(post => ({ ...post, commentCount: comments.filter(comment => comment.postId === post.id).length }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createPost(
  title: string,
  content: string,
  userId: string,
  userEmail: string,
  displayName: string,
  isCertified: boolean = false,
): Promise<number> {
  const posts = readList<Post>(POSTS_KEY);
  const id = nextId(posts);
  posts.unshift({
    id,
    title,
    content,
    userId,
    userEmail,
    displayName,
    createdAt: new Date().toISOString(),
    likes: 0,
    commentCount: 0,
    isCertified,
  });
  writeList(POSTS_KEY, posts);
  return id;
}

export async function togglePostLike(postId: number, userId: string): Promise<{ likes: number; liked: boolean }> {
  const posts = readList<Post>(POSTS_KEY);
  const post = posts.find(row => row.id === postId);
  let likes = readList<PostLikeRecord>(POST_LIKES_KEY);
  const existing = likes.some(row => row.postId === postId && row.userId === userId);
  let liked = true;

  if (existing) {
    likes = likes.filter(row => !(row.postId === postId && row.userId === userId));
    liked = false;
  } else {
    likes.push({ postId, userId });
  }
  if (post) post.likes = likes.filter(row => row.postId === postId).length;
  writeList(POST_LIKES_KEY, likes);
  writeList(POSTS_KEY, posts);
  return { likes: post?.likes ?? 0, liked };
}

export async function getPostLiked(postId: number, userId: string): Promise<boolean> {
  return readList<PostLikeRecord>(POST_LIKES_KEY)
    .some(row => row.postId === postId && row.userId === userId);
}

export async function deletePost(postId: number): Promise<void> {
  writeList(POSTS_KEY, readList<Post>(POSTS_KEY).filter(row => row.id !== postId));
  writeList(COMMENTS_KEY, readList<Comment>(COMMENTS_KEY).filter(row => row.postId !== postId));
  writeList(POST_LIKES_KEY, readList<PostLikeRecord>(POST_LIKES_KEY).filter(row => row.postId !== postId));
}

export async function getComments(postId: number): Promise<Comment[]> {
  return readList<Comment>(COMMENTS_KEY)
    .filter(row => row.postId === postId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function addComment(
  postId: number,
  content: string,
  userId: string,
  userEmail: string,
  displayName: string,
  isCertified: boolean = false,
): Promise<number> {
  const comments = readList<Comment>(COMMENTS_KEY);
  const id = nextId(comments);
  comments.push({
    id,
    postId,
    content,
    userId,
    userEmail,
    displayName,
    createdAt: new Date().toISOString(),
    isCertified,
  });
  writeList(COMMENTS_KEY, comments);
  return id;
}

export async function deleteComment(commentId: number): Promise<void> {
  writeList(COMMENTS_KEY, readList<Comment>(COMMENTS_KEY).filter(row => row.id !== commentId));
}

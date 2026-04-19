import * as SQLite from 'expo-sqlite';
import { File, Directory, Paths } from 'expo-file-system';

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
}

export interface Comment {
  id: number;
  postId: number;
  content: string;
  userId: string;
  userEmail: string;
  displayName: string;
  createdAt: string;
}

// ── 싱글턴 초기화 (race condition 방지) ────────────────────────────
let _db: SQLite.SQLiteDatabase | null = null;
let _initPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function initDatabase(): Promise<SQLite.SQLiteDatabase> {
  const database = await SQLite.openDatabaseAsync('obstacles.db');

  await database.execAsync('PRAGMA journal_mode = WAL;');

  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS obstacles (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      photoUri    TEXT    NOT NULL,
      latitude    REAL    NOT NULL,
      longitude   REAL    NOT NULL,
      createdAt   TEXT    NOT NULL,
      userId      TEXT    NOT NULL DEFAULT '',
      userEmail   TEXT    NOT NULL DEFAULT '',
      displayName TEXT    NOT NULL DEFAULT '',
      likes       INTEGER NOT NULL DEFAULT 0,
      dislikes    INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS votes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      obstacleId  INTEGER NOT NULL,
      userId      TEXT    NOT NULL,
      voteType    TEXT    NOT NULL,
      UNIQUE(obstacleId, userId)
    );
    CREATE TABLE IF NOT EXISTS posts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT    NOT NULL,
      content     TEXT    NOT NULL,
      userId      TEXT    NOT NULL DEFAULT '',
      userEmail   TEXT    NOT NULL DEFAULT '',
      displayName TEXT    NOT NULL DEFAULT '',
      createdAt   TEXT    NOT NULL,
      likes       INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS post_likes (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      postId  INTEGER NOT NULL,
      userId  TEXT    NOT NULL,
      UNIQUE(postId, userId)
    );
    CREATE TABLE IF NOT EXISTS comments (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      postId      INTEGER NOT NULL,
      content     TEXT    NOT NULL,
      userId      TEXT    NOT NULL DEFAULT '',
      userEmail   TEXT    NOT NULL DEFAULT '',
      displayName TEXT    NOT NULL DEFAULT '',
      createdAt   TEXT    NOT NULL
    );
  `);

  const migrations = [
    `ALTER TABLE obstacles ADD COLUMN userId TEXT NOT NULL DEFAULT '';`,
    `ALTER TABLE obstacles ADD COLUMN userEmail TEXT NOT NULL DEFAULT '';`,
    `ALTER TABLE obstacles ADD COLUMN displayName TEXT NOT NULL DEFAULT '';`,
    `ALTER TABLE obstacles ADD COLUMN likes INTEGER NOT NULL DEFAULT 0;`,
    `ALTER TABLE obstacles ADD COLUMN dislikes INTEGER NOT NULL DEFAULT 0;`,
  ];
  for (const sql of migrations) {
    try { await database.execAsync(sql); } catch { /* 이미 존재 */ }
  }

  return database;
}

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  if (!_initPromise) {
    _initPromise = initDatabase();
  }
  _db = await _initPromise;
  return _db;
}

// ── 장애물 ────────────────────────────────────────────────────────

export async function saveObstacle(
  tempUri: string,
  latitude: number,
  longitude: number,
  userId: string = '',
  userEmail: string = '',
  displayName: string = ''
): Promise<number> {
  const database = await getDatabase();

  const obstaclesDir = new Directory(Paths.document, 'obstacles');
  obstaclesDir.create({ idempotent: true });

  const fileName = `obstacle_${Date.now()}.jpg`;
  const destFile = new File(obstaclesDir, fileName);
  const srcFile = new File(tempUri);
  srcFile.copy(destFile);

  const destUri = destFile.uri;
  const createdAt = new Date().toISOString();
  const result = await database.runAsync(
    `INSERT INTO obstacles
      (photoUri, latitude, longitude, createdAt, userId, userEmail, displayName)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [destUri, latitude, longitude, createdAt, userId, userEmail, displayName]
  );

  return result.lastInsertRowId;
}

export async function getAllObstacles(): Promise<ObstacleRecord[]> {
  const database = await getDatabase();
  return database.getAllAsync<ObstacleRecord>(
    'SELECT * FROM obstacles ORDER BY createdAt DESC'
  );
}

export async function getAllObstaclesWithBase64(): Promise<(ObstacleRecord & { photoBase64: string })[]> {
  const rows = await getAllObstacles();
  return Promise.all(
    rows.map(async (row) => {
      try {
        const file = new File(row.photoUri);
        if (!file.exists) return { ...row, photoBase64: '' };
        const base64 = await file.base64();
        return { ...row, photoBase64: `data:image/jpeg;base64,${base64}` };
      } catch {
        return { ...row, photoBase64: '' };
      }
    })
  );
}

export async function deleteObstacle(id: number): Promise<void> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<ObstacleRecord>(
    'SELECT photoUri FROM obstacles WHERE id = ?',
    [id]
  );
  if (rows.length > 0) {
    try {
      const file = new File(rows[0].photoUri);
      if (file.exists) file.delete();
    } catch { /* 무시 */ }
  }
  await database.runAsync('DELETE FROM obstacles WHERE id = ?', [id]);
  await database.runAsync('DELETE FROM votes WHERE obstacleId = ?', [id]);
}

export async function getUserVote(
  obstacleId: number,
  userId: string
): Promise<'like' | 'dislike' | null> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<{ voteType: string }>(
    'SELECT voteType FROM votes WHERE obstacleId = ? AND userId = ?',
    [obstacleId, userId]
  );
  return (row?.voteType as 'like' | 'dislike') ?? null;
}

export async function castVote(
  obstacleId: number,
  userId: string,
  voteType: 'like' | 'dislike'
): Promise<{ likes: number; dislikes: number; userVote: 'like' | 'dislike' | null }> {
  const database = await getDatabase();

  const existing = await database.getFirstAsync<{ voteType: string }>(
    'SELECT voteType FROM votes WHERE obstacleId = ? AND userId = ?',
    [obstacleId, userId]
  );

  let newUserVote: 'like' | 'dislike' | null;

  if (existing?.voteType === voteType) {
    await database.runAsync('DELETE FROM votes WHERE obstacleId = ? AND userId = ?', [obstacleId, userId]);
    const col = voteType === 'like' ? 'likes' : 'dislikes';
    await database.runAsync(`UPDATE obstacles SET ${col} = MAX(0, ${col} - 1) WHERE id = ?`, [obstacleId]);
    newUserVote = null;
  } else if (existing) {
    await database.runAsync('UPDATE votes SET voteType = ? WHERE obstacleId = ? AND userId = ?', [voteType, obstacleId, userId]);
    if (voteType === 'like') {
      await database.runAsync('UPDATE obstacles SET likes = likes + 1, dislikes = MAX(0, dislikes - 1) WHERE id = ?', [obstacleId]);
    } else {
      await database.runAsync('UPDATE obstacles SET dislikes = dislikes + 1, likes = MAX(0, likes - 1) WHERE id = ?', [obstacleId]);
    }
    newUserVote = voteType;
  } else {
    await database.runAsync('INSERT INTO votes (obstacleId, userId, voteType) VALUES (?, ?, ?)', [obstacleId, userId, voteType]);
    const col = voteType === 'like' ? 'likes' : 'dislikes';
    await database.runAsync(`UPDATE obstacles SET ${col} = ${col} + 1 WHERE id = ?`, [obstacleId]);
    newUserVote = voteType;
  }

  const updated = await database.getFirstAsync<{ likes: number; dislikes: number }>(
    'SELECT likes, dislikes FROM obstacles WHERE id = ?', [obstacleId]
  );

  return { likes: updated?.likes ?? 0, dislikes: updated?.dislikes ?? 0, userVote: newUserVote };
}

export async function getMyObstacles(userId: string): Promise<ObstacleRecord[]> {
  const database = await getDatabase();
  return database.getAllAsync<ObstacleRecord>(
    'SELECT * FROM obstacles WHERE userId = ? ORDER BY createdAt DESC', [userId]
  );
}

export async function getTopContributors(limit: number = 3): Promise<TopContributor[]> {
  const database = await getDatabase();
  return database.getAllAsync<TopContributor>(
    `SELECT userId, displayName, userEmail, SUM(likes) as totalLikes
     FROM obstacles WHERE userId != ''
     GROUP BY userId ORDER BY totalLikes DESC LIMIT ?`,
    [limit]
  );
}

// ── 커뮤니티 ────────────────────────────────────────────────────────

export async function getPosts(): Promise<Post[]> {
  const database = await getDatabase();
  return database.getAllAsync<Post>(
    `SELECT p.*, COUNT(c.id) as commentCount
     FROM posts p LEFT JOIN comments c ON c.postId = p.id
     GROUP BY p.id ORDER BY p.createdAt DESC`
  );
}

export async function createPost(
  title: string, content: string,
  userId: string, userEmail: string, displayName: string
): Promise<number> {
  const database = await getDatabase();
  const result = await database.runAsync(
    `INSERT INTO posts (title, content, userId, userEmail, displayName, createdAt) VALUES (?, ?, ?, ?, ?, ?)`,
    [title, content, userId, userEmail, displayName, new Date().toISOString()]
  );
  return result.lastInsertRowId;
}

export async function togglePostLike(postId: number, userId: string): Promise<{ likes: number; liked: boolean }> {
  const database = await getDatabase();
  const existing = await database.getFirstAsync<{ id: number }>(
    'SELECT id FROM post_likes WHERE postId = ? AND userId = ?', [postId, userId]
  );
  if (existing) {
    await database.runAsync('DELETE FROM post_likes WHERE postId = ? AND userId = ?', [postId, userId]);
    await database.runAsync('UPDATE posts SET likes = MAX(0, likes - 1) WHERE id = ?', [postId]);
  } else {
    await database.runAsync('INSERT INTO post_likes (postId, userId) VALUES (?, ?)', [postId, userId]);
    await database.runAsync('UPDATE posts SET likes = likes + 1 WHERE id = ?', [postId]);
  }
  const updated = await database.getFirstAsync<{ likes: number }>('SELECT likes FROM posts WHERE id = ?', [postId]);
  return { likes: updated?.likes ?? 0, liked: !existing };
}

export async function getPostLiked(postId: number, userId: string): Promise<boolean> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<{ id: number }>(
    'SELECT id FROM post_likes WHERE postId = ? AND userId = ?', [postId, userId]
  );
  return !!row;
}

export async function deletePost(postId: number): Promise<void> {
  const database = await getDatabase();
  await database.runAsync('DELETE FROM comments WHERE postId = ?', [postId]);
  await database.runAsync('DELETE FROM post_likes WHERE postId = ?', [postId]);
  await database.runAsync('DELETE FROM posts WHERE id = ?', [postId]);
}

export async function getComments(postId: number): Promise<Comment[]> {
  const database = await getDatabase();
  return database.getAllAsync<Comment>(
    'SELECT * FROM comments WHERE postId = ? ORDER BY createdAt ASC', [postId]
  );
}

export async function addComment(
  postId: number, content: string,
  userId: string, userEmail: string, displayName: string
): Promise<number> {
  const database = await getDatabase();
  const result = await database.runAsync(
    `INSERT INTO comments (postId, content, userId, userEmail, displayName, createdAt) VALUES (?, ?, ?, ?, ?, ?)`,
    [postId, content, userId, userEmail, displayName, new Date().toISOString()]
  );
  return result.lastInsertRowId;
}

export async function deleteComment(commentId: number): Promise<void> {
  const database = await getDatabase();
  await database.runAsync('DELETE FROM comments WHERE id = ?', [commentId]);
}

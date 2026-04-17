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

let db: SQLite.SQLiteDatabase | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    db = await SQLite.openDatabaseAsync('obstacles.db');
    await db.execAsync(`
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
    `);
    // 기존 테이블 마이그레이션
    const migrations = [
      `ALTER TABLE obstacles ADD COLUMN userId TEXT NOT NULL DEFAULT '';`,
      `ALTER TABLE obstacles ADD COLUMN userEmail TEXT NOT NULL DEFAULT '';`,
      `ALTER TABLE obstacles ADD COLUMN displayName TEXT NOT NULL DEFAULT '';`,
      `ALTER TABLE obstacles ADD COLUMN likes INTEGER NOT NULL DEFAULT 0;`,
      `ALTER TABLE obstacles ADD COLUMN dislikes INTEGER NOT NULL DEFAULT 0;`,
    ];
    for (const sql of migrations) {
      try { await db.execAsync(sql); } catch {}
    }
  }
  return db;
}

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

  try {
    srcFile.copy(destFile);
  } catch (copyErr) {
    console.error('[database] 파일 복사 실패, URI:', tempUri, copyErr);
    throw copyErr;
  }

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
    } catch {}
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
    // 같은 버튼 재클릭 → 취소
    await database.runAsync(
      'DELETE FROM votes WHERE obstacleId = ? AND userId = ?',
      [obstacleId, userId]
    );
    const col = voteType === 'like' ? 'likes' : 'dislikes';
    await database.runAsync(
      `UPDATE obstacles SET ${col} = MAX(0, ${col} - 1) WHERE id = ?`,
      [obstacleId]
    );
    newUserVote = null;
  } else if (existing) {
    // 반대 버튼 클릭 → 교체
    await database.runAsync(
      'UPDATE votes SET voteType = ? WHERE obstacleId = ? AND userId = ?',
      [voteType, obstacleId, userId]
    );
    if (voteType === 'like') {
      await database.runAsync(
        'UPDATE obstacles SET likes = likes + 1, dislikes = MAX(0, dislikes - 1) WHERE id = ?',
        [obstacleId]
      );
    } else {
      await database.runAsync(
        'UPDATE obstacles SET dislikes = dislikes + 1, likes = MAX(0, likes - 1) WHERE id = ?',
        [obstacleId]
      );
    }
    newUserVote = voteType;
  } else {
    // 새 투표
    await database.runAsync(
      'INSERT INTO votes (obstacleId, userId, voteType) VALUES (?, ?, ?)',
      [obstacleId, userId, voteType]
    );
    const col = voteType === 'like' ? 'likes' : 'dislikes';
    await database.runAsync(
      `UPDATE obstacles SET ${col} = ${col} + 1 WHERE id = ?`,
      [obstacleId]
    );
    newUserVote = voteType;
  }

  const updated = await database.getFirstAsync<{ likes: number; dislikes: number }>(
    'SELECT likes, dislikes FROM obstacles WHERE id = ?',
    [obstacleId]
  );

  return {
    likes: updated?.likes ?? 0,
    dislikes: updated?.dislikes ?? 0,
    userVote: newUserVote,
  };
}

export async function getMyObstacles(userId: string): Promise<ObstacleRecord[]> {
  const database = await getDatabase();
  return database.getAllAsync<ObstacleRecord>(
    'SELECT * FROM obstacles WHERE userId = ? ORDER BY createdAt DESC',
    [userId]
  );
}

export async function getTopContributors(limit: number = 3): Promise<TopContributor[]> {
  const database = await getDatabase();
  return database.getAllAsync<TopContributor>(
    `SELECT userId, displayName, userEmail, SUM(likes) as totalLikes
     FROM obstacles
     WHERE userId != ''
     GROUP BY userId
     ORDER BY totalLikes DESC
     LIMIT ?`,
    [limit]
  );
}

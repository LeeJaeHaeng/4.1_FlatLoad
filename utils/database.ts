import * as SQLite from 'expo-sqlite';
import { File, Directory, Paths } from 'expo-file-system';

export interface ObstacleRecord {
  id: number;
  photoUri: string;
  latitude: number;
  longitude: number;
  createdAt: string;
  userId: string;      // Firebase UID
  userEmail: string;   // Google 이메일 (표시용)
  displayName: string; // 표시 이름
}

let db: SQLite.SQLiteDatabase | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    db = await SQLite.openDatabaseAsync('obstacles.db');
    // 기존 테이블이 없으면 새로 생성
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS obstacles (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        photoUri    TEXT    NOT NULL,
        latitude    REAL    NOT NULL,
        longitude   REAL    NOT NULL,
        createdAt   TEXT    NOT NULL,
        userId      TEXT    NOT NULL DEFAULT '',
        userEmail   TEXT    NOT NULL DEFAULT '',
        displayName TEXT    NOT NULL DEFAULT ''
      );
    `);
    // 기존 테이블에 컬럼이 없으면 추가 (마이그레이션)
    try {
      await db.execAsync(`ALTER TABLE obstacles ADD COLUMN userId TEXT NOT NULL DEFAULT '';`);
    } catch {}
    try {
      await db.execAsync(`ALTER TABLE obstacles ADD COLUMN userEmail TEXT NOT NULL DEFAULT '';`);
    } catch {}
    try {
      await db.execAsync(`ALTER TABLE obstacles ADD COLUMN displayName TEXT NOT NULL DEFAULT '';`);
    } catch {}
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

  // 영구 저장 폴더 생성 (이미 존재해도 안전하게 처리)
  const obstaclesDir = new Directory(Paths.document, 'obstacles');
  obstaclesDir.create({ idempotent: true });

  // 파일 복사
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
  const rows = await database.getAllAsync<ObstacleRecord>(
    'SELECT * FROM obstacles ORDER BY createdAt DESC'
  );
  return rows;
}

// 지도 마커용: photoUri를 base64 data URL로 변환하여 반환
export async function getAllObstaclesWithBase64(): Promise<(ObstacleRecord & { photoBase64: string })[]> {
  const rows = await getAllObstacles();
  const result = await Promise.all(
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
  return result;
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
}

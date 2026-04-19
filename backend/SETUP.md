# FlatRoad 백엔드 실행 가이드

> 담당자: 이재행 | 2026-04-20

---

## 빠른 실행 (이미 설치 완료된 경우)

```powershell
cd "C:\Users\leejh\OneDrive\바탕 화면\4-1\종합프로젝트\FlatRoad\backend"
./venv/Scripts/uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

정상 실행 시 출력:
```
[YOLO] 모델 로드 완료 — 클래스: ['Bollard']
INFO: Uvicorn running on http://0.0.0.0:8000
INFO: Application startup complete.
```

---

## 최초 설치 순서

### 1. Python 가상환경 생성 및 패키지 설치
```powershell
cd "C:\Users\leejh\OneDrive\바탕 화면\4-1\종합프로젝트\FlatRoad\backend"
python -m venv venv
./venv/Scripts/pip install -r requirements.txt
```

### 2. PostgreSQL (이미 완료)
- PostgreSQL 17 설치됨 (winget)
- DB: `flatroad` 생성 완료
- 계정: `postgres` / 비밀번호: `0000`

### 3. 환경변수 설정 (이미 완료)
`.env` 파일 내용:
```ini
DATABASE_URL=postgresql+asyncpg://postgres:0000@localhost:5432/flatroad
FIREBASE_CREDENTIALS_PATH=./firebase-adminsdk.json
FIREBASE_STORAGE_BUCKET=map2026-233a5.firebasestorage.app
YOLO_MODEL=./best.pt
PORT=8000
```

### 4. Firebase 서비스 계정 (이미지 업로드 기능)
1. console.firebase.google.com → 프로젝트 `map2026-233a5`
2. 프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성
3. 다운로드 파일 → `backend/firebase-adminsdk.json` 저장

---

## Expo Go 앱 연동

### 전제 조건
- PC와 폰이 **같은 WiFi** 연결
- PC WiFi IP: `192.168.0.40`

### 방화벽 허용 (관리자 PowerShell, 최초 1회)
```powershell
New-NetFirewallRule -DisplayName 'FlatRoad Backend 8000' -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow
```

### 연결 확인
폰 브라우저에서 접속:
```
http://192.168.0.40:8000
```
`{"status":"ok","yolo_ready":true}` 응답 확인

### 앱 실행 (프로젝트 루트)
```powershell
cd "C:\Users\leejh\OneDrive\바탕 화면\4-1\종합프로젝트\FlatRoad"
npm start
```

---

## API 문서
서버 실행 후: `http://localhost:8000/docs`

## AI 모델 상태 확인
```
GET http://localhost:8000/api/analyze/status
```

## 전체 API 목록

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | /api/obstacles | 전체 장애물 조회 |
| POST | /api/obstacles | 장애물 등록 + AI 자동 분석 |
| POST | /api/obstacles/{id}/vote | 좋아요/싫어요 |
| GET | /api/obstacles/mine/{user_id} | 내 장애물 |
| GET | /api/obstacles/contributors/top | 좋아요 TOP 3 |
| GET | /api/community/posts | 게시글 목록 |
| POST | /api/community/posts | 게시글 작성 |
| DELETE | /api/community/posts/{id} | 게시글 삭제 |
| POST | /api/community/posts/{id}/like | 좋아요 토글 |
| GET | /api/community/posts/{id}/comments | 댓글 목록 |
| POST | /api/community/posts/{id}/comments | 댓글 작성 |
| DELETE | /api/community/comments/{id} | 댓글 삭제 |
| POST | /api/analyze | 이미지 AI 분석 |
| GET | /api/analyze/status | AI 모델 상태 |

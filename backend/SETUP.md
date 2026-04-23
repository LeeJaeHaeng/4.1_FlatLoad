# FlatRoad 백엔드 실행 가이드

> 담당자: 이재행 | 최종 수정: 2026-04-23

---

## 빠른 실행 (이미 설치 완료된 경우)

```powershell
cd "C:\Users\leejh\OneDrive\바탕 화면\4-1\종합프로젝트\FlatRoad\backend"
./venv/Scripts/uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

정상 실행 시 출력:
```
[Detectron2] AIHub 커스텀 앵커 적용: [[0.65, 1.0, 2.47, 5.2, 18.12]]
[Detectron2] 모델 로드 완료 — classes=13, device=cpu
INFO: Uvicorn running on http://0.0.0.0:8000
```

---

## 최초 설치 순서

### 1. Python 가상환경 생성

```powershell
cd "C:\Users\leejh\OneDrive\바탕 화면\4-1\종합프로젝트\FlatRoad\backend"
python -m venv venv
./venv/Scripts/pip install -r requirements.txt
```

### 2. PyTorch + Detectron2 설치 (CPU 환경)

```powershell
./venv/Scripts/pip install torch torchvision
./venv/Scripts/pip install detectron2 -f https://dl.fbaipublicfiles.com/detectron2/wheels/cpu/torch2.0/index.html
```

GPU(CUDA 11.8) 환경:

```powershell
./venv/Scripts/pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
./venv/Scripts/pip install detectron2 -f https://dl.fbaipublicfiles.com/detectron2/wheels/cu118/torch2.0/index.html
```

### 3. AI 모델 파일 배치

`retinanet_r_50_fpn_3x_aihub_final.pth` 파일을 **프로젝트 루트** (backend/ 상위)에 위치:

```text
FlatRoad/
├── retinanet_r_50_fpn_3x_aihub_final.pth   ← 여기
└── backend/
    └── ...
```

### 4. PostgreSQL

- PostgreSQL 17 설치
- DB: `safe_route_db` 생성
- `.env` 의 `DATABASE_URL` 수정

### 5. 환경변수 설정

`backend/.env`:

```ini
DATABASE_URL=postgresql+asyncpg://postgres:비밀번호@localhost:5432/safe_route_db
FIREBASE_CREDENTIALS_PATH=./firebase-adminsdk.json
FIREBASE_STORAGE_BUCKET=map2026-233a5.firebasestorage.app
DETECTRON2_WEIGHTS=../retinanet_r_50_fpn_3x_aihub_final.pth
DETECTRON2_SCORE_THRESH=0.5
PORT=8000
```

### 6. Firebase 서비스 계정 (이미지 업로드)

1. console.firebase.google.com → 프로젝트 `map2026-233a5`
2. 프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성
3. 다운로드 파일 → `backend/firebase-adminsdk.json` 저장

---

## Expo Go 앱 연동

- PC와 폰을 **같은 WiFi**에 연결
- 루트 `.env`의 `EXPO_PUBLIC_API_BASE_URL`을 PC의 WiFi IP로 수정

방화벽 허용 (관리자 PowerShell, 최초 1회):

```powershell
New-NetFirewallRule -DisplayName 'FlatRoad Backend 8000' -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow
```

앱 실행:

```powershell
cd "C:\Users\leejh\OneDrive\바탕 화면\4-1\종합프로젝트\FlatRoad"
npm start
```

---

## API 목록

서버 실행 후 Swagger UI: `http://localhost:8000/docs`

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
| GET | /api/analyze/status | AI 모델 상태 (classes 13개 확인) |

# FlatRoad — 전동이동보조기기 안전 경로 안내 서비스

> 전동휠체어·전동스쿠터 등 전동이동보조기기 사용자를 위한 크라우드소싱 장애물 지도 및 안전 경로 안내 앱

---

## 서비스 개요

전동이동보조기기 사용자는 볼라드·계단·경사 등 장애물로 인해 이동 중 예상치 못한 위험을 겪는다.  
FlatRoad는 사용자가 직접 장애물을 촬영·공유하고 AI가 자동 분류하여 모든 사용자의 지도에 반영하는 **크라우드소싱 안전지도** 서비스이다.

| 핵심 기능 | 설명 |
|-----------|------|
| 안전 경로 탐색 | 인도·보행자 도로 기반, 계단·경사·좁은 길 회피 (Valhalla wheelchair 프로파일) |
| AI 장애물 탐지 | YOLOv5 모델이 사진을 분석, 볼라드 자동 탐지 및 신뢰도 반환 |
| 장애물 공유 DB | 사용자 촬영 장애물을 서버에 공유 저장 → 경로 경고에 활용 |
| 장애편의시설 필터 | 현재 위치 기반 경사로·엘리베이터·장애인화장실 지도 표시 |
| 커뮤니티 | 게시글·댓글·좋아요 기반 정보 공유 |

---

## 시스템 아키텍처

```
┌──────────────────────────────────────────────┐
│          Expo Go 앱 (React Native)            │
│  MapScreen │ ContributeScreen │ CommunityScreen│
│         utils/api.ts (API 클라이언트)         │
└──────────────┬───────────────────────────────┘
               │ HTTP REST API
               ▼
┌──────────────────────────────────────────────┐
│       FastAPI 백엔드 서버 (Python)            │
│  host: 0.0.0.0:8000                          │
│  ├── YOLOv5 AI 추론 엔진 (best.pt, 14MB)     │
│  ├── 장애물 CRUD + 투표 API                   │
│  ├── 커뮤니티 API                             │
│  └── Kakao Local API 연동 (장애편의시설)      │
└──────────────┬───────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────┐
│       PostgreSQL 17 (공유 DB)                │
│  obstacles │ votes │ posts │ comments        │
└──────────────────────────────────────────────┘
```

---

## 기술 스택

### 프론트엔드 (앱)
| 항목 | 기술 |
|------|------|
| 프레임워크 | React Native (Expo SDK 54) |
| 지도 | Leaflet.js (WebView 내 렌더링) |
| 경로 탐색 | Valhalla (wheelchair 프로파일) |
| 장애편의시설 | Kakao Local Search REST API |
| 상태 관리 | React Context (AuthContext) |

### 백엔드 (서버)
| 항목 | 기술 |
|------|------|
| 서버 프레임워크 | FastAPI (Python 3.10) |
| AI 모델 | YOLOv5s (볼라드 탐지, 14MB) |
| ORM | SQLAlchemy async + asyncpg |
| DB | PostgreSQL 17 |
| 이미지 저장 | Firebase Storage |

---

## 프로젝트 구조

```
FlatRoad/
├── screens/
│   ├── MapScreen.tsx         ← 지도, 필터, 경로 탐색
│   ├── ContributeScreen.tsx  ← 장애물 촬영·등록
│   ├── CommunityScreen.tsx   ← 게시판
│   └── MyPageScreen.tsx      ← 설정, 앱 정보
├── context/
│   └── AuthContext.tsx       ← 데모 유저 컨텍스트
├── utils/
│   ├── api.ts                ← 백엔드 API 클라이언트
│   └── database.ts           ← 로컬 SQLite 폴백
├── backend/
│   ├── main.py               ← FastAPI 앱 진입점
│   ├── best.pt               ← YOLOv5 볼라드 탐지 모델
│   ├── requirements.txt
│   ├── .env.example
│   ├── BACKEND_DOCS.md       ← 백엔드 상세 개발 문서
│   ├── PPT_GUIDE.md          ← 발표 PPT 구성 지침서
│   ├── db/
│   │   ├── database.py
│   │   ├── models.py
│   │   └── schemas.py
│   ├── routers/
│   │   ├── obstacles.py
│   │   ├── community.py
│   │   └── analyze.py
│   └── services/
│       ├── yolo.py
│       └── storage.py
└── .env                      ← 환경변수 (git 제외)
```

---

## AI 추론 파이프라인

```
사용자 볼라드 촬영
    ↓
POST /api/obstacles (이미지 base64 + GPS)
    ↓
FastAPI → YOLOv5 추론 (~15ms)
    ↓
탐지 결과: { label: "Bollard", confidence: 0.87 }
    ↓
PostgreSQL 저장 (ai_label, ai_confidence)
    ↓
전체 사용자 지도에 볼라드 마커 표시
    ↓
경로 계산 시 50m 이내 볼라드 → ⚠️ 경고
```

### 모델 정보
- **모델**: YOLOv5s (Small)
- **탐지 클래스**: Bollard (볼라드)
- **추론 속도**: ~15ms/장 (CPU 환경)
- **모델 크기**: 14MB
- **학습 환경**: Python 3.10, PyTorch, yolov5 라이브러리

### Detectron2 → YOLOv5 전환 이유
초기 계획은 Detectron2(Mask R-CNN)였으나 아래 이유로 YOLOv5로 전환:

| 항목 | Detectron2 | YOLOv5 |
|------|-----------|--------|
| 추론 속도 | ~200ms/장 | **~15ms/장** |
| GPU 의존성 | CUDA 필수 | CPU 지원 |
| 모델 크기 | 수백 MB | **14MB** |
| FastAPI 통합 | 복잡 | PyTorch 네이티브 |

---

## 지도 필터 기능

현재 위치 기반 반경 3km 내 장애편의시설 실시간 표시

| 필터 | 아이콘 | 검색 키워드 |
|------|--------|-----------|
| 경사로 | ♿ 초록 | `무장애`, `배리어프리`, `휠체어경사로` |
| 엘리베이터 | 🛗 파랑 | `엘리베이터` |
| 장애인화장실 | 🚻 보라 | `장애인화장실` |

- 데이터 소스: Kakao Local Search REST API
- 최대 45개 표시 (3페이지 × 15개), 중복 좌표 자동 제거

---

## 백엔드 API 목록

| 메서드 | 엔드포인트 | 설명 |
|--------|-----------|------|
| GET | `/` | 서버 상태 확인 |
| GET | `/api/obstacles` | 전체 장애물 조회 |
| POST | `/api/obstacles` | 장애물 등록 + AI 자동 분석 |
| POST | `/api/obstacles/{id}/vote` | 장애물 투표 (위험/해소됨) |
| GET | `/api/community/posts` | 커뮤니티 게시글 목록 |
| POST | `/api/community/posts` | 게시글 작성 |
| POST | `/api/analyze` | AI 단독 분석 (이미지만 전송) |

---

## 로컬 실행 방법

### 1. 환경변수 설정

루트 `.env`:
```
EXPO_PUBLIC_KAKAO_REST_KEY=your_kakao_rest_key
EXPO_PUBLIC_API_BASE_URL=http://192.168.x.x:8000
```

`backend/.env`:
```
DATABASE_URL=postgresql+asyncpg://postgres:0000@localhost:5432/flatroad
FIREBASE_BUCKET=your_firebase_bucket
```

### 2. 백엔드 서버 실행

```powershell
cd backend
python -m venv venv
./venv/Scripts/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

정상 실행 시:
```
[YOLO] 모델 로드 완료 — 클래스: ['Bollard']
INFO: Application startup complete.
```

### 3. 앱 실행

```powershell
# 프로젝트 루트에서
npm install
npm start
```

QR코드 → Expo Go 앱으로 스캔 (PC와 동일 WiFi 필요)

### API 문서 (Swagger UI)
- 로컬: http://localhost:8000/docs
- 폰: http://192.168.x.x:8000/docs

---

## 담당자

| 이름 | 담당 영역 |
|------|----------|
| 이재행 | AI 모델 개발, FastAPI 백엔드 서버 구축, 지도 필터 기능 |
| (팀원) | DB 설계, 프론트엔드, 경로 탐색 연동 등 |

---

## 개발 이력 — 이재행

| 날짜 | 작업 |
|------|------|
| 2026-03-03 ~ 04-02 | 볼라드 이미지 데이터 수집·라벨링·정제 |
| 2026-04-03 ~ 04-16 | YOLOv5 모델 구조 설계 및 데이터셋 구성 |
| 2026-04-17 ~ | FastAPI 백엔드 서버 전체 구축, YOLOv5 연동 완료 |
| 2026-04-20 | 지도 필터 Overpass API → Kakao Local API 전환 |
| 2026-04-20 | 데모 모드 전환 (Firebase 로그인 제거) |

---

## 라이선스

본 프로젝트는 학술·교육 목적의 종합 프로젝트입니다.

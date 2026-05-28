# FlatRoad

전동휠체어와 전동스쿠터 사용자를 위한 장애물 제보, 편의시설 조회, 안전 경로 안내 앱입니다. Expo 앱, FastAPI 백엔드, Next.js 관리자 대시보드로 구성되어 있습니다.

## 주요 기능

| 영역 | 내용 |
| --- | --- |
| 안전 지도 | Kakao Maps WebView 기반 현재 위치, 장애물, 편의시설 마커 표시 |
| 길찾기 | Valhalla pedestrian 기반 안전 경로, OSRM driving 기반 일반 경로 |
| 장애물 제보 | 카메라/갤러리 업로드, 위치 기록, 서버 저장, 좋아요/싫어요 |
| AI 분석 | Roboflow hosted inference API로 장애물 후보 탐지 및 바운딩 박스 표시 |
| 인증 사용자 | 기관/관리자가 발급한 인증키로 제보와 게시글을 인증 처리 |
| 관리자 | Next.js 대시보드에서 장애물/게시글/인증 사용자/자동승인 설정 관리 |
| 편의시설 | 공공데이터 장애인편의시설 API, 충남 전동휠체어 충전기 CSV, Kakao/Overpass fallback 통합 |
| 알림 | 삭제된 장애물에 대한 사용자 알림 조회 및 읽음 처리 |

## 이번 작업 요약

- `backend/routers/routing.py`
  - `/api/route/facilities` 추가
  - 한국사회보장정보원 장애인편의시설 XML API를 지도용 JSON으로 전처리
  - `evalInfo`의 `승강기`, `장애인사용가능화장실`, `주출입구 높이차이 제거`, `주출입구 접근로`를 앱 필터 타입으로 매핑
  - 충청남도 전동휠체어 급속충전기 CSV를 읽고 Kakao 주소 검색으로 좌표 변환
  - 공공데이터 일일 트래픽 제한에 대비해 지역 목록/상세 평가 결과를 `backend/cache`에 캐시
  - 공공데이터 실패 시 Kakao Local Search, Overpass 경사로/낮은 연석 검색으로 fallback
- `screens/MapScreen.tsx`
  - 경사로, 엘리베이터, 장애인화장실, 충전기 필터를 백엔드 전처리 API에 연결
  - 충전기 마커 타입 추가
  - React Native 텍스트 렌더 오류를 막도록 문자열 조건 렌더링을 삼항식으로 정리
- `screens/ContributeScreen.tsx`
  - AI 감지 결과 오버레이 및 조건 렌더링 안정화
- `backend/services/detector.py`
  - 로컬 Detectron2/YOLO 의존 대신 Roboflow hosted inference 경로로 정리
- `admin/`
  - 관리자 대시보드에서 장애물, 게시글, 인증 사용자, 자동승인 설정을 관리
- `README.md`
  - 현재 구현 기준으로 데이터 흐름, 실행 방법, 배포 플랜을 갱신

## 시스템 구성

```text
Expo 앱
  screens/MapScreen.tsx
  screens/ContributeScreen.tsx
  screens/CommunityScreen.tsx
  screens/NotificationScreen.tsx
  utils/api.ts
        |
        | REST
        v
FastAPI 백엔드
  backend/main.py
  backend/routers/obstacles.py
  backend/routers/community.py
  backend/routers/analyze.py
  backend/routers/routing.py
  backend/routers/admin.py
        |
        +-- PostgreSQL: 장애물, 게시글, 인증 사용자, 알림
        +-- Firebase/local uploads: 장애물 사진 저장
        +-- Roboflow: AI 장애물 탐지
        +-- 공공데이터포털: 장애인편의시설 현황
        +-- Kakao Local: 목적지 검색, 충전기 주소 지오코딩, fallback 검색
        +-- Overpass: 경사로/낮은 연석 fallback, 경로 주변 계단 경고

Next.js 관리자
  admin/app
  admin/components
        |
        | NEXT_PUBLIC_API_BASE_URL
        v
FastAPI /api/admin
```

## 편의시설 데이터 흐름

### 장애인편의시설 API

공공데이터포털 서비스:

- 데이터명: `한국사회보장정보원_장애인편의시설 현황 상세설명`
- 엔드포인트: `https://apis.data.go.kr/B554287/DisabledPersonConvenientFacility`
- 목록 API: `/getDisConvFaclList`
- 기구표/평가 API: `/getFacInfoOpenApiJpEvalInfoList`
- 포맷: XML

백엔드는 현재 위치 좌표를 Kakao 행정구역으로 변환한 뒤 지역 목록을 읽고, 가까운 시설의 `wfcltId`로 상세 `evalInfo`를 조회합니다.

| 앱 필터 | 공공데이터 `evalInfo` 매핑 |
| --- | --- |
| 경사로 | `주출입구 높이차이 제거`, `주출입구 접근로`, `경사로` |
| 엘리베이터 | `승강기` |
| 장애인화장실 | `장애인사용가능화장실`, `화장실` |
| 장애인전용주차 | `장애인전용주차구역` |

공공데이터 API는 일일 트래픽이 낮기 때문에 `backend/cache`에 지역 목록과 `evalInfo` 결과를 저장합니다. 캐시는 git에 포함하지 않습니다.

### 전동휠체어 충전기 CSV

루트의 `충청남도_전동휠체어급속충전기 정보_20251130.csv`를 사용합니다.

필요 필드:

- `시설명`
- `소재지도로명주소`
- `소재지지번주소`
- `설치장소설명`
- `공기주입가능여부`
- `휴대전화충전가능여부`
- `관리기관명`
- `관리기관전화번호`

좌표가 없는 CSV라서 백엔드가 Kakao 주소 검색으로 지오코딩하고, 반경 필터를 적용한 뒤 지도 마커로 반환합니다.

## 주요 API

| Method | Path | 설명 |
| --- | --- | --- |
| `GET` | `/` | 서버 상태, AI 준비 여부 |
| `GET` | `/api/obstacles` | 승인된 장애물 목록 |
| `POST` | `/api/obstacles` | 장애물 등록, 사진 저장, AI 분석 |
| `PATCH` | `/api/obstacles/{id}/label` | 장애물 라벨 보정 |
| `POST` | `/api/obstacles/{id}/vote` | 좋아요/싫어요 |
| `GET` | `/api/route/facilities` | 편의시설/충전기 지도 마커 조회 |
| `POST` | `/api/route/avoid-locations` | 안전 경로용 우회 좌표 조회 |
| `GET` | `/api/route/notifications/{user_id}` | 삭제 알림 조회 |
| `POST` | `/api/analyze` | 이미지 단독 AI 분석 |
| `GET` | `/api/analyze/status` | Roboflow 설정 상태 |
| `GET` | `/api/community/posts` | 게시글 목록 |
| `POST` | `/api/certified/verify` | 인증 사용자 키 검증 |
| `GET` | `/api/admin/*` | 관리자 대시보드 API |

## 환경 변수

루트 `.env`:

```ini
EXPO_PUBLIC_KAKAO_REST_KEY=...
EXPO_PUBLIC_KAKAO_JS_KEY=...
EXPO_PUBLIC_API_BASE_URL=http://<PC_LAN_IP>:8000

DATABASE_URL=postgresql+asyncpg://...
FIREBASE_CREDENTIALS_PATH=./firebase-adminsdk.json
FIREBASE_STORAGE_BUCKET=...
ROBOFLOW_API_KEY=...
ROBOFLOW_MODEL_ID=bollard-i4ydf/27
ROBOFLOW_SCORE_THRESH=0.5
API_BASE_URL=http://<PC_LAN_IP>:8000
DISABLED_FACILITY_SERVICE_KEY=...
```

`backend/.env`도 백엔드 단독 실행을 위해 같은 서버용 값을 둡니다.

관리자 `admin/.env.local` 또는 Vercel 환경 변수:

```ini
NEXT_PUBLIC_API_BASE_URL=https://<backend-public-domain>
ADMIN_USERNAME=root
ADMIN_PASSWORD=...
```

Expo Go 로컬 테스트 시 `EXPO_PUBLIC_API_BASE_URL`은 휴대폰에서 접근 가능한 PC의 Wi-Fi IPv4여야 합니다. Wi-Fi가 바뀌면 `Get-NetIPConfiguration`으로 다시 확인합니다.

## 로컬 실행

### 백엔드

```powershell
cd "C:\Users\leejh\OneDrive\바탕 화면\4-1\종합프로젝트\4.1_FlatLoad_594930d\backend"
.\venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000
```

헬스 체크:

```powershell
Invoke-WebRequest http://127.0.0.1:8000/ -UseBasicParsing
```

### Expo 앱

```powershell
cd "C:\Users\leejh\OneDrive\바탕 화면\4-1\종합프로젝트\4.1_FlatLoad_594930d"
npx.cmd expo start --host lan --port 8081 --clear
```

네트워크 검증:

```powershell
Get-NetIPConfiguration
Invoke-WebRequest http://<PC_LAN_IP>:8000/ -UseBasicParsing
```

### 관리자 대시보드

```powershell
cd "C:\Users\leejh\OneDrive\바탕 화면\4-1\종합프로젝트\4.1_FlatLoad_594930d\admin"
npm.cmd install
npm.cmd run dev
```

## 검증 명령

```powershell
npx.cmd tsc --noEmit
npm.cmd run test:unit
python -m py_compile backend\routers\routing.py
```

관리자:

```powershell
cd admin
npm.cmd run build
```

## 배포 플랜

### 1. 백엔드

Vercel보다는 항상 떠 있는 Python 서비스에 배포하는 쪽이 맞습니다. FastAPI, 업로드 파일, PostgreSQL 연결, 캐시, 외부 API 타임아웃이 있기 때문입니다.

권장 후보:

1. EC2 또는 Lightsail
2. Render Web Service
3. Railway
4. Fly.io

백엔드 배포 절차:

1. 공용 HTTPS 도메인 확보: 예 `https://api.flatroad.example.com`
2. 서버 환경 변수 설정: `DATABASE_URL`, `ROBOFLOW_API_KEY`, `DISABLED_FACILITY_SERVICE_KEY`, `FIREBASE_*`, `API_BASE_URL`
3. `uvicorn main:app --host 0.0.0.0 --port $PORT` 실행
4. `/`와 `/docs`로 헬스 체크
5. `/api/route/facilities?lat=36.7985475&lng=127.076107&types=toilet`로 편의시설 조회 확인
6. CORS는 현재 전체 허용이므로 운영 전 프론트 도메인으로 제한 가능

### 2. 관리자 프론트엔드

관리자 Next.js 앱은 Vercel 배포가 가장 단순합니다.

Vercel 설정:

- Root Directory: `admin`
- Framework: Next.js
- Build Command: `npm run build`
- Output: Next.js 기본값
- Environment Variable:
  - `NEXT_PUBLIC_API_BASE_URL=https://<backend-public-domain>`
  - `ADMIN_USERNAME`
  - `ADMIN_PASSWORD`

검증:

1. `/login`
2. `/obstacles`
3. `/posts`
4. `/certified`
5. 자동승인 토글

### 3. 모바일 앱

Expo 앱은 Vercel 배포 대상이 아니라 EAS Build 또는 Expo Go 테스트 대상입니다.

테스트 APK:

```powershell
npx.cmd eas-cli@latest build --platform android --profile preview
```

운영 빌드:

```powershell
npx.cmd eas-cli@latest build --platform android --profile production
```

주의:

- `EXPO_PUBLIC_API_BASE_URL`은 LAN IP가 아니라 운영 백엔드 HTTPS URL이어야 합니다.
- 현재 `app.json`의 EAS projectId는 `alphaxen` 소유 프로젝트입니다. `leejaehaeng` 계정에서 빌드하려면 해당 EAS 프로젝트 권한을 받거나 새 EAS 프로젝트로 재연결해야 합니다.

### 4. 웹 프론트 선택지

사용자용 앱을 웹으로도 열고 싶다면 Expo web export 후 별도 검증이 필요합니다. 현재 지도는 Kakao Maps를 WebView 안에서 사용하는 모바일 중심 구조라, Vercel 웹 배포 전에는 브라우저에서 WebView/지도 동작을 따로 확인해야 합니다.

우선순위:

1. 관리자 Next.js를 Vercel에 배포
2. FastAPI 백엔드를 공용 HTTPS 서버에 배포
3. Expo Android preview APK 생성
4. 필요 시 Expo web/Vercel 사용자 웹 버전 별도 검증

## 배포 전 체크리스트

- `.env`, `backend/.env`, Firebase 키 파일은 커밋하지 않기
- 공공데이터 키는 서버 전용으로만 사용하기
- 운영 앱의 `EXPO_PUBLIC_API_BASE_URL`을 HTTPS 백엔드로 변경
- Kakao JavaScript 키에 실제 도메인 등록
- Kakao REST 키 사용량 제한 확인
- 공공데이터포털 일일 트래픽 제한 확인
- PostgreSQL 외부 접속/방화벽 확인
- `backend/cache`는 런타임 캐시로 유지하되 git 제외

## 저장소 구조

```text
.
├── App.tsx
├── screens/
├── utils/
├── context/
├── assets/
├── backend/
│   ├── main.py
│   ├── routers/
│   ├── services/
│   ├── db/
│   └── requirements.txt
├── admin/
│   ├── app/
│   ├── components/
│   └── package.json
├── scripts/
└── 충청남도_전동휠체어급속충전기 정보_20251130.csv
```

## 담당 작업

이재행:

- Expo 앱 지도/기여/커뮤니티/알림 화면
- FastAPI 백엔드 API
- Roboflow AI 분석 연동
- 공공데이터 장애인편의시설 API 전처리
- 전동휠체어 충전기 CSV 지도 표시
- 관리자 대시보드
- 로컬 실행 및 배포 플랜 정리

import csv
import json
import math
import os
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import httpx
from db.database import get_db
from db.models import Obstacle, DeleteNotification

router = APIRouter(prefix="/api/route", tags=["routing"])

DISABLED_FACILITY_BASE_URL = "https://apis.data.go.kr/B554287/DisabledPersonConvenientFacility"
DISABLED_FACILITY_LIST_PATH = "/getDisConvFaclList"
DISABLED_FACILITY_DETAIL_PATH = "/getFacInfoOpenApiJpEvalInfoList"
DISABLED_FACILITY_NUM_ROWS = 1000
DISABLED_FACILITY_REGION_PAGES = {
    "충청남도": (18, 55),
}
FACILITY_CACHE_TTL_SECONDS = int(os.getenv("FACILITY_CACHE_TTL_SECONDS", "43200"))
FACILITY_MAX_RESULTS = int(os.getenv("FACILITY_MAX_RESULTS", "30"))
FACILITY_DETAIL_LIMIT = int(os.getenv("FACILITY_DETAIL_LIMIT", "20"))

_disabled_region_cache: dict[str, tuple[float, list[dict]]] = {}
_disabled_eval_cache: dict[str, set[str]] = {}
_disabled_eval_cache_loaded = False
_charger_rows_cache: tuple[float, list[dict]] | None = None
_charger_geocode_cache: dict[str, tuple[float, float]] = {}
_region_cache: dict[str, str] = {}

FACILITY_TYPE_KEYWORDS = {
    "elevator": ("승강기",),
    "toilet": ("장애인사용가능화장실", "화장실"),
    "ramp": ("주출입구 높이차이 제거", "주출입구 접근로", "경사로"),
    "parking": ("장애인전용주차구역",),
}

KAKAO_FACILITY_KEYWORDS = {
    "elevator": ("장애인 엘리베이터", "승강기", "엘리베이터"),
    "toilet": ("장애인 화장실", "장애인화장실", "공중화장실", "화장실"),
    "ramp": ("휠체어 경사로", "장애인 경사로", "경사로"),
}


class ExternalFacilityApiError(Exception):
    pass


class AvoidLocationsRequest(BaseModel):
    from_lat: float
    from_lng: float
    to_lat: float
    to_lng: float


def _service_key() -> str:
    return (
        os.getenv("DISABLED_FACILITY_SERVICE_KEY")
        or os.getenv("DISABLED_PERSON_FACILITY_SERVICE_KEY")
        or ""
    ).strip()


def _kakao_rest_key() -> str:
    return (os.getenv("KAKAO_REST_KEY") or os.getenv("EXPO_PUBLIC_KAKAO_REST_KEY") or "").strip()


def _cache_dir() -> Path:
    path = Path(__file__).resolve().parents[1] / "cache"
    path.mkdir(exist_ok=True)
    return path


def _cache_path(name: str) -> Path:
    return _cache_dir() / f"{quote(name, safe='')}.json"


def _read_json_cache(path: Path, max_age_seconds: int | None = None) -> object | None:
    if not path.exists():
        return None
    if max_age_seconds is not None and time.time() - path.stat().st_mtime > max_age_seconds:
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _write_json_cache(path: Path, data: object) -> None:
    try:
        path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass


def _distance_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    radius = 6371000
    d_lat = math.radians(lat2 - lat1)
    d_lng = math.radians(lng2 - lng1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lng / 2) ** 2
    )
    return radius * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _xml_text(parent: ET.Element, tag: str) -> str:
    value = parent.findtext(tag)
    return value.strip() if value else ""


def _parse_disabled_rows(xml_text: str) -> list[dict]:
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []

    rows = []
    for item in root.findall("servList"):
        try:
            lat = float(_xml_text(item, "faclLat"))
            lng = float(_xml_text(item, "faclLng"))
        except ValueError:
            continue
        if not lat or not lng:
            continue
        rows.append(
            {
                "id": _xml_text(item, "wfcltId") or _xml_text(item, "faclInfId"),
                "facility_id": _xml_text(item, "faclInfId"),
                "service_id": _xml_text(item, "wfcltId"),
                "name": _xml_text(item, "faclNm"),
                "address": _xml_text(item, "lcMnad"),
                "category": _xml_text(item, "faclTyCd"),
                "lat": lat,
                "lng": lng,
                "status": _xml_text(item, "salStaNm"),
            }
        )
    return rows


def _facility_types_from_eval(eval_info: str) -> set[str]:
    result: set[str] = set()
    for facility_type, keywords in FACILITY_TYPE_KEYWORDS.items():
        if any(keyword in eval_info for keyword in keywords):
            result.add(facility_type)
    return result


async def _get_region_prefix(client: httpx.AsyncClient, lat: float, lng: float) -> str:
    cache_key = f"{lat:.3f},{lng:.3f}"
    if cache_key in _region_cache:
        return _region_cache[cache_key]

    kakao_key = _kakao_rest_key()
    if not kakao_key:
        return ""

    try:
        res = await client.get(
            "https://dapi.kakao.com/v2/local/geo/coord2regioncode.json",
            params={"x": lng, "y": lat},
            headers={"Authorization": f"KakaoAK {kakao_key}"},
        )
        res.raise_for_status()
        docs = res.json().get("documents", [])
        doc = next((item for item in docs if item.get("region_type") == "H"), docs[0] if docs else {})
        province = str(doc.get("region_1depth_name") or "").strip()
        city = str(doc.get("region_2depth_name") or "").strip()
        prefix = f"{province} {city}".strip()
        _region_cache[cache_key] = prefix
        return prefix
    except Exception:
        return ""


def _pages_for_region(region_prefix: str) -> range:
    province = region_prefix.split()[0] if region_prefix else ""
    if province in DISABLED_FACILITY_REGION_PAGES:
        start, end = DISABLED_FACILITY_REGION_PAGES[province]
        return range(start, end + 1)
    max_pages = int(os.getenv("DISABLED_FACILITY_MAX_SCAN_PAGES", "90"))
    return range(1, max_pages + 1)


async def _fetch_disabled_page(
    client: httpx.AsyncClient,
    service_key: str,
    page_no: int,
) -> list[dict]:
    res = await client.get(
        f"{DISABLED_FACILITY_BASE_URL}{DISABLED_FACILITY_LIST_PATH}",
        params={
            "serviceKey": service_key,
            "pageNo": page_no,
            "numOfRows": DISABLED_FACILITY_NUM_ROWS,
        },
    )
    if res.status_code != 200:
        raise ExternalFacilityApiError(f"disabled facility API HTTP {res.status_code}")
    if "API token quota exceeded" in res.text:
        raise ExternalFacilityApiError("disabled facility API quota exceeded")
    return _parse_disabled_rows(res.text)


async def _load_disabled_region(
    client: httpx.AsyncClient,
    region_prefix: str,
    service_key: str,
) -> list[dict]:
    cache_key = region_prefix or "default"
    now = time.time()
    cached = _disabled_region_cache.get(cache_key)
    if cached and now - cached[0] < FACILITY_CACHE_TTL_SECONDS:
        return cached[1]

    cache_path = _cache_path(f"disabled_region:{cache_key}")
    disk_cached = _read_json_cache(cache_path, FACILITY_CACHE_TTL_SECONDS)
    if isinstance(disk_cached, list):
        _disabled_region_cache[cache_key] = (now, disk_cached)
        return disk_cached

    pages = list(_pages_for_region(region_prefix))
    try:
        page_rows = await asyncio_gather_limited(client, service_key, pages)
    except ExternalFacilityApiError:
        stale_cached = _read_json_cache(cache_path, None)
        if isinstance(stale_cached, list):
            _disabled_region_cache[cache_key] = (now, stale_cached)
            return stale_cached
        raise

    rows = [row for rows in page_rows for row in rows]
    if region_prefix:
        rows = [row for row in rows if row.get("address", "").startswith(region_prefix)]

    _disabled_region_cache[cache_key] = (now, rows)
    _write_json_cache(cache_path, rows)
    return rows


async def asyncio_gather_limited(
    client: httpx.AsyncClient,
    service_key: str,
    pages: list[int],
) -> list[list[dict]]:
    import asyncio

    limit = int(os.getenv("DISABLED_FACILITY_CONCURRENCY", "8"))
    semaphore = asyncio.Semaphore(max(1, limit))

    async def run(page_no: int) -> list[dict]:
        async with semaphore:
            return await _fetch_disabled_page(client, service_key, page_no)

    return await asyncio.gather(*(run(page_no) for page_no in pages))


async def _get_disabled_eval_types(
    client: httpx.AsyncClient,
    service_key: str,
    service_id: str,
) -> set[str]:
    global _disabled_eval_cache_loaded

    if not service_id:
        return set()

    if not _disabled_eval_cache_loaded:
        disk_cached = _read_json_cache(_cache_path("disabled_eval_types"), None)
        if isinstance(disk_cached, dict):
            for cached_id, cached_types in disk_cached.items():
                if isinstance(cached_types, list):
                    _disabled_eval_cache[str(cached_id)] = {str(item) for item in cached_types}
        _disabled_eval_cache_loaded = True

    if service_id in _disabled_eval_cache:
        return _disabled_eval_cache[service_id]

    try:
        res = await client.get(
            f"{DISABLED_FACILITY_BASE_URL}{DISABLED_FACILITY_DETAIL_PATH}",
            params={"serviceKey": service_key, "wfcltId": service_id},
        )
        if res.status_code != 200:
            raise ExternalFacilityApiError(f"disabled facility API HTTP {res.status_code}")
        if "API token quota exceeded" in res.text:
            raise ExternalFacilityApiError("disabled facility API quota exceeded")
        root = ET.fromstring(res.text)
        eval_info = " ".join(_xml_text(item, "evalInfo") for item in root.findall("servList"))
        types = _facility_types_from_eval(eval_info)
        _disabled_eval_cache[service_id] = types
        _write_json_cache(
            _cache_path("disabled_eval_types"),
            {cached_id: sorted(cached_types) for cached_id, cached_types in _disabled_eval_cache.items()},
        )
        return types
    except ExternalFacilityApiError:
        raise
    except Exception:
        return set()


async def asyncio_gather_eval_limited(
    client: httpx.AsyncClient,
    service_key: str,
    service_ids: list[str],
) -> list[set[str]]:
    import asyncio

    limit = int(os.getenv("DISABLED_FACILITY_DETAIL_CONCURRENCY", "8"))
    semaphore = asyncio.Semaphore(max(1, limit))

    async def run(service_id: str) -> set[str]:
        async with semaphore:
            return await _get_disabled_eval_types(client, service_key, service_id)

    return await asyncio.gather(*(run(service_id) for service_id in service_ids))


def _charger_csv_path() -> Path | None:
    configured = os.getenv("WHEELCHAIR_CHARGER_CSV_PATH")
    if configured:
        return Path(configured)
    root = Path(__file__).resolve().parents[2]
    csv_files = sorted(root.glob("*.csv"))
    return csv_files[0] if csv_files else None


def _load_charger_rows() -> list[dict]:
    global _charger_rows_cache

    now = time.time()
    if _charger_rows_cache and now - _charger_rows_cache[0] < FACILITY_CACHE_TTL_SECONDS:
        return _charger_rows_cache[1]

    path = _charger_csv_path()
    if not path or not path.exists():
        _charger_rows_cache = (now, [])
        return []

    rows: list[dict] = []
    for encoding in ("cp949", "utf-8-sig", "utf-8"):
        try:
            with path.open("r", encoding=encoding, newline="") as file:
                reader = csv.DictReader(file)
                for row in reader:
                    address = (row.get("소재지도로명주소") or row.get("소재지지번주소") or "").strip()
                    if not address:
                        continue
                    rows.append(
                        {
                            "id": f"charger:{row.get('시설명', '').strip()}:{address}",
                            "name": (row.get("시설명") or "").strip(),
                            "address": address,
                            "detail": (row.get("설치장소설명") or "").strip(),
                            "phone": (row.get("관리기관전화번호") or "").strip(),
                            "air_pump": (row.get("공기주입가능여부") or "").strip(),
                            "mobile_charge": (row.get("휴대전화충전가능여부") or "").strip(),
                        }
                    )
            break
        except UnicodeDecodeError:
            rows = []
            continue

    _charger_rows_cache = (now, rows)
    return rows


async def _geocode_address(client: httpx.AsyncClient, address: str) -> tuple[float, float] | None:
    if address in _charger_geocode_cache:
        return _charger_geocode_cache[address]

    kakao_key = _kakao_rest_key()
    if not kakao_key:
        return None

    try:
        res = await client.get(
            "https://dapi.kakao.com/v2/local/search/address.json",
            params={"query": address},
            headers={"Authorization": f"KakaoAK {kakao_key}"},
        )
        res.raise_for_status()
        docs = res.json().get("documents", [])
        if not docs:
            return None
        doc = docs[0]
        coords = (float(doc["y"]), float(doc["x"]))
        _charger_geocode_cache[address] = coords
        return coords
    except Exception:
        return None


async def _get_chargers(
    client: httpx.AsyncClient,
    lat: float,
    lng: float,
    radius_m: int,
    region_prefix: str,
) -> list[dict]:
    rows = _load_charger_rows()
    if region_prefix:
        rows = [row for row in rows if row["address"].startswith(region_prefix)]

    results: list[dict] = []
    for row in rows:
        coords = await _geocode_address(client, row["address"])
        if not coords:
            continue
        distance = _distance_m(lat, lng, coords[0], coords[1])
        if distance > radius_m:
            continue
        results.append(
            {
                **row,
                "type": "charger",
                "source": "wheelchair_charger_csv",
                "lat": coords[0],
                "lng": coords[1],
                "distance": round(distance),
            }
        )

    return sorted(results, key=lambda item: item["distance"])[:FACILITY_MAX_RESULTS]


async def _get_kakao_facility_fallback(
    client: httpx.AsyncClient,
    lat: float,
    lng: float,
    radius_m: int,
    requested_types: set[str],
) -> list[dict]:
    kakao_key = _kakao_rest_key()
    if not kakao_key:
        return []

    results: list[dict] = []
    seen = set()
    for facility_type in sorted(requested_types):
        keywords = KAKAO_FACILITY_KEYWORDS.get(facility_type, ())
        for keyword in keywords:
            for page in range(1, 3):
                try:
                    res = await client.get(
                        "https://dapi.kakao.com/v2/local/search/keyword.json",
                        params={
                            "query": keyword,
                            "x": lng,
                            "y": lat,
                            "radius": radius_m,
                            "size": 15,
                            "page": page,
                        },
                        headers={"Authorization": f"KakaoAK {kakao_key}"},
                    )
                    res.raise_for_status()
                    data = res.json()
                except Exception:
                    break

                for doc in data.get("documents", []):
                    try:
                        item_lat = float(doc.get("y"))
                        item_lng = float(doc.get("x"))
                    except (TypeError, ValueError):
                        continue
                    distance = int(float(doc.get("distance") or _distance_m(lat, lng, item_lat, item_lng)))
                    if distance > radius_m:
                        continue
                    key = (facility_type, round(item_lat, 5), round(item_lng, 5))
                    if key in seen:
                        continue
                    seen.add(key)
                    results.append(
                        {
                            "id": f"kakao:{facility_type}:{doc.get('id') or item_lat}:{item_lng}",
                            "type": facility_type,
                            "name": doc.get("place_name") or keyword,
                            "address": doc.get("road_address_name") or doc.get("address_name") or "",
                            "detail": doc.get("category_name") or "Kakao 로컬 검색 보조 결과",
                            "source": "kakao_local_fallback",
                            "lat": item_lat,
                            "lng": item_lng,
                            "distance": distance,
                        }
                    )
                if data.get("meta", {}).get("is_end"):
                    break

    return sorted(results, key=lambda item: item["distance"])[:FACILITY_MAX_RESULTS]


async def _get_overpass_ramp_fallback(
    client: httpx.AsyncClient,
    lat: float,
    lng: float,
    radius_m: int,
) -> list[dict]:
    query = (
        f"[out:json][timeout:15];"
        f"(nwr[\"ramp\"=\"yes\"](around:{radius_m},{lat},{lng});"
        f"nwr[\"ramp:wheelchair\"=\"yes\"](around:{radius_m},{lat},{lng});"
        f"node[\"kerb\"=\"lowered\"](around:{radius_m},{lat},{lng});"
        f"node[\"kerb\"=\"flush\"](around:{radius_m},{lat},{lng}););"
        f"out center;"
    )
    try:
        res = await client.post(
            "https://overpass-api.de/api/interpreter",
            data={"data": query},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        res.raise_for_status()
        elements = res.json().get("elements", [])
    except Exception:
        return []

    results: list[dict] = []
    seen = set()
    for el in elements:
        item_lat = el.get("lat") or (el.get("center") or {}).get("lat")
        item_lng = el.get("lon") or (el.get("center") or {}).get("lon")
        if item_lat is None or item_lng is None:
            continue
        try:
            item_lat = float(item_lat)
            item_lng = float(item_lng)
        except (TypeError, ValueError):
            continue
        key = (round(item_lat, 5), round(item_lng, 5))
        if key in seen:
            continue
        seen.add(key)
        distance = round(_distance_m(lat, lng, item_lat, item_lng))
        results.append(
            {
                "id": f"overpass:ramp:{el.get('type')}:{el.get('id')}",
                "type": "ramp",
                "name": "경사로/낮은 연석",
                "address": "",
                "detail": "OpenStreetMap 보조 결과",
                "source": "overpass_fallback",
                "lat": item_lat,
                "lng": item_lng,
                "distance": distance,
            }
        )

    return sorted(results, key=lambda item: item["distance"])[:FACILITY_MAX_RESULTS]


@router.get("/facilities")
async def get_facilities(lat: float, lng: float, radius_m: int = 3000, types: str = "ramp,elevator,toilet,charger"):
    """장애인 편의시설 공공 API와 전동휠체어 충전기 CSV를 지도용 필드로 전처리."""
    requested = {item.strip() for item in types.split(",") if item.strip()}
    radius_m = max(300, min(radius_m, 10000))

    timeout = httpx.Timeout(25.0, connect=5.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        region_prefix = await _get_region_prefix(client, lat, lng)
        results: list[dict] = []

        if "charger" in requested:
            results.extend(await _get_chargers(client, lat, lng, radius_m, region_prefix))

        disabled_types = requested & {"ramp", "elevator", "toilet", "parking"}
        service_key = _service_key()
        if disabled_types and service_key:
            try:
                rows = await _load_disabled_region(client, region_prefix, service_key)
            except ExternalFacilityApiError:
                rows = []
            if rows:
                nearby = []
                seen_service_ids = set()
                for row in rows:
                    service_id = row.get("service_id", "")
                    if not service_id or service_id in seen_service_ids:
                        continue
                    distance = _distance_m(lat, lng, row["lat"], row["lng"])
                    if distance <= radius_m:
                        seen_service_ids.add(service_id)
                        nearby.append((distance, row))
                nearby.sort(key=lambda item: item[0])

                candidates = nearby[:FACILITY_DETAIL_LIMIT]
                service_ids = [row.get("service_id", "") for _, row in candidates]
                try:
                    eval_results = await asyncio_gather_eval_limited(client, service_key, service_ids)
                except ExternalFacilityApiError:
                    eval_results = []

                seen_results = set()
                for (distance, row), available_types in zip(candidates, eval_results):
                    if len(results) >= FACILITY_MAX_RESULTS:
                        break
                    matched = available_types & disabled_types
                    if not matched:
                        continue
                    facility_type = sorted(matched)[0]
                    result_key = (row["id"], facility_type)
                    if result_key in seen_results:
                        continue
                    seen_results.add(result_key)
                    results.append(
                        {
                            "id": row["id"],
                            "type": facility_type,
                            "name": row["name"],
                            "address": row["address"],
                            "detail": row["category"],
                            "source": "disabled_facility_api",
                            "lat": row["lat"],
                            "lng": row["lng"],
                            "distance": round(distance),
                        }
                    )

        existing_types = {item.get("type") for item in results if item.get("type") in disabled_types}
        missing_types = disabled_types - existing_types
        if "ramp" in missing_types:
            ramp_results = await _get_overpass_ramp_fallback(client, lat, lng, radius_m)
            results.extend(ramp_results)
            if ramp_results:
                missing_types.remove("ramp")
        if missing_types:
            results.extend(await _get_kakao_facility_fallback(client, lat, lng, radius_m, missing_types))

    return sorted(results, key=lambda item: item["distance"])[:FACILITY_MAX_RESULTS]


@router.get("/ramps")
async def get_ramps(lat: float, lng: float):
    """주변 경사로·연석경사(kerb) 좌표 목록 반환. 앱 대신 서버에서 Overpass 호출."""
    query = (
        f"[out:json][timeout:15];"
        f"(nwr[\"ramp\"=\"yes\"](around:1500,{lat},{lng});"
        f"nwr[\"ramp:wheelchair\"=\"yes\"](around:1500,{lat},{lng});"
        f"node[\"kerb\"=\"lowered\"](around:1500,{lat},{lng});"
        f"node[\"kerb\"=\"flush\"](around:1500,{lat},{lng}););"
        f"out center;"
    )
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            res = await client.post(
                "https://overpass-api.de/api/interpreter",
                data={"data": query},
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        elements = res.json().get("elements", [])
        result = []
        seen = set()
        for el in elements:
            elat = el.get("lat") or (el.get("center") or {}).get("lat")
            elng = el.get("lon") or (el.get("center") or {}).get("lon")
            if elat and elng:
                key = f"{elat:.5f},{elng:.5f}"
                if key not in seen:
                    seen.add(key)
                    result.append({"lat": elat, "lon": elng})
        return result
    except Exception:
        return []


@router.post("/avoid-locations")
async def get_avoid_locations(req: AvoidLocationsRequest, db: AsyncSession = Depends(get_db)):
    """신뢰도 기반으로 필터링된 장애물 좌표 목록 반환. 클라이언트가 Valhalla 호출 시 avoid_locations로 사용."""
    buf = 0.015  # ~1.5km 버퍼

    result = await db.execute(
        select(Obstacle).where(
            Obstacle.latitude  >= min(req.from_lat, req.to_lat)  - buf,
            Obstacle.latitude  <= max(req.from_lat, req.to_lat)  + buf,
            Obstacle.longitude >= min(req.from_lng, req.to_lng)  - buf,
            Obstacle.longitude <= max(req.from_lng, req.to_lng)  + buf,
            Obstacle.is_approved == True,
            # 비추천이 추천보다 3 이상 많으면 신뢰도 낮은 제보로 간주해 우회 제외
            Obstacle.dislikes <= Obstacle.likes + 2,
        )
    )
    obstacles = result.scalars().all()

    avoid_locs = [
        {"lat": o.latitude, "lon": o.longitude}
        for o in obstacles
    ][:50]

    return {"avoid_locations": avoid_locs}


@router.get("/notifications/{user_id}")
async def get_delete_notifications(user_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(DeleteNotification)
        .where(DeleteNotification.user_id == user_id, DeleteNotification.is_read == False)
        .order_by(DeleteNotification.created_at.desc())
    )
    rows = result.scalars().all()
    return [
        {"id": r.id, "obstacleId": r.obstacle_id, "reason": r.reason, "createdAt": r.created_at.isoformat()}
        for r in rows
    ]


@router.post("/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: int, db: AsyncSession = Depends(get_db)):
    notif = await db.get(DeleteNotification, notification_id)
    if notif:
        notif.is_read = True
        await db.commit()
    return {"ok": True}

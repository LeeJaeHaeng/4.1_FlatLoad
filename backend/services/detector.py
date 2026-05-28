"""
Roboflow hosted inference service.

The rest of the backend expects detector.detect() to return:
[{"label": str, "confidence": float, "bbox": [cx, cy, w, h]}]
where bbox values are normalized to 0..1.
"""
from __future__ import annotations

import base64
import os
from typing import Any

import httpx
from dotenv import load_dotenv

load_dotenv()

DEFAULT_MODEL_ID = "bollard-i4ydf/27"
ROBOFLOW_API_URL = "https://detect.roboflow.com"
REQUEST_TIMEOUT = 30.0

MODEL_READY = False
MODEL_ID = os.getenv("ROBOFLOW_MODEL_ID", DEFAULT_MODEL_ID).strip().strip("/")
API_KEY = os.getenv("ROBOFLOW_API_KEY", "").strip()
SCORE_THRESH = float(os.getenv("ROBOFLOW_SCORE_THRESH", "0.3"))
class_names: list[str] = []


def load_model() -> None:
    """Validate Roboflow configuration; no local model is loaded."""
    global MODEL_READY
    MODEL_READY = bool(API_KEY and MODEL_ID)
    if MODEL_READY:
        print(f"[Roboflow] API 추론 준비 완료 - model={MODEL_ID}, threshold={SCORE_THRESH}")
    else:
        missing = []
        if not API_KEY:
            missing.append("ROBOFLOW_API_KEY")
        if not MODEL_ID:
            missing.append("ROBOFLOW_MODEL_ID")
        print(f"[Roboflow] 설정 누락: {', '.join(missing)}")


def detect(image_bytes: bytes, conf_thresh: float | None = None) -> list[dict]:
    """Send an image to Roboflow and return normalized detection results."""
    if not MODEL_READY:
        raise RuntimeError("Roboflow API 설정이 준비되지 않았습니다")

    threshold = conf_thresh if conf_thresh is not None else SCORE_THRESH
    response = _request_roboflow(image_bytes, threshold)
    detections = _parse_predictions(response, threshold)
    detections.sort(key=lambda x: x["confidence"], reverse=True)
    return detections


def _request_roboflow(image_bytes: bytes, threshold: float) -> dict[str, Any]:
    image_payload = base64.b64encode(image_bytes).decode("ascii")
    url = f"{ROBOFLOW_API_URL}/{MODEL_ID}"
    params = {
        "api_key": API_KEY,
        "confidence": int(max(0.0, min(threshold, 1.0)) * 100),
    }
    headers = {"Content-Type": "application/x-www-form-urlencoded"}

    try:
        with httpx.Client(timeout=REQUEST_TIMEOUT) as client:
            res = client.post(url, params=params, content=image_payload, headers=headers)
            res.raise_for_status()
            return res.json()
    except httpx.HTTPStatusError as e:
        detail = _safe_response_text(e.response)
        raise RuntimeError(f"Roboflow API 오류: HTTP {e.response.status_code} {detail}") from e
    except httpx.HTTPError as e:
        raise RuntimeError(f"Roboflow API 요청 실패: {e}") from e
    except ValueError as e:
        raise RuntimeError("Roboflow API 응답을 JSON으로 해석할 수 없습니다") from e


def _parse_predictions(payload: dict[str, Any], threshold: float) -> list[dict]:
    predictions = payload.get("predictions") or []
    if not isinstance(predictions, list):
        raise RuntimeError("Roboflow API 응답 형식이 올바르지 않습니다")

    image_info = payload.get("image") if isinstance(payload.get("image"), dict) else {}
    image_w = _as_float(image_info.get("width")) or _as_float(payload.get("image_width"))
    image_h = _as_float(image_info.get("height")) or _as_float(payload.get("image_height"))

    detections: list[dict] = []
    seen_classes: set[str] = set(class_names)
    for pred in predictions:
        if not isinstance(pred, dict):
            continue
        confidence = _as_float(pred.get("confidence"))
        if confidence is None or confidence < threshold:
            continue

        label = str(pred.get("class") or pred.get("class_name") or pred.get("label") or "unknown")
        bbox = _prediction_bbox(pred, image_w, image_h)
        if bbox is None:
            continue

        detections.append({
            "label": label,
            "confidence": confidence,
            "bbox": bbox,
        })
        if label not in seen_classes:
            seen_classes.add(label)
            class_names.append(label)

    return detections


def _prediction_bbox(pred: dict[str, Any], image_w: float | None, image_h: float | None) -> list[float] | None:
    x = _as_float(pred.get("x"))
    y = _as_float(pred.get("y"))
    width = _as_float(pred.get("width"))
    height = _as_float(pred.get("height"))
    if x is None or y is None or width is None or height is None:
        return None

    if _looks_normalized(x, y, width, height):
        return [_clamp01(x), _clamp01(y), _clamp01(width), _clamp01(height)]

    if not image_w or not image_h:
        return None

    return [
        _clamp01(x / image_w),
        _clamp01(y / image_h),
        _clamp01(width / image_w),
        _clamp01(height / image_h),
    ]


def _as_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _looks_normalized(*values: float) -> bool:
    return all(0.0 <= value <= 1.0 for value in values)


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def _safe_response_text(response: httpx.Response) -> str:
    try:
        text = response.text.strip()
    except Exception:
        return ""
    return text[:300]

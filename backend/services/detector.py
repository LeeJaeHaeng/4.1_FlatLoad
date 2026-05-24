"""
YOLO-World — 오픈 어휘 보행 장애물 탐지 서비스
"""
import io
import numpy as np
from PIL import Image

YOLO_CLASSES = [
    "person", "pole", "bollard", "tree_trunk",
    "car", "traffic_light", "truck", "bus",
    "traffic_sign", "motorcycle", "movable_signage",
    "potted_plant", "wheelchair",
]

SCORE_THRESH = 0.3

MODEL_READY = False
_model = None
class_names: list[str] = list(YOLO_CLASSES)


def load_model() -> None:
    global MODEL_READY, _model
    try:
        from ultralytics import YOLOWorld
        m = YOLOWorld("yolov8s-worldv2.pt")
        m.set_classes(YOLO_CLASSES)
        _model = m
        MODEL_READY = True
        print(f"[YOLO-World] 모델 로드 완료 — classes={YOLO_CLASSES}")
    except Exception as e:
        print(f"[YOLO-World] 모델 로드 실패: {e}")


def detect(image_bytes: bytes, conf_thresh: float | None = None) -> list[dict]:
    """
    이미지 바이트 → 감지 결과 리스트 (confidence 내림차순)
    반환: [{"label": str, "confidence": float, "bbox": [cx, cy, w, h]}]  (0~1 정규화)
    """
    if not MODEL_READY or _model is None:
        raise RuntimeError("YOLO-World 모델이 로드되지 않았습니다")

    threshold = conf_thresh if conf_thresh is not None else SCORE_THRESH

    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    img_w, img_h = img.size
    img_np = np.array(img)

    results = _model.predict(img_np, conf=threshold, verbose=False)

    detections = []
    for r in results:
        for box in r.boxes:
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            conf = float(box.conf[0])
            cls_idx = int(box.cls[0])
            label = YOLO_CLASSES[cls_idx] if cls_idx < len(YOLO_CLASSES) else str(cls_idx)

            cx = (x1 + x2) / 2 / img_w
            cy = (y1 + y2) / 2 / img_h
            bw = (x2 - x1) / img_w
            bh = (y2 - y1) / img_h

            detections.append({
                "label": label,
                "confidence": conf,
                "bbox": [float(cx), float(cy), float(bw), float(bh)],
            })

    detections.sort(key=lambda x: x["confidence"], reverse=True)
    return detections


# ────────────────────────────────────────────────────────────────────────────
# 이전 구현: Detectron2 RetinaNet R-50-FPN 3x (AIHub 인도 보행 데이터셋)
# 출처: github.com/visionNoob/detectron2_aihub_tutorial
# 가중치 파일(retinanet_r_50_fpn_3x_aihub_final.pth)이 없어 비활성화됨
# 복원하려면 아래 주석을 해제하고 위 YOLO-World 코드를 제거할 것
# ────────────────────────────────────────────────────────────────────────────
#
# import os
# from dotenv import load_dotenv
#
# load_dotenv()
#
# MODEL_PATH = os.getenv(
#     "DETECTRON2_WEIGHTS",
#     os.path.join(os.path.dirname(__file__), "../../retinanet_r_50_fpn_3x_aihub_final.pth"),
# )
# SCORE_THRESH = float(os.getenv("DETECTRON2_SCORE_THRESH", "0.5"))
#
# AIHUB_CLASSES = [
#     "person", "pole", "bollard", "tree_trunk", "car", "traffic_light",
#     "truck", "bus", "traffic_sign", "motorcycle", "movable_signage",
#     "potted_plant", "wheelchair",
# ]
#
# MODEL_READY = False
# predictor = None
# class_names: list[str] = []
#
# _DATASET_NAME = "aihub/flatroad"
# _COCO_DEFAULT_ANCHORS = [[0.5, 1.0, 2.0]]
# _AIHUB_ANCHORS = [[0.65, 1.0, 2.47, 5.2, 18.12]]
#
#
# def _load_checkpoint_anchors(weights_path: str, torch) -> list | None:
#     try:
#         ckpt = torch.load(weights_path, map_location="cpu", weights_only=False)
#         cfg_str = ckpt.get("cfg", None)
#         if not cfg_str:
#             return None
#         from detectron2.config import get_cfg as _get_cfg
#         tmp = _get_cfg()
#         tmp.merge_from_str(cfg_str)
#         anchors = [list(r) for r in tmp.MODEL.ANCHOR_GENERATOR.ASPECT_RATIOS]
#         return None if anchors == _COCO_DEFAULT_ANCHORS else anchors
#     except Exception:
#         return None
#
#
# def load_model() -> None:
#     global MODEL_READY, predictor, class_names
#
#     weights_path = os.path.abspath(MODEL_PATH)
#     if not os.path.exists(weights_path):
#         print(f"[Detectron2] 모델 파일 없음: {weights_path}")
#         return
#
#     try:
#         import torch
#         from detectron2.config import get_cfg
#         from detectron2.engine import DefaultPredictor
#         from detectron2.data import MetadataCatalog, DatasetCatalog
#         from detectron2 import model_zoo
#
#         if _DATASET_NAME not in DatasetCatalog.list():
#             DatasetCatalog.register(_DATASET_NAME, lambda: [])
#         MetadataCatalog.get(_DATASET_NAME).set(thing_classes=AIHUB_CLASSES)
#
#         cfg = get_cfg()
#         cfg.merge_from_file(
#             model_zoo.get_config_file("COCO-Detection/retinanet_R_50_FPN_3x.yaml")
#         )
#
#         ckpt_anchors = _load_checkpoint_anchors(weights_path, torch)
#         if ckpt_anchors is not None:
#             cfg.MODEL.ANCHOR_GENERATOR.ASPECT_RATIOS = ckpt_anchors
#             print(f"[Detectron2] 체크포인트 앵커 사용: {ckpt_anchors}")
#         else:
#             cfg.MODEL.ANCHOR_GENERATOR.ASPECT_RATIOS = _AIHUB_ANCHORS
#             print(f"[Detectron2] AIHub 커스텀 앵커 적용: {_AIHUB_ANCHORS}")
#
#         cfg.MODEL.RETINANET.SCORE_THRESH_TEST = SCORE_THRESH
#         cfg.MODEL.RETINANET.NMS_THRESH_TEST = 0.2
#         cfg.MODEL.RETINANET.NUM_CLASSES = len(AIHUB_CLASSES)
#         cfg.MODEL.WEIGHTS = weights_path
#         cfg.DATASETS.TRAIN = (_DATASET_NAME,)
#         cfg.MODEL.DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
#
#         predictor = DefaultPredictor(cfg)
#         class_names = list(AIHUB_CLASSES)
#         MODEL_READY = True
#         print(f"[Detectron2] 모델 로드 완료 — classes={len(class_names)}, device={cfg.MODEL.DEVICE}")
#     except Exception as e:
#         print(f"[Detectron2] 모델 로드 실패: {e}")
#
#
# def detect(image_bytes: bytes, conf_thresh: float | None = None) -> list[dict]:
#     if not MODEL_READY or predictor is None:
#         raise RuntimeError("Detectron2 모델이 로드되지 않았습니다")
#
#     threshold = conf_thresh if conf_thresh is not None else SCORE_THRESH
#
#     img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
#     img_w, img_h = img.size
#     img_bgr = np.array(img)[:, :, ::-1]  # Detectron2 입력 포맷: BGR
#
#     outputs = predictor(img_bgr)
#     instances = outputs["instances"].to("cpu")
#
#     boxes = instances.pred_boxes.tensor.numpy()
#     scores = instances.scores.numpy()
#     classes = instances.pred_classes.numpy()
#
#     detections = []
#     for box, score, cls_idx in zip(boxes, scores, classes):
#         if float(score) < threshold:
#             continue
#         x1, y1, x2, y2 = box
#         cx = (x1 + x2) / 2 / img_w
#         cy = (y1 + y2) / 2 / img_h
#         bw = (x2 - x1) / img_w
#         bh = (y2 - y1) / img_h
#         idx = int(cls_idx)
#         label = class_names[idx] if idx < len(class_names) else str(idx)
#         detections.append({
#             "label": label,
#             "confidence": float(score),
#             "bbox": [float(cx), float(cy), float(bw), float(bh)],
#         })
#
#     detections.sort(key=lambda x: x["confidence"], reverse=True)
#     return detections

export type DetectionBox = [number, number, number, number];

export interface DetectionOverlayLayout {
  boxLeft: number;
  boxTop: number;
  boxWidth: number;
  boxHeight: number;
  labelLeft: number;
  labelTop: number;
  labelMaxWidth: number;
}

const MIN_LABEL_WIDTH = 74;
const LABEL_HEIGHT = 22;
const EDGE_PADDING = 4;

export function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

export function getDetectionOverlayLayout(
  bbox: DetectionBox,
  imgWidth: number,
  imgHeight: number
): DetectionOverlayLayout {
  const [cx, cy, bw, bh] = bbox.map(value => clamp(Number(value) || 0, 0, 1)) as DetectionBox;
  const boxWidth = Math.max(1, bw * imgWidth);
  const boxHeight = Math.max(1, bh * imgHeight);
  const boxLeft = clamp((cx - bw / 2) * imgWidth, 0, Math.max(0, imgWidth - boxWidth));
  const boxTop = clamp((cy - bh / 2) * imgHeight, 0, Math.max(0, imgHeight - boxHeight));
  const labelWidth = Math.min(Math.max(MIN_LABEL_WIDTH, boxWidth), Math.max(MIN_LABEL_WIDTH, imgWidth - EDGE_PADDING * 2));
  const labelLeft = clamp(boxLeft, EDGE_PADDING, Math.max(EDGE_PADDING, imgWidth - labelWidth - EDGE_PADDING));
  const labelTop = boxTop > LABEL_HEIGHT + EDGE_PADDING
    ? boxTop - LABEL_HEIGHT
    : Math.min(imgHeight - LABEL_HEIGHT - EDGE_PADDING, boxTop + boxHeight + EDGE_PADDING);

  return {
    boxLeft,
    boxTop,
    boxWidth,
    boxHeight,
    labelLeft,
    labelTop: clamp(labelTop, EDGE_PADDING, Math.max(EDGE_PADDING, imgHeight - LABEL_HEIGHT - EDGE_PADDING)),
    labelMaxWidth: imgWidth - labelLeft - EDGE_PADDING,
  };
}

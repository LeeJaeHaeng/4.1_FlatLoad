import { strict as assert } from 'node:assert';
import { clamp, getDetectionOverlayLayout } from '../utils/detectionOverlay';

assert.equal(clamp(12, 0, 10), 10);
assert.equal(clamp(-2, 0, 10), 0);
assert.equal(clamp(4, 0, 10), 4);

const narrow = getDetectionOverlayLayout([0.5, 0.5, 0.02, 0.5], 876, 640);
assert.ok(narrow.boxWidth >= 1);
assert.ok(narrow.boxHeight >= 1);
assert.ok(narrow.labelMaxWidth >= 74);
assert.ok(narrow.labelLeft >= 4);
assert.ok(narrow.labelLeft + narrow.labelMaxWidth <= 876);

const clipped = getDetectionOverlayLayout([1.2, -0.2, 2, 0], 320, 220);
assert.ok(clipped.boxLeft >= 0);
assert.ok(clipped.boxTop >= 0);
assert.ok(clipped.boxLeft + clipped.boxWidth <= 320);
assert.ok(clipped.boxTop + clipped.boxHeight <= 220);
assert.ok(clipped.labelTop >= 4);
assert.ok(clipped.labelTop <= 194);

const topEdge = getDetectionOverlayLayout([0.5, 0.01, 0.25, 0.02], 400, 300);
assert.ok(topEdge.labelTop > topEdge.boxTop);

console.log('detectionOverlay unit tests passed');

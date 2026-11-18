const patterns = { solid: [], dashed: [12, 8], dotted: [1, 7], dashdot: [12, 7, 1, 7] };
export const A4_WIDTH = 210 * 96 / 25.4;
export function getHistoryShortcut(event) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'z' ||
      event.target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName)) return null;
  return event.shiftKey ? 'redo' : 'undo';
}
export function getClipboardShortcut(event) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || !['c', 'v'].includes(event.key.toLowerCase()) ||
      event.target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName)) return null;
  return event.key.toLowerCase() === 'c' ? 'copy' : 'paste';
}
export function zoomScrollPosition(scroll, anchor, oldZoom, newZoom) {
  return (scroll + anchor) * newZoom / oldZoom - anchor;
}
export function isPointInsideRect(point, rect) {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

export async function saveDrawingImage(contents, notebookPath, name, content) {
  const separator = Math.max(notebookPath.lastIndexOf('/'), notebookPath.lastIndexOf(':'));
  const directory = `${notebookPath.slice(0, separator + 1)}Images`;
  await contents.save(directory, { type: 'directory' });
  await contents.save(`${directory}/${name}`, { type: 'file', format: 'base64', content });
}

export function createDeferredSave(save, delay) {
  let timer = null;
  const flush = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    save();
  };
  return {
    schedule() {
      clearTimeout(timer);
      timer = setTimeout(flush, delay);
    },
    flush
  };
}
export function createFrameRender(render, request = callback => globalThis.requestAnimationFrame(callback), cancel = id => globalThis.cancelAnimationFrame(id)) {
  let frame = null;
  let force = false;
  let redrawBase = false;
  const run = () => {
    frame = null;
    const nextForce = force;
    const nextRedrawBase = redrawBase;
    force = false;
    redrawBase = false;
    render(nextForce, nextRedrawBase);
  };
  return {
    schedule(nextForce = false, nextRedrawBase = true) {
      force ||= nextForce;
      redrawBase ||= nextRedrawBase;
      if (frame === null) frame = request(run);
    },
    cancel() {
      if (frame !== null) cancel(frame);
      frame = null;
      force = false;
      redrawBase = false;
    }
  };
}
export const A4_HEIGHT = 297 * 96 / 25.4;
export const DEFAULT_EXPORT_MARGIN = 5 * 96 / 25.4;

export function parseFavoriteColors(serialized) {
  const defaults = ['#20242b', '#e53935', '#1976d2', '#2e7d32', '#f9a825'];
  try {
    const saved = JSON.parse(serialized);
    return defaults.map((color, index) => typeof saved?.[index] === 'string' && /^#[0-9a-f]{6}$/i.test(saved[index]) ? saved[index].toLowerCase() : color);
  } catch {
    return defaults;
  }
}

export function createShapePoints(shape, start, end, width = 3) {
  const point = (x, y, move = false) => ({ x, y, pressure: 1, ...(move ? { move: true } : {}) });
  const arrowhead = (from, to) => {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const size = Math.min(Math.max(8, width * 4), Math.hypot(to.x - from.x, to.y - from.y) / 3);
    return [point(to.x - size * Math.cos(angle - Math.PI / 6), to.y - size * Math.sin(angle - Math.PI / 6), true), point(to.x, to.y), point(to.x - size * Math.cos(angle + Math.PI / 6), to.y - size * Math.sin(angle + Math.PI / 6))];
  };
  if (shape === 'rectangle') return [point(start.x, start.y), point(end.x, start.y), point(end.x, end.y), point(start.x, end.y), point(start.x, start.y)];
  if (shape === 'ellipse') {
    const centerX = (start.x + end.x) / 2;
    const centerY = (start.y + end.y) / 2;
    return Array.from({ length: 65 }, (_, index) => point(centerX + (end.x - start.x) / 2 * Math.cos(index * Math.PI / 32), centerY + (end.y - start.y) / 2 * Math.sin(index * Math.PI / 32)));
  }
  if (shape === 'axes') {
    const origin = point(start.x, end.y);
    const horizontal = point(end.x, end.y);
    const vertical = point(start.x, start.y);
    return [origin, horizontal, ...arrowhead(origin, horizontal), point(origin.x, origin.y, true), vertical, ...arrowhead(origin, vertical)];
  }
  const points = [point(start.x, start.y), point(end.x, end.y)];
  if (shape === 'arrow' || shape === 'double-arrow') points.push(...arrowhead(start, end));
  if (shape === 'double-arrow') points.push(...arrowhead(end, start));
  return points;
}

export function linearizeSpline(knots) {
  if (knots.length < 2) return [];
  const points = [{ x: knots[0].x, y: knots[0].y, pressure: 1 }];
  for (let index = 1; index < knots.length; index++) {
    const start = knots[index - 1];
    const end = knots[index];
    const control1 = { x: start.x + start.dx, y: start.y + start.dy };
    const control2 = { x: end.x - end.dx, y: end.y - end.dy };
    const length = Math.hypot(start.dx, start.dy) + Math.hypot(control2.x - control1.x, control2.y - control1.y) + Math.hypot(end.dx, end.dy);
    const steps = Math.max(1, Math.ceil(length / 4));
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      const inverse = 1 - t;
      points.push({
        x: inverse ** 3 * start.x + 3 * inverse ** 2 * t * control1.x + 3 * inverse * t ** 2 * control2.x + t ** 3 * end.x,
        y: inverse ** 3 * start.y + 3 * inverse ** 2 * t * control1.y + 3 * inverse * t ** 2 * control2.y + t ** 3 * end.y,
        pressure: 1
      });
    }
  }
  return points;
}

function readPoint(point) {
  return Array.isArray(point)
    ? { x: point[0], y: point[1], pressure: point[2] ?? 1, time: point[3] }
    : { x: point.x, y: point.y, pressure: point.pressure ?? 1, time: point.time };
}

export function compactStrokes(strokes, cache = new WeakMap()) {
  return strokes.map(stroke => {
    if (cache.has(stroke)) return cache.get(stroke);
    const packed = {
      ...stroke,
      points: stroke.points.map(point => {
        if (Array.isArray(point) || point.move) return point;
        const pointData = [point.x, point.y, point.pressure ?? 1];
        if (Number.isFinite(point.time)) pointData.push(point.time);
        return pointData;
      })
    };
    cache.set(stroke, packed);
    return packed;
  });
}

export function getPointerPressure(event) {
  if (event.pointerType !== 'pen') return 1;
  if (!Number.isFinite(event.pressure)) return 1;
  if (event.pressure <= 0) return null;
  return Math.min(1, event.pressure);
}

export function getToolStrokeWidth(tool, width, highlighter = false) {
  return tool === 'pen' && highlighter ? width * 4 : width;
}

function strokeWidth(stroke) {
  return stroke.width ?? (stroke.tool === 'pen' ? 3 : 20);
}

function pointWidth(stroke, point) {
  return strokeWidth(stroke) * Math.max(0.1, Math.min(1, Number.isFinite(point.pressure) ? point.pressure : 1));
}

export function drawStroke(context, stroke) {
  if (!stroke.points?.length) return;
  context.globalCompositeOperation = stroke.tool === 'erase' ? 'destination-out' : 'source-over';
  context.strokeStyle = stroke.tool === 'white' ? '#ffffff' : (stroke.color || '#20242b');
  context.fillStyle = context.strokeStyle;
  context.globalAlpha = stroke.tool === 'pen' && Number.isFinite(stroke.opacity) ? Math.max(0, Math.min(1, stroke.opacity)) : 1;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.setLineDash(stroke.tool === 'pen' ? (patterns[stroke.style] || []) : []);
  if (stroke.shape) {
    context.lineWidth = strokeWidth(stroke);
    context.beginPath();
    for (const [index, rawPoint] of stroke.points.entries()) {
      const point = readPoint(rawPoint);
      if (!index || rawPoint.move) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    }
    if (stroke.fill) context.fill();
    if (!(stroke.fill && stroke.highlighter)) context.stroke();
    return;
  }
  const points = stroke.points.map(readPoint);
  if ((stroke.fill || stroke.highlighter) && points.length > 1) {
    context.lineWidth = strokeWidth(stroke);
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index++) {
      const start = points[index - 1];
      const end = points[index];
      const endX = index === points.length - 1 ? end.x : (start.x + end.x) / 2;
      const endY = index === points.length - 1 ? end.y : (start.y + end.y) / 2;
      context.quadraticCurveTo(start.x, start.y, endX, endY);
    }
    if (stroke.fill) context.fill();
    if (stroke.highlighter) {
      context.stroke();
      return;
    }
  }
  if (points.length === 1) {
    context.lineWidth = pointWidth(stroke, points[0]);
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    context.lineTo(points[0].x + 0.01, points[0].y);
    context.stroke();
    return;
  }

  let dashOffset = 0;
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1];
    const end = points[index];
    const previous = points[index - 2] || start;
    const next = points[index + 1] || end;
    const startX = index === 1 ? start.x : (previous.x + start.x) / 2;
    const startY = index === 1 ? start.y : (previous.y + start.y) / 2;
    const endX = index === points.length - 1 ? end.x : (start.x + end.x) / 2;
    const endY = index === points.length - 1 ? end.y : (start.y + end.y) / 2;
    const width = (pointWidth(stroke, start) + pointWidth(stroke, end)) / 2;
    context.lineWidth = width;
    context.lineDashOffset = -dashOffset;
    context.beginPath();
    context.moveTo(startX, startY);
    if (context.quadraticCurveTo) context.quadraticCurveTo(start.x, start.y, endX, endY);
    else context.lineTo(endX, endY);
    context.stroke();
    dashOffset += Math.hypot(endX - startX, endY - startY);
    if (index === points.length - 1 && (endX !== end.x || endY !== end.y)) {
      context.lineWidth = pointWidth(stroke, end);
      context.beginPath();
      context.moveTo(endX, endY);
      context.lineTo(end.x, end.y);
      context.stroke();
    }
  }
}

function pointDistance(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = dx * dx + dy * dy;
  const position = length ? Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length)) : 0;
  return Math.hypot(point[0] - start[0] - position * dx, point[1] - start[1] - position * dy);
}

export function getContentBounds(strokes) {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const stroke of strokes) {
    if (!stroke.points?.length) continue;
    for (const rawPoint of stroke.points) {
      const point = readPoint(rawPoint);
      const radius = pointWidth(stroke, point) / 2;
      left = Math.min(left, point.x - radius);
      top = Math.min(top, point.y - radius);
      right = Math.max(right, point.x + radius);
      bottom = Math.max(bottom, point.y + radius);
    }
  }
  return left === Infinity ? null : { left, top, right, bottom };
}

export function getExportLayout(strokes, { margin = DEFAULT_EXPORT_MARGIN, scale = 1 } = {}) {
  const bounds = getContentBounds(strokes);
  let offsetX = 0;
  let height = A4_HEIGHT;
  let offsetY = 0;
  if (bounds) {
    if (bounds.left < margin) offsetX = margin - bounds.left;
    if (bounds.right + offsetX > A4_WIDTH - margin) offsetX = A4_WIDTH - margin - bounds.right;
    height = Math.max(1, bounds.bottom - bounds.top + margin * 2);
    offsetY = margin - bounds.top;
  }
  return {
    width: Math.ceil(A4_WIDTH * scale),
    height: Math.ceil(height * scale),
    scale,
    offsetX,
    offsetY
  };
}

export function normalizeDrawing(saved) {
  if (!saved || !Array.isArray(saved.strokes) || ![1, 2].includes(saved.version)) return null;
  const legacyScale = saved.version === 1 ? A4_WIDTH / 1000 : 1;
  const strokes = saved.strokes.flatMap(stroke => {
    if (!stroke || !['pen', 'erase', 'white'].includes(stroke.tool) || !Array.isArray(stroke.points)) return [];
    const points = stroke.points.flatMap(rawPoint => {
      const point = readPoint(rawPoint);
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return [];
      const normalized = {
        x: point.x * legacyScale,
        y: point.y * legacyScale,
        pressure: Number.isFinite(point.pressure) ? Math.max(0, Math.min(1, point.pressure)) : 1
      };
      if (Number.isFinite(point.time)) normalized.time = point.time;
      if (rawPoint.move) normalized.move = true;
      return [normalized];
    });
    if (!points.length) return [];
    const width = Number.isFinite(stroke.width) && stroke.width > 0
      ? stroke.width * legacyScale
      : (stroke.tool === 'pen' ? 3 : 20) * legacyScale;
    return [{ ...stroke, width, points }];
  });
  return { ...saved, version: 2, width: A4_WIDTH, strokes };
}

function segmentDistance(start, end, otherStart, otherEnd) {
  const cross = (a, b, point) => (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]);
  const first = cross(start, end, otherStart);
  const second = cross(start, end, otherEnd);
  const third = cross(otherStart, otherEnd, start);
  const fourth = cross(otherStart, otherEnd, end);
  if (first * second < 0 && third * fourth < 0) return 0;
  return Math.min(pointDistance(start, otherStart, otherEnd), pointDistance(end, otherStart, otherEnd), pointDistance(otherStart, start, end), pointDistance(otherEnd, start, end));
}

export function selectStrokes(strokes, region) {
  if (region.length < 3) return [];
  const inside = point => {
    let contained = false;
    for (let index = 0, previous = region.length - 1; index < region.length; previous = index++) {
      const a = region[index];
      const b = region[previous];
      if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) contained = !contained;
    }
    return contained;
  };
  return strokes.flatMap((stroke, strokeIndex) => {
    const points = stroke.points.map(readPoint);
    if (points.some(inside)) return [strokeIndex];
    for (const point of points) {
      for (let edge = 0; edge < region.length; edge++) {
        const start = region[edge];
        const end = region[(edge + 1) % region.length];
        if (pointDistance([point.x, point.y], [start.x, start.y], [end.x, end.y]) <= pointWidth(stroke, point) / 2) return [strokeIndex];
      }
    }
    for (let index = 1; index < points.length; index++) {
      if (stroke.points[index].move) continue;
      for (let edge = 0; edge < region.length; edge++) {
        const start = points[index - 1];
        const end = points[index];
        const a = region[edge];
        const b = region[(edge + 1) % region.length];
        if (segmentDistance([start.x, start.y], [end.x, end.y], [a.x, a.y], [b.x, b.y]) <= strokeWidth(stroke) / 2) return [strokeIndex];
      }
    }
    return [];
  });
}

export function transformStrokes(strokes, indices, { x = 0, y = 0, scale = 1, angle = 0, dx = 0, dy = 0 }) {
  const cosine = Math.cos(angle) * scale;
  const sine = Math.sin(angle) * scale;
  return strokes.map((stroke, index) => indices.includes(index) ? {
    ...stroke,
    width: strokeWidth(stroke) * scale,
    points: stroke.points.map(point => ({
      ...point,
      x: x + (point.x - x) * cosine - (point.y - y) * sine + dx,
      y: y + (point.x - x) * sine + (point.y - y) * cosine + dy
    }))
  } : stroke);
}

export function updateSelectedStrokes(strokes, indices, update) {
  const selected = new Set(indices);
  return strokes.map((stroke, index) => selected.has(index) && stroke.tool === 'pen'
    ? { ...stroke, ...update(stroke) }
    : stroke);
}

export function duplicateSelectedStrokes(strokes, indices, { dx = 16, dy = 16 } = {}) {
  const selected = indices.map(index => strokes[index]).filter(Boolean);
  const bounds = getContentBounds(selected);
  if (!bounds) return [];
  const offsetX = Math.max(-bounds.left, Math.min(A4_WIDTH - bounds.right, dx));
  const offsetY = Math.max(-bounds.top, dy);
  return selected.map(stroke => ({
    ...stroke,
    points: stroke.points.map(rawPoint => {
      const point = readPoint(rawPoint);
      const copied = { x: point.x + offsetX, y: point.y + offsetY, pressure: point.pressure };
      if (Number.isFinite(point.time)) copied.time = point.time;
      if (rawPoint.move) copied.move = true;
      return copied;
    })
  }));
}

export function eraseStrokes(strokes, path, radius = 10) {
  if (!path.length) return strokes;
  const eraser = (path.length === 1 ? [path[0], path[0]] : path).map(readPoint);
  return strokes.filter(stroke => {
    if (stroke.tool !== 'pen' || !stroke.points?.length) return true;
    const points = (stroke.points.length === 1 ? [stroke.points[0], stroke.points[0]] : stroke.points).map(readPoint).map(point => [point.x, point.y]);
    const erasePoints = eraser.map(point => [point.x, point.y]);
    for (let index = 1; index < points.length; index++) {
      if (stroke.points[index]?.move) continue;
      for (let eraserIndex = 1; eraserIndex < erasePoints.length; eraserIndex++) {
        if (segmentDistance(points[index - 1], points[index], erasePoints[eraserIndex - 1], erasePoints[eraserIndex]) <= radius + strokeWidth(stroke) / 2) return false;
      }
    }
    return true;
  });
}
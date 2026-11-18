import test from 'node:test';
import assert from 'node:assert/strict';
import { A4_HEIGHT, drawStroke, eraseStrokes, getContentBounds, getExportLayout, getPointerPressure, normalizeDrawing } from '../lib/drawing.mjs';
import * as drawing from '../lib/drawing.mjs';

test('writes the image beside the notebook and propagates save errors', async () => {
  const calls = [];
  const contents = { save: async (path, model) => { calls.push([path, model]); } };
  await drawing.saveDrawingImage(contents, 'corso/lezione.ipynb', 'draw-123.png', 'aGVsbG8=');
  assert.deepEqual(calls, [
    ['corso/Images', { type: 'directory' }],
    ['corso/Images/draw-123.png', { type: 'file', format: 'base64', content: 'aGVsbG8=' }]
  ]);
  await assert.rejects(drawing.saveDrawingImage({ save: async () => { throw new Error('negato'); } }, 'lezione.ipynb', 'draw-123.png', ''), /negato/);
});

test('recognizes drawing history shortcuts without intercepting text editing', () => {
  assert.equal(drawing.getHistoryShortcut({ key: 'z', ctrlKey: true }), 'undo');
  assert.equal(drawing.getHistoryShortcut({ key: 'Z', ctrlKey: true, shiftKey: true }), 'redo');
  assert.equal(drawing.getHistoryShortcut({ key: 'z', metaKey: true }), 'undo');
  assert.equal(drawing.getHistoryShortcut({ key: 'z', ctrlKey: true, target: { tagName: 'INPUT' } }), null);
  assert.equal(drawing.getHistoryShortcut({ key: 'z', ctrlKey: true, altKey: true }), null);
});

test('recognizes copy and paste shortcuts without intercepting text editing', () => {
  assert.equal(drawing.getClipboardShortcut({ key: 'c', ctrlKey: true }), 'copy');
  assert.equal(drawing.getClipboardShortcut({ key: 'V', metaKey: true }), 'paste');
  assert.equal(drawing.getClipboardShortcut({ key: 'v', ctrlKey: true, target: { tagName: 'TEXTAREA' } }), null);
  assert.equal(drawing.getClipboardShortcut({ key: 'c', ctrlKey: true, altKey: true }), null);
});

test('zoom keeps the document point under the cursor fixed', () => {
  assert.equal(drawing.zoomScrollPosition(100, 50, 1, 2), 250);
  assert.equal(drawing.zoomScrollPosition(250, 50, 2, 1), 100);
});

test('detects when a captured pointer leaves the visible viewport', () => {
  const viewport = { left: 10, top: 20, right: 110, bottom: 220 };
  assert.equal(drawing.isPointInsideRect({ x: 60, y: 120 }, viewport), true);
  assert.equal(drawing.isPointInsideRect({ x: 10, y: 20 }, viewport), true);
  assert.equal(drawing.isPointInsideRect({ x: 5, y: 120 }, viewport), false);
  assert.equal(drawing.isPointInsideRect({ x: 60, y: 221 }, viewport), false);
});

test('coalesces preview saves and flushes pending work exactly once', async () => {
  let saves = 0;
  const deferred = drawing.createDeferredSave(() => { saves++; }, 20);
  deferred.schedule();
  deferred.schedule();
  assert.equal(saves, 0);
  deferred.flush();
  deferred.flush();
  assert.equal(saves, 1);
  deferred.schedule();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(saves, 2);
  deferred.flush();
  assert.equal(saves, 2);
});

test('coalesces pointer renders into one animation frame', () => {
  const frames = new Map();
  let nextId = 1;
  const renders = [];
  const scheduled = drawing.createFrameRender((force, redrawBase) => renders.push([force, redrawBase]), callback => {
    const id = nextId++;
    frames.set(id, callback);
    return id;
  }, id => frames.delete(id));
  scheduled.schedule(true, false);
  scheduled.schedule(false, true);
  assert.equal(frames.size, 1);
  const frame = frames.get(1);
  frames.delete(1);
  frame();
  assert.deepEqual(renders, [[true, true]]);
  scheduled.schedule();
  assert.equal(frames.size, 1);
  scheduled.cancel();
  assert.equal(frames.size, 0);
});

test('packs stroke points without losing precision, timestamps or disconnected shapes', () => {
  const saved = { version: 2, width: drawing.A4_WIDTH, strokes: [
    { tool: 'pen', width: 3, points: [
      { x: 10.123456789, y: 20.987654321, pressure: 0.321234, time: 123.456 },
      { x: 30, y: 40, pressure: 1, time: 124.789 }
    ] },
    { tool: 'pen', shape: true, width: 2, points: [
      { x: 0, y: 0, pressure: 1 }, { x: 10, y: 10, pressure: 1, move: true }
    ] }
  ] };
  const packed = { ...saved, strokes: drawing.compactStrokes(saved.strokes) };
  assert.ok(JSON.stringify(packed).length < JSON.stringify(saved).length);
  assert.deepEqual(normalizeDrawing(packed), saved);
});

test('reuses packed immutable strokes and repacks changed strokes', () => {
  const cache = new WeakMap();
  const stroke = { tool: 'pen', color: '#000000', points: [{ x: 1, y: 2, pressure: 1 }] };
  const [first] = drawing.compactStrokes([stroke], cache);
  assert.equal(drawing.compactStrokes([stroke], cache)[0], first);
  const [changed] = drawing.compactStrokes([{ ...stroke, color: '#ff0000' }], cache);
  assert.notEqual(changed, first);
  assert.equal(changed.color, '#ff0000');
});

test('restores five valid favorite colors and falls back safely on invalid data', () => {
  const defaults = drawing.parseFavoriteColors(null);
  assert.equal(defaults.length, 5);
  assert.deepEqual(drawing.parseFavoriteColors('{broken'), defaults);
  assert.deepEqual(drawing.parseFavoriteColors(JSON.stringify(['#123456', 'invalid', '#abcdef'])), [
    '#123456', defaults[1], '#abcdef', defaults[3], defaults[4]
  ]);
});

test('creates a closed rectangle and an arrow with a separate arrowhead', () => {
  const start = { x: 10, y: 20 };
  const end = { x: 110, y: 70 };
  const rectangle = drawing.createShapePoints('rectangle', start, end);
  assert.deepEqual(rectangle.map(({ x, y }) => [x, y]), [[10, 20], [110, 20], [110, 70], [10, 70], [10, 20]]);
  const arrow = drawing.createShapePoints('arrow', start, end);
  assert.deepEqual([arrow[0].x, arrow[0].y, arrow[1].x, arrow[1].y], [10, 20, 110, 70]);
  assert.equal(arrow[2].move, true);
});

test('scales arrowheads with stroke width, including double arrows and axes', () => {
  const start = { x: 0, y: 0 };
  const end = { x: 200, y: 100 };
  for (const shape of ['arrow', 'double-arrow', 'axes']) {
    const thin = drawing.createShapePoints(shape, start, end, 1);
    const thick = drawing.createShapePoints(shape, start, end, 10);
    assert.ok(Math.hypot(thick[2].x - thick[3].x, thick[2].y - thick[3].y) > Math.hypot(thin[2].x - thin[3].x, thin[2].y - thin[3].y));
  }
});

test('creates a cubic spline through knots with user-controlled tangents', () => {
  const knots = [
    { x: 0, y: 0, dx: 0, dy: 80 },
    { x: 100, y: 0, dx: 0, dy: -80 }
  ];
  const points = drawing.linearizeSpline(knots);
  assert.deepEqual([points[0].x, points[0].y], [0, 0]);
  assert.deepEqual([points.at(-1).x, points.at(-1).y], [100, 0]);
  assert.ok(points.some(point => point.y > 50));
  assert.deepEqual(drawing.linearizeSpline([knots[0]]), []);
});

test('creates ellipses, lines, double arrows and coordinate axes', () => {
  const start = { x: 10, y: 20 };
  const end = { x: 110, y: 70 };
  const ellipse = drawing.createShapePoints('ellipse', start, end);
  assert.equal(ellipse.length, 65);
  assert.ok(Math.hypot(ellipse[0].x - ellipse.at(-1).x, ellipse[0].y - ellipse.at(-1).y) < 1e-10);
  assert.equal(drawing.createShapePoints('line', start, end).length, 2);
  assert.equal(drawing.createShapePoints('double-arrow', start, end).filter(point => point.move).length, 2);
  assert.equal(drawing.createShapePoints('axes', start, end).filter(point => point.move).length, 3);
});

test('selects strokes crossing a region even when their endpoints are outside', () => {
  const strokes = [
    { tool: 'pen', points: [{ x: 0, y: 50 }, { x: 100, y: 50 }] },
    { tool: 'pen', points: [{ x: 0, y: 10 }, { x: 100, y: 10 }] }
  ];
  const region = [{ x: 40, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 60 }, { x: 40, y: 60 }];
  assert.deepEqual(drawing.selectStrokes(strokes, region), [0]);
});

test('selects a dot whose visible width overlaps a selection region', () => {
  const strokes = [{ tool: 'pen', width: 10, points: [{ x: 38, y: 50 }] }];
  const region = [{ x: 40, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 60 }, { x: 40, y: 60 }];
  assert.deepEqual(drawing.selectStrokes(strokes, region), [0]);
});

test('transforms selected strokes without changing the originals', () => {
  const strokes = [{ tool: 'pen', width: 4, points: [{ x: 10, y: 0, pressure: 0.5 }] }];
  const transformed = drawing.transformStrokes(strokes, [0], { x: 0, y: 0, scale: 2, angle: Math.PI / 2, dx: 3, dy: 4 });
  assert.ok(Math.abs(transformed[0].points[0].x - 3) < 1e-10);
  assert.ok(Math.abs(transformed[0].points[0].y - 24) < 1e-10);
  assert.equal(transformed[0].width, 8);
  assert.equal(strokes[0].points[0].x, 10);
});

test('updates style and width only on selected ink strokes', () => {
  const strokes = [
    { tool: 'pen', style: 'solid', width: 3, points: [[0, 0]] },
    { tool: 'pen', highlighter: true, style: 'solid', width: 12, points: [[1, 1]] },
    { tool: 'white', style: 'solid', width: 20, points: [[2, 2]] }
  ];
  const updated = drawing.updateSelectedStrokes(strokes, [0, 1, 2], stroke => ({
    style: 'dashed',
    width: drawing.getToolStrokeWidth('pen', 6, stroke.highlighter)
  }));
  assert.equal(updated[0].style, 'dashed');
  assert.equal(updated[0].width, 6);
  assert.equal(updated[1].style, 'dashed');
  assert.equal(updated[1].width, 24);
  assert.equal(updated[2], strokes[2]);
  assert.equal(strokes[0].style, 'solid');
});

test('duplicates selected strokes with an offset without mutating originals', () => {
  const strokes = [
    { tool: 'pen', width: 4, points: [{ x: 10, y: 20, pressure: 0.5 }] },
    { tool: 'pen', width: 2, points: [{ x: 300, y: 40, pressure: 1 }] }
  ];
  const copied = drawing.duplicateSelectedStrokes(strokes, [0, 1], { dx: 16, dy: 8 });
  assert.deepEqual(copied.map(stroke => [stroke.points[0].x, stroke.points[0].y]), [[26, 28], [316, 48]]);
  assert.equal(strokes[0].points[0].x, 10);
  assert.notEqual(copied[0], strokes[0]);
  assert.notEqual(copied[0].points, strokes[0].points);
});

test('preserves disconnected shape segments when saving and erasing', () => {
  const shape = { tool: 'pen', shape: true, width: 2, points: [
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 90, y: 0, move: true }, { x: 100, y: 0 }
  ] };
  const saved = normalizeDrawing({ version: 2, strokes: [shape] }).strokes[0];
  assert.equal(saved.points[2].move, true);
  assert.deepEqual(eraseStrokes([saved], [{ x: 50, y: 0 }], 2), [saved]);
  const canvas = context();
  drawStroke(canvas, saved);
  assert.ok(canvas.calls.some(call => call[0] === 'move' && call[1] === 90));
});

function context() {
  return {
    calls: [],
    beginPath() {},
    moveTo(x, y) { this.calls.push(['move', x, y]); },
    lineTo(x, y) { this.calls.push(['line', x, y]); },
    quadraticCurveTo(x1, y1, x, y) { this.calls.push(['curve', x1, y1, x, y]); },
    stroke() { this.calls.push(['stroke', this.globalCompositeOperation, this.strokeStyle]); },
    fill() { this.calls.push(['fill', this.fillStyle, this.globalAlpha]); },
    setLineDash(dash) { this.calls.push(['dash', dash]); },
  };
}

test('draws filled shapes and highlighter strokes with their opacity', () => {
  const canvas = context();
  drawStroke(canvas, { tool: 'pen', shape: true, fill: true, opacity: 0.4, color: '#ff0000', points: [[0, 0], [10, 0], [10, 10], [0, 0]] });
  assert.ok(canvas.calls.some(call => call[0] === 'fill' && call[1] === '#ff0000' && call[2] === 0.4));
  const marker = context();
  drawStroke(marker, { tool: 'pen', highlighter: true, opacity: 0.3, points: [[0, 0], [5, 5], [10, 0]] });
  assert.equal(marker.calls.filter(call => call[0] === 'stroke').length, 1);
  assert.equal(marker.globalAlpha, 0.3);
  drawStroke(marker, { tool: 'erase', points: [[0, 0], [1, 1]] });
  assert.equal(marker.globalAlpha, 1);
});

test('fills a highlighter shape once without a darker inner border', () => {
  const canvas = context();
  drawStroke(canvas, { tool: 'pen', shape: true, highlighter: true, fill: true, opacity: 0.35, color: '#f9a825', points: [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]] });
  assert.equal(canvas.calls.filter(call => call[0] === 'fill').length, 1);
  assert.equal(canvas.calls.filter(call => call[0] === 'stroke').length, 0);
});

test('preserves highlighter, fill and opacity through compact storage', () => {
  const stroke = { tool: 'pen', highlighter: true, fill: true, opacity: 0.35, points: [{ x: 1, y: 2, pressure: 1 }, { x: 5, y: 6, pressure: 1 }] };
  const saved = normalizeDrawing({ version: 2, strokes: drawing.compactStrokes([stroke]) }).strokes[0];
  assert.equal(saved.highlighter, true);
  assert.equal(saved.fill, true);
  assert.equal(saved.opacity, 0.35);
});

test('draws each pen style with its dash pattern', () => {
  for (const [style, pattern] of Object.entries({ solid: [], dashed: [12, 8], dotted: [1, 7], dashdot: [12, 7, 1, 7] })) {
    const canvas = context();
    drawStroke(canvas, { tool: 'pen', style, points: [[1, 2], [3, 4]] });
    assert.deepEqual(canvas.calls[0], ['dash', pattern]);
    assert.deepEqual(canvas.calls.at(-1), ['stroke', 'source-over', '#20242b']);
  }
});

test('standard eraser removes ink while whitening paints white', () => {
  for (const [tool, composite, color] of [['erase', 'destination-out', '#20242b'], ['white', 'source-over', '#ffffff']]) {
    const canvas = context();
    drawStroke(canvas, { tool, points: [[0, 0], [1, 1]] });
    assert.deepEqual(canvas.calls.at(-1), ['stroke', composite, color]);
  }
});

test('stroke eraser removes only pen strokes intersecting the eraser path', () => {
  const hit = { tool: 'pen', points: [[0, 0], [100, 0]] };
  const miss = { tool: 'pen', points: [[0, 50], [100, 50]] };
  const white = { tool: 'white', points: [[0, 0], [1, 1]] };
  assert.deepEqual(eraseStrokes([hit, miss, white], [[50, -20], [50, 20]], 5), [miss, white]);
});

test('content bounds include each stroke width and point pressure', () => {
  const bounds = getContentBounds([
    { tool: 'pen', width: 10, points: [{ x: 20, y: 30, pressure: 0.5 }, { x: 40, y: 50, pressure: 1 }] }
  ]);
  assert.deepEqual(bounds, { left: 17.5, top: 27.5, right: 45, bottom: 55 });
});

test('smooths pen segments and varies width with sampled pressure', () => {
  const canvas = context();
  drawStroke(canvas, {
    tool: 'pen',
    width: 8,
    points: [{ x: 0, y: 0, pressure: 0.25 }, { x: 10, y: 10, pressure: 1 }]
  });
  assert.ok(canvas.calls.some(call => call[0] === 'curve'));
  assert.equal(canvas.lineWidth, 5);
});

test('does not convert a zero-pressure pen release to full pressure', () => {
  assert.equal(getPointerPressure({ pointerType: 'pen', pressure: 0 }), null);
  assert.equal(getPointerPressure({ pointerType: 'pen', pressure: 0.375 }), 0.375);
  assert.equal(getPointerPressure({ pointerType: 'pen' }), 1);
  assert.equal(getPointerPressure({ pointerType: 'mouse', pressure: 0 }), 1);
});

test('export keeps A4 width and crops height to content plus margins', () => {
  const layout = getExportLayout([
    { tool: 'pen', width: 4, points: [{ x: 100, y: 200 }, { x: 120, y: 300 }] }
  ], { margin: 10, scale: 2 });
  assert.equal(layout.width, 1588);
  assert.equal(layout.height, 248);
  assert.equal(layout.offsetX, 0);
  assert.equal(layout.offsetY, -188);
  assert.equal(getExportLayout([]).height, Math.ceil(A4_HEIGHT));
});

test('migrates version one strokes to A4 logical coordinates', () => {
  const drawing = normalizeDrawing({
    version: 1,
    strokes: [{ tool: 'pen', style: 'solid', points: [[0, 0], [1000, 500]] }]
  });
  assert.equal(drawing.version, 2);
  assert.equal(drawing.width, 210 * 96 / 25.4);
  assert.deepEqual(drawing.strokes[0].points, [
    { x: 0, y: 0, pressure: 1 },
    { x: drawing.width, y: drawing.width / 2, pressure: 1 }
  ]);
  assert.equal(drawing.strokes[0].width, 3 * drawing.width / 1000);
});

test('keeps version two vector strokes unchanged', () => {
  const saved = {
    version: 2,
    width: 210 * 96 / 25.4,
    strokes: [{ tool: 'pen', width: 4, color: '#123456', points: [{ x: 2, y: 3, pressure: 0.4, time: 12 }] }]
  };
  assert.deepEqual(normalizeDrawing(saved), saved);
});
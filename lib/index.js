import { INotebookTracker } from '@jupyterlab/notebook';
import { ICommandPalette, ToolbarButton } from '@jupyterlab/apputils';
import { addIcon, caretDownEmptyThinIcon, cleaningIcon, editIcon, expandIcon, lineFormIcon, redoIcon, saveIcon, undoIcon } from '@jupyterlab/ui-components';
import { A4_HEIGHT, A4_WIDTH, compactStrokes, createDeferredSave, createFrameRender, createShapePoints, drawStroke, duplicateSelectedStrokes, eraseStrokes, getClipboardShortcut, getContentBounds, getExportLayout, getHistoryShortcut, getPointerPressure, getToolStrokeWidth, isPointInsideRect, linearizeSpline, normalizeDrawing, parseFavoriteColors, saveDrawingImage, selectStrokes, transformStrokes, updateSelectedStrokes, zoomScrollPosition } from './drawing.mjs';

const metadataKey = 'jupyter_draw';
const favoriteColorsKey = 'jupyter-draw:favorite-colors';
const pngAttachment = 'jupyter-draw.png';
const svgAttachment = 'jupyter-draw.svg';
const tileHeight = 256;
const maxCanvasHeight = 32767;
const maxPreviewPixels = 40_000_000;
const gridSize = 5 * 96 / 25.4;

function renderPng(strokes, scale = 2, margin) {
  const layout = getExportLayout(strokes, { scale, ...(margin === undefined ? {} : { margin }) });
  if (layout.height > maxCanvasHeight || layout.width * layout.height > maxPreviewPixels) return null;
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const context = canvas.getContext('2d');
  context.scale(scale, scale);
  context.translate(layout.offsetX, layout.offsetY);
  for (const stroke of strokes) drawStroke(context, stroke);
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalCompositeOperation = 'destination-over';
  context.globalAlpha = 1;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, layout.width, layout.height);
  return { canvas, layout };
}

function svgStroke(stroke, color) {
  if (!stroke.points?.length) return '';
  const points = stroke.points;
  const dash = stroke.tool === 'pen' && stroke.style !== 'solid'
    ? ` stroke-dasharray="${({ dashed: '12 8', dotted: '1 7', dashdot: '12 7 1 7' })[stroke.style] || ''}"`
    : '';
  const paint = color || (stroke.tool === 'white' ? '#ffffff' : (stroke.color || '#20242b'));
  const safePaint = /^#[\da-f]{6}$/i.test(paint) ? paint : '#20242b';
  const width = stroke.width || (stroke.tool === 'pen' ? 3 : 20);
  if (stroke.shape) {
    const path = points.map((point, index) => `${!index || point.move ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
    const strokeAttributes = stroke.fill && stroke.highlighter ? '' : ` stroke="${safePaint}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${dash}`;
    return `<path d="${path}" fill="${stroke.fill ? safePaint : 'none'}"${strokeAttributes}/>`;
  }
  if ((stroke.fill || stroke.highlighter) && points.length > 1) {
    const path = [`M ${points[0].x} ${points[0].y}`];
    for (let index = 1; index < points.length; index++) {
      const start = points[index - 1];
      const end = points[index];
      const endX = index === points.length - 1 ? end.x : (start.x + end.x) / 2;
      const endY = index === points.length - 1 ? end.y : (start.y + end.y) / 2;
      path.push(`Q ${start.x} ${start.y} ${endX} ${endY}`);
    }
    const fill = stroke.fill ? `<path d="${path.join(' ')}" fill="${safePaint}"/>` : '';
    if (stroke.highlighter) return `${fill}<path d="${path.join(' ')}" stroke="${safePaint}" stroke-width="${width}" fill="none" stroke-linecap="round" stroke-linejoin="round"${dash}/>`;
    return fill + svgStroke({ ...stroke, fill: false }, color);
  }
  const paths = [];
  if (points.length === 1) {
    const point = points[0];
    paths.push(`<path d="M ${point.x} ${point.y} l 0.01 0" stroke-width="${width * (point.pressure || 1)}"/>`);
  } else {
    for (let index = 1; index < points.length; index++) {
      const start = points[index - 1];
      const end = points[index];
      const previous = points[index - 2] || start;
      const next = points[index + 1] || end;
      const startX = index === 1 ? start.x : (previous.x + start.x) / 2;
      const startY = index === 1 ? start.y : (previous.y + start.y) / 2;
      const endX = index === points.length - 1 ? end.x : (start.x + end.x) / 2;
      const endY = index === points.length - 1 ? end.y : (start.y + end.y) / 2;
      const pressure = ((start.pressure ?? 1) + (end.pressure ?? 1)) / 2;
      paths.push(`<path d="M ${startX} ${startY} Q ${start.x} ${start.y} ${endX} ${endY}" stroke-width="${width * pressure}"/>`);
    }
  }
  return paths.map(path => path.replace('/>', ` stroke="${safePaint}" fill="none" stroke-linecap="round" stroke-linejoin="round"${dash}/>`)).join('');
}

function createSvg(strokes, layout) {
  const logicalHeight = layout.height / layout.scale;
  const definitions = [];
  let content = '';
  for (const [index, stroke] of strokes.entries()) {
    if (stroke.tool === 'erase') {
      const maskId = `erase-${index}`;
      definitions.push(`<mask id="${maskId}" maskUnits="userSpaceOnUse" x="${-layout.offsetX}" y="${-layout.offsetY}" width="${A4_WIDTH}" height="${logicalHeight}"><rect x="${-layout.offsetX}" y="${-layout.offsetY}" width="${A4_WIDTH}" height="${logicalHeight}" fill="white"/>${svgStroke(stroke, '#000000')}</mask>`);
      content = `<g mask="url(#${maskId})">${content}</g>`;
    } else {
      const opacity = stroke.tool === 'pen' && Number.isFinite(stroke.opacity) ? Math.max(0, Math.min(1, stroke.opacity)) : 1;
      content += `<g opacity="${opacity}">${svgStroke(stroke)}</g>`;
    }
  }
  const heightMm = logicalHeight * 25.4 / 96;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="${heightMm}mm" viewBox="0 0 ${A4_WIDTH} ${logicalHeight}"><defs>${definitions.join('')}</defs><rect width="${A4_WIDTH}" height="${logicalHeight}" fill="white"/><g transform="translate(${layout.offsetX} ${layout.offsetY})">${content}</g></svg>`;
}

function encodeBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

async function saveDrawing(model, strokes, panel, contents, imageId) {
  const previous = model.getMetadata(metadataKey);
  const revision = (previous?.revision || 0) + 1;
  const notebookPath = panel.context.path;
  const rendered = renderPng(strokes);
  const imageName = `jupyter-draw-${imageId}.${rendered ? 'png' : 'svg'}`;
  const content = rendered ? rendered.canvas.toDataURL('image/png').split(',')[1] : encodeBase64(createSvg(strokes, getExportLayout(strokes)));
  await saveDrawingImage(contents, notebookPath, imageName, content);
  if (panel.context.path !== notebookPath) return;
  const attachments = { ...model.getAttachments() };
  delete attachments[pngAttachment];
  delete attachments[svgAttachment];
  model.transact(() => {
    model.setMetadata(metadataKey, { ...model.getMetadata(metadataKey), revision, notebookPath, imageId });
    model.setAttachments(attachments);
    model.setSource(`![Disegno](Images/${imageName})\n\n<!-- jupyter-draw:${revision} -->`);
  });
}

function createEditor(cell, panel, contents) {
  if (cell.node.querySelector('.jd-editor')) return;
  const model = cell.model.sharedModel;
  const drawing = normalizeDrawing(model.getMetadata(metadataKey));
  if (!drawing) return;
  let strokes = drawing.strokes;
  let tool = 'pen';
  let inkTool = 'pen';
  let current = null;
  let spline = null;
  let selection = null;
  let clipboard = [];
  let pasteCount = 0;
  let stageHeight = A4_HEIGHT;
  let zoom = 1;
  let dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  let forcePreview = false;
  const imageId = Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('');
  let pendingPreviews = 0;
  let previewQueue = Promise.resolve();
  let resaveAfterPreview = false;
  let notebookSaving = false;
  let editorClosed = false;
  function disconnectSaveState() {
    if (editorClosed && !pendingPreviews && !notebookSaving && !resaveAfterPreview) panel.context.saveState?.disconnect(onSaveState);
  }
  function resaveNotebook() {
    if (resaveAfterPreview && !notebookSaving && !pendingPreviews) {
      resaveAfterPreview = false;
      notebookSaving = true;
      void panel.context.save().catch(error => console.error('Jupyter Draw:', error)).finally(() => {
        notebookSaving = false;
        disconnectSaveState();
      });
    }
    disconnectSaveState();
  }
  const deferredSave = createDeferredSave(() => {
    if (current && !forcePreview) deferredSave.schedule();
    else {
      const snapshot = strokes;
      pendingPreviews++;
      previewQueue = previewQueue.then(() => saveDrawing(model, snapshot, panel, contents, imageId)).catch(error => {
        resaveAfterPreview = false;
        console.error('Jupyter Draw:', error);
        window.alert(`Impossibile salvare l'immagine del disegno: ${error.message}`);
      }).finally(() => {
        pendingPreviews--;
        resaveNotebook();
      });
    }
  }, 500);
  const undoStack = [];
  const redoStack = [];
  const tiles = new Map();
  const strokeTiles = new Map();
  const packedStrokes = new WeakMap();

  const editor = document.createElement('div');
  editor.className = 'jd-editor';
  const toolbar = document.createElement('div');
  toolbar.className = 'jd-toolbar';
  const makeButton = (label, className = '') => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    if (className) button.className = className;
    return button;
  };
  const iconButton = (label, icon) => {
    const button = makeButton('');
    button.className = 'jd-icon-button';
    button.title = label;
    button.setAttribute('aria-label', label);
    icon.element({ container: button });
    return button;
  };
  const makeMenu = (label, options, initial, preview = false) => {
    const details = document.createElement('details');
    details.className = 'jd-menu';
    const summary = document.createElement('summary');
    summary.title = label;
    summary.setAttribute('aria-label', label);
    caretDownEmptyThinIcon.element({ container: summary });
    const list = document.createElement('div');
    list.className = 'jd-menu-list';
    const menu = { node: details, value: initial, onchange: null };
    for (const [value, text] of options) {
      const option = makeButton('');
      option.className = 'jd-menu-option';
      option.setAttribute('aria-pressed', String(value === initial));
      const indicator = document.createElement('span');
      indicator.className = 'jd-menu-indicator';
      option.append(indicator);
      if (preview) {
        const line = document.createElement('span');
        line.className = `jd-line-preview jd-line-${value}`;
        option.append(line);
      }
      option.append(document.createTextNode(text));
      option.onclick = () => {
        menu.value = value;
        for (const sibling of list.children) sibling.setAttribute('aria-pressed', String(sibling === option));
        details.open = false;
        menu.onchange?.();
      };
      list.append(option);
    }
    details.append(summary, list);
    return menu;
  };
  const pen = iconButton('Penna', editIcon);
  const highlighter = iconButton('Evidenziatore', editIcon);
  highlighter.classList.add('jd-highlighter');
  const fillLabel = document.createElement('label');
  fillLabel.className = 'jd-fill';
  const fill = document.createElement('input');
  fill.type = 'checkbox';
  fillLabel.append(fill, document.createTextNode('Riempi'));
  const opacity = document.createElement('input');
  opacity.type = 'range';
  opacity.min = '0';
  opacity.max = '100';
  opacity.value = '100';
  opacity.title = 'Opacità';
  opacity.setAttribute('aria-label', 'Opacità');
  const pan = makeButton('Scorri');
  const penStyle = makeMenu('Stile della penna', [['solid', 'standard'], ['dashed', 'tratteggiato'], ['dashdot', 'tratteggiato-puntinato'], ['dotted', 'puntinato']], 'solid', true);
  const color = document.createElement('input');
  color.type = 'color';
  color.value = '#20242b';
  color.setAttribute('aria-label', 'Colore della penna');
  const colors = document.createElement('div');
  colors.className = 'jd-colors';
  const favorites = document.createElement('div');
  favorites.className = 'jd-favorites';
  favorites.setAttribute('role', 'group');
  favorites.setAttribute('aria-label', 'Colori preferiti');
  const saveColor = iconButton('Salva colore nel preferito selezionato', saveIcon);
  let favoriteIndex = 0;
  let favoriteColors;
  function updateFavorites() {
    try {
      favoriteColors = parseFavoriteColors(window.localStorage.getItem(favoriteColorsKey));
    } catch {
      favoriteColors = parseFavoriteColors(null);
    }
    for (const [index, button] of [...favorites.children].entries()) {
      button.firstChild.style.backgroundColor = favoriteColors[index];
      button.title = `Colore preferito ${index + 1}: ${favoriteColors[index]}`;
      button.setAttribute('aria-label', button.title);
      button.setAttribute('aria-pressed', String(index === favoriteIndex));
    }
    saveColor.title = `Salva colore nel preferito ${favoriteIndex + 1}`;
    saveColor.setAttribute('aria-label', saveColor.title);
  }
  for (let index = 0; index < 5; index++) {
    const button = makeButton('');
    button.append(document.createElement('span'));
    button.onclick = () => {
      favoriteIndex = index;
      color.value = favoriteColors[index];
      updateFavorites();
      applySelectionColor();
    };
    favorites.append(button);
  }
  color.addEventListener('input', () => {
    updateFavorites();
    applySelectionColor();
  });
  saveColor.onclick = () => {
    const updated = [...favoriteColors];
    updated[favoriteIndex] = color.value;
    try {
      window.localStorage.setItem(favoriteColorsKey, JSON.stringify(updated));
      window.dispatchEvent(new Event(favoriteColorsKey));
    } catch {
      window.alert('Impossibile salvare i colori preferiti nel browser.');
    }
  };
  const syncFavorites = event => {
    if (event.type !== 'storage' || event.key === favoriteColorsKey || event.key === null) updateFavorites();
  };
  window.addEventListener(favoriteColorsKey, syncFavorites);
  window.addEventListener('storage', syncFavorites);
  updateFavorites();
  colors.append(color, favorites, saveColor);
  const width = document.createElement('div');
  width.className = 'jd-widths';
  width.setAttribute('role', 'group');
  width.setAttribute('aria-label', 'Spessore della penna e della gomma');
  width.value = '3';
  for (const [value, label] of [['1', 'Sottile'], ['3', 'Medio'], ['6', 'Spesso'], ['10', 'Molto spesso']]) {
    const button = makeButton('');
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(value === width.value));
    const dot = document.createElement('span');
    dot.style.width = dot.style.height = `${4 + Number(value) * 1.5}px`;
    button.append(dot);
    button.onclick = () => {
      width.value = value;
      for (const sibling of width.children) sibling.setAttribute('aria-pressed', String(sibling === button));
      applySelectionProperty('width', stroke => getToolStrokeWidth('pen', Number(width.value), stroke.highlighter));
    };
    width.append(button);
  }
  const eraser = iconButton('Gomma', cleaningIcon);
  const eraserStyle = makeMenu('Tipo di gomma', [['erase', 'standard'], ['white', 'sbianca'], ['stroke', 'cancella tratto']], 'stroke');
  const shape = iconButton('Forme', lineFormIcon);
  const shapeStyle = makeMenu('Tipo di forma', [['rectangle', 'Disegna rettangolo'], ['ellipse', 'Disegna ellisse'], ['arrow', 'Disegna freccia'], ['double-arrow', 'Disegna doppia freccia'], ['line', 'Disegna linea retta'], ['axes', 'Disegna il sistema di coordinate'], ['spline', 'Disegna spline']], 'rectangle');
  const select = iconButton('Selezione', expandIcon);
  const selectStyle = makeMenu('Tipo di selezione', [['rectangle', 'Seleziona rettangolo'], ['region', 'Seleziona regione']], 'rectangle');
  const undo = iconButton('Annulla', undoIcon);
  const redo = iconButton('Ripeti', redoIcon);
  const clear = makeButton('Cancella tutto');
  const zoomSelect = document.createElement('select');
  zoomSelect.setAttribute('aria-label', 'Zoom del foglio');
  for (const [value, label] of [['0.5', '50%'], ['0.75', '75%'], ['1', '100%'], ['1.25', '125%'], ['1.5', '150%'], ['2', '200%'], ['3', '300%'], ['4', '400%']]) zoomSelect.add(new Option(label, value));
  const done = makeButton('Fine', 'jd-done');
  toolbar.append(pen, penStyle.node, highlighter, eraser, eraserStyle.node, shape, shapeStyle.node, select, selectStyle.node, pan, colors, width, fillLabel, opacity, undo, redo, clear, zoomSelect, done);

  const viewport = document.createElement('div');
  viewport.className = 'jd-viewport';
  const stage = document.createElement('div');
  stage.className = 'jd-stage';
  stage.setAttribute('role', 'application');
  stage.setAttribute('aria-label', 'Area di disegno A4');
  stage.tabIndex = 0;
  const selectionBox = document.createElement('div');
  selectionBox.className = 'jd-selection';
  selectionBox.hidden = true;
  for (const [kind, label] of [['resize', 'Ridimensiona selezione'], ['rotate', 'Ruota selezione']]) {
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = `jd-selection-handle jd-selection-${kind}`;
    handle.dataset.transform = kind;
    handle.title = label;
    handle.setAttribute('aria-label', label);
    selectionBox.append(handle);
  }
  const eraserCursor = document.createElement('div');
  eraserCursor.className = 'jd-eraser-cursor';
  eraserCursor.hidden = true;
  stage.append(selectionBox, eraserCursor);
  viewport.append(stage);
  editor.append(toolbar, viewport);
  cell.node.appendChild(editor);
  cell.node.classList.add('jd-editing');

  function remember() {
    undoStack.push(strokes);
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    undo.disabled = undoStack.length === 0;
    redo.disabled = redoStack.length === 0;
  }

  function tileTop(index) {
    return index * tileHeight;
  }

  function renderTile(index, redrawBase = true) {
    const tile = tiles.get(index);
    if (!tile) return;
    const top = tileTop(index);
    if (redrawBase) {
      tile.baseContext.setTransform(dpr, 0, 0, dpr, 0, -top * dpr);
      tile.baseContext.clearRect(0, top, A4_WIDTH, tileHeight);
      let visibleStrokes = current?.preview || strokeTiles.get(index) || [];
      for (const stroke of visibleStrokes) drawStroke(tile.baseContext, stroke);
      if (current?.tool === 'erase') drawStroke(tile.baseContext, current);
    }
    tile.overlayContext.setTransform(dpr, 0, 0, dpr, 0, -top * dpr);
    if (current?.shape) {
      const bounds = getContentBounds([current]);
      for (const area of [tile.shapeBounds, bounds]) {
        if (area) tile.overlayContext.clearRect(area.left - 2, area.top - 2, area.right - area.left + 4, area.bottom - area.top + 4);
      }
      tile.shapeBounds = bounds;
    } else if (current?.tool === 'pen' && !current.shape && !spline) {
      tile.shapeBounds = null;
      const bounds = getContentBounds([current]);
      const padding = 2 / dpr;
      tile.overlayContext.clearRect(bounds.left - padding, bounds.top - padding, bounds.right - bounds.left + padding * 2, bounds.bottom - bounds.top + padding * 2);
    } else {
      tile.shapeBounds = null;
      tile.overlayContext.clearRect(0, top, A4_WIDTH, tileHeight);
    }
    if (spline) {
      const knots = spline.hover ? [...spline.knots, { ...spline.hover, dx: 0, dy: 0 }] : spline.knots;
      drawStroke(tile.overlayContext, { ...spline.stroke, points: linearizeSpline(knots) });
      tile.overlayContext.save();
      tile.overlayContext.strokeStyle = '#3086cf';
      tile.overlayContext.fillStyle = '#fff';
      tile.overlayContext.lineWidth = 1.5 / zoom;
      tile.overlayContext.setLineDash([]);
      for (const knot of spline.knots) {
        tile.overlayContext.beginPath();
        tile.overlayContext.moveTo(knot.x - knot.dx, knot.y - knot.dy);
        tile.overlayContext.lineTo(knot.x + knot.dx, knot.y + knot.dy);
        tile.overlayContext.stroke();
        tile.overlayContext.beginPath();
        tile.overlayContext.arc(knot.x, knot.y, 4 / zoom, 0, Math.PI * 2);
        tile.overlayContext.fill();
        tile.overlayContext.stroke();
      }
      tile.overlayContext.restore();
    }
    if (current?.tool === 'select' && current.points.length > 1) {
      const points = current.kind === 'rectangle' ? createShapePoints('rectangle', current.points[0], current.points.at(-1)) : current.points;
      drawStroke(tile.overlayContext, { tool: 'pen', style: 'dashed', width: 1 / zoom, color: '#3086cf', shape: true, points });
    } else if (!['pan', 'move', 'resize', 'rotate', 'erase', 'stroke'].includes(current?.tool) && current?.points?.length) drawStroke(tile.overlayContext, current);
  }

  function createTile(index) {
    const base = document.createElement('canvas');
    const overlay = document.createElement('canvas');
    base.width = overlay.width = Math.ceil(A4_WIDTH * dpr);
    base.height = overlay.height = Math.ceil(tileHeight * dpr);
    base.className = overlay.className = 'jd-tile';
    overlay.classList.add('jd-overlay');
    base.style.top = overlay.style.top = `${tileTop(index) * zoom}px`;
    stage.append(base, overlay);
    tiles.set(index, { base, overlay, baseContext: base.getContext('2d'), overlayContext: overlay.getContext('2d') });
    renderTile(index);
  }

  function indexStroke(stroke) {
    const bounds = getContentBounds([stroke]);
    if (!bounds) return;
    const first = Math.max(0, Math.floor(bounds.top / tileHeight));
    const last = Math.max(first, Math.floor(bounds.bottom / tileHeight));
    for (let index = first; index <= last; index++) {
      if (!strokeTiles.has(index)) strokeTiles.set(index, []);
      strokeTiles.get(index).push(stroke);
    }
  }

  function rebuildIndex() {
    strokeTiles.clear();
    for (const stroke of strokes) indexStroke(stroke);
  }

  function updateStageSize() {
    stage.style.width = `${A4_WIDTH * zoom}px`;
    stage.style.height = `${stageHeight * zoom}px`;
    stage.style.setProperty('--jd-grid-size', `${gridSize * zoom}px`);
    for (const [index, tile] of tiles) {
      tile.base.style.width = tile.overlay.style.width = `${A4_WIDTH * zoom}px`;
      tile.base.style.height = tile.overlay.style.height = `${tileHeight * zoom}px`;
      tile.base.style.top = tile.overlay.style.top = `${tileTop(index) * zoom}px`;
    }
    updateSelectionBox();
  }

  function updateSelectionBox() {
    selectionBox.hidden = !selection;
    if (!selection) return;
    const bounds = current?.preview ? getContentBounds(selection.indices.map(index => current.preview[index])) : selection.bounds;
    selectionBox.style.left = `${bounds.left * zoom - 6}px`;
    selectionBox.style.top = `${bounds.top * zoom - 6}px`;
    selectionBox.style.width = `${(bounds.right - bounds.left) * zoom + 12}px`;
    selectionBox.style.height = `${(bounds.bottom - bounds.top) * zoom + 12}px`;
  }

  function renderVisible(force = false, redrawBase = true) {
    updateStageSize();
    const first = Math.max(0, Math.floor(viewport.scrollTop / zoom / tileHeight) - 1);
    const last = Math.floor((viewport.scrollTop + viewport.clientHeight) / zoom / tileHeight) + 1;
    for (const [index, tile] of tiles) {
      if (index < first || index > last) {
        tile.base.remove();
        tile.overlay.remove();
        tiles.delete(index);
      }
    }
    for (let index = first; index <= last; index++) {
      if (!tiles.has(index)) createTile(index);
      else if (force) renderTile(index, redrawBase);
    }
  }
  const scheduledRender = createFrameRender(renderVisible);

  function updateZoom() {
    const nextDpr = Math.min(2, Math.max(1, (window.devicePixelRatio || 1) * zoom));
    if (nextDpr !== dpr) {
      dpr = nextDpr;
      for (const tile of tiles.values()) {
        tile.base.remove();
        tile.overlay.remove();
      }
      tiles.clear();
    }
    renderVisible();
  }

  function setZoom(value, anchorX, anchorY) {
    const previousZoom = zoom;
    const previousLeft = viewport.scrollLeft;
    const previousTop = viewport.scrollTop;
    zoom = Number(value);
    updateZoom();
    viewport.scrollLeft = zoomScrollPosition(previousLeft, anchorX, previousZoom, zoom);
    viewport.scrollTop = zoomScrollPosition(previousTop, anchorY, previousZoom, zoom);
    renderVisible();
  }

  function selectTool(value) {
    scheduledRender.cancel();
    finishSpline();
    if (['pen', 'highlighter'].includes(value) && value !== inkTool) {
      inkTool = value;
      opacity.value = value === 'highlighter' ? '35' : '100';
    }
    tool = value;
    selection = null;
    updateSelectionBox();
    eraserCursor.hidden = true;
    stage.classList.toggle('jd-erasing', ['erase', 'stroke', 'white'].includes(tool));
    pen.setAttribute('aria-pressed', String(tool === 'pen'));
    highlighter.setAttribute('aria-pressed', String(tool === 'highlighter'));
    pan.setAttribute('aria-pressed', String(tool === 'pan'));
    eraser.setAttribute('aria-pressed', String(['erase', 'stroke', 'white'].includes(tool)));
    shape.setAttribute('aria-pressed', String(tool === 'shape'));
    select.setAttribute('aria-pressed', String(tool === 'select'));
  }

  function ensureHeight(y) {
    const visibleHeight = viewport.clientHeight / zoom;
    if (y + visibleHeight * 0.6 > stageHeight) {
      stageHeight += Math.max(A4_HEIGHT, visibleHeight);
      updateStageSize();
    }
  }

  function documentPoint(event, allowZeroPressure = false) {
    const bounds = stage.getBoundingClientRect();
    const pressure = getPointerPressure(event);
    if (pressure === null && !allowZeroPressure) return null;
    return {
      x: Math.max(0, Math.min(A4_WIDTH, (event.clientX - bounds.left) / zoom)),
      y: Math.max(0, (event.clientY - bounds.top) / zoom),
      pressure: pressure ?? 0.1,
      time: event.timeStamp
    };
  }

  function save(addedStroke = null) {
    scheduledRender.cancel();
    if (addedStroke) {
      const existingTiles = new Set(tiles.keys());
      indexStroke(addedStroke);
      renderVisible();
      for (const [index, tile] of tiles) {
        if (existingTiles.has(index) && strokeTiles.get(index)?.includes(addedStroke)) drawStroke(tile.baseContext, addedStroke);
        renderTile(index, false);
      }
    } else {
      rebuildIndex();
      renderVisible(true);
    }
    model.setMetadata(metadataKey, { ...model.getMetadata(metadataKey), version: 2, width: A4_WIDTH, strokes: compactStrokes(strokes, packedStrokes) });
    deferredSave.schedule();
  }

  function flushPreview() {
    forcePreview = true;
    try {
      deferredSave.flush();
    } finally {
      forcePreview = false;
    }
  }

  function onSaveState(sender, state) {
    if (state === 'started') {
      notebookSaving = true;
      flushPreview();
      if (pendingPreviews) resaveAfterPreview = true;
    } else {
      notebookSaving = false;
      if (state === 'failed') resaveAfterPreview = false;
      resaveNotebook();
    }
  }

  function onPathChanged() {
    deferredSave.schedule();
  }

  function applySelectionColor() {
    applySelectionProperty('color', color.value);
  }

  function applySelectionProperty(property, value) {
    if (!selection || current) return;
    const resolve = stroke => typeof value === 'function' ? value(stroke) : value;
    if (!selection.indices.some(index => strokes[index].tool === 'pen' && strokes[index][property] !== resolve(strokes[index]))) return;
    remember();
    strokes = updateSelectedStrokes(strokes, selection.indices, stroke => ({ [property]: resolve(stroke) }));
    save();
  }

  function finishSpline(close = false) {
    if (!spline) return;
    if (close && spline.knots.length > 1) spline.knots.push({ ...spline.knots[0] });
    const points = linearizeSpline(spline.knots);
    if (points.length) {
      remember();
      strokes = [...strokes, { ...spline.stroke, points }];
    }
    spline = null;
    if (current?.tool === 'spline') current = null;
    if (points.length) save();
    else renderVisible(true);
  }

  function pushSamples(event) {
    const coalesced = event.getCoalescedEvents?.();
    const samples = coalesced?.length ? coalesced : [event];
    const previousLength = current.points.length;
    for (const sample of samples) {
      const point = documentPoint(sample);
      if (!point) continue;
      current.points.push(point);
      ensureHeight(point.y);
    }
    if (current.tool === 'erase') {
      const segment = { ...current, points: current.points.slice(Math.max(0, previousLength - 1)) };
      for (const tile of tiles.values()) drawStroke(tile.baseContext, segment);
    } else if (current.tool === 'stroke') {
      const preview = eraseStrokes(current.preview, current.points.slice(Math.max(0, previousLength - 1)), current.width / 2);
      const changed = preview.length !== current.preview.length;
      current.preview = preview;
      if (changed) scheduledRender.schedule(true, true);
    } else {
      scheduledRender.schedule(true, false);
    }
  }

  pen.onclick = () => selectTool('pen');
  highlighter.onclick = () => selectTool('highlighter');
  fill.onchange = () => applySelectionProperty('fill', fill.checked);
  opacity.onchange = () => applySelectionProperty('opacity', Number(opacity.value) / 100);
  pan.onclick = () => selectTool('pan');
  eraser.onclick = () => selectTool(eraserStyle.value);
  shape.onclick = () => selectTool('shape');
  select.onclick = () => selectTool('select');
  penStyle.onchange = () => {
    if (selection) applySelectionProperty('style', penStyle.value);
    else selectTool('pen');
  };
  eraserStyle.onchange = () => selectTool(eraserStyle.value);
  shapeStyle.onchange = () => selectTool('shape');
  selectStyle.onchange = () => selectTool('select');
  zoomSelect.onchange = () => {
    setZoom(zoomSelect.value, viewport.clientWidth / 2, viewport.clientHeight / 2);
  };
  clear.onclick = () => {
    finishSpline();
    if (!strokes.length) return;
    remember();
    selection = null;
    strokes = [];
    stageHeight = A4_HEIGHT;
    save();
  };
  undo.onclick = () => {
    finishSpline();
    if (!undoStack.length) return;
    redoStack.push(strokes);
    selection = null;
    strokes = undoStack.pop();
    updateHistoryButtons();
    save();
  };
  redo.onclick = () => {
    finishSpline();
    if (!redoStack.length) return;
    undoStack.push(strokes);
    selection = null;
    strokes = redoStack.pop();
    updateHistoryButtons();
    save();
  };

  function saveShortcut(event) {
    if (!editor.contains(event.target)) return;
    const historyAction = getHistoryShortcut(event);
    const clipboardAction = getClipboardShortcut(event);
    if (clipboardAction && event.target === stage && !current) {
      event.preventDefault();
      event.stopPropagation();
      if (clipboardAction === 'copy') {
        if (!selection) return;
        clipboard = duplicateSelectedStrokes(strokes, selection.indices, { dx: 0, dy: 0 });
        pasteCount = 0;
      } else if (clipboard.length) {
        const offset = 16 * (pasteCount + 1);
        const copied = duplicateSelectedStrokes(clipboard, clipboard.map((stroke, index) => index), { dx: offset, dy: offset });
        if (!copied.length) return;
        remember();
        const firstIndex = strokes.length;
        strokes = [...strokes, ...copied];
        selection = {
          indices: copied.map((stroke, index) => firstIndex + index),
          bounds: getContentBounds(copied)
        };
        pasteCount++;
        save();
      }
    } else if (spline && event.target === stage && !current && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      finishSpline();
    } else if (spline && event.target === stage && !current && event.key === 'Backspace') {
      event.preventDefault();
      event.stopPropagation();
      if (spline.knots.length > 1) spline.knots.pop();
      spline.hover = null;
      renderVisible(true);
    } else if (selection && !current && event.target === stage && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault();
      event.stopPropagation();
      remember();
      strokes = strokes.filter((stroke, index) => !selection.indices.includes(index));
      selection = null;
      save();
    } else if (historyAction && !current) {
      event.preventDefault();
      event.stopPropagation();
      (historyAction === 'undo' ? undo : redo).click();
    } else if (event.key.toLowerCase() === 's' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      event.stopPropagation();
      void panel.context.save();
    }
  }
  function removeShortcut() {
    scheduledRender.cancel();
    flushPreview();
    editorClosed = true;
    window.removeEventListener('keydown', saveShortcut, true);
    window.removeEventListener('beforeunload', flushPreview);
    window.removeEventListener(favoriteColorsKey, syncFavorites);
    window.removeEventListener('storage', syncFavorites);
    disconnectSaveState();
    panel.context.pathChanged?.disconnect(onPathChanged);
    cell.disposed.disconnect(removeShortcut);
  }
  window.addEventListener('keydown', saveShortcut, true);
  window.addEventListener('beforeunload', flushPreview);
  panel.context.saveState?.connect(onSaveState);
  panel.context.pathChanged?.connect(onPathChanged);
  cell.disposed.connect(removeShortcut);
  done.onclick = () => {
    finishSpline();
    removeShortcut();
    cell.node.classList.remove('jd-editing');
    editor.remove();
    cell.rendered = false;
    cell.rendered = true;
  };
  editor.addEventListener('keydown', event => event.stopPropagation());
  stage.addEventListener('pointerdown', event => {
    if (current || (event.button !== 0 && event.button !== 1)) return;
    event.preventDefault();
    event.stopPropagation();
    stage.focus({ preventScroll: true });
    if (event.button === 1) {
      stage.setPointerCapture(event.pointerId);
      current = { tool: 'pan', startX: event.clientX, startY: event.clientY, scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop };
      return;
    }
    if (tool === 'shape' && shapeStyle.value === 'spline') {
      const point = documentPoint(event, true);
      if (spline?.knots.length > 1 && Math.hypot(point.x - spline.knots[0].x, point.y - spline.knots[0].y) <= 10 / zoom) {
        finishSpline(true);
        return;
      }
      if (!spline) spline = { knots: [], hover: null, stroke: { tool: 'pen', shape: true, style: penStyle.value, color: color.value, width: Number(width.value) * (inkTool === 'highlighter' ? 4 : 1), fill: fill.checked, opacity: Number(opacity.value) / 100, highlighter: inkTool === 'highlighter' } };
      spline.knots.push({ x: point.x, y: point.y, dx: 0, dy: 0 });
      spline.hover = null;
      current = { tool: 'spline' };
      stage.setPointerCapture(event.pointerId);
      ensureHeight(point.y);
      renderVisible(true);
      return;
    }
    stage.setPointerCapture(event.pointerId);
    if (tool === 'pan') {
      current = { tool: 'pan', startX: event.clientX, startY: event.clientY, scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop };
    } else if (tool === 'select') {
      const point = documentPoint(event, true);
      const bounds = selection?.bounds;
      const handle = event.target.dataset.transform;
      const padding = 6 / zoom;
      if (bounds && (handle || (point.x >= bounds.left - padding && point.x <= bounds.right + padding && point.y >= bounds.top - padding && point.y <= bounds.bottom + padding))) {
        const center = { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 };
        current = { tool: handle || 'move', start: point, center, bounds, preview: strokes, changed: false };
      } else {
        selection = null;
        updateSelectionBox();
        current = { tool: 'select', kind: selectStyle.value, points: [point] };
      }
    } else {
      const activeTool = ['shape', 'highlighter'].includes(tool) ? 'pen' : tool;
      current = {
        tool: activeTool,
        style: penStyle.value,
        color: color.value,
        width: getToolStrokeWidth(activeTool, Number(width.value), inkTool === 'highlighter'),
        ...(activeTool === 'pen' ? { fill: fill.checked, opacity: Number(opacity.value) / 100, highlighter: inkTool === 'highlighter' } : {}),
        ...(tool === 'shape' && shapeStyle.value !== 'spline' ? { shape: true, kind: shapeStyle.value } : {}),
        points: [documentPoint(event, true)]
      };
      if (activeTool === 'stroke') current.preview = eraseStrokes(strokes, current.points, current.width / 2);
      if (current.shape) current.start = current.points[0];
      ensureHeight(current.points[0].y);
      renderVisible(true, activeTool === 'erase' || activeTool === 'stroke');
    }
  });
  stage.addEventListener('pointermove', event => {
    if (['erase', 'stroke', 'white'].includes(tool)) {
      const viewportBounds = viewport.getBoundingClientRect();
      const inside = isPointInsideRect({ x: event.clientX, y: event.clientY }, viewportBounds);
      stage.classList.toggle('jd-erasing', inside);
      eraserCursor.hidden = !inside;
      if (!inside && current && stage.hasPointerCapture(event.pointerId)) {
        finish(event, false);
        return;
      }
      const bounds = stage.getBoundingClientRect();
      eraserCursor.style.width = eraserCursor.style.height = `${Number(width.value) * zoom}px`;
      eraserCursor.style.left = `${event.clientX - bounds.left}px`;
      eraserCursor.style.top = `${event.clientY - bounds.top}px`;
    }
    if (spline && !current) {
      spline.hover = documentPoint(event, true);
      scheduledRender.schedule(true, false);
      return;
    }
    if (!current || !stage.hasPointerCapture(event.pointerId)) return;
    event.preventDefault();
    if (current.tool === 'spline') {
      const point = documentPoint(event, true);
      const knot = spline.knots.at(-1);
      knot.dx = point.x - knot.x;
      knot.dy = point.y - knot.y;
      ensureHeight(point.y);
      scheduledRender.schedule(true, false);
      return;
    }
    if (current.tool === 'pan') {
      viewport.scrollLeft = current.scrollLeft + current.startX - event.clientX;
      viewport.scrollTop = current.scrollTop + current.startY - event.clientY;
      return;
    }
    if (['move', 'resize', 'rotate'].includes(current.tool)) {
      const point = documentPoint(event, true);
      let transform;
      if (current.tool === 'move') {
        transform = {
          dx: Math.max(-current.bounds.left, Math.min(A4_WIDTH - current.bounds.right, point.x - current.start.x)),
          dy: Math.max(-current.bounds.top, point.y - current.start.y)
        };
      } else if (current.tool === 'resize') {
        const anchor = { x: current.bounds.left, y: current.bounds.top };
        const startDistance = Math.hypot(current.start.x - anchor.x, current.start.y - anchor.y);
        const maxScale = (A4_WIDTH - anchor.x) / Math.max(current.bounds.right - anchor.x, 1);
        const scale = Math.max(0.05, Math.min(20, maxScale, Math.hypot(point.x - anchor.x, point.y - anchor.y) / Math.max(startDistance, 1)));
        transform = { ...anchor, scale };
      } else {
        const { x, y } = current.center;
        transform = { x, y, angle: Math.atan2(point.y - y, point.x - x) - Math.atan2(current.start.y - y, current.start.x - x) };
      }
      let preview = transformStrokes(strokes, selection.indices, transform);
      let bounds = getContentBounds(selection.indices.map(index => preview[index]));
      if (current.tool === 'rotate') {
        if (bounds.right - bounds.left > A4_WIDTH) return;
        const dx = bounds.left < 0 ? -bounds.left : Math.min(0, A4_WIDTH - bounds.right);
        const dy = Math.max(0, -bounds.top);
        if (dx || dy) {
          preview = transformStrokes(strokes, selection.indices, { ...transform, dx, dy });
          bounds = getContentBounds(selection.indices.map(index => preview[index]));
        }
      }
      current.preview = preview;
      current.changed = current.tool === 'move' ? Boolean(transform.dx || transform.dy) : current.tool === 'resize' ? Math.abs(transform.scale - 1) > 0.001 : Math.abs(transform.angle) > 0.001;
      ensureHeight(bounds.bottom);
      scheduledRender.schedule(true, true);
      return;
    }
    if (current.shape) {
      const point = documentPoint(event, true);
      current.points = createShapePoints(current.kind, current.start, point, current.width);
      ensureHeight(point.y);
      scheduledRender.schedule(true, false);
      return;
    }
    pushSamples(event);
  });
  function finish(event, includePoint = true) {
    if (!current || !stage.hasPointerCapture(event.pointerId)) return;
    scheduledRender.cancel();
    stage.releasePointerCapture(event.pointerId);
    if (current.tool === 'spline') {
      current = null;
      renderVisible(true);
      return;
    }
    if (current.tool === 'pan') {
      current = null;
      return;
    }
    const point = includePoint ? documentPoint(event) : null;
    if (['move', 'resize', 'rotate'].includes(current.tool)) {
      if (current.changed) {
        remember();
        strokes = current.preview;
        selection.bounds = getContentBounds(selection.indices.map(index => strokes[index]));
        current = null;
        save();
      } else {
        current = null;
        renderVisible(true);
      }
      return;
    }
    if (current.tool === 'select') {
      if (point) current.points.push(point);
      const region = current.kind === 'rectangle' ? createShapePoints('rectangle', current.points[0], current.points.at(-1)) : current.points;
      const indices = selectStrokes(strokes, region);
      selection = indices.length ? { indices, bounds: getContentBounds(indices.map(index => strokes[index])) } : null;
      current = null;
      renderVisible(true);
      return;
    }
    if (current.shape && point) current.points = createShapePoints(current.kind, current.start, point, current.width);
    else if (point) current.points.push(point);
    delete current.start;
    delete current.kind;
    remember();
    const completed = current;
    const addedStroke = completed.tool === 'stroke' ? null : completed;
    strokes = addedStroke ? [...strokes, addedStroke] : eraseStrokes(strokes, completed.points, completed.width / 2);
    current = null;
    save(addedStroke?.tool === 'erase' ? null : addedStroke);
  }
  stage.addEventListener('pointerup', finish);
  stage.addEventListener('pointerleave', () => {
    eraserCursor.hidden = true;
    stage.classList.remove('jd-erasing');
  });
  stage.addEventListener('pointercancel', event => {
    if (current?.tool === 'spline' && spline) {
      spline.knots.pop();
      if (!spline.knots.length) spline = null;
      current = null;
      renderVisible(true);
      return;
    }
    finish(event);
  });
  stage.addEventListener('dblclick', event => {
    event.stopPropagation();
    if (!spline) return;
    const last = spline.knots.at(-1);
    const previous = spline.knots.at(-2);
    if (previous && Math.hypot(last.x - previous.x, last.y - previous.y) <= 10 / zoom) spline.knots.pop();
    finishSpline();
  });
  viewport.addEventListener('wheel', event => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const levels = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
    const next = event.deltaY < 0 ? levels.find(level => level > zoom + 0.001) : levels.findLast(level => level < zoom - 0.001);
    if (!next) return;
    zoomSelect.value = String(next);
    const bounds = viewport.getBoundingClientRect();
    setZoom(String(next), event.clientX - bounds.left, event.clientY - bounds.top);
  }, { passive: false });
  viewport.addEventListener('scroll', () => {
    if (viewport.scrollTop + viewport.clientHeight >= stageHeight * zoom - 8) ensureHeight(stageHeight);
    scheduledRender.schedule();
  }, { passive: true });
  const resizeObserver = new ResizeObserver(() => {
    updateZoom();
  });
  resizeObserver.observe(viewport);
  cell.disposed.connect(() => resizeObserver.disconnect());
  selectTool('pen');
  updateHistoryButtons();
  zoomSelect.value = '1';
  rebuildIndex();
  updateZoom();
  if (!drawing.imageId || drawing.notebookPath !== panel.context.path) deferredSave.schedule();
}

function insertDrawing(panel, contents) {
  if (!panel?.model || panel.model.readOnly) return;
  const notebook = panel.content;
  const index = notebook.activeCellIndex + 1;
  notebook.model.sharedModel.insertCell(index, {
    cell_type: 'markdown',
    source: '',
    metadata: { [metadataKey]: { version: 2, width: A4_WIDTH, strokes: [] } }
  });
  notebook.activeCellIndex = index;
  const cell = notebook.activeCell;
  cell.rendered = true;
  createEditor(cell, panel, contents);
}

const plugin = {
  id: 'jupyter-draw:plugin',
  autoStart: true,
  requires: [INotebookTracker],
  optional: [ICommandPalette],
  activate: (app, tracker, palette) => {
    const contents = app.serviceManager.contents;
    app.commands.addCommand('jupyter-draw:insert', {
      label: 'Inserisci cella Draw',
      execute: () => insertDrawing(tracker.currentWidget, contents)
    });
    app.commands.addCommand('jupyter-draw:edit', {
      label: 'Modifica cella Draw',
      execute: () => {
        const panel = tracker.currentWidget;
        const cell = panel?.content.activeCell;
        if (cell && !panel.model?.readOnly) createEditor(cell, panel, contents);
      }
    });
    palette?.addItem({ command: 'jupyter-draw:insert', category: 'Draw' });
    palette?.addItem({ command: 'jupyter-draw:edit', category: 'Draw' });
    tracker.widgetAdded.connect((sender, panel) => {
      panel.toolbar.addItem('draw-insert', new ToolbarButton({ icon: addIcon, tooltip: 'Inserisci cella Draw', onClick: () => insertDrawing(panel, contents) }));
      panel.toolbar.addItem('draw-edit', new ToolbarButton({ icon: editIcon, tooltip: 'Modifica cella Draw selezionata', onClick: () => {
        if (!panel.model?.readOnly && panel.content.activeCell) createEditor(panel.content.activeCell, panel, contents);
      } }));
    });
  }
};

export default plugin;
// canvas.js - Handwriting Canvas Module (Supports Apple Pencil pressure, responsive scaling, lasso selection, and flood fill)

export class CanvasManager {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onSave = options.onSave || (() => {});
    this.isReadOnly = options.isReadOnly || false;
    
    this.isDrawing = false;
    this.paths = []; // Array of standard paths: { color, size, isEraser, points: [{x, y}] } OR fill paths: { type: 'fill', color, x, y }
    this.currentPath = null;
    
    this.brushColor = '#1e1e1e';
    this.brushSize = 4;
    this.isEraser = false;
    this.pencilOnly = false; // Prevent finger palm rejection

    // Lasso Selection States
    this.toolMode = 'draw'; // 'draw', 'erase', 'lasso', 'fill'
    this.selectedPaths = [];
    this.lassoPoints = [];
    this.isLassoing = false;
    this.selectionBox = null; // { minX, minY, maxX, maxY } relative values
    this.isMovingSelection = false;
    this.isScalingSelection = false;
    this.isRotatingSelection = false;
    this.initialAngle = 0;
    this.lastLassoPoints = [];
    this.redoStack = [];
    this.isFilling = false;
    this.fillPoints = [];
    this.layers = [
      { id: 'default', name: '手繪圖層 1', visible: true, locked: false },
      { id: 'text-media', name: '文字與媒體', visible: true, locked: false }
    ];
    this.activeLayerId = 'default';

    this.setupEvents();
    this.resizeCanvas();
  }

  // Set brushes settings
  setBrushColor(color) {
    this.brushColor = color;
    if (this.toolMode === 'erase') {
      this.toolMode = 'draw';
    }
  }

  setBrushSize(size) {
    this.brushSize = parseInt(size, 10);
  }

  setEraserMode(enabled) {
    this.toolMode = enabled ? 'erase' : 'draw';
    if (enabled) {
      this.clearSelection();
    }
  }

  setLassoMode(enabled) {
    this.toolMode = enabled ? 'lasso' : 'draw';
    if (!enabled) {
      this.clearSelection();
    }
  }

  setFillMode(enabled) {
    this.toolMode = enabled ? 'fill' : 'draw';
    if (enabled) {
      this.clearSelection();
    }
  }

  clearSelection() {
    this.selectedPaths = [];
    this.selectionBox = null;
    this.lastLassoPoints = [];
    const clearEvent = new CustomEvent('selection-cleared');
    this.canvas.dispatchEvent(clearEvent);
    this.drawAll();
  }

  fillSelection(color) {
    if (!this.lastLassoPoints || this.lastLassoPoints.length < 3) return;
    this.redoStack = []; // Clear redo stack on new action
    this.paths.push({
      type: 'polygon-fill',
      color: color || this.brushColor,
      points: [...this.lastLassoPoints],
      layerId: this.activeLayerId
    });
    this.clearSelection();
    this.onSave(this.paths);
  }

  undo() {
    if (this.paths.length === 0) return;
    const path = this.paths.pop();
    this.redoStack.push(path);
    this.clearSelection();
    this.drawAll();
    this.onSave(this.paths);
  }

  redo() {
    if (this.redoStack.length === 0) return;
    const path = this.redoStack.pop();
    this.paths.push(path);
    this.clearSelection();
    this.drawAll();
    this.onSave(this.paths);
  }

  hexToRgba(hex, alpha) {
    let h = hex || '#1e1e1e';
    if (!h.startsWith('#')) return h;
    let c = h.substring(1);
    if (c.length === 3) {
      c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    }
    const r = parseInt(c.substring(0, 2), 16) || 0;
    const g = parseInt(c.substring(2, 4), 16) || 0;
    const b = parseInt(c.substring(4, 6), 16) || 0;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // Load existing paths and draw
  loadPaths(paths) {
    const cleanPaths = [];
    let foundMeta = false;
    (paths || []).forEach(path => {
      if (path && path.type === 'layers-meta') {
        this.layers = path.layers;
        foundMeta = true;
      } else {
        cleanPaths.push(path);
      }
    });
    if (!foundMeta) {
      this.layers = [
        { id: 'default', name: '手繪圖層 1', visible: true, locked: false },
        { id: 'text-media', name: '文字與媒體', visible: true, locked: false }
      ];
    }
    this.paths = cleanPaths;

    // Ensure activeLayerId is valid and not 'text-media'
    const drawLayers = this.layers.filter(l => l.id !== 'text-media');
    if (!drawLayers.find(l => l.id === this.activeLayerId)) {
      this.activeLayerId = drawLayers[0] ? drawLayers[0].id : 'default';
    }

    this.clearSelection();

    // Dispatch event to app.js to sync the UI and DOM status
    this.canvas.dispatchEvent(new CustomEvent('layer-status-changed', {
      detail: { layers: this.layers }
    }));
  }

  getPaths() {
    const savePaths = JSON.parse(JSON.stringify(this.paths));
    savePaths.push({
      type: 'layers-meta',
      layers: this.layers
    });
    return savePaths;
  }

  clear() {
    this.paths = [];
    this.clearSelection();
    this.onSave(this.paths);
  }

  // Handle Resize and Retina screen density (Retina/iPad Pro support)
  resizeCanvas() {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    
    if (width === 0 || height === 0) return;

    // Set internal resolution based on device pixel ratio for ultra-sharp drawing
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    
    // Scale drawings
    this.ctx.resetTransform();
    this.ctx.scale(dpr, dpr);
    
    // Redraw
    this.drawAll();
  }

  // Draw all paths in memory
  drawAll() {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    
    this.ctx.clearRect(0, 0, width, height);

    if (width === 0 || height === 0) return;

    this.layers.forEach(layer => {
      if (layer.id === 'text-media') return; // Skip DOM layer on canvas
      if (!layer.visible) return; // Skip hidden layers

      this.ctx.save();
      this.ctx.globalAlpha = layer.opacity !== undefined ? layer.opacity : 1.0;

      this.paths.forEach(path => {
        const pathLayerId = path.layerId || 'default';
        if (pathLayerId !== layer.id) return;

        if (path.type === 'fill') {
          const rawX = Math.round(path.x * this.canvas.width);
          const rawY = Math.round(path.y * this.canvas.height);
          this.floodFill(rawX, rawY, path.color);
        } else {
          this.drawPath(path, width, height);
        }
      });

      this.ctx.restore();
    });

    // Draw Lasso Selection marquee outline and controls
    if (this.selectedPaths.length > 0 && this.selectionBox) {
      this.drawSelectionUI();
    }
    if (this.isLassoing && this.lassoPoints.length > 1) {
      this.drawLassoTrail();
    }
    if (this.isFilling && this.fillPoints.length > 1) {
      const ctx = this.ctx;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(this.fillPoints[0].x * width, this.fillPoints[0].y * height);
      for (let i = 1; i < this.fillPoints.length; i++) {
        ctx.lineTo(this.fillPoints[i].x * width, this.fillPoints[i].y * height);
      }
      ctx.closePath();
      
      // Draw semi-transparent preview (20% opacity)
      ctx.fillStyle = this.hexToRgba(this.brushColor, 0.2);
      ctx.fill();
      
      // Draw dashed outline
      ctx.strokeStyle = this.brushColor;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.restore();
    }
  }

  // Helper to draw a single path
  drawPath(path, width, height) {
    const ctx = this.ctx;

    if (path.type === 'polygon-fill') {
      if (!path.points || path.points.length < 3) return;
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.beginPath();
      ctx.moveTo(path.points[0].x * width, path.points[0].y * height);
      for (let i = 1; i < path.points.length; i++) {
        ctx.lineTo(path.points[i].x * width, path.points[i].y * height);
      }
      ctx.closePath();
      ctx.fillStyle = path.color || '#1e1e1e';
      ctx.fill();
      ctx.restore();
      return;
    }

    if (!path.points || path.points.length < 1) return;
    ctx.beginPath();
    
    const isPathSelected = this.selectedPaths.includes(path);
    
    if (path.isEraser) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1.0)';
      ctx.lineWidth = path.size * 3;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = isPathSelected ? '#8b5cf6' : (path.color || '#1e1e1e');
      ctx.lineWidth = path.size || 4;
    }
    
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    // Map relative coordinates to current dimensions
    const points = path.points.map(p => ({
      x: p.x * width,
      y: p.y * height
    }));

    if (points.length === 1) {
      ctx.arc(points[0].x, points[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();
      return;
    }

    ctx.moveTo(points[0].x, points[0].y);
    
    // Draw smooth quadratic curves instead of line segments
    for (let i = 1; i < points.length - 1; i++) {
      const xc = (points[i].x + points[i + 1].x) / 2;
      const yc = (points[i].y + points[i + 1].y) / 2;
      ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
    }
    
    ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    ctx.stroke();
    
    // Restore default composition
    ctx.globalCompositeOperation = 'source-over';
  }

  // Ray Casting Algorithm to check if point is inside Lasso Loop
  isPointInPolygon(x, y, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;
      
      const intersect = ((yi > y) !== (yj > y))
          && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  recalculateSelectionBox() {
    if (this.selectedPaths.length === 0) {
      this.selectionBox = null;
      return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    this.selectedPaths.forEach(path => {
      if (path.points) {
        path.points.forEach(pt => {
          if (pt.x < minX) minX = pt.x;
          if (pt.y < minY) minY = pt.y;
          if (pt.x > maxX) maxX = pt.x;
          if (pt.y > maxY) maxY = pt.y;
        });
      }
    });
    this.selectionBox = { minX, minY, maxX, maxY };
  }

  getSelectionScreenCoords() {
    if (!this.selectionBox) return null;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    
    const x = this.selectionBox.minX * width;
    const y = this.selectionBox.minY * height;
    const w = (this.selectionBox.maxX - this.selectionBox.minX) * width;
    const h = (this.selectionBox.maxY - this.selectionBox.minY) * height;
    
    const cx = x + w / 2;
    const cy = y + h / 2;
    
    const seHandle = { x: x + w, y: y + h };
    const rotateHandle = { x: cx, y: y - 24 };
    
    return { x, y, w, h, cx, cy, seHandle, rotateHandle };
  }

  drawSelectionUI() {
    const coords = this.getSelectionScreenCoords();
    if (!coords) return;
    
    const ctx = this.ctx;
    ctx.save();
    
    // Draw bounding box
    ctx.strokeStyle = '#8b5cf6';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(coords.x, coords.y, coords.w, coords.h);
    
    // Draw corner scale handle (SE)
    ctx.beginPath();
    ctx.setLineDash([]);
    ctx.arc(coords.seHandle.x, coords.seHandle.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#8b5cf6';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // Draw rotation handle (top)
    ctx.beginPath();
    ctx.arc(coords.rotateHandle.x, coords.rotateHandle.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#8b5cf6';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    
    // Draw connection line for rotate handle
    ctx.beginPath();
    ctx.moveTo(coords.cx, coords.y);
    ctx.lineTo(coords.rotateHandle.x, coords.rotateHandle.y + 6);
    ctx.strokeStyle = '#8b5cf6';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    
    ctx.restore();
  }

  drawLassoTrail() {
    if (this.lassoPoints.length < 2) return;
    const ctx = this.ctx;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    
    ctx.save();
    
    ctx.beginPath();
    ctx.moveTo(this.lassoPoints[0].x * width, this.lassoPoints[0].y * height);
    for (let i = 1; i < this.lassoPoints.length; i++) {
      ctx.lineTo(this.lassoPoints[i].x * width, this.lassoPoints[i].y * height);
    }
    
    ctx.strokeStyle = '#8b5cf6';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    
    ctx.restore();
  }

  // Pixel-level Flood Fill paint bucket algorithm
  floodFill(startX, startY, fillColorHex, tolerance = 32) {
    const canvas = this.canvas;
    const ctx = this.ctx;
    const width = canvas.width;
    const height = canvas.height;
    
    if (startX < 0 || startX >= width || startY < 0 || startY >= height) return;

    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    
    // Convert hex color to RGBA components
    const fillR = parseInt(fillColorHex.slice(1, 3), 16);
    const fillG = parseInt(fillColorHex.slice(3, 5), 16);
    const fillB = parseInt(fillColorHex.slice(5, 7), 16);
    const fillA = 255;
    
    const startIdx = (startY * width + startX) * 4;
    const targetR = data[startIdx];
    const targetG = data[startIdx+1];
    const targetB = data[startIdx+2];
    const targetA = data[startIdx+3];
    
    // Exit if target color is already extremely close to fill color to avoid infinite loops
    if (Math.abs(targetR - fillR) < 8 && 
        Math.abs(targetG - fillG) < 8 && 
        Math.abs(targetB - fillB) < 8 && 
        Math.abs(targetA - fillA) < 8) {
      return;
    }
    
    const queue = [[startX, startY]];
    const visited = new Uint8Array(width * height);
    
    const colorMatch = (idx) => {
      const r = data[idx];
      const g = data[idx+1];
      const b = data[idx+2];
      const a = data[idx+3];
      
      const dr = r - targetR;
      const dg = g - targetG;
      const db = b - targetB;
      const da = a - targetA;
      return Math.sqrt(dr*dr + dg*dg + db*db + da*da) <= tolerance;
    };
    
    while (queue.length > 0) {
      const [x, y] = queue.pop();
      if (x < 0 || x >= width || y < 0 || y >= height) continue;
      
      const offset = y * width + x;
      if (visited[offset]) continue;
      visited[offset] = 1;
      
      const idx = offset * 4;
      if (colorMatch(idx)) {
        data[idx] = fillR;
        data[idx+1] = fillG;
        data[idx+2] = fillB;
        data[idx+3] = fillA;
        
        queue.push([x + 1, y]);
        queue.push([x - 1, y]);
        queue.push([x, y + 1]);
        queue.push([x, y - 1]);
      }
    }
    
    ctx.putImageData(imgData, 0, 0);
  }

  // Event handler for Stylus, Touch, Mouse using PointerEvents
  setupEvents() {
    const handleStart = (e) => {
      if (this.isReadOnly) return;

      // Lock check: prevent drawing on a locked layer
      const activeLayer = this.layers.find(l => l.id === this.activeLayerId);
      if (activeLayer && activeLayer.locked) {
        alert(`圖層 "${activeLayer.name}" 已鎖定，請先解鎖後再進行編輯。`);
        return;
      }

      // Apple Pencil palm rejection (Only apply to draw/erase modes)
      if (this.pencilOnly && e.pointerType === 'touch' && (this.toolMode === 'draw' || this.toolMode === 'erase')) {
        return;
      }

      if (e.pointerType === 'pen' && !this.pencilOnly) {
        this.pencilOnly = true;
        const event = new CustomEvent('pencil-detected', { bubbles: true });
        this.canvas.dispatchEvent(event);
      }
      
      e.preventDefault();
      
      const rect = this.canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const x = px / rect.width;
      const y = py / rect.height;
      
      // Selection Handle Hit Detection
      if (this.selectedPaths.length > 0 && this.selectionBox) {
        const coords = this.getSelectionScreenCoords();
        if (coords) {
          // Rotate handle
          let dist = Math.hypot(px - coords.rotateHandle.x, py - coords.rotateHandle.y);
          if (dist < 15) {
            this.isRotatingSelection = true;
            this.initialAngle = Math.atan2(py - coords.cy, px - coords.cx);
            this.lastPointerPos = { x: px, y: py };
            return;
          }
          
          // SE scale handle
          dist = Math.hypot(px - coords.seHandle.x, py - coords.seHandle.y);
          if (dist < 15) {
            this.isScalingSelection = true;
            this.lastPointerPos = { x: px, y: py };
            return;
          }
          
          // Translation drag inside box
          if (px >= coords.x && px <= coords.x + coords.w && py >= coords.y && py <= coords.y + coords.h) {
            this.isMovingSelection = true;
            this.lastPointerPos = { x: px, y: py };
            return;
          }
          
          // Clicked outside active selection box
          this.clearSelection();
          if (this.toolMode !== 'lasso') return;
        }
      }

      if (this.toolMode === 'fill') {
        this.isFilling = true;
        this.fillPoints = [{ x, y }];
        this.drawAll();
        return;
      }

      if (this.toolMode === 'lasso') {
        this.isLassoing = true;
        this.lassoPoints = [{ x, y }];
        this.drawAll();
        return;
      }

      // Default: drawing or erasing
      this.redoStack = [];
      this.isDrawing = true;
      let size = this.brushSize;
      if (e.pointerType === 'pen' && e.pressure) {
        size = this.brushSize * (0.4 + e.pressure * 1.2);
      }

      this.currentPath = {
        color: this.brushColor,
        size: parseFloat(size.toFixed(1)),
        isEraser: this.toolMode === 'erase',
        points: [{ x: parseFloat(x.toFixed(4)), y: parseFloat(y.toFixed(4)) }],
        layerId: this.activeLayerId
      };
      
      this.paths.push(this.currentPath);
      this.drawAll();
    };

    const handleMove = (e) => {
      if (this.isReadOnly) return;
      if (this.pencilOnly && e.pointerType === 'touch' && (this.toolMode === 'draw' || this.toolMode === 'erase')) return;
      
      e.preventDefault();
      
      const rect = this.canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const x = px / rect.width;
      const y = py / rect.height;

      // Handle translation of selection
      if (this.isMovingSelection && this.selectionBox) {
        const dx = (px - this.lastPointerPos.x) / rect.width;
        const dy = (py - this.lastPointerPos.y) / rect.height;
        
        this.selectedPaths.forEach(path => {
          if (path.points) {
            path.points.forEach(pt => {
              pt.x += dx;
              pt.y += dy;
            });
          }
        });
        
        this.selectionBox.minX += dx;
        this.selectionBox.maxX += dx;
        this.selectionBox.minY += dy;
        this.selectionBox.maxY += dy;

        const moveEvent = new CustomEvent('selection-moved', {
          detail: { dx, dy, selectedPaths: this.selectedPaths }
        });
        this.canvas.dispatchEvent(moveEvent);

        this.lastPointerPos = { x: px, y: py };
        this.drawAll();
        return;
      }

      // Handle scaling of selection
      if (this.isScalingSelection && this.selectionBox) {
        const coords = this.getSelectionScreenCoords();
        if (coords) {
          const distCenterPrev = Math.hypot(this.lastPointerPos.x - coords.cx, this.lastPointerPos.y - coords.cy);
          const distCenterCurr = Math.hypot(px - coords.cx, py - coords.cy);
          const scale = distCenterPrev > 0 ? (distCenterCurr / distCenterPrev) : 1.0;
          
          const relCX = coords.cx / rect.width;
          const relCY = coords.cy / rect.height;

          this.selectedPaths.forEach(path => {
            if (path.points) {
              path.points.forEach(pt => {
                pt.x = relCX + (pt.x - relCX) * scale;
                pt.y = relCY + (pt.y - relCY) * scale;
              });
            }
          });

          // Scale bounding box coordinates
          const boxW = (this.selectionBox.maxX - this.selectionBox.minX) * scale;
          const boxH = (this.selectionBox.maxY - this.selectionBox.minY) * scale;
          this.selectionBox.minX = relCX - boxW / 2;
          this.selectionBox.maxX = relCX + boxW / 2;
          this.selectionBox.minY = relCY - boxH / 2;
          this.selectionBox.maxY = relCY + boxH / 2;

          const scaleEvent = new CustomEvent('selection-scaled', {
            detail: { scale, cx: relCX, cy: relCY, selectedPaths: this.selectedPaths }
          });
          this.canvas.dispatchEvent(scaleEvent);

          this.lastPointerPos = { x: px, y: py };
          this.drawAll();
        }
        return;
      }

      // Handle rotation of selection
      if (this.isRotatingSelection && this.selectionBox) {
        const coords = this.getSelectionScreenCoords();
        if (coords) {
          const angleCurr = Math.atan2(py - coords.cy, px - coords.cx);
          const angleDiff = angleCurr - this.initialAngle;
          
          const relCX = coords.cx / rect.width;
          const relCY = coords.cy / rect.height;

          const cos = Math.cos(angleDiff);
          const sin = Math.sin(angleDiff);

          this.selectedPaths.forEach(path => {
            if (path.points) {
              path.points.forEach(pt => {
                const rx = pt.x - relCX;
                const ry = pt.y - relCY;
                pt.x = relCX + (rx * cos - ry * sin);
                pt.y = relCY + (rx * sin + ry * cos);
              });
            }
          });

          this.recalculateSelectionBox();

          const rotateEvent = new CustomEvent('selection-rotated', {
            detail: { angle: angleDiff, cx: relCX, cy: relCY, selectedPaths: this.selectedPaths }
          });
          this.canvas.dispatchEvent(rotateEvent);

          this.initialAngle = angleCurr;
          this.drawAll();
        }
        return;
      }

      if (this.isFilling) {
        this.fillPoints.push({ x, y });
        this.drawAll();
        return;
      }

      if (this.isLassoing) {
        this.lassoPoints.push({ x, y });
        this.drawAll();
        return;
      }

      if (this.isDrawing && this.currentPath) {
        const lastPoint = this.currentPath.points[this.currentPath.points.length - 1];
        const dx = x - lastPoint.x;
        const dy = y - lastPoint.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist > 0.002) {
          this.currentPath.points.push({
            x: parseFloat(x.toFixed(4)),
            y: parseFloat(y.toFixed(4))
          });
          this.drawAll();
        }
      }
    };

    const handleEnd = (e) => {
      if (e.type === 'pointercancel' && e.pointerType === 'touch') {
        return;
      }

      if (this.isMovingSelection || this.isScalingSelection || this.isRotatingSelection) {
        this.isMovingSelection = false;
        this.isScalingSelection = false;
        this.isRotatingSelection = false;
        this.onSave(this.paths);
        return;
      }

      if (this.isFilling) {
        this.isFilling = false;
        if (this.fillPoints.length > 2) {
          this.redoStack = [];
          this.paths.push({
            type: 'polygon-fill',
            color: this.brushColor,
            points: [...this.fillPoints],
            layerId: this.activeLayerId
          });
          this.onSave(this.paths);
        }
        this.fillPoints = [];
        this.drawAll();
        return;
      }

      if (this.isLassoing) {
        this.isLassoing = false;
        this.selectedPaths = [];
        
        if (this.lassoPoints.length > 2) {
          this.lastLassoPoints = [...this.lassoPoints];

          this.paths.forEach(path => {
            if (path.type === 'fill' || !path.points) return;
            let insideCount = 0;
            path.points.forEach(pt => {
              if (this.isPointInPolygon(pt.x, pt.y, this.lassoPoints)) {
                insideCount++;
              }
            });
            const threshold = Math.max(1, Math.floor(path.points.length * 0.2));
            if (insideCount >= threshold) {
              this.selectedPaths.push(path);
            }
          });

          if (this.selectedPaths.length > 0) {
            this.recalculateSelectionBox();
          }
          
          // Dispatch lasso selection event for app.js (so it can select matching text nodes AND display the fill button!)
          const selectEvent = new CustomEvent('lasso-selected', {
            detail: { lassoPoints: this.lassoPoints, selectedPaths: this.selectedPaths }
          });
          this.canvas.dispatchEvent(selectEvent);
        }
        
        this.lassoPoints = [];
        this.drawAll();
        return;
      }
      
      if (this.isDrawing) {
        this.isDrawing = false;
        this.currentPath = null;
        this.onSave(this.paths);
      }
    };

    // Attach PointerEvent listeners
    this.canvas.addEventListener('pointerdown', handleStart);
    this.canvas.addEventListener('pointermove', handleMove);
    this.canvas.addEventListener('pointerup', handleEnd);
    this.canvas.addEventListener('pointercancel', handleEnd);

    // Prevent Safari default touch guestures on canvas
    this.canvas.addEventListener('touchstart', (e) => {
      if (this.isReadOnly) return;
      e.preventDefault();
    }, { passive: false });

    this.canvas.addEventListener('touchmove', (e) => {
      if (this.isReadOnly) return;
      e.preventDefault();
    }, { passive: false });
    
    // Observe layout resizing
    const resizeObserver = new ResizeObserver(() => {
      if (this.canvas.clientWidth > 0 && this.canvas.clientHeight > 0) {
        this.resizeCanvas();
      }
    });
    resizeObserver.observe(this.canvas);
  }
}

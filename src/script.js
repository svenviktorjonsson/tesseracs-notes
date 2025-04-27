// File: ./graph-editor.js
import { formatStringToMathDisplay, renderStringToElement } from './utils/katex.js';
import katex from 'katex';
import { sqrDist, distToSegmentSquared, rotatePoint } from './utils/math.js';
import { generateId } from './utils/general.js';
import { Graph } from './graph.js';
import { TextBox } from './text-box.js'; // Import TextBox

document.addEventListener('DOMContentLoaded', () => {
  class GraphEditor {
    constructor() {
      this.body = document.body;
      this.selectionRectElem = document.getElementById('selectionRect');
      this.canvas = document.getElementById('mainCanvas');
      this.ctx = this.canvas.getContext('2d');
      this.colorPicker = document.getElementById('colorPicker');
      this.lineWidthPicker = document.getElementById('lineWidthPicker');
      this.fontSizeInput = document.getElementById('fontSizeInput');
      this.toolbar = document.getElementById('toolbar');
      this.nodeHandlesContainer = document.getElementById('nodeHandlesContainer');
      this.snapIndicatorElem = document.getElementById('snapIndicatorElem');
      this.rotateHandleIconElem = document.getElementById('rotateHandleIcon');
      this.scaleHandleIconElem = document.getElementById('scaleHandleIcon');
            this.textBoxContainer = document.getElementById('textBoxContainer') || this.body; // Container for text boxes

      this.DRAG_THRESHOLD = 5;
      this.NODE_HIT_THRESHOLD = 8;
      this.EDGE_HIT_THRESHOLD = 5;
      this.MAX_HISTORY = 50;
      this.HANDLE_ICON_SIZE = 16;
      this.HANDLE_VISUAL_OFFSET = this.HANDLE_ICON_SIZE * 1.5;
      this.MIN_FONT_SIZE = 1;
      this.MAX_FONT_SIZE = 400;
      this.MIN_SCALE = 0.05;

      this.graph = new Graph();
      this.textBoxRegistry = new Map(); // Stores TextBox instances

      this.selectedTextBoxes = new Set(); // Stores TextBox instances
      this.activeComponentData = new Map();
      this.selectedNodes = new Set();
      this.selectedEdges = new Set();
      this.elementSelectionActiveForComponentId = null;
      this.selectionLevel = 'component';

      this.activeTextBox = null; // Stores the active TextBox instance
      this.mouseOverBox = null; // Stores the hovered TextBox instance
      this.mouseOverNodeId = null;
      this.mouseOverEdgeId = null;

      this.isDraggingItems = false;
      this.isDraggingNodes = false;
      this.isDrawing = false;
      this.isSelecting = false;
      this.isRotating = false;
      this.isScaling = false;

      this.potentialNodeHandleClick = false;
      this.potentialGraphElementClick = false;
      this.clickedElementInfo = null;
      this.potentialRightClick = false;
      this.potentialTransformHandleClick = null;
      this.potentialDragTarget = null;

      this.dragStartMousePos = { x: 0, y: 0 };
      this.selectionStartPos = { x: 0, y: 0 };
      this.dragStartStates = [];

      this.scaleRotateCenter = { x: 0, y: 0 };
      this.initialBBox = null;
      this.selectionRotationAngle = 0;

      this.startAngle = 0;
      this.startDistanceInfo = { dist: 0, vec: { x: 0, y: 0 } };
      this.currentRotationAngle = 0;
      this.currentScaleFactor = 1;
      this.currentScaleFactorX = 1;
      this.currentScaleFactorY = 1;
      this.currentDragTargetAngle = 0;

      this.drawingMode = 'freehand';
      this.currentDrawingStartNodeId = null;
      this.currentDrawingLastNodeId = null;
      this.currentTempNodes = [];
      this.currentTempEdges = [];

      this.isAltDrawing = false;
      this.altDrawingSourceNodeId = null;
      this.altPreviewSourceNodeIds = new Set();

      this.mouseDownButton = -1;
      this.lastMousePos = { x: 0, y: 0 };
      this.isCtrlDown = false;
      this.isShiftDown = false;
      this.isAltDown = false;

      this.currentColor = '#000000';
      this.currentLineWidth = 2;
      this.currentFontSize = '16px';

      this.snapTargetNode = null;

      this.undoStack = [];
      this.redoStack = [];

            // Utils needed by TextBox
            this.textBoxUtils = {
                formatStringToMathDisplay,
                renderStringToElement,
                rotatePoint,
                moveCaretToEnd: this.moveCaretToEnd
            };

      this.init();
    }

    moveCaretToEnd(element) { if (!element || typeof window.getSelection === 'undefined' || !element.isContentEditable) return; const range = document.createRange(); const selection = window.getSelection(); if (document.activeElement !== element) { element.focus({ preventScroll: true }); } setTimeout(() => { if (document.activeElement === element && element.isContentEditable) { try { range.selectNodeContents(element); range.collapse(false); selection.removeAllRanges(); selection.addRange(range); } catch (e) { console.error("Error moving caret:", e); } } }, 0); }
    getNodeAtPoint(point, threshold = this.NODE_HIT_THRESHOLD) { const thresholdSq = threshold * threshold; for (const node of this.graph.getAllNodes()) { if (sqrDist(point, node) <= thresholdSq) return node; } return null; }
    getEdgeAtPoint(point, threshold = this.EDGE_HIT_THRESHOLD) { const thresholdSq = threshold * threshold; const edges = this.graph.getAllEdges().reverse(); for (const edge of edges) { const n1 = this.graph.getNode(edge.node1Id); const n2 = this.graph.getNode(edge.node2Id); if (n1 && n2) { if (distToSegmentSquared(point, n1, n2) <= thresholdSq + (edge.lineWidth || 1)) { return edge; } } } return null; }
    findConnectedComponent(startElementId, elementType) { if (elementType === 'text') { const textBox = this.textBoxRegistry.get(startElementId); return { componentNodes: new Set(), componentEdges: new Set(), representativeId: textBox ? textBox.id : null }; } return this.graph.findConnectedComponent(startElementId, elementType); } // Adjusted for text
    getComponentIdForElement(elementId, elementType) { if(elementType === 'text') return elementId; let foundKey = null; this.activeComponentData.forEach((data, key) => { if ((elementType === 'node' && data.componentNodes.has(elementId)) || (elementType === 'edge' && data.componentEdges.has(elementId))) { foundKey = key; } }); if (foundKey) return foundKey; const { representativeId } = this.findConnectedComponent(elementId, elementType); return representativeId; }
    setDrawingState(drawing, mode) { this.isDrawing = drawing; this.drawingMode = mode; }

    getCombinedBoundingBox(nodeIds, textBoxIds) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      let elementCount = 0;
      const PADDING = 2;
      nodeIds.forEach(nodeId => {
        const node = this.graph.getNode(nodeId);
        if (node) {
          minX = Math.min(minX, node.x); minY = Math.min(minY, node.y); maxX = Math.max(maxX, node.x); maxY = Math.max(maxY, node.y); elementCount++;
        }
      });
      textBoxIds.forEach(boxId => {
        const box = this.textBoxRegistry.get(boxId);
        if (box) {
          const corners = box.getRotatedCorners();
          if (corners) {
            [corners.tl, corners.tr, corners.br, corners.bl].forEach(p => {
              minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
            });
            elementCount++;
          }
        }
      });
      if (elementCount === 0) return null;
      const finalMinX = minX - PADDING; const finalMinY = minY - PADDING; const finalMaxX = maxX + PADDING; const finalMaxY = maxY + PADDING; const finalWidth = Math.max(0, finalMaxX - finalMinX); const finalHeight = Math.max(0, finalMaxY - finalMinY);
      return { minX: finalMinX, minY: finalMinY, maxX: finalMaxX, maxY: finalMaxY, centerX: finalMinX + finalWidth / 2, centerY: finalMinY + finalHeight / 2, width: finalWidth, height: finalHeight };
    }

    getSelectionBoundingBox() {
      const nodeIds = new Set(); const textBoxIds = new Set();
      if (this.selectionLevel === 'component') {
        this.activeComponentData.forEach(compData => { compData.componentNodes.forEach(nid => nodeIds.add(nid)); });
        this.selectedTextBoxes.forEach(box => textBoxIds.add(box.id));
      }
      if (nodeIds.size > 0 || textBoxIds.size > 0) { return this.getCombinedBoundingBox(nodeIds, textBoxIds); } return null;
    }

    updateTransformHandles() {
      const rotateHandle = this.rotateHandleIconElem; const scaleHandle = this.scaleHandleIconElem; const isAnySelectionActive = this.selectionLevel === 'component' && (this.activeComponentData.size > 0 || this.selectedTextBoxes.size > 0); const isWritingMode = !!this.activeTextBox;
      if (isWritingMode || !isAnySelectionActive || this.isDrawing || this.isSelecting || this.selectionLevel === 'element') { rotateHandle.style.display = 'none'; scaleHandle.style.display = 'none'; return; }
      let refBoxWidth, refBoxHeight, centerForTransform, rotationForTransform;
      if (this.isRotating || this.isScaling) {
        if (!this.dragStartStates.length || !this.dragStartStates[0].startBBox || !this.dragStartStates[0].startCenter) { rotateHandle.style.display = 'none'; scaleHandle.style.display = 'none'; return; }
        const startBBox = this.dragStartStates[0].startBBox; const startCenter = this.dragStartStates[0].startCenter; const startGroupRotation = this.dragStartStates[0].startGroupRotation ?? 0;
        centerForTransform = startCenter; rotationForTransform = startGroupRotation + (this.isRotating ? this.currentRotationAngle : 0);
        const scaleX = this.currentScaleFactorX; const scaleY = this.currentScaleFactorY;
        if (startBBox.width < 0 || startBBox.height < 0) { rotateHandle.style.display = 'none'; scaleHandle.style.display = 'none'; return; }
        refBoxWidth = startBBox.width * Math.abs(scaleX); refBoxHeight = startBBox.height * Math.abs(scaleY);
      } else {
        const usePersistentState = this.initialBBox && this.initialBBox.width >= 0 && this.initialBBox.height >= 0 && this.scaleRotateCenter.x !== 0 && this.scaleRotateCenter.y !== 0;
        const isSingleTextBoxSelected = this.selectedTextBoxes.size === 1 && this.activeComponentData.size === 0;
        if (isSingleTextBoxSelected && !usePersistentState) {
          const textBox = this.selectedTextBoxes.values().next().value; const corners = textBox.getRotatedCorners(); const rect = textBox.getDOMRect();
          if (!corners || !rect || rect.width <= 0 || rect.height <= 0) { rotateHandle.style.display = 'none'; scaleHandle.style.display = 'none'; return; }
          refBoxWidth = rect.width; refBoxHeight = rect.height; centerForTransform = corners.center; rotationForTransform = textBox.rotation ?? 0;
          this.initialBBox = this.getCombinedBoundingBox(new Set(), new Set([textBox.id]));
          if(this.initialBBox) { this.scaleRotateCenter = { x: this.initialBBox.centerX, y: this.initialBBox.centerY }; this.selectionRotationAngle = rotationForTransform; }
          else { this.scaleRotateCenter = corners.center; this.selectionRotationAngle = rotationForTransform; this.initialBBox = {centerX: corners.center.x, centerY: corners.center.y, width: refBoxWidth, height: refBoxHeight, minX: corners.center.x - refBoxWidth/2, minY: corners.center.y - refBoxHeight/2, maxX: corners.center.x + refBoxWidth/2, maxY: corners.center.y + refBoxHeight/2 }; }
        } else if (usePersistentState) {
          refBoxWidth = this.initialBBox.width; refBoxHeight = this.initialBBox.height; centerForTransform = this.scaleRotateCenter; rotationForTransform = this.selectionRotationAngle;
        } else {
          const currentBBox = this.getSelectionBoundingBox();
          if (!currentBBox || currentBBox.width < 0 || currentBBox.height < 0) { rotateHandle.style.display = 'none'; scaleHandle.style.display = 'none'; return; }
          refBoxWidth = currentBBox.width; refBoxHeight = currentBBox.height; centerForTransform = { x: currentBBox.centerX, y: currentBBox.centerY }; rotationForTransform = 0;
          this.initialBBox = currentBBox; this.scaleRotateCenter = centerForTransform; this.selectionRotationAngle = rotationForTransform;
        }
      }
      const halfWidth = refBoxWidth / 2; const halfHeight = refBoxHeight / 2;
      let relativeCorners = [ { x: -halfWidth, y: -halfHeight }, { x: halfWidth, y: -halfHeight }, { x: halfWidth, y: halfHeight }, { x: -halfWidth, y: halfHeight } ];
      const visScaleX = this.isScaling ? this.currentScaleFactorX : 1; const visScaleY = this.isScaling ? this.currentScaleFactorY : 1;
      if (visScaleX < 0) { relativeCorners = relativeCorners.map(p => ({ x: -p.x, y: p.y })); } if (visScaleY < 0) { relativeCorners = relativeCorners.map(p => ({ x: p.x, y: -p.y })); }
      const visualCorners = { tl: rotatePoint({ x: centerForTransform.x + relativeCorners[0].x, y: centerForTransform.y + relativeCorners[0].y }, centerForTransform, rotationForTransform), tr: rotatePoint({ x: centerForTransform.x + relativeCorners[1].x, y: centerForTransform.y + relativeCorners[1].y }, centerForTransform, rotationForTransform), br: rotatePoint({ x: centerForTransform.x + relativeCorners[2].x, y: centerForTransform.y + relativeCorners[2].y }, centerForTransform, rotationForTransform), bl: rotatePoint({ x: centerForTransform.x + relativeCorners[3].x, y: centerForTransform.y + relativeCorners[3].y }, centerForTransform, rotationForTransform) };
      const handleHalfSize = this.HANDLE_ICON_SIZE / 2;
      const rotateHandleCenterX = visualCorners.tr.x; const rotateHandleCenterY = visualCorners.tr.y; rotateHandle.style.left = `${rotateHandleCenterX - handleHalfSize}px`; rotateHandle.style.top = `${rotateHandleCenterY - handleHalfSize}px`; rotateHandle.style.display = 'block';
      const scaleHandleCenterX = visualCorners.br.x; const scaleHandleCenterY = visualCorners.br.y; scaleHandle.style.left = `${scaleHandleCenterX - handleHalfSize}px`; scaleHandle.style.top = `${scaleHandleCenterY - handleHalfSize}px`; scaleHandle.style.display = 'block';
    }

    updateCursorBasedOnContext() {
      const targetElement = document.elementFromPoint(this.lastMousePos.x, this.lastMousePos.y);
            const targetTextBoxElement = targetElement?.closest('.textBox'); // Find closest TextBox ancestor
            const targetTextBoxInstance = targetTextBoxElement ? this.textBoxRegistry.get(targetTextBoxElement.dataset.id) : null;

      if (this.isRotating || this.isScaling || this.isDraggingNodes) { this.body.style.cursor = 'grabbing'; return; }
      if (this.isDraggingItems) { this.body.style.cursor = 'move'; return; }
      if (this.isDrawing || (this.isAltDown && !this.isAltDrawing) || this.isAltDrawing) { this.body.style.cursor = 'crosshair'; return; }
      if (this.isSelecting && !this.potentialRightClick) { this.body.style.cursor = 'default'; return; }
      if (targetElement === this.rotateHandleIconElem || targetElement === this.scaleHandleIconElem) { this.body.style.cursor = 'grab'; return; }
      let cursorStyle = 'default';
      if (targetTextBoxInstance) {
        cursorStyle = (targetTextBoxInstance === this.activeTextBox && targetTextBoxInstance.isEditing) ? 'text' : 'pointer';
      } else if (this.selectionLevel === 'element' && this.elementSelectionActiveForComponentId && (this.mouseOverNodeId || this.mouseOverEdgeId)) {
        cursorStyle = 'pointer';
      } else if (this.selectionLevel === 'component' && (this.mouseOverNodeId || this.mouseOverEdgeId || this.mouseOverBox)) {
        cursorStyle = 'pointer';
      }
      this.body.style.cursor = cursorStyle;
    }

    resizeCanvas() { this.canvas.width = window.innerWidth; this.canvas.height = window.innerHeight; this.redrawCanvas(); this.updateNodeHandles(); this.updateTransformHandles(); }
    drawEdge(edge, isSelected = false, isHovered = false) { const n1 = this.graph.getNode(edge.node1Id); const n2 = this.graph.getNode(edge.node2Id); if (!n1 || !n2) return; this.ctx.beginPath(); this.ctx.strokeStyle = edge.color; this.ctx.lineWidth = edge.lineWidth; this.ctx.lineJoin = 'round'; this.ctx.lineCap = 'round'; this.ctx.moveTo(n1.x, n1.y); this.ctx.lineTo(n2.x, n2.y); this.ctx.stroke(); const componentId = this.getComponentIdForElement(edge.id, 'edge'); const isElementSelected = this.selectionLevel === 'element' && this.selectedEdges.has(edge.id) && this.elementSelectionActiveForComponentId === componentId; const isComponentSelected = this.selectionLevel === 'component' && this.activeComponentData.has(componentId); const isFocusedElementComponent = this.selectionLevel === 'element' && this.elementSelectionActiveForComponentId === componentId; let showHighlight = false; let highlightColor = 'gray'; let highlightWidth = edge.lineWidth + 2; let highlightAlpha = 0.4; if (isElementSelected) { showHighlight = true; highlightColor = 'blue'; highlightWidth = edge.lineWidth + 3; highlightAlpha = 0.5; } else if (isComponentSelected && this.selectionLevel === 'component') {} else if (isFocusedElementComponent && !isElementSelected) { showHighlight = true; highlightColor = 'dodgerblue'; highlightWidth = edge.lineWidth + 2; highlightAlpha = 0.4; } if (isHovered && !showHighlight && this.selectionLevel === 'element' && isFocusedElementComponent) { showHighlight = true; highlightColor = 'blue'; highlightWidth = edge.lineWidth + 3; highlightAlpha = 0.5; } if (showHighlight) { this.ctx.beginPath(); this.ctx.strokeStyle = highlightColor; this.ctx.lineWidth = highlightWidth; this.ctx.globalAlpha = highlightAlpha; this.ctx.moveTo(n1.x, n1.y); this.ctx.lineTo(n2.x, n2.y); this.ctx.stroke(); this.ctx.globalAlpha = 1.0; } }
    drawNodeHighlight(node, isHovered = false) { if (!node || !isHovered || this.selectionLevel === 'component') return; if (!this.isDrawing && !this.isDraggingNodes && !this.isDraggingItems && this.mouseDownButton === -1) { this.ctx.beginPath(); this.ctx.strokeStyle = '#aaa'; this.ctx.lineWidth = 1; this.ctx.setLineDash([2,2]); this.ctx.arc(node.x, node.y, this.NODE_HIT_THRESHOLD * 1.2, 0, Math.PI * 2); this.ctx.stroke(); this.ctx.setLineDash([]); } }
    drawRotatedRect(corners, color = 'blue', dash = [4, 4]) { if (!corners || !corners.tl || !corners.tr || !corners.br || !corners.bl) return; this.ctx.save(); this.ctx.strokeStyle = color; this.ctx.lineWidth = 1; if (dash && dash.length > 0) this.ctx.setLineDash(dash); else this.ctx.setLineDash([]); this.ctx.beginPath(); this.ctx.moveTo(corners.tl.x, corners.tl.y); this.ctx.lineTo(corners.tr.x, corners.tr.y); this.ctx.lineTo(corners.br.x, corners.br.y); this.ctx.lineTo(corners.bl.x, corners.bl.y); this.ctx.closePath(); this.ctx.stroke(); this.ctx.restore(); }

    redrawCanvas() {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); const isWritingMode = !!this.activeTextBox;
      this.graph.getAllEdges().forEach(edge => { const isHovered = !this.isDrawing && !this.isDraggingNodes && !this.isDraggingItems && this.mouseOverEdgeId === edge.id && this.mouseDownButton === -1; this.drawEdge(edge, false, isHovered); });
      this.graph.getAllNodes().forEach(node => { const isHovered = !this.isDrawing && !this.isDraggingNodes && !this.isDraggingItems && this.mouseOverNodeId === node.id && this.mouseDownButton === -1; this.drawNodeHighlight(node, isHovered); });
      const isAnyComponentSelectionActive = this.selectionLevel === 'component' && (this.activeComponentData.size > 0 || this.selectedTextBoxes.size > 0);
      if (isAnyComponentSelectionActive && !isWritingMode) {
        let cornersToDraw = null; let dashStyle = [4, 4]; let colorStyle = 'blue';
        if (this.isScaling) {
          if (this.dragStartStates.length > 0 && this.dragStartStates[0].startBBox && this.dragStartStates[0].startCenter) {
            const startBBox = this.dragStartStates[0].startBBox; const centerToUse = this.dragStartStates[0].startCenter; const angleToDraw = this.dragStartStates[0].startGroupRotation ?? 0; const cursorPos = this.lastMousePos;
            if(startBBox.width >= 0 && startBBox.height >= 0) {
              const mouseRel = { x: cursorPos.x - centerToUse.x, y: cursorPos.y - centerToUse.y };
              const cosA = Math.cos(-angleToDraw); const sinA = Math.sin(-angleToDraw); const mouseRelLocal = { x: mouseRel.x * cosA - mouseRel.y * sinA, y: mouseRel.x * sinA + mouseRel.y * cosA };
              const newHalfWidthLocal = mouseRelLocal.x; const newHalfHeightLocal = mouseRelLocal.y;
              const local_TL = { x: -newHalfWidthLocal, y: -newHalfHeightLocal }; const local_TR = { x: newHalfWidthLocal, y: -newHalfHeightLocal }; const local_BR = { x: newHalfWidthLocal, y: newHalfHeightLocal }; const local_BL = { x: -newHalfWidthLocal, y: newHalfHeightLocal };
              cornersToDraw = { tl: rotatePoint({ x: centerToUse.x + local_TL.x, y: centerToUse.y + local_TL.y }, centerToUse, angleToDraw), tr: rotatePoint({ x: centerToUse.x + local_TR.x, y: centerToUse.y + local_TR.y }, centerToUse, angleToDraw), br: rotatePoint({ x: centerToUse.x + local_BR.x, y: centerToUse.y + local_BR.y }, centerToUse, angleToDraw), bl: rotatePoint({ x: centerToUse.x + local_BL.x, y: centerToUse.y + local_BL.y }, centerToUse, angleToDraw) }; colorStyle = 'dodgerblue';
            }
          }
        } else {
          let boxToDraw = null; let angleToDraw = 0; let centerToUse = null; let visualScaleX = 1; let visualScaleY = 1;
          if (this.isRotating) {
            if (this.dragStartStates.length > 0 && this.dragStartStates[0].startBBox && this.dragStartStates[0].startCenter) {
              const startBBox = this.dragStartStates[0].startBBox; centerToUse = this.dragStartStates[0].startCenter; const startGroupRotation = this.dragStartStates[0].startGroupRotation ?? 0; angleToDraw = startGroupRotation + this.currentRotationAngle;
              visualScaleX = this.currentScaleFactorX; visualScaleY = this.currentScaleFactorY;
              boxToDraw = { centerX: centerToUse.x, centerY: centerToUse.y, width: startBBox.width * Math.abs(visualScaleX), height: startBBox.height * Math.abs(visualScaleY) }; dashStyle = [4, 4]; colorStyle = 'dodgerblue';
            }
          } else if (this.isDraggingNodes || this.isDraggingItems) {
            const usePersistentState = this.initialBBox && this.initialBBox.width >= 0 && this.initialBBox.height >= 0 && this.scaleRotateCenter.x !== 0 && this.scaleRotateCenter.y !== 0;
            if (usePersistentState) { boxToDraw = { centerX: this.scaleRotateCenter.x, centerY: this.scaleRotateCenter.y, width: this.initialBBox.width, height: this.initialBBox.height }; centerToUse = this.scaleRotateCenter; angleToDraw = this.selectionRotationAngle; dashStyle = [4, 4]; colorStyle = 'dodgerblue'; }
            else { const currentBBox = this.getSelectionBoundingBox(); if (currentBBox && currentBBox.width >= 0 && currentBBox.height >= 0) { boxToDraw = { ...currentBBox }; centerToUse = { x: currentBBox.centerX, y: currentBBox.centerY }; angleToDraw = 0; dashStyle = [4, 4]; colorStyle = 'dodgerblue'; } }
          } else {
            const usePersistentState = this.initialBBox && this.initialBBox.width >= 0 && this.initialBBox.height >= 0 && this.scaleRotateCenter.x !== 0 && this.scaleRotateCenter.y !== 0;
            if (usePersistentState) { boxToDraw = { centerX: this.scaleRotateCenter.x, centerY: this.scaleRotateCenter.y, width: this.initialBBox.width, height: this.initialBBox.height }; centerToUse = this.scaleRotateCenter; angleToDraw = this.selectionRotationAngle; dashStyle = [4, 4]; colorStyle = 'blue'; }
            else { const currentBBox = this.getSelectionBoundingBox(); if (currentBBox && currentBBox.width >= 0 && currentBBox.height >= 0) { boxToDraw = { ...currentBBox }; centerToUse = { x: currentBBox.centerX, y: currentBBox.centerY }; angleToDraw = 0; dashStyle = [4, 4]; colorStyle = 'blue'; this.initialBBox = currentBBox; this.scaleRotateCenter = centerToUse; this.selectionRotationAngle = angleToDraw; } }
          }
          if (boxToDraw && centerToUse && boxToDraw.width >= 0 && boxToDraw.height >= 0) {
            const halfWidth = boxToDraw.width / 2; const halfHeight = boxToDraw.height / 2; let relativeCorners = [ { x: -halfWidth, y: -halfHeight }, { x: halfWidth, y: -halfHeight }, { x: halfWidth, y: halfHeight }, { x: -halfWidth, y: halfHeight } ];
            if (visualScaleX < 0) { relativeCorners = relativeCorners.map(p => ({ x: -p.x, y: p.y })); } if (visualScaleY < 0) { relativeCorners = relativeCorners.map(p => ({ x: p.x, y: -p.y })); }
            const rotatedCorners = relativeCorners.map(p => rotatePoint({ x: centerToUse.x + p.x, y: centerToUse.y + p.y }, centerToUse, angleToDraw)); cornersToDraw = { tl: rotatedCorners[0], tr: rotatedCorners[1], br: rotatedCorners[2], bl: rotatedCorners[3] };
          }
        }
        if (cornersToDraw) { this.drawRotatedRect(cornersToDraw, colorStyle, dashStyle); }
      } else if (this.selectionLevel === 'component' && !isWritingMode) {
        let hoverCorners = null; const targetElement = document.elementFromPoint(this.lastMousePos.x, this.lastMousePos.y); const isHoveringHandle = targetElement === this.rotateHandleIconElem || targetElement === this.scaleHandleIconElem;
        if (!isHoveringHandle && !this.isDrawing && !this.isSelecting && !this.isRotating && !this.isScaling && this.mouseDownButton === -1) {
          if (this.mouseOverNodeId || this.mouseOverEdgeId) { const hoveredElementId = this.mouseOverNodeId || this.mouseOverEdgeId; const hoveredElementType = this.mouseOverNodeId ? 'node' : 'edge'; const compId = this.getComponentIdForElement(hoveredElementId, hoveredElementType); if (compId) { const { componentNodes } = this.findConnectedComponent(hoveredElementId, hoveredElementType); const hoverBBox = this.getCombinedBoundingBox(componentNodes, []); if (hoverBBox && hoverBBox.width >= 0 && hoverBBox.height >= 0) { const hw=hoverBBox.width/2; const hh=hoverBBox.height/2; const hc= {x:hoverBBox.centerX, y:hoverBBox.centerY}; hoverCorners = { tl: { x: hc.x-hw, y: hc.y-hh }, tr: { x: hc.x+hw, y: hc.y-hh }, br: { x: hc.x+hw, y: hc.y+hh }, bl: { x: hc.x-hw, y: hc.y+hh } }; } } }
          else if (this.mouseOverBox) { // Use the TextBox instance
                       hoverCorners = this.mouseOverBox.getRotatedCorners();
                    }
          if (hoverCorners) { this.drawRotatedRect(hoverCorners, '#aaa', [3, 3]); }
        }
      }
      if (this.isAltDown && !this.isDrawing && !this.isDraggingNodes && !this.isDraggingItems && !this.isRotating && !this.isScaling && this.mouseDownButton === -1 && this.lastMousePos && (this.isAltDrawing || this.altPreviewSourceNodeIds.size > 0)) {
        const previewEndPoint = this.snapTargetNode ? this.snapTargetNode : this.lastMousePos;
        this.ctx.save(); this.ctx.lineWidth = this.currentLineWidth; this.ctx.setLineDash([4, 4]); this.ctx.strokeStyle = this.snapTargetNode ? 'red' : this.currentColor;
        if (this.isAltDrawing && this.altDrawingSourceNodeId) { const sourceNode = this.graph.getNode(this.altDrawingSourceNodeId); if (sourceNode) { this.ctx.beginPath(); this.ctx.moveTo(sourceNode.x, sourceNode.y); this.ctx.lineTo(previewEndPoint.x, previewEndPoint.y); this.ctx.stroke(); } }
        else if (this.altPreviewSourceNodeIds.size > 0) { this.altPreviewSourceNodeIds.forEach(nid => { const node = this.graph.getNode(nid); if(node){ this.ctx.beginPath(); this.ctx.moveTo(node.x, node.y); this.ctx.lineTo(previewEndPoint.x, previewEndPoint.y); this.ctx.stroke(); } }); }
        this.ctx.restore();
      }
    }

    updateNodeHandles() { this.nodeHandlesContainer.innerHTML = ''; this.snapIndicatorElem.style.display = 'none'; const nodesToShowHandles = new Set(); if (this.selectionLevel === 'element' && this.elementSelectionActiveForComponentId) { const compData = this.activeComponentData.get(this.elementSelectionActiveForComponentId); if (compData) { compData.componentNodes.forEach(nodeId => nodesToShowHandles.add(nodeId)); } } nodesToShowHandles.forEach(nodeId => { const node = this.graph.getNode(nodeId); if (!node) return; const handle = document.createElement('div'); handle.className = 'node-handle'; handle.dataset.nodeId = nodeId; handle.style.left = `${node.x}px`; handle.style.top = `${node.y}px`; handle.style.display = 'block'; const componentId = this.getComponentIdForElement(nodeId, 'node'); if (this.selectionLevel === 'element' && this.elementSelectionActiveForComponentId === componentId) { if (this.selectedNodes.has(nodeId)) { handle.classList.add('element-selected'); } else { handle.classList.add('element-focus-component'); } } else { handle.style.display = 'none'; } handle.addEventListener('mousedown', this.handleNodeMouseDown.bind(this)); this.nodeHandlesContainer.appendChild(handle); }); if (this.isAltDown && (this.isAltDrawing || this.altPreviewSourceNodeIds.size > 0) && this.snapTargetNode) { this.snapIndicatorElem.style.left = `${this.snapTargetNode.x}px`; this.snapIndicatorElem.style.top = `${this.snapTargetNode.y}px`; this.snapIndicatorElem.style.display = 'block'; } }
    resetPersistentTransformState() { this.selectionRotationAngle = 0; this.initialBBox = null; this.scaleRotateCenter = { x: 0, y: 0 }; }

    selectTextBox(textBox, add = false) {
        if (!textBox || !(textBox instanceof TextBox) || !this.textBoxRegistry.has(textBox.id)) return;
        let needsReset = false;
        if (!add) {
            if(this.deselectAllGraphElements()) needsReset = true;
            // Deselect other text boxes only if not adding
            const otherSelected = new Set(this.selectedTextBoxes);
            otherSelected.delete(textBox);
            if (otherSelected.size > 0) {
                otherSelected.forEach(box => this.selectedTextBoxes.delete(box));
                needsReset = true;
            }
        }
        if (!this.selectedTextBoxes.has(textBox)) {
            this.selectedTextBoxes.add(textBox);
            // Add visual selection indicator (e.g., border) if needed - could be done via CSS class
            textBox.element?.classList.add('selected');
            needsReset = true;
        }
        if (needsReset) {
            this.selectionLevel = 'component';
            this.elementSelectionActiveForComponentId = null;
            this.resetPersistentTransformState();
            this.redrawCanvas();
            this.updateNodeHandles();
            this.updateTransformHandles();
        }
    }

    deselectTextBox(textBox) {
        if (!textBox || !(textBox instanceof TextBox) || !this.textBoxRegistry.has(textBox.id)) return;
        if (this.selectedTextBoxes.has(textBox)) {
            this.selectedTextBoxes.delete(textBox);
            // Remove visual selection indicator
            textBox.element?.classList.remove('selected');
            this.resetPersistentTransformState();
            this.redrawCanvas();
            this.updateNodeHandles();
            this.updateTransformHandles();
        }
    }

    toggleSelectTextBox(textBox) {
        if (!textBox || !(textBox instanceof TextBox) || !this.textBoxRegistry.has(textBox.id)) return;
        if (this.selectedTextBoxes.has(textBox)) {
            this.deselectTextBox(textBox);
        } else {
            this.selectTextBox(textBox, true); // Add to selection
        }
    }

    selectComponent(elementId, elementType, add = false) { if (this.selectionLevel !== 'component') return; const { componentNodes, componentEdges, representativeId } = this.findConnectedComponent(elementId, elementType); if (!representativeId || (componentNodes.size === 0 && componentEdges.size === 0)) return; if (!add) { this.deselectAllGraphElements(); this.deselectAllTextBoxes(); this.resetPersistentTransformState(); } if (!this.activeComponentData.has(representativeId)) { this.activeComponentData.set(representativeId, { componentNodes, componentEdges }); this.resetPersistentTransformState(); } this.redrawCanvas(); this.updateNodeHandles(); this.updateTransformHandles(); }
    toggleSelectComponent(elementId, elementType) { if (this.selectionLevel !== 'component') return; const { componentNodes, componentEdges, representativeId } = this.findConnectedComponent(elementId, elementType); if (!representativeId) return; let changed = false; if (this.activeComponentData.has(representativeId)) { this.activeComponentData.delete(representativeId); changed = true; } else if (componentNodes.size > 0 || componentEdges.size > 0) { this.activeComponentData.set(representativeId, { componentNodes, componentEdges }); changed = true; } if (changed) { this.resetPersistentTransformState(); this.redrawCanvas(); this.updateNodeHandles(); this.updateTransformHandles(); } }
    selectElement(elementId, elementType, add = false) { if (this.selectionLevel !== 'element' || !this.elementSelectionActiveForComponentId) return; const elementComponentId = this.getComponentIdForElement(elementId, elementType); if (elementComponentId !== this.elementSelectionActiveForComponentId) return; if (!add) { this.selectedNodes.clear(); this.selectedEdges.clear(); } if (elementType === 'node' && this.graph.getNode(elementId)) this.selectedNodes.add(elementId); else if (elementType === 'edge' && this.graph.getEdge(elementId)) this.selectedEdges.add(elementId); this.redrawCanvas(); this.updateNodeHandles(); this.updateTransformHandles(); }
    toggleSelectElement(elementId, elementType) { if (this.selectionLevel !== 'element' || !this.elementSelectionActiveForComponentId) return; const elementComponentId = this.getComponentIdForElement(elementId, elementType); if (elementComponentId !== this.elementSelectionActiveForComponentId) return; let changed = false; if (elementType === 'node' && this.graph.getNode(elementId)) { if (this.selectedNodes.has(elementId)) this.selectedNodes.delete(elementId); else this.selectedNodes.add(elementId); changed = true; } else if (elementType === 'edge' && this.graph.getEdge(elementId)) { if (this.selectedEdges.has(elementId)) this.selectedEdges.delete(elementId); else this.selectedEdges.add(elementId); changed = true; } if (changed) { this.redrawCanvas(); this.updateNodeHandles(); this.updateTransformHandles(); } }

    deselectAllTextBoxes() {
        let changed = this.selectedTextBoxes.size > 0;
        if (changed) {
            this.selectedTextBoxes.forEach(box => {
                box.element?.classList.remove('selected'); // Remove visual selection
            });
            this.selectedTextBoxes.clear();
        }
        if (this.activeTextBox) {
            this.deactivateTextBox(this.activeTextBox); // Deactivate if needed
            changed = true; // Deactivating is a change
        }
        return changed;
    }

    deselectAllGraphElements() { let changed = false; if (this.activeComponentData.size > 0) { this.activeComponentData.clear(); changed = true; } if (this.selectedNodes.size > 0) { this.selectedNodes.clear(); changed = true; } if (this.selectedEdges.size > 0) { this.selectedEdges.clear(); changed = true; } if (this.elementSelectionActiveForComponentId) { this.elementSelectionActiveForComponentId = null; this.selectionLevel = 'component'; changed = true;} return changed; }
    deselectAll(keepTextBoxes = false) { let changedGraph = false; let changedText = false; if (!keepTextBoxes) { changedText = this.deselectAllTextBoxes(); } changedGraph = this.deselectAllGraphElements(); if (changedGraph || changedText) { this.resetPersistentTransformState(); this.redrawCanvas(); this.updateNodeHandles(); this.updateTransformHandles(); } }

    selectAllItems() {
        this.deselectAll();
        // Select all text boxes
        this.textBoxRegistry.forEach(box => this.selectTextBox(box, true));
        // Select all graph components
        const processedNodes = new Set();
        this.graph.getAllNodes().forEach(node => {
            if (!processedNodes.has(node.id)) {
                const { componentNodes, componentEdges, representativeId } = this.findConnectedComponent(node.id, 'node');
                if (representativeId && (componentNodes.size > 0 || componentEdges.size > 0)) {
                    if (!this.activeComponentData.has(representativeId)) {
                        this.activeComponentData.set(representativeId, { componentNodes, componentEdges });
                    }
                    componentNodes.forEach(nid => processedNodes.add(nid));
                }
            }
        });
        this.selectionLevel = 'component';
        this.elementSelectionActiveForComponentId = null;
        this.resetPersistentTransformState();
        this.redrawCanvas();
        this.updateNodeHandles();
        this.updateTransformHandles();
        if(this.activeTextBox) this.deactivateTextBox(this.activeTextBox);
    }

    createNewTextBox(screenX, screenY, initialText = '', color = this.currentColor, fontSize = this.currentFontSize, rotation = 0) {
        const newId = generateId();
        this.deselectAll();
        if(this.activeTextBox) this.deactivateTextBox(this.activeTextBox); // Ensure no active box

        const initialData = {
            text: initialText,
            x: screenX, // Initial position (center X)
            y: screenY, // Initial position (center Y)
            color: color,
            fontSize: fontSize,
            rotation: rotation
        };

        const newTextBox = new TextBox(newId, initialData, this.textBoxContainer, this.textBoxUtils);
        this.textBoxRegistry.set(newId, newTextBox);

        // Add event listeners managed by GraphEditor
        newTextBox.element.addEventListener('mouseenter', (event) => {
            const box = this.textBoxRegistry.get(event.currentTarget.dataset.id);
            if (box && this.activeTextBox !== box) {
                this.mouseOverBox = box;
                this.redrawCanvas();
                this.updateCursorBasedOnContext();
            }
        });
            newTextBox.element.addEventListener('mouseleave', (event) => {
            const box = this.textBoxRegistry.get(event.currentTarget.dataset.id);
                if (this.mouseOverBox === box) {
                    this.mouseOverBox = null;
                    this.redrawCanvas();
                    this.updateCursorBasedOnContext();
                }
            });
            newTextBox.element.addEventListener('focusout', (event) => {
            const box = this.textBoxRegistry.get(event.currentTarget.dataset.id);
                setTimeout(() => {
                    if (box && this.activeTextBox === box && !box.element.contains(document.activeElement) && !this.isDraggingItems && !this.isRotating && !this.isScaling) {
                    this.deactivateTextBox(box);
                    }
                }, 50);
            });
            newTextBox.element.addEventListener('dragstart', (e) => e.preventDefault());
            // Input event is handled internally by TextBox, but we might need to react
            newTextBox.element.addEventListener('input', (event) => {
                const box = this.textBoxRegistry.get(event.currentTarget.dataset.id);
                if(box) {
                    this.resetPersistentTransformState(); // Text change resets group transform
                    this.updateTransformHandles();
                }
            });

        this.addHistory({
            type: 'create_text',
            boxInfo: newTextBox.getDataForHistory() // Get initial state data
        });

        this.selectTextBox(newTextBox); // Select the new box
        this.setActiveTextBox(newTextBox); // Enter edit mode immediately

        return newTextBox;
    }

    deleteTextBox(id) {
        if (this.textBoxRegistry.has(id)) {
            const box = this.textBoxRegistry.get(id);
            if (this.mouseOverBox === box) this.mouseOverBox = null;
            if (this.activeTextBox === box) this.deactivateTextBox(box); // Ensure deactivated
            this.deselectTextBox(box); // Remove from selection
            try {
                box.destroy(); // Remove element from DOM
                this.textBoxRegistry.delete(id);
                this.resetPersistentTransformState();
                this.updateTransformHandles(); // Handles might depend on selection
                this.redrawCanvas(); // Redraw potentially affected hover highlights
                return true;
            } catch (e) {
                console.error("Error destroying TextBox:", e);
                return false;
            }
        }
        return false;
    }

    setActiveTextBox(textBox) {
        if (!textBox || !(textBox instanceof TextBox) || !this.textBoxRegistry.has(textBox.id)) return;
        if (this.activeTextBox && this.activeTextBox !== textBox) {
            this.deactivateTextBox(this.activeTextBox);
        }
        if (this.activeTextBox === textBox && textBox.isEditing) return; // Already active

        this.activeTextBox = textBox;
        textBox.enterEditMode(); // Handles contentEditable, focus, caret
        textBox.element?.classList.add('writing-mode');

        // Ensure only this text box is selected visually when editing
        this.selectedTextBoxes.forEach(b => {
            if (b !== textBox) b.element?.classList.remove('selected');
        });
        this.selectedTextBoxes.clear();
        this.selectedTextBoxes.add(textBox); // Keep it in the set logically
        textBox.element?.classList.add('selected'); // Ensure it has selection style

        this.rotateHandleIconElem.style.display = 'none';
        this.scaleHandleIconElem.style.display = 'none';
        this.redrawCanvas(); // Might hide selection highlights etc.
        this.updateCursorBasedOnContext();
    }

    deactivateTextBox(textBox = this.activeTextBox) {
        if (!textBox || !(textBox instanceof TextBox) || !this.textBoxRegistry.has(textBox.id) || this.activeTextBox !== textBox) return;

        const { textChanged } = textBox.exitEditMode(); // Handles contentEditable, rendering
        textBox.element?.classList.remove('writing-mode');

        if (textChanged) {
                // If text changed, we might need to update history or reset group transforms
                // For now, just reset persistent state if a change occurred
                this.resetPersistentTransformState();
        }

        this.activeTextBox = null;
        // Decide if the box should remain selected after editing
        // Option 1: Keep it selected
        // this.selectTextBox(textBox); // Ensures it's selected after editing
        // Option 2: Deselect it
        this.deselectTextBox(textBox);

        this.redrawCanvas();
        this.updateTransformHandles(); // Might become visible again
        this.updateCursorBasedOnContext();
    }

    deleteSelected() {
        const deletedHistory = { texts: [], graph: null };
        const boxesToDelete = new Set(this.selectedTextBoxes); // Copy set before iteration

        boxesToDelete.forEach(box => {
            if (this.textBoxRegistry.has(box.id)) {
                deletedHistory.texts.push(box.getDataForHistory()); // Get state before deletion
                this.deleteTextBox(box.id); // Destroys and removes from registry/selection
            }
        });

        const nodesToDelete = new Set();
        const edgesToDelete = new Set();

        if (this.selectionLevel === 'element' && this.elementSelectionActiveForComponentId) {
            const compData = this.activeComponentData.get(this.elementSelectionActiveForComponentId);
            if (compData) {
                this.selectedNodes.forEach(nid => { if (compData.componentNodes.has(nid)) nodesToDelete.add(nid); });
                this.selectedEdges.forEach(eid => { if (compData.componentEdges.has(eid)) edgesToDelete.add(eid); });
            }
        } else { // Component level selection
            this.activeComponentData.forEach(compData => {
                compData.componentNodes.forEach(nid => nodesToDelete.add(nid));
                compData.componentEdges.forEach(eid => edgesToDelete.add(eid));
            });
        }

        if (nodesToDelete.size > 0 || edgesToDelete.size > 0) {
            deletedHistory.graph = this.graph.deleteNodesAndEdges(nodesToDelete, edgesToDelete, generateId);
        }

        const deletedSomething = deletedHistory.texts.length > 0 || (deletedHistory.graph && (deletedHistory.graph.deletedNodes.length > 0 || deletedHistory.graph.deletedEdges.length > 0 || deletedHistory.graph.createdEdges.length > 0));

        if (deletedSomething) {
            this.addHistory({ type: 'delete_selected', deletedInfo: deletedHistory });
        }

        this.deselectAllGraphElements(); // Clear graph selection state
        // Text boxes already deselected by deleteTextBox
        this.resetPersistentTransformState();
        this.redrawCanvas();
        this.updateNodeHandles();
        this.updateTransformHandles();
        this.body.focus({ preventScroll: true });
    }

    handleGraphElementModifierClick(elementId, elementType) { if (this.selectionLevel === 'component') { if (this.isCtrlDown) this.toggleSelectComponent(elementId, elementType); else if (this.isShiftDown) this.selectComponent(elementId, elementType, true); } else if (this.selectionLevel === 'element' && this.elementSelectionActiveForComponentId) { const elementCompId = this.getComponentIdForElement(elementId, elementType); if (elementCompId === this.elementSelectionActiveForComponentId) { if (this.isCtrlDown) this.toggleSelectElement(elementId, elementType); else if (this.isShiftDown) this.selectElement(elementId, elementType, true); } } }
    prepareNodeDrag() {
      const nodesToDrag = new Set(); this.dragStartStates = [];
      const startingPersistentCenter = this.scaleRotateCenter && this.initialBBox ? { ...this.scaleRotateCenter } : null;
      const startingPersistentBBox = this.initialBBox ? { ...this.initialBBox } : null; const startingPersistentAngle = this.selectionRotationAngle;
      if (this.selectionLevel === 'element' && this.elementSelectionActiveForComponentId) {
        const compData = this.activeComponentData.get(this.elementSelectionActiveForComponentId);
        if (compData) { this.selectedNodes.forEach(nodeId => { if (this.graph.getNode(nodeId) && compData.componentNodes.has(nodeId)) { nodesToDrag.add(nodeId); } });
          this.selectedEdges.forEach(edgeId => { if (compData.componentEdges.has(edgeId)) { const edge = this.graph.getEdge(edgeId); if (edge) { if (this.graph.getNode(edge.node1Id) && compData.componentNodes.has(edge.node1Id)) { nodesToDrag.add(edge.node1Id); } if (this.graph.getNode(edge.node2Id) && compData.componentNodes.has(edge.node2Id)) { nodesToDrag.add(edge.node2Id); } } } });
        }
        nodesToDrag.forEach(nid => { const node = this.graph.getNode(nid); if (node) { this.dragStartStates.push({ type: 'node', id: nid, startX: node.x, startY: node.y }); } });
      } else {
        this.activeComponentData.forEach(compData => { compData.componentNodes.forEach(nid => { if (this.graph.getNode(nid)) { nodesToDrag.add(nid); } }); });
        nodesToDrag.forEach(nid => { const node = this.graph.getNode(nid); if (node) { this.dragStartStates.push({ type: 'node', id: nid, startX: node.x, startY: node.y, startGroupRotation: startingPersistentAngle, startCenter: startingPersistentCenter, startBBox: startingPersistentBBox }); } });
      }
    }
    handleNodeMouseDown(event) { event.stopPropagation(); this.mouseDownButton = event.button; if (this.mouseDownButton !== 0 && this.mouseDownButton !== 2) return; const handle = event.target; const nodeId = handle.dataset.nodeId; const node = this.graph.getNode(nodeId); if (!node) return; if(this.isDrawing) this.finalizeCurrentDrawing(); this.isDraggingNodes = false; this.potentialNodeHandleClick = true; this.potentialGraphElementClick = false; this.clickedElementInfo = { id: nodeId, type: 'node' }; this.dragStartMousePos = { x: event.clientX, y: event.clientY }; this.isCtrlDown = event.ctrlKey || event.metaKey; this.isShiftDown = event.shiftKey; this.isAltDown = event.altKey; if (this.mouseDownButton === 0 && !this.isAltDown) { if (this.isCtrlDown || this.isShiftDown) { this.handleGraphElementModifierClick(nodeId, 'node'); this.redrawCanvas(); this.updateNodeHandles(); } else { if (this.selectionLevel === 'element' && this.elementSelectionActiveForComponentId) { const elementCompId = this.getComponentIdForElement(nodeId, 'node'); if (elementCompId === this.elementSelectionActiveForComponentId) { if (!this.selectedNodes.has(nodeId)) { this.selectElement(nodeId, 'node', false); } } } else if (this.selectionLevel === 'component') { const compId = this.getComponentIdForElement(nodeId, 'node'); if (compId && !this.activeComponentData.has(compId)) { this.deselectAll(false); this.selectComponent(nodeId, 'node'); this.redrawCanvas(); this.updateNodeHandles(); } } } } }


    handleMouseDown(event) {
        const target = event.target;
        if (target.closest('#toolbar')) return;

        const targetTextBoxElement = target.closest('.textBox');
        const targetTextBox = targetTextBoxElement ? this.textBoxRegistry.get(targetTextBoxElement.dataset.id) : null;

        this.potentialTransformHandleClick = null;
        if (target === this.rotateHandleIconElem) this.potentialTransformHandleClick = 'rotate';
        else if (target === this.scaleHandleIconElem) this.potentialTransformHandleClick = 'scale';

        this.mouseDownButton = event.button;
        const screenX = event.clientX;
        const screenY = event.clientY;
        const clickPoint = { x: screenX, y: screenY };
        this.lastMousePos = clickPoint;
        this.dragStartMousePos = clickPoint;

        this.potentialGraphElementClick = false;
        this.clickedElementInfo = null;
        this.potentialNodeHandleClick = false;
        this.potentialRightClick = false;
        this.potentialDragTarget = null;
        this.isDraggingNodes = false;
        this.isDraggingItems = false;
        this.isSelecting = false;
        this.isRotating = false;
        this.isScaling = false;
        this.isAltDown = event.altKey;
        this.isCtrlDown = event.ctrlKey || event.metaKey;
        this.isShiftDown = event.shiftKey;
        this.snapTargetNode = null;
        this.currentRotationAngle = 0;
        this.currentScaleFactorX = 1;
        this.currentScaleFactorY = 1;

        const hitNode = (target === this.canvas) ? this.getNodeAtPoint(clickPoint) : null;
        const hitEdge = (target === this.canvas && !hitNode) ? this.getEdgeAtPoint(clickPoint) : null;
        const hitElementId = hitNode?.id || hitEdge?.id;
        const hitElementType = hitNode ? 'node' : (hitEdge ? 'edge' : null);
        const isAnySelectionActive = this.selectionLevel === 'component' && (this.activeComponentData.size > 0 || this.selectedTextBoxes.size > 0);

        if (this.mouseDownButton === 0 && this.potentialTransformHandleClick && isAnySelectionActive) {
            event.preventDefault();
            event.stopPropagation();
            if (this.isDrawing) this.finalizeCurrentDrawing();
            if (this.activeTextBox) this.deactivateTextBox(this.activeTextBox);

            if (!this.initialBBox || !this.scaleRotateCenter) {
                this.updateTransformHandles();
                if (!this.initialBBox || !this.scaleRotateCenter || this.initialBBox.width <= 0 || this.initialBBox.height <= 0) {
                    console.error(`Cannot start ${this.potentialTransformHandleClick}: Invalid bounding box or center.`);
                    this.potentialTransformHandleClick = null;
                    return;
                }
            }

            this.dragStartStates = [];
            const currentGroupAngle = this.selectionRotationAngle;
            const currentGroupCenter = { ...this.scaleRotateCenter };
            const currentGroupBBox = { ...this.initialBBox };

            this.activeComponentData.forEach(compData => {
                compData.componentNodes.forEach(nid => {
                    const node = this.graph.getNode(nid);
                    if (node) {
                        this.dragStartStates.push({
                            type: 'node', id: nid, startX: node.x, startY: node.y,
                            startGroupRotation: currentGroupAngle, startCenter: currentGroupCenter, startBBox: currentGroupBBox
                        });
                    }
                });
            });

            this.selectedTextBoxes.forEach(box => {
                const boxData = box.getDataForHistory();
                const boxCenter = box.getCenter();
                if (boxData && boxCenter && boxData.width > 0 && boxData.height > 0) {
                    this.dragStartStates.push({
                        type: 'text', id: box.id, startX: boxData.x, startY: boxData.y,
                        startWidth: boxData.width, startHeight: boxData.height, startCenterX: boxCenter.x, startCenterY: boxCenter.y,
                        startRotation: boxData.rotation ?? 0, startFontSize: parseFloat(boxData.fontSize || '16px'),
                        startGroupRotation: currentGroupAngle, startCenter: currentGroupCenter, startBBox: currentGroupBBox
                    });
                } else {
                    console.warn(`Skipping text box ${box.id} from transform start state due to invalid data.`);
                }
            });

            if (this.dragStartStates.length === 0) {
                console.warn(`Attempted to start ${this.potentialTransformHandleClick} with no valid items selected.`);
                this.potentialTransformHandleClick = null;
                return;
            }

            if (this.potentialTransformHandleClick === 'rotate') {
                const initialMouseAngleRad = Math.atan2(clickPoint.y - currentGroupCenter.y, clickPoint.x - currentGroupCenter.x);
                this.startAngle = initialMouseAngleRad;
            } else { // scale
                const vec = { x: clickPoint.x - currentGroupCenter.x, y: clickPoint.y - currentGroupCenter.y };
                const dist = Math.sqrt(vec.x * vec.x + vec.y * vec.y);
                this.startDistanceInfo = { dist: dist, vec: vec };
            }

            this.updateCursorBasedOnContext();
            return;
        }
        this.potentialTransformHandleClick = null;

        if (this.mouseDownButton === 0 && !this.isShiftDown && !this.isCtrlDown && !targetTextBox && !hitNode && !hitEdge && target === this.canvas) {
            if (this.initialBBox || this.selectionRotationAngle !== 0 || isAnySelectionActive) {
                this.deselectAll();
            }
        }

        if (this.mouseDownButton === 2) {
            if (this.isDrawing) this.finalizeCurrentDrawing();
            if (this.isAltDrawing) {
                this.isAltDrawing = false;
                this.altDrawingSourceNodeId = null;
                this.redrawCanvas();
                this.updateNodeHandles();
                this.updateTransformHandles();
            }
            event.preventDefault();
            this.isSelecting = true;
            this.potentialRightClick = true;
            this.selectionStartPos = clickPoint;
            this.selectionRectElem.style.left = `${screenX}px`;
            this.selectionRectElem.style.top = `${screenY}px`;
            this.selectionRectElem.style.width = '0px';
            this.selectionRectElem.style.height = '0px';
            this.selectionRectElem.style.display = 'none';
            if (!this.isCtrlDown && !this.isShiftDown) {
                this.deselectAll();
            }
            if(this.activeTextBox) this.deactivateTextBox(this.activeTextBox);
            this.updateCursorBasedOnContext();
            return;
        }

        if (this.mouseDownButton === 0) {
            this.isSelecting = false;
            if (this.isAltDown) {
                if (this.isDrawing) this.finalizeCurrentDrawing();
                this.potentialGraphElementClick = false;
                this.potentialNodeHandleClick = false;
                const historyData = { type: null, createdNode: null, createdEdges: [] };
                const targetNode = hitNode || this.getNodeAtPoint(clickPoint, this.NODE_HIT_THRESHOLD);

                if (this.isAltDrawing && this.altDrawingSourceNodeId) {
                    const sourceNodeId = this.altDrawingSourceNodeId;
                    let targetId = null;
                    if (targetNode && targetNode.id !== sourceNodeId) {
                        targetId = targetNode.id;
                    } else if (!targetNode) {
                        const newNodeId = generateId();
                        const newNode = this.graph.createNode(newNodeId, clickPoint.x, clickPoint.y);
                        if(newNode){ targetId = newNodeId; historyData.createdNode = {...newNode}; } else { return; }
                    }
                    if (targetId && !this.graph.edgeExists(sourceNodeId, targetId)) {
                        const edgeId = generateId();
                        const edge = this.graph.createEdge(edgeId, sourceNodeId, targetId, this.currentColor, this.currentLineWidth);
                        if (edge) { historyData.createdEdges.push({...edge}); historyData.type = 'create_graph_elements'; }
                    }
                    this.altDrawingSourceNodeId = targetId;
                    if (!targetId) { this.isAltDrawing = false; }
                } else {
                    const sourcePoints = new Set(this.altPreviewSourceNodeIds);
                    let targetId = null;
                    if (targetNode) {
                        targetId = targetNode.id;
                        this.altPreviewSourceNodeIds.clear();
                    } else {
                        const newNodeId = generateId();
                        const newNode = this.graph.createNode(newNodeId, clickPoint.x, clickPoint.y);
                        if(newNode){ targetId = newNodeId; historyData.createdNode = {...newNode}; } else { return; }
                    }
                    if (targetId && sourcePoints.size > 0) {
                        historyData.type = 'create_graph_elements';
                        sourcePoints.forEach(sourceId => {
                            if (sourceId !== targetId && !this.graph.edgeExists(sourceId, targetId)) {
                                const edgeId = generateId();
                                const edge = this.graph.createEdge(edgeId, sourceId, targetId, this.currentColor, this.currentLineWidth);
                                if (edge) historyData.createdEdges.push({...edge});
                            }
                        });
                        this.altPreviewSourceNodeIds.clear();
                    } else if (targetId && historyData.createdNode) {
                        historyData.type = 'create_graph_elements';
                        this.altPreviewSourceNodeIds.clear();
                    }
                    if(targetId) { this.isAltDrawing = true; this.altDrawingSourceNodeId = targetId; }
                    else { this.isAltDrawing = false; this.altDrawingSourceNodeId = null; }
                }
                if (historyData.type) { this.addHistory({ type: historyData.type, nodes: historyData.createdNode ? [historyData.createdNode] : [], edges: historyData.createdEdges }); }
                this.redrawCanvas();
                this.updateNodeHandles();
                this.updateTransformHandles();
                event.preventDefault();
                return;
            } else {
                if (this.isAltDrawing) { this.isAltDrawing = false; this.altDrawingSourceNodeId = null; }
                if (targetTextBox) {
                    if (this.isDrawing) this.finalizeCurrentDrawing();
                    event.stopPropagation();
                    if (this.activeTextBox && this.activeTextBox !== targetTextBox) { this.deactivateTextBox(this.activeTextBox); }
                    this.clickedElementInfo = { id: targetTextBox.id, type: 'text' };
                    this.potentialGraphElementClick = false;
                    this.potentialNodeHandleClick = false;
                    this.potentialDragTarget = { type: 'text', id: targetTextBox.id };
                    if (this.isCtrlDown) { this.toggleSelectTextBox(targetTextBox); }
                    else if (this.isShiftDown) { this.selectTextBox(targetTextBox, true); }
                    else { if (!this.selectedTextBoxes.has(targetTextBox) || this.selectedTextBoxes.size > 1 || this.activeComponentData.size > 0) { this.deselectAll(false); this.selectTextBox(targetTextBox); } }
                    if(this.selectionLevel === 'element') { this.deselectAllGraphElements(); }
                    this.redrawCanvas();
                    this.updateNodeHandles();
                    this.updateTransformHandles();
                } else if (target === this.canvas) {
                    if (this.activeTextBox) this.deactivateTextBox(this.activeTextBox);
                    if (hitElementId) {
                        if (this.isDrawing) this.finalizeCurrentDrawing();
                        this.potentialGraphElementClick = true;
                        if(!this.clickedElementInfo) this.clickedElementInfo = { id: hitElementId, type: hitElementType };
                        this.potentialNodeHandleClick = false;
                        this.potentialDragTarget = { type: 'graph', representativeId: hitElementId, elementType: hitElementType };
                        if (this.isCtrlDown || this.isShiftDown) { this.handleGraphElementModifierClick(hitElementId, hitElementType); }
                        else {
                            if (this.selectionLevel === 'element' && this.elementSelectionActiveForComponentId) {
                                const elementCompId = this.getComponentIdForElement(hitElementId, hitElementType);
                                if (elementCompId === this.elementSelectionActiveForComponentId) {
                                    const isAlreadySelected = (hitElementType === 'node' && this.selectedNodes.has(hitElementId)) || (hitElementType === 'edge' && this.selectedEdges.has(hitElementId));
                                    if (!isAlreadySelected || this.selectedNodes.size + this.selectedEdges.size > 1) { this.selectElement(hitElementId, hitElementType, false); }
                                } else { this.deselectAll(false); this.selectComponent(hitElementId, hitElementType); }
                            } else if (this.selectionLevel === 'component') {
                                const compId = this.getComponentIdForElement(hitElementId, hitElementType);
                                const currentCompData = this.activeComponentData;
                                if (compId && (!currentCompData.has(compId) || currentCompData.size > 1 || this.selectedTextBoxes.size > 0)) { this.deselectAll(false); this.selectComponent(hitElementId, hitElementType); }
                                else if (!compId && isAnySelectionActive) { this.deselectAll(); }
                            }
                        }
                        this.redrawCanvas();
                        this.updateNodeHandles();
                        this.updateTransformHandles();
                    } else {
                        if (this.isDrawing) this.finalizeCurrentDrawing();
                        this.setDrawingState(true, 'freehand');
                        const startNodeId = generateId();
                        const startNode = this.graph.createNode(startNodeId, clickPoint.x, clickPoint.y);
                        if (startNode) {
                            this.currentDrawingStartNodeId = startNodeId;
                            this.currentDrawingLastNodeId = startNodeId;
                            this.currentTempNodes = [{...startNode}];
                            this.currentTempEdges = [];
                        } else { this.setDrawingState(false, 'freehand'); }
                        this.potentialDragTarget = null;
                        this.potentialGraphElementClick = false;
                        this.potentialNodeHandleClick = false;
                        event.preventDefault();
                    }
                } else {
                    if (this.isDrawing) this.finalizeCurrentDrawing();
                    this.potentialGraphElementClick = false;
                    this.potentialDragTarget = null;
                    if (!targetTextBox && !target.closest('#toolbar') && !target.classList.contains('transform-handle') && !target.classList.contains('node-handle')) {
                        if (this.activeTextBox) this.deactivateTextBox(this.activeTextBox);
                    }
                }
            }
        }
        this.updateCursorBasedOnContext();
    }


    handleMouseMove(event) {
        const screenX = event.clientX;
        const screenY = event.clientY;
        const currentPoint = { x: screenX, y: screenY };
        this.lastMousePos = currentPoint;
        let needsCanvasRedraw = false;
        let needsHandleUpdate = false;
        let previewNeedsRedraw = false;
        let dragJustStarted = false; // Flag for the first mousemove after drag threshold

        if (this.activeTextBox && !this.isDraggingItems && !this.isRotating && !this.isScaling && this.mouseDownButton === -1) {
            const rect = this.activeTextBox.getDOMRect();
            if (rect) {
                const buffer = 10;
                const isMouseOutside = screenX < rect.left - buffer || screenX > rect.right + buffer || screenY < rect.top - buffer || screenY > rect.bottom + buffer;
                if (isMouseOutside) {
                    const elementToDeactivate = this.activeTextBox;
                    this.deactivateTextBox(elementToDeactivate);
                    needsCanvasRedraw = true;
                    needsHandleUpdate = true;
                }
            }
        }

        let oldMouseOverNodeId = this.mouseOverNodeId;
        let oldMouseOverEdgeId = this.mouseOverEdgeId;
        let oldMouseOverBox = this.mouseOverBox;
        if (!this.isDrawing && !this.isAltDrawing && !this.isDraggingNodes && !this.isDraggingItems && !this.isSelecting && !this.isRotating && !this.isScaling && this.mouseDownButton === -1) {
            this.mouseOverNodeId = null;
            this.mouseOverEdgeId = null;
            this.mouseOverBox = null;
            const targetElement = document.elementFromPoint(screenX, screenY);
            const isHoveringHandle = targetElement === this.rotateHandleIconElem || targetElement === this.scaleHandleIconElem;
            if (!isHoveringHandle) {
                const hoveredTextBoxElement = targetElement?.closest('.textBox');
                const hoveredTextBox = hoveredTextBoxElement ? this.textBoxRegistry.get(hoveredTextBoxElement.dataset.id) : null;
                if (hoveredTextBox && hoveredTextBox !== this.activeTextBox) {
                    this.mouseOverBox = hoveredTextBox;
                } else if (targetElement === this.canvas) {
                    const node = this.getNodeAtPoint(currentPoint);
                    const edge = node ? null : this.getEdgeAtPoint(currentPoint);
                    if (this.selectionLevel === 'element' && this.elementSelectionActiveForComponentId) {
                        const compId = this.elementSelectionActiveForComponentId;
                        if (node && this.getComponentIdForElement(node.id, 'node') === compId) this.mouseOverNodeId = node.id;
                        if (edge && this.getComponentIdForElement(edge.id, 'edge') === compId) this.mouseOverEdgeId = edge.id;
                    } else if (this.selectionLevel === 'component') {
                        this.mouseOverNodeId = node ? node.id : null;
                        this.mouseOverEdgeId = edge ? edge.id : null;
                    }
                }
            }
            if (this.mouseOverNodeId !== oldMouseOverNodeId || this.mouseOverEdgeId !== oldMouseOverEdgeId || this.mouseOverBox !== oldMouseOverBox) {
                needsCanvasRedraw = true;
            }
        }
        this.updateCursorBasedOnContext();

        let previousSnapTarget = this.snapTargetNode;
        this.snapTargetNode = null;
        if (this.isAltDown && !this.isDrawing && !this.isDraggingNodes && !this.isDraggingItems && !this.isRotating && !this.isScaling && this.mouseDownButton === -1 && (this.isAltDrawing || this.altPreviewSourceNodeIds.size > 0)) {
            const potentialSnap = this.getNodeAtPoint(currentPoint, this.NODE_HIT_THRESHOLD * 1.5);
            if (potentialSnap && (!this.isAltDrawing || potentialSnap.id !== this.altDrawingSourceNodeId)) {
                this.snapTargetNode = potentialSnap;
            }
            previewNeedsRedraw = true;
            if (this.snapTargetNode !== previousSnapTarget) {
                needsHandleUpdate = true;
            }
        } else {
            if (this.snapIndicatorElem.style.display !== 'none') {
                needsHandleUpdate = true;
            }
            if (!this.isAltDown && (this.isAltDrawing || this.altPreviewSourceNodeIds.size > 0) && this.mouseDownButton === -1){
                previewNeedsRedraw = true;
            }
        }

        if (this.isSelecting && this.mouseDownButton === 2) {
            event.preventDefault();
            const movedBeyondThreshold = Math.abs(screenX - this.dragStartMousePos.x) > this.DRAG_THRESHOLD || Math.abs(screenY - this.dragStartMousePos.y) > this.DRAG_THRESHOLD;
            if (this.potentialRightClick && movedBeyondThreshold) {
                this.potentialRightClick = false;
                this.selectionRectElem.style.display = 'block';
                document.body.style.cursor = 'default';
            }
            if (!this.potentialRightClick) {
                const rectX = Math.min(this.selectionStartPos.x, screenX);
                const rectY = Math.min(this.selectionStartPos.y, screenY);
                const rectW = Math.abs(screenX - this.selectionStartPos.x);
                const rectH = Math.abs(screenY - this.selectionStartPos.y);
                this.selectionRectElem.style.left = `${rectX}px`;
                this.selectionRectElem.style.top = `${rectY}px`;
                this.selectionRectElem.style.width = `${rectW}px`;
                this.selectionRectElem.style.height = `${rectH}px`;
            }
            needsCanvasRedraw = false;
            needsHandleUpdate = false;
            previewNeedsRedraw = false;
        } else if (this.mouseDownButton === 0) {
            const movedEnough = Math.abs(screenX - this.dragStartMousePos.x) > this.DRAG_THRESHOLD || Math.abs(screenY - this.dragStartMousePos.y) > this.DRAG_THRESHOLD;
            const wasPotentialDragOnActiveBox = this.activeTextBox && this.potentialDragTarget?.type === 'text' && this.potentialDragTarget.id === this.activeTextBox.id;

            if (!this.isDrawing && !this.isAltDrawing && !this.isDraggingNodes && !this.isDraggingItems && !this.isRotating && !this.isScaling && movedEnough) {
                if (this.activeTextBox && !wasPotentialDragOnActiveBox) {
                    const targetElement = document.elementFromPoint(screenX, screenY);
                    const shouldDeactivate = this.potentialTransformHandleClick || this.potentialNodeHandleClick || this.potentialGraphElementClick || (this.potentialDragTarget?.type === 'text' && this.potentialDragTarget.id !== this.activeTextBox.id) || (!this.potentialDragTarget && targetElement !== this.activeTextBox.element && !this.activeTextBox.element.contains(targetElement));
                    if (shouldDeactivate) {
                        this.deactivateTextBox(this.activeTextBox);
                        needsCanvasRedraw = true; needsHandleUpdate = true;
                    }
                }

                if (this.potentialTransformHandleClick === 'rotate') {
                    if (this.dragStartStates?.length > 0) {
                        this.isRotating = true; dragJustStarted = true; this.body.style.cursor = 'grabbing';
                    }
                    this.potentialTransformHandleClick = null;
                } else if (this.potentialTransformHandleClick === 'scale') {
                    if (this.dragStartStates?.length > 0) {
                        this.isScaling = true; dragJustStarted = true; this.body.style.cursor = 'grabbing';
                    }
                    this.potentialTransformHandleClick = null;
                } else if (this.potentialNodeHandleClick || this.potentialGraphElementClick) {
                    let canDrag = false;
                    if (this.clickedElementInfo) {
                        if (this.selectionLevel === 'element' && this.elementSelectionActiveForComponentId) {
                            const compId = this.getComponentIdForElement(this.clickedElementInfo.id, this.clickedElementInfo.type);
                            if (compId === this.elementSelectionActiveForComponentId) {
                                const isClickedSelected = (this.clickedElementInfo.type === 'node' && this.selectedNodes.has(this.clickedElementInfo.id)) || (this.clickedElementInfo.type === 'edge' && this.selectedEdges.has(this.clickedElementInfo.id));
                                if (isClickedSelected) { canDrag = true; }
                            }
                        } else if (this.selectionLevel === 'component') {
                            const compId = this.getComponentIdForElement(this.clickedElementInfo.id, this.clickedElementInfo.type);
                            if (compId && this.activeComponentData.has(compId)) { canDrag = true; }
                        }
                    }
                    if (canDrag) {
                        this.prepareNodeDrag();
                        if (this.dragStartStates.length > 0) { this.isDraggingNodes = true; dragJustStarted = true; this.body.style.cursor = 'grabbing'; }
                    }
                    this.potentialNodeHandleClick = false; this.potentialGraphElementClick = false;
                } else if (this.potentialDragTarget?.type === 'text') {
                    if (!wasPotentialDragOnActiveBox) {
                        const box = this.textBoxRegistry.get(this.potentialDragTarget.id);
                        if(box && this.selectedTextBoxes.has(box)){
                            this.isDraggingItems = true; dragJustStarted = true; this.body.style.cursor = 'move'; this.body.style.userSelect = 'none'; this.body.style.webkitUserSelect = 'none';
                            const startingPersistentCenter = this.scaleRotateCenter && this.initialBBox ? { ...this.scaleRotateCenter } : null;
                            const startingPersistentBBox = this.initialBBox ? { ...this.initialBBox } : null;
                            const startingPersistentAngle = this.selectionRotationAngle;
                            this.dragStartStates = [];
                            this.selectedTextBoxes.forEach(b => {
                                const boxData = b.getDataForHistory();
                                const boxCenter = b.getCenter();
                                if(boxData && boxCenter && boxData.width > 0 && boxData.height > 0) {
                                    this.dragStartStates.push({ type: 'text', id: b.id, startX: boxData.x, startY: boxData.y, startWidth: boxData.width, startHeight: boxData.height, startCenterX: boxCenter.x, startCenterY: boxCenter.y, startRotation: boxData.rotation ?? 0, startFontSize: parseFloat(boxData.fontSize || '16px'), startGroupRotation: startingPersistentAngle, startCenter: startingPersistentCenter, startBBox: startingPersistentBBox });
                                }
                            });
                        }
                    }
                    this.potentialDragTarget = null;
                } else {
                    this.potentialDragTarget = null;
                }

                if(dragJustStarted){ needsCanvasRedraw = true; needsHandleUpdate = true; }
            }

            const dx = screenX - this.dragStartMousePos.x;
            const dy = screenY - this.dragStartMousePos.y;

            if (this.isRotating) {
                event.preventDefault();
                if (!this.dragStartStates.length || !this.dragStartStates[0].startCenter) return;
                const rotationCenter = this.dragStartStates[0].startCenter;
                const currentMouseAngle = Math.atan2(currentPoint.y - rotationCenter.y, currentPoint.x - rotationCenter.x);
                let deltaAngle = currentMouseAngle - this.startAngle;
                if (deltaAngle > Math.PI) deltaAngle -= 2 * Math.PI;
                else if (deltaAngle <= -Math.PI) deltaAngle += 2 * Math.PI;
                this.currentRotationAngle = deltaAngle;
                const startGroupRotation = this.dragStartStates[0].startGroupRotation ?? 0;
                this.currentDragTargetAngle = startGroupRotation + deltaAngle;

                this.dragStartStates.forEach(itemState => {
                    const startX_orig = itemState.startX; const startY_orig = itemState.startY;
                    let itemStartX, itemStartY;
                    if(itemState.type === 'text') { itemStartX = itemState.startCenterX; itemStartY = itemState.startCenterY; }
                    else if(itemState.type === 'node'){ itemStartX = startX_orig; itemStartY = startY_orig; }
                    else { return; }
                    const startRelX = itemStartX - rotationCenter.x; const startRelY = itemStartY - rotationCenter.y;
                    const cosDelta = Math.cos(deltaAngle); const sinDelta = Math.sin(deltaAngle);
                    const rotatedRelX = startRelX * cosDelta - startRelY * sinDelta; const rotatedRelY = startRelX * sinDelta + startRelY * cosDelta;
                    const newCenterX = rotationCenter.x + rotatedRelX; const newCenterY = rotationCenter.y + rotatedRelY;
                    if (itemState.type === 'node') { this.graph.updateNodePosition(itemState.id, newCenterX, newCenterY); }
                    else if (itemState.type === 'text') {
                        const textBox = this.textBoxRegistry.get(itemState.id);
                        if (textBox) {
                            const textStartRotation = itemState.startRotation ?? 0;
                            const newAbsRotation = textStartRotation + deltaAngle;
                            textBox.setPosition(newCenterX, newCenterY, true);
                            textBox.setRotation(newAbsRotation);
                        }
                    }
                });
                needsCanvasRedraw = true; needsHandleUpdate = true;
            } else if (this.isScaling) {
                event.preventDefault();
                if (!this.dragStartStates || this.dragStartStates.length === 0 || !this.dragStartStates[0].startCenter || !this.dragStartStates[0].startBBox || !this.startDistanceInfo) {
                    console.error("Cannot continue scaling: Missing start state information."); return;
                }
                const rotationCenter = this.dragStartStates[0].startCenter;
                const startBBox = this.dragStartStates[0].startBBox;
                const startGroupRotation = this.dragStartStates[0].startGroupRotation ?? 0;
                const cosA = Math.cos(-startGroupRotation); const sinA = Math.sin(-startGroupRotation);
                const mouseRel = { x: currentPoint.x - rotationCenter.x, y: currentPoint.y - rotationCenter.y };
                const mouseRelLocal = { x: mouseRel.x * cosA - mouseRel.y * sinA, y: mouseRel.x * sinA + mouseRel.y * cosA };
                const startHalfWidth = Math.max(1e-6, startBBox.width / 2); const startHalfHeight = Math.max(1e-6, startBBox.height / 2);
                const scaleX_needed = mouseRelLocal.x / startHalfWidth; const scaleY_needed = mouseRelLocal.y / startHalfHeight;
                const hasText = this.dragStartStates.some(s => s.type === 'text'); const maintainAspect = hasText || this.isCtrlDown;
                let actualScaleX = scaleX_needed; let actualScaleY = scaleY_needed; let uniformScaleFactor = 1;
                if (maintainAspect) { const s = Math.min(Math.abs(scaleX_needed), Math.abs(scaleY_needed)); actualScaleX = s * Math.sign(scaleX_needed || 1); actualScaleY = s * Math.sign(scaleY_needed || 1); uniformScaleFactor = s; }
                else { uniformScaleFactor = Math.abs(scaleY_needed); }
                const MIN_SCALE = 0.05;
                actualScaleX = Math.max(MIN_SCALE, Math.abs(actualScaleX)) * Math.sign(actualScaleX || 1);
                actualScaleY = Math.max(MIN_SCALE, Math.abs(actualScaleY)) * Math.sign(actualScaleY || 1);
                uniformScaleFactor = Math.max(MIN_SCALE, Math.abs(uniformScaleFactor));
                this.currentScaleFactorX = actualScaleX; this.currentScaleFactorY = actualScaleY;

                this.dragStartStates.forEach(itemState => {
                    let startItemCenterX, startItemCenterY;
                    if (itemState.type === 'node') { startItemCenterX = itemState.startX; startItemCenterY = itemState.startY; }
                    else if (itemState.type === 'text') { startItemCenterX = itemState.startCenterX; startItemCenterY = itemState.startCenterY; }
                    else { return; }
                    const startRelItemX = startItemCenterX - rotationCenter.x; const startRelItemY = startItemCenterY - rotationCenter.y;
                    const localRelX = startRelItemX * cosA - startRelItemY * sinA; const localRelY = startRelItemX * sinA + startRelItemY * cosA;
                    const scaledLocalRelX = localRelX * actualScaleX; const scaledLocalRelY = localRelY * actualScaleY;
                    const cosEnd = Math.cos(startGroupRotation); const sinEnd = Math.sin(startGroupRotation);
                    const scaledWorldRelX = scaledLocalRelX * cosEnd - scaledLocalRelY * sinEnd; const scaledWorldRelY = scaledLocalRelX * sinEnd + scaledLocalRelY * cosEnd;
                    const newTargetItemCenterX = rotationCenter.x + scaledWorldRelX; const newTargetItemCenterY = rotationCenter.y + scaledWorldRelY;

                    if (itemState.type === 'node') { this.graph.updateNodePosition(itemState.id, newTargetItemCenterX, newTargetItemCenterY); }
                    else if (itemState.type === 'text') {
                        const textBox = this.textBoxRegistry.get(itemState.id);
                        if (textBox) {
                            textBox.applyScale(actualScaleX, actualScaleY, dragJustStarted);
                            // Optional: Force position update if needed, but applyScale should handle centering
                            // textBox.setPosition(newTargetItemCenterX, newTargetItemCenterY, true);
                        }
                    }
                });
                needsCanvasRedraw = true; needsHandleUpdate = true;
            } else if (this.isDraggingNodes) {
                event.preventDefault();
                this.dragStartStates.forEach(itemState => { if (itemState.type === 'node') { this.graph.updateNodePosition(itemState.id, itemState.startX + dx, itemState.startY + dy); } });
                needsCanvasRedraw = true; needsHandleUpdate = true;
            } else if (this.isDraggingItems) {
                event.preventDefault();
                this.dragStartStates.forEach(itemState => {
                    if (itemState.type === 'text') {
                        const textBox = this.textBoxRegistry.get(itemState.id);
                        if (textBox) {
                            const newTopLeftX = itemState.startX + dx; const newTopLeftY = itemState.startY + dy;
                            textBox.setPosition(newTopLeftX, newTopLeftY);
                            const startRotation = itemState.startRotation ?? 0;
                            if (textBox.rotation !== startRotation) { textBox.setRotation(startRotation); }
                            else { textBox._updateTransform(); }
                        }
                    }
                });
                needsCanvasRedraw = true; needsHandleUpdate = true;
            } else if (this.isDrawing && this.drawingMode === 'freehand') {
                event.preventDefault();
                const lastNode = this.graph.getNode(this.currentDrawingLastNodeId);
                if (lastNode && sqrDist(currentPoint, lastNode) > (this.DRAG_THRESHOLD * this.DRAG_THRESHOLD * 0.5)) {
                    const newNodeId = generateId();
                    const newNode = this.graph.createNode(newNodeId, currentPoint.x, currentPoint.y);
                    const edgeId = generateId();
                    const edge = this.graph.createEdge(edgeId, this.currentDrawingLastNodeId, newNodeId, this.currentColor, this.currentLineWidth);
                    if (newNode && edge) { this.currentTempNodes.push({ ...newNode }); this.currentTempEdges.push({ ...edge }); this.currentDrawingLastNodeId = newNodeId; needsCanvasRedraw = true; }
                    else if(newNode && !edge) { console.warn("Edge creation failed during freehand draw."); this.currentDrawingLastNodeId = newNodeId; needsCanvasRedraw = true; }
                }
            }

            if (this.isDraggingNodes || this.isDraggingItems) {
                const startState = this.dragStartStates[0];
                if (startState?.startCenter && startState?.startBBox && this.scaleRotateCenter && this.initialBBox) {
                    const initialDragCenter = startState.startCenter;
                    this.scaleRotateCenter.x = initialDragCenter.x + dx; this.scaleRotateCenter.y = initialDragCenter.y + dy;
                    this.initialBBox.centerX = this.scaleRotateCenter.x; this.initialBBox.centerY = this.scaleRotateCenter.y;
                    this.initialBBox.minX = this.scaleRotateCenter.x - this.initialBBox.width / 2; this.initialBBox.maxX = this.scaleRotateCenter.x + this.initialBBox.width / 2;
                    this.initialBBox.minY = this.scaleRotateCenter.y - this.initialBBox.height / 2; this.initialBBox.maxY = this.scaleRotateCenter.y + this.initialBBox.height / 2;
                    needsHandleUpdate = true;
                }
            }
        }

        if (previewNeedsRedraw || needsCanvasRedraw) { this.redrawCanvas(); }
        if (needsHandleUpdate) {
            if (this.isScaling || this.isRotating || this.isDraggingNodes || this.isDraggingItems) {
                this.updateTransformHandles();
            } else {
                this.updateNodeHandles();
                this.updateTransformHandles();
            }
            if (this.snapTargetNode) {
                this.snapIndicatorElem.style.left = `${this.snapTargetNode.x}px`; this.snapIndicatorElem.style.top = `${this.snapTargetNode.y}px`; this.snapIndicatorElem.style.display = 'block';
            } else { this.snapIndicatorElem.style.display = 'none'; }
        }
    }


    handleMouseUp(event) {
        const releasedButton = event.button;
        const screenX = event.clientX;
        const screenY = event.clientY;
        const dragOccurred = Math.abs(screenX - this.dragStartMousePos.x) > this.DRAG_THRESHOLD || Math.abs(screenY - this.dragStartMousePos.y) > this.DRAG_THRESHOLD;
        const targetElement = event.target;
        const targetTextBoxElement = targetElement.closest('.textBox');
        const targetTextBox = targetTextBoxElement ? this.textBoxRegistry.get(targetTextBoxElement.dataset.id) : null;

        const wasDrawingFreehand = this.isDrawing && this.drawingMode === 'freehand';
        const wasDraggingNodes = this.isDraggingNodes;
        const wasDraggingItems = this.isDraggingItems;
        const wasRotating = this.isRotating;
        const wasScaling = this.isScaling;
        const wasSelecting = this.isSelecting;
        const clickTargetInfo = this.clickedElementInfo;
        const finalDeltaAngle = this.currentRotationAngle;
        const finalScaleFactorX = this.currentScaleFactorX;
        const finalScaleFactorY = this.currentScaleFactorY;
        let startPersistentStateForHistory = null;

        if ((wasRotating || wasScaling || wasDraggingNodes || wasDraggingItems) && this.dragStartStates.length > 0) {
            const firstState = this.dragStartStates[0];
            if(firstState.startCenter && firstState.startBBox){
                startPersistentStateForHistory = { angle: firstState.startGroupRotation ?? 0, center: { ...firstState.startCenter }, box: { ...firstState.startBBox } };
            } else {
                startPersistentStateForHistory = { angle: this.selectionRotationAngle, center: this.scaleRotateCenter ? { ...this.scaleRotateCenter } : null, box: this.initialBBox ? { ...this.initialBBox } : null };
                console.warn("Using fallback persistent state for history in mouseup.");
            }
        }

        this.potentialNodeHandleClick = false;
        this.potentialGraphElementClick = false;
        this.potentialTransformHandleClick = null;

        if (releasedButton === 2 && wasSelecting) {
            event.preventDefault();
            const wasSelectingRect = !this.potentialRightClick;
            let rectBounds = null;
            if (wasSelectingRect && this.selectionRectElem.style.display !== 'none') {
                rectBounds = this.selectionRectElem.getBoundingClientRect();
            }
            this.selectionRectElem.style.display = 'none';
            this.isSelecting = false;
            this.potentialRightClick = false;
            if (wasSelectingRect && rectBounds && rectBounds.width > 0 && rectBounds.height > 0) {
                let newlySelectedTextBoxesInRect = new Set();
                let newlySelectedComponentsInRect = new Map();
                this.textBoxRegistry.forEach(box => {
                    const b = box.getDOMRect();
                    if (b) {
                        const intersects = b.left < rectBounds.right && b.right > rectBounds.left && b.top < rectBounds.bottom && b.bottom > rectBounds.top;
                        if (intersects) { newlySelectedTextBoxesInRect.add(box); }
                    }
                });
                this.selectionLevel = 'component';
                this.elementSelectionActiveForComponentId = null;
                this.selectedNodes.clear();
                this.selectedEdges.clear();
                const processedNodesRect = new Set();
                this.graph.getAllNodes().forEach(node => {
                    const nodeInBounds = node.x >= rectBounds.left && node.x <= rectBounds.right && node.y >= rectBounds.top && node.y <= rectBounds.bottom;
                    if (nodeInBounds && !processedNodesRect.has(node.id)) {
                        const { componentNodes, componentEdges, representativeId } = this.findConnectedComponent(node.id, 'node');
                        if (representativeId && (componentNodes.size > 0 || componentEdges.size > 0)) {
                            if (!newlySelectedComponentsInRect.has(representativeId)) { newlySelectedComponentsInRect.set(representativeId, { componentNodes, componentEdges }); }
                            componentNodes.forEach(nid => processedNodesRect.add(nid));
                        }
                    }
                });
                const previouslySelectedTextBoxes = new Set(this.selectedTextBoxes);
                const previouslyActiveComponentData = new Map(this.activeComponentData);
                let finalSelectedTextBoxes = new Set(previouslySelectedTextBoxes);
                let finalActiveComponentData = new Map(previouslyActiveComponentData);
                if (this.isCtrlDown) {
                    newlySelectedTextBoxesInRect.forEach(box => { if (previouslySelectedTextBoxes.has(box)) finalSelectedTextBoxes.delete(box); else finalSelectedTextBoxes.add(box); });
                    newlySelectedComponentsInRect.forEach((compData, compId) => { if (previouslyActiveComponentData.has(compId)) finalActiveComponentData.delete(compId); else finalActiveComponentData.set(compId, compData); });
                } else if (this.isShiftDown) {
                    newlySelectedTextBoxesInRect.forEach(box => finalSelectedTextBoxes.add(box));
                    newlySelectedComponentsInRect.forEach((compData, compId) => finalActiveComponentData.set(compId, compData));
                } else {
                    finalSelectedTextBoxes = newlySelectedTextBoxesInRect;
                    finalActiveComponentData = newlySelectedComponentsInRect;
                }
                this.selectedTextBoxes.forEach(box => box.element?.classList.remove('selected'));
                finalSelectedTextBoxes.forEach(box => box.element?.classList.add('selected'));
                this.selectedTextBoxes = finalSelectedTextBoxes;
                this.activeComponentData = finalActiveComponentData;
                this.resetPersistentTransformState();
                this.redrawCanvas();
                this.updateNodeHandles();
                this.updateTransformHandles();
            }
        } else if (releasedButton === 0) {
            if (wasDrawingFreehand) { this.finalizeCurrentDrawing(); }
            else if (wasRotating && startPersistentStateForHistory?.center) {
                const transformHistory = { type: 'transform_items', transformType: 'rotate', items: [], startAngle: startPersistentStateForHistory.angle, startCenter: { ...startPersistentStateForHistory.center }, startBBox: startPersistentStateForHistory.box ? { ...startPersistentStateForHistory.box } : null, endAngle: this.currentDragTargetAngle };
                let transformApplied = false;
                const rotationCenter = startPersistentStateForHistory.center;
                this.dragStartStates.forEach(itemState => {
                    let startX_orig = itemState.startX, startY_orig = itemState.startY, startRotation_orig = itemState.startRotation ?? 0;
                    let startCenterX, startCenterY;
                    if (itemState.type === 'node') { startCenterX = startX_orig; startCenterY = startY_orig; }
                    else if (itemState.type === 'text') { startCenterX = itemState.startCenterX; startCenterY = itemState.startCenterY; }
                    else { return; }
                    const startRelCenterX = startCenterX - rotationCenter.x; const startRelCenterY = startCenterY - rotationCenter.y;
                    const cosDelta = Math.cos(finalDeltaAngle); const sinDelta = Math.sin(finalDeltaAngle);
                    const rotatedRelX = startRelCenterX * cosDelta - startRelCenterY * sinDelta; const rotatedRelY = startRelCenterX * sinDelta + startRelCenterY * cosDelta;
                    const endCenterX = rotationCenter.x + rotatedRelX; const endCenterY = rotationCenter.y + rotatedRelY;
                    const endRotation = startRotation_orig + finalDeltaAngle;
                    let endX, endY;
                    if(itemState.type === 'node'){ endX = endCenterX; endY = endCenterY; }
                    else { endX = endCenterX - (itemState.startWidth / 2); endY = endCenterY - (itemState.startHeight / 2); }

                    let moved = false;
                    if (itemState.type === 'node') { moved = Math.abs(endX - startX_orig) > 0.1 || Math.abs(endY - startY_orig) > 0.1; }
                    else { moved = Math.abs(endX - startX_orig) > 0.1 || Math.abs(endY - startY_orig) > 0.1 || Math.abs(endRotation - startRotation_orig) > 0.01; }

                    if (moved) {
                        transformHistory.items.push({ id: itemState.id, type: itemState.type, startX: startX_orig, startY: startY_orig, endX: endX, endY: endY, startRotation: startRotation_orig, endRotation: endRotation });
                        transformApplied = true;
                    }
                });
                if (transformApplied) { this.addHistory(transformHistory); }
                this.selectionRotationAngle = this.currentDragTargetAngle;
                this.isRotating = false;
                this.updateTransformHandles(); // Update handles based on final rotation

            } else if (wasScaling && startPersistentStateForHistory?.center && startPersistentStateForHistory?.box) {
                const transformHistory = { type: 'transform_items', transformType: 'scale', items: [], startAngle: startPersistentStateForHistory.angle, startCenter: { ...startPersistentStateForHistory.center }, startBBox: { ...startPersistentStateForHistory.box }, endScaleX: finalScaleFactorX, endScaleY: finalScaleFactorY };
                let transformApplied = false;

                this.dragStartStates.forEach(itemState => {
                    if (itemState.type === 'text') {
                        const textBox = this.textBoxRegistry.get(itemState.id);
                        if (textBox) { textBox.finalizeScale(); }
                    }
                });

                this.dragStartStates.forEach(itemState => {
                    let startState = { ...itemState };
                    let endState = null; let moved = false;
                    if (itemState.type === 'node') {
                        const node = this.graph.getNode(itemState.id);
                        if (node) { endState = { endX: node.x, endY: node.y }; moved = Math.abs(endState.endX - startState.startX) > 0.1 || Math.abs(endState.endY - startState.startY) > 0.1; }
                    } else if (itemState.type === 'text') {
                        const textBox = this.textBoxRegistry.get(itemState.id);
                        if (textBox) {
                            const finalBoxData = textBox.getDataForHistory();
                            endState = { endX: finalBoxData.x, endY: finalBoxData.y, endWidth: finalBoxData.width, endHeight: finalBoxData.height, endRotation: finalBoxData.rotation, endFontSize: parseFloat(finalBoxData.fontSize) };
                            moved = Math.abs(endState.endX - startState.startX) > 0.1 || Math.abs(endState.endY - startState.startY) > 0.1 || Math.abs(endState.endRotation - (startState.startRotation ?? 0)) > 0.01 || Math.abs(endState.endFontSize - (startState.startFontSize ?? 0)) > 0.1 || Math.abs(endState.endWidth - startState.startWidth) > 0.1 || Math.abs(endState.endHeight - startState.startHeight) > 0.1;
                        }
                    }
                    if (moved && endState) {
                        transformHistory.items.push({
                            id: startState.id, type: startState.type,
                            startX: startState.startX, startY: startState.startY, startWidth: startState.startWidth, startHeight: startState.startHeight, startRotation: startState.startRotation ?? 0, startFontSize: startState.startFontSize,
                            endX: endState.endX, endY: endState.endY, endWidth: endState.endWidth, endHeight: endState.endHeight, endRotation: endState.endRotation, endFontSize: endState.endFontSize,
                        });
                        transformApplied = true;
                    }
                });

                if (transformApplied) { this.addHistory(transformHistory); }
                this.isScaling = false;
                this.updateTransformHandles(); // Recalculate BBox based on final states

            } else if (wasDraggingNodes) {
                const dx = screenX - this.dragStartMousePos.x; const dy = screenY - this.dragStartMousePos.y;
                const moves = [];
                this.dragStartStates.forEach(itemState => {
                    if (itemState.type === 'node') {
                        const node = this.graph.getNode(itemState.id);
                        if (node) { const finalX = node.x; const finalY = node.y; if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) { moves.push({ id: itemState.id, startX: itemState.startX, startY: itemState.startY, endX: finalX, endY: finalY }); } }
                    }
                });
                if (moves.length > 0) { this.addHistory({ type: 'move_nodes', moves: moves }); }
                this.isDraggingNodes = false;
                this.updateTransformHandles(); // Update BBox after drag

            } else if (wasDraggingItems) {
                this.body.style.userSelect = 'auto'; this.body.style.webkitUserSelect = 'auto';
                const dx = screenX - this.dragStartMousePos.x; const dy = screenY - this.dragStartMousePos.y;
                const moves = [];
                this.dragStartStates.forEach(itemState => {
                    if (itemState.type === 'text') {
                        const box = this.textBoxRegistry.get(itemState.id);
                        if (box) {
                            const finalX = box.x; const finalY = box.y;
                            if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
                                moves.push({ id: itemState.id, type: 'text', startX: itemState.startX, startY: itemState.startY, endX: finalX, endY: finalY, startRotation: itemState.startRotation, endRotation: box.rotation, startFontSize: itemState.startFontSize, endFontSize: parseFloat(box.fontSize) });
                            }
                        }
                    }
                });
                if (moves.length > 0) { this.addHistory({ type: 'move_text', moves: moves }); }
                this.isDraggingItems = false;
                this.updateTransformHandles(); // Update BBox after drag

            } else if (!dragOccurred && !wasDrawingFreehand && !this.isAltDown && releasedButton === 0) {
                if (targetTextBox && clickTargetInfo && clickTargetInfo.type === 'text' && clickTargetInfo.id === targetTextBox.id) {
                    // Simple click on text box handled by double click
                }
            }
        }

        this.mouseDownButton = -1;
        this.isRotating = false;
        this.isScaling = false;
        this.isDraggingNodes = false;
        this.isDraggingItems = false;
        this.isSelecting = false;
        this.dragStartStates = [];
        this.snapTargetNode = null;
        this.potentialDragTarget = null;
        this.clickedElementInfo = null;
        this.potentialRightClick = false;
        this.currentRotationAngle = 0;
        this.currentScaleFactorX = 1;
        this.currentScaleFactorY = 1;
        this.potentialTransformHandleClick = null;

        if (this.isAltDrawing && !this.isAltDown) { this.isAltDrawing = false; this.altDrawingSourceNodeId = null; }

        this.updateCursorBasedOnContext();
        this.redrawCanvas();
        this.updateNodeHandles();
        this.updateTransformHandles();
    }


    finalizeCurrentDrawing() {
      if (!this.isDrawing && !this.isAltDrawing) return;
      if (this.isDrawing && this.drawingMode === 'freehand') { const historyType = 'create_graph_elements'; const wasSimpleClick = this.currentTempNodes.length === 1 && this.currentTempEdges.length === 0; const startNode = this.currentTempNodes.length > 0 ? this.graph.getNode(this.currentTempNodes[0]?.id) : null; const movedNegligibly = startNode && this.dragStartMousePos && sqrDist(this.dragStartMousePos, startNode) < (this.DRAG_THRESHOLD * this.DRAG_THRESHOLD); if ((wasSimpleClick || this.currentTempEdges.length === 0) && movedNegligibly) { const nodeIdToDelete = this.currentTempNodes[0]?.id; if (nodeIdToDelete && this.graph.getNode(nodeIdToDelete)) { this.graph.deleteNodesAndEdges(new Set([nodeIdToDelete]), new Set(), generateId); } } else if (this.currentTempNodes.length > 0 || this.currentTempEdges.length > 0) { this.addHistory({ type: historyType, nodes: JSON.parse(JSON.stringify(this.currentTempNodes)), edges: JSON.parse(JSON.stringify(this.currentTempEdges)) }); if(this.currentDrawingStartNodeId) { this.deselectAll(); this.selectComponent(this.currentDrawingStartNodeId, 'node'); } } this.setDrawingState(false, 'freehand'); this.currentDrawingStartNodeId = null; this.currentDrawingLastNodeId = null; this.currentTempNodes = []; this.currentTempEdges = []; }
      else if (this.isAltDrawing) { const lastNodeId = this.altDrawingSourceNodeId; this.isAltDrawing = false; this.altDrawingSourceNodeId = null; if (lastNodeId && this.graph.getNode(lastNodeId)) { this.deselectAll(); this.selectComponent(lastNodeId, 'node'); } }
      this.snapTargetNode = null; this.redrawCanvas(); this.updateNodeHandles(); this.updateTransformHandles(); this.updateCursorBasedOnContext();
    }

    handleDoubleClick(event) {
      const target = event.target; if (target.closest('#toolbar') || target.classList.contains('transform-handle') || target.classList.contains('node-handle')) return; if (this.isDrawing || this.isAltDrawing || this.isSelecting || this.isRotating || this.isScaling || this.isDraggingItems || this.isDraggingNodes) return;
      const screenX = event.clientX; const screenY = event.clientY; const clickPoint = { x: screenX, y: screenY };
            const targetTextBoxElement = target.closest('.textBox');
            const targetTextBox = targetTextBoxElement ? this.textBoxRegistry.get(targetTextBoxElement.dataset.id) : null;

      if (targetTextBox) {
                 event.stopPropagation(); event.preventDefault();
                 this.deselectAllGraphElements(); // Deselect graph elements
                 // Ensure only the double-clicked box is selected visually
                 this.selectedTextBoxes.forEach(selectedBox => {
                     if (selectedBox !== targetTextBox) {
                        selectedBox.element?.classList.remove('selected');
                     }
                 });
                 this.selectedTextBoxes.clear();
                 this.selectedTextBoxes.add(targetTextBox); // Add it logically
                 targetTextBox.element?.classList.add('selected'); // Ensure visual selection
                 this.resetPersistentTransformState();
                 this.setActiveTextBox(targetTextBox); // Enter edit mode
                 return;
            }
      const hitNode = this.getNodeAtPoint(clickPoint); const hitEdge = hitNode ? null : this.getEdgeAtPoint(clickPoint); const hitElementId = hitNode?.id || hitEdge?.id; const hitElementType = hitNode ? 'node' : (hitEdge ? 'edge' : null);
      if (hitElementId) { event.stopPropagation(); event.preventDefault(); const componentId = this.getComponentIdForElement(hitElementId, hitElementType); if (!componentId) return; this.deselectAll(false); this.selectionLevel = 'element'; this.elementSelectionActiveForComponentId = componentId; const { componentNodes, componentEdges } = this.findConnectedComponent(hitElementId, hitElementType); if (componentNodes.size > 0 || componentEdges.size > 0) { this.activeComponentData.set(componentId, { componentNodes, componentEdges }); } this.selectElement(hitElementId, hitElementType, false); this.resetPersistentTransformState(); this.redrawCanvas(); this.updateNodeHandles(); this.updateTransformHandles(); return; }
      if (target === this.canvas && this.selectionLevel === 'element') { event.stopPropagation(); event.preventDefault(); this.deselectAll(); return; }
    }

    handleKeyDown(event) {
      const wasAltDown = this.isAltDown; this.isCtrlDown = event.ctrlKey || event.metaKey; this.isShiftDown = event.shiftKey; this.isAltDown = event.altKey;
      if (this.isAltDown && !wasAltDown && !this.isRotating && !this.isScaling && !this.isDraggingItems && !this.isDraggingNodes && !this.isAltDrawing) { this.altPreviewSourceNodeIds.clear(); if (this.selectionLevel === 'element' && this.elementSelectionActiveForComponentId) { this.selectedNodes.forEach(nid => this.altPreviewSourceNodeIds.add(nid)); } else if (this.selectionLevel === 'component') { this.activeComponentData.forEach(comp => comp.componentNodes.forEach(nid => this.altPreviewSourceNodeIds.add(nid))); } if(this.altPreviewSourceNodeIds.size > 0) { this.redrawCanvas(); this.updateNodeHandles(); } this.updateCursorBasedOnContext(); }
      const focusIsOnToolbarInput = document.activeElement === this.colorPicker || document.activeElement === this.lineWidthPicker || document.activeElement === this.fontSizeInput; if (focusIsOnToolbarInput) return;
      const currentActiveTextBox = this.activeTextBox; const focusIsOnEditableTextBox = currentActiveTextBox && currentActiveTextBox.isEditing;

      if (event.key === 'Escape') { event.preventDefault(); if (this.isRotating || this.isScaling) { this.applyTransform(this.dragStartStates, true); const startState = this.dragStartStates[0]; if (startState) { this.selectionRotationAngle = startState.startGroupRotation ?? 0; this.initialBBox = startState.startBBox ? { ...startState.startBBox } : null; this.scaleRotateCenter = startState.startCenter ? { ...startState.startCenter } : {x:0,y:0}; } else { this.resetPersistentTransformState(); } this.isRotating = false; this.isScaling = false; this.dragStartStates = []; this.currentRotationAngle = 0; this.currentScaleFactor = 1; this.currentScaleFactorX = 1; this.currentScaleFactorY = 1; this.redrawCanvas(); this.updateNodeHandles(); this.updateTransformHandles(); this.updateCursorBasedOnContext(); } else if (this.isDrawing || this.isAltDrawing) { this.finalizeCurrentDrawing(); } else if (this.isSelecting) { this.isSelecting = false; this.potentialRightClick = false; this.selectionRectElem.style.display = 'none'; } else if (focusIsOnEditableTextBox) { this.deactivateTextBox(currentActiveTextBox); this.body.focus({ preventScroll: true }); } else if (this.selectionLevel === 'element' || this.selectedTextBoxes.size > 0 || this.activeComponentData.size > 0 || this.initialBBox){ this.deselectAll(); } return; }
      if (focusIsOnEditableTextBox) { if (event.key === 'Enter' && !this.isShiftDown) { event.preventDefault(); this.deactivateTextBox(currentActiveTextBox); this.body.focus({ preventScroll: true }); } return; } // Let TextBox handle other keys
      if (this.isCtrlDown && event.key.toLowerCase() === 'a') { event.preventDefault(); this.selectAllItems(); return; }
      if (this.isCtrlDown && event.key.toLowerCase() === 'z') { event.preventDefault(); this.undo(); return; }
      if (this.isCtrlDown && event.key.toLowerCase() === 'y') { event.preventDefault(); this.redo(); return; }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); this.deleteSelected(); return; }
      const isPrintable = event.key.length === 1 && !this.isCtrlDown && !this.isAltDown; if (isPrintable && this.lastMousePos) { if (!this.isDrawing && !this.isAltDrawing && !this.isRotating && !this.isScaling && !this.isDraggingItems && !this.isDraggingNodes && !this.isSelecting) { if (this.selectionLevel === 'element') this.deselectAll(); this.createNewTextBox(this.lastMousePos.x, this.lastMousePos.y, event.key); event.preventDefault(); return; } }
    }

    handleKeyUp(event) { const wasAltDown = this.isAltDown; this.isCtrlDown = event.ctrlKey || event.metaKey; this.isShiftDown = event.shiftKey; this.isAltDown = event.altKey; this.updateCursorBasedOnContext(); if (event.key === 'Alt' && wasAltDown && !this.isAltDown) { if (this.isAltDrawing) { this.finalizeCurrentDrawing(); } this.altPreviewSourceNodeIds.clear(); this.redrawCanvas(); this.updateNodeHandles(); } }

    handleColorChange(event) {
        const newColor = event.target.value;
        this.currentColor = newColor;
        const changes = { texts: [], edges: [] };
        let redrawNeeded = false;
        this.selectedTextBoxes.forEach(box => {
            const oldColor = box.color;
            if (oldColor !== newColor) {
                if(box.setStyle(newColor, undefined)) { // Pass undefined for fontSize
                    changes.texts.push({ id: box.id, oldColor, newColor });
                }
            }
        });
        const edgesToChange = new Set(); if (this.selectionLevel === 'element' && this.elementSelectionActiveForComponentId) { this.selectedEdges.forEach(eid => edgesToChange.add(eid)); } else { this.activeComponentData.forEach(compData => compData.componentEdges.forEach(eid => edgesToChange.add(eid))); } edgesToChange.forEach(id => { if (this.graph.getEdge(id)) { const d = this.graph.getEdge(id); const oldColor = d.color; if (oldColor !== newColor) { this.graph.updateEdgeProperties(id, { color: newColor }); changes.edges.push({ id, oldColor, newColor }); redrawNeeded = true; } } });
        if (changes.texts.length > 0 || changes.edges.length > 0) { this.addHistory({ type: 'change_color', changes }); if (redrawNeeded) this.redrawCanvas(); }
    }

    handleLineWidthChange(event) { const newLineWidth = parseInt(event.target.value, 10); if (isNaN(newLineWidth) || newLineWidth < 1) return; this.currentLineWidth = newLineWidth; this.lineWidthPicker.value = newLineWidth; const changes = []; let redrawNeeded = false; const edgesToChange = new Set(); if (this.selectionLevel === 'element' && this.elementSelectionActiveForComponentId) { this.selectedEdges.forEach(eid => edgesToChange.add(eid)); } else { this.activeComponentData.forEach(compData => compData.componentEdges.forEach(eid => edgesToChange.add(eid))); } edgesToChange.forEach(id => { if (this.graph.getEdge(id)) { const d = this.graph.getEdge(id); const oldLineWidth = d.lineWidth || 2; if (oldLineWidth !== newLineWidth) { this.graph.updateEdgeProperties(id, { lineWidth: newLineWidth }); changes.push({ id, oldLineWidth, newLineWidth }); redrawNeeded = true; } } }); if (changes.length > 0) { this.addHistory({ type: 'change_linewidth', changes }); if (redrawNeeded) this.redrawCanvas(); } }

    handleFontSizeChange(event) {
        let newFontSizeVal = parseInt(event.target.value, 10); if (isNaN(newFontSizeVal)) return; newFontSizeVal = Math.max(this.MIN_FONT_SIZE, Math.min(this.MAX_FONT_SIZE, newFontSizeVal)); this.fontSizeInput.value = newFontSizeVal; const newFontSize = `${newFontSizeVal}px`; this.currentFontSize = newFontSize;
        const changes = [];
        this.selectedTextBoxes.forEach(box => {
            const oldFontSize = box.fontSize || '16px';
            if (oldFontSize !== newFontSize) {
                if(box.setStyle(undefined, newFontSize)) { // Pass undefined for color
                    changes.push({ id: box.id, oldFontSize, newFontSize });
                    // Position might need update after font size change, handled by setStyle/finalizeStyle
                }
            }
        });
        if (changes.length > 0) {
            this.addHistory({ type: 'change_fontsize', changes });
            this.resetPersistentTransformState(); // Font size change affects bbox
            this.redrawCanvas();
            this.updateTransformHandles();
        }
    }

    applyTransform(itemStates, applyStart = false) {
        itemStates.forEach(itemState => {
            const isNode = itemState.type === 'node';
            const isText = itemState.type === 'text';
            const startX = itemState.startX; const startY = itemState.startY; const endX = itemState.endX; const endY = itemState.endY;
            const startRotation = itemState.startRotation ?? 0; const endRotation = itemState.endRotation ?? startRotation;
            const startFontSize = itemState.startFontSize; const endFontSize = itemState.endFontSize ?? startFontSize;
            const targetX = applyStart ? startX : endX; const targetY = applyStart ? startY : endY;
            const targetRotation = applyStart ? startRotation : endRotation;
            const targetFontSize = applyStart ? startFontSize : endFontSize;

            if (isNode) { this.graph.updateNodePosition(itemState.id, targetX, targetY); }
            else if (isText) {
                const textBox = this.textBoxRegistry.get(itemState.id);
                if (textBox) {
                    textBox.setStyle(undefined, `${targetFontSize}px`); // Update font size
                    textBox.setRotation(targetRotation); // Update rotation
                    textBox.setPosition(targetX, targetY); // Update position (top-left)
                    textBox.finalizeStyle(); // Re-render content at final state
                }
            }
        });
    }

    addHistory(action) { if (this.undoStack.length >= this.MAX_HISTORY) { this.undoStack.shift(); } this.undoStack.push(action); this.redoStack = []; }

    undo() {
        if (this.undoStack.length === 0) return; const action = this.undoStack.pop(); let redo = null; const oldPersistent = { angle: this.selectionRotationAngle, box: this.initialBBox ? {...this.initialBBox} : null, center: this.scaleRotateCenter ? {...this.scaleRotateCenter} : null };
        try {
            switch (action.type) {
                case 'create_text':
                    const boxToUndo = this.textBoxRegistry.get(action.boxInfo.id);
                    const currentDataForRedo = boxToUndo ? boxToUndo.getDataForHistory() : action.boxInfo; // Get current state if exists
                    redo = { type: 'create_text', boxInfo: currentDataForRedo };
                    this.deleteTextBox(action.boxInfo.id); // Use the proper delete method
                    break;
                case 'delete_selected':
                    const nodesToAdd = action.deletedInfo.graph?.deletedNodes || [];
                    const edgesToAdd = action.deletedInfo.graph?.deletedEdges || [];
                    this.graph.addNodesAndEdges(nodesToAdd, edgesToAdd);
                    const createdEdgesToDelete = new Set(action.deletedInfo.graph?.createdEdges?.map(e => e.id) || []);
                    if (createdEdgesToDelete.size > 0) {
                        this.graph.deleteNodesAndEdges(new Set(), createdEdgesToDelete, generateId);
                    }
                    // Recreate text boxes from history data
                    const recreatedBoxes = [];
                    action.deletedInfo.texts.forEach(t => {
                        const newTextBox = new TextBox(t.id, t, this.textBoxContainer, this.textBoxUtils);
                        this.textBoxRegistry.set(t.id, newTextBox);
                        this.selectTextBox(newTextBox, true); // Select the restored boxes
                        recreatedBoxes.push(newTextBox);
                    });
                    // The redo action needs the state *before* undoing the delete
                    redo = { type: 'delete_selected', deletedInfo: JSON.parse(JSON.stringify(action.deletedInfo)) };
                    // Don't deselect here, keep restored items selected
                    break;
                case 'create_graph_elements': const nodeIdsToDel = new Set(action.nodes?.map(n => n.id) || []); const edgeIdsToDel = new Set(action.edges?.map(e => e.id) || []); const deletedData = this.graph.deleteNodesAndEdges(nodeIdsToDel, edgeIdsToDel, generateId); redo = { type: 'create_graph_elements', nodes: deletedData.deletedNodes, edges: [...deletedData.deletedEdges, ...deletedData.createdEdges] }; this.deselectAll(); break;
                case 'move_nodes': const rNodeMoves = []; action.moves.forEach(m => { if (this.graph.updateNodePosition(m.id, m.startX, m.startY)) { rNodeMoves.push({ ...m, startX: m.endX, startY: m.endY, endX: m.startX, endY: m.startY }); } }); redo = { type: 'move_nodes', moves: rNodeMoves }; this.resetPersistentTransformState(); break;
                case 'move_text': const rTextMoves = []; action.moves.forEach(m => {
                    const box = this.textBoxRegistry.get(m.id);
                    if(box) {
                        box.setPosition(m.startX, m.startY);
                        box.setRotation(m.startRotation ?? 0);
                        // Font size unchanged during simple move
                        box.finalizeStyle(); // Ensure render matches state
                        rTextMoves.push({ ...m, startX: m.endX, startY: m.endY, endX: m.startX, endY: m.startY, startRotation: m.endRotation, endRotation: m.startRotation });
                    }
                    }); redo = { type: 'move_text', moves: rTextMoves }; this.resetPersistentTransformState(); break;
                case 'transform_items':
                    const currentStatesForRedo = action.items.map(item => {
                            if (item.type === 'node') {
                                const node = this.graph.getNode(item.id);
                                return node ? { ...item, currentX: node.x, currentY: node.y } : null;
                            } else if (item.type === 'text') {
                                const box = this.textBoxRegistry.get(item.id);
                                return box ? { ...item, currentX: box.x, currentY: box.y, currentRotation: box.rotation, currentFontSize: parseFloat(box.fontSize) } : null;
                            }
                            return null;
                        }).filter(s => s);

                    this.applyTransform(action.items, true); // Apply start state
                    // Restore previous persistent state if available
                    if (action.prevPersistent) {
                            this.selectionRotationAngle = action.prevPersistent.angle;
                            this.initialBBox = action.prevPersistent.box ? { ...action.prevPersistent.box } : null;
                            this.scaleRotateCenter = action.prevPersistent.center ? { ...action.prevPersistent.center } : null;
                        } else {
                        this.selectionRotationAngle = action.startAngle ?? 0;
                        this.scaleRotateCenter = action.startCenter ? { ...action.startCenter } : { x: 0, y: 0 };
                        this.initialBBox = action.startBBox ? { ...action.startBBox } : null;
                        }
                        redo = { ...action, items: currentStatesForRedo, prevPersistent: oldPersistent }; // Store current state for redo
                    break;
                case 'change_color': const rColChanges = { texts: [], edges: [] }; action.changes.texts.forEach(c => {
                    const box = this.textBoxRegistry.get(c.id); if(box && box.setStyle(c.oldColor, undefined)){ rColChanges.texts.push({ id: c.id, oldColor: c.newColor, newColor: c.oldColor }); } }); action.changes.edges.forEach(c => { if(this.graph.updateEdgeProperties(c.id, {color: c.oldColor})){ rColChanges.edges.push({ id: c.id, oldColor: c.newColor, newColor: c.oldColor }); } }); redo = { type: 'change_color', changes: rColChanges }; break;
                case 'change_linewidth': const rLwChanges = []; action.changes.forEach(c => { if(this.graph.updateEdgeProperties(c.id, {lineWidth: c.oldLineWidth})){ rLwChanges.push({ id: c.id, oldLineWidth: c.newLineWidth, newLineWidth: c.oldLineWidth }); } }); redo = { type: 'change_linewidth', changes: rLwChanges }; break;
                case 'change_fontsize': const rFsChanges = []; action.changes.forEach(c => {
                    const box = this.textBoxRegistry.get(c.id); if(box && box.setStyle(undefined, c.oldFontSize)){ rFsChanges.push({ id: c.id, oldFontSize: c.newFontSize, newFontSize: c.oldFontSize }); } }); redo = { type: 'change_fontsize', changes: rFsChanges }; this.resetPersistentTransformState(); break;
            }
            if (redo) this.redoStack.push(redo);
        } catch (e) { console.error("Undo err:", e, action); this.redoStack = []; this.resetPersistentTransformState(); }
        this.redrawCanvas(); this.updateNodeHandles(); this.updateTransformHandles(); this.updateCursorBasedOnContext();
    }

    redo() {
        if (this.redoStack.length === 0) return; const action = this.redoStack.pop(); let undo = null; const oldPersistent = { angle: this.selectionRotationAngle, box: this.initialBBox ? {...this.initialBBox} : null, center: this.scaleRotateCenter ? {...this.scaleRotateCenter} : null };
        try {
            switch (action.type) {
                case 'create_text':
                    const boxData = action.boxInfo;
                    const newTextBox = new TextBox(boxData.id, boxData, this.textBoxContainer, this.textBoxUtils);
                    this.textBoxRegistry.set(boxData.id, newTextBox);
                    // Re-add event listeners
                    newTextBox.element.addEventListener('mouseenter', (event) => { /* ... */ });
                    newTextBox.element.addEventListener('mouseleave', (event) => { /* ... */ });
                    newTextBox.element.addEventListener('focusout', (event) => { /* ... */ });
                    newTextBox.element.addEventListener('dragstart', (e) => e.preventDefault());
                    newTextBox.element.addEventListener('input', (event) => { /* ... */ });
                    // History state before redo
                    undo = { type: 'create_text', boxInfo: boxData };
                    this.deselectAll();
                    this.selectTextBox(newTextBox);
                    break;
                case 'delete_selected':
                    const deletedHistory_r = { texts: [], graph: null };
                    action.deletedInfo.texts.forEach(t => {
                        const box = this.textBoxRegistry.get(t.id);
                        if (box) {
                            deletedHistory_r.texts.push(box.getDataForHistory()); // State before delete
                            this.deleteTextBox(t.id);
                        }
                    });
                    const nodesToDel_r = new Set(action.deletedInfo.graph?.deletedNodes?.map(n => n.id) || []);
                    const edgesToDel_r = new Set(action.deletedInfo.graph?.deletedEdges?.map(e => e.id) || []);
                    deletedHistory_r.graph = this.graph.deleteNodesAndEdges(nodesToDel_r, edgesToDel_r, generateId);
                    if (deletedHistory_r.texts.length > 0 || (deletedHistory_r.graph && (deletedHistory_r.graph.deletedNodes.length > 0 || deletedHistory_r.graph.deletedEdges.length > 0 || deletedHistory_r.graph.createdEdges.length > 0))) {
                        undo = { type: 'delete_selected', deletedInfo: deletedHistory_r };
                    }
                    this.deselectAll();
                    break;
                case 'create_graph_elements': const nodesToAdd_r = action.nodes || []; const edgesToAdd_r = action.edges || []; this.graph.addNodesAndEdges(nodesToAdd_r, edgesToAdd_r); undo = { type: 'create_graph_elements', nodes: nodesToAdd_r, edges: edgesToAdd_r }; const firstNodeId_r = action.nodes?.[0]?.id || action.edges?.[0]?.node1Id; this.deselectAll(); if (firstNodeId_r) this.selectComponent(firstNodeId_r, 'node'); break;
                case 'move_nodes': const uNodeMoves = []; action.moves.forEach(m => { if (this.graph.updateNodePosition(m.id, m.endX, m.endY)) { uNodeMoves.push({ ...m, startX: m.endX, startY: m.endY, endX: m.startX, endY: m.startY }); } }); undo = { type: 'move_nodes', moves: uNodeMoves }; this.resetPersistentTransformState(); break;
                case 'move_text': const uTextMoves = []; action.moves.forEach(m => {
                    const box = this.textBoxRegistry.get(m.id);
                    if(box) {
                        box.setPosition(m.endX, m.endY);
                        box.setRotation(m.endRotation ?? 0);
                        box.finalizeStyle();
                        uTextMoves.push({ ...m, startX: m.endX, startY: m.endY, endX: m.startX, endY: m.startY, startRotation: m.endRotation, endRotation: m.startRotation });
                    }
                    }); undo = { type: 'move_text', moves: uTextMoves }; this.resetPersistentTransformState(); break;
                case 'transform_items':
                    const historyItemsForUndo = action.items.map(item => ({ // Map back to original format for applyTransform
                        id: item.id, type: item.type,
                        startX: item.startX, startY: item.startY, endX: item.currentX, endY: item.currentY,
                        startWidth: item.startWidth, startHeight: item.startHeight,
                        startRotation: item.startRotation, endRotation: item.currentRotation,
                        startFontSize: item.startFontSize, endFontSize: item.currentFontSize,
                        startScaleX: 1, startScaleY: 1,
                        endScaleX: action.endScaleX, endScaleY: action.endScaleY // Keep scale factors from original action
                    }));
                    this.applyTransform(historyItemsForUndo, false); // Apply 'current' state which is the end state
                    if (action.prevPersistent) { // Restore persistent state from action
                        this.selectionRotationAngle = action.prevPersistent.angle;
                        this.initialBBox = action.prevPersistent.box ? { ...action.prevPersistent.box } : null;
                        this.scaleRotateCenter = action.prevPersistent.center ? { ...action.prevPersistent.center } : null;
                    } else { this.resetPersistentTransformState(); }
                    undo = { ...action, items: historyItemsForUndo, prevPersistent: oldPersistent }; // Store state before redo for undo
                    break;
                case 'change_color': const uColChanges = { texts: [], edges: [] }; action.changes.texts.forEach(c => {
                    const box = this.textBoxRegistry.get(c.id); if(box && box.setStyle(c.newColor, undefined)){ uColChanges.texts.push({ id: c.id, oldColor: c.newColor, newColor: c.oldColor }); } }); action.changes.edges.forEach(c => { if(this.graph.updateEdgeProperties(c.id, {color: c.newColor})){ uColChanges.edges.push({ id: c.id, oldColor: c.newColor, newColor: c.oldColor }); } }); undo = { type: 'change_color', changes: uColChanges }; break;
                case 'change_linewidth': const uLwChanges = []; action.changes.forEach(c => { if(this.graph.updateEdgeProperties(c.id, {lineWidth: c.newLineWidth})){ uLwChanges.push({ id: c.id, oldLineWidth: c.newLineWidth, newLineWidth: c.oldLineWidth }); } }); undo = { type: 'change_linewidth', changes: uLwChanges }; break;
                case 'change_fontsize': const uFsChanges = []; action.changes.forEach(c => {
                    const box = this.textBoxRegistry.get(c.id); if(box && box.setStyle(undefined, c.newFontSize)){ uFsChanges.push({ id: c.id, oldFontSize: c.newFontSize, newFontSize: c.oldFontSize }); } }); undo = { type: 'change_fontsize', changes: uFsChanges }; this.resetPersistentTransformState(); break;
            }
            if (undo) this.undoStack.push(undo);
        } catch (e) { console.error("Redo err:", e, action); this.undoStack = []; this.resetPersistentTransformState(); }
        this.redrawCanvas(); this.updateNodeHandles(); this.updateTransformHandles(); this.updateCursorBasedOnContext();
    }

    init() {
      this.lineWidthPicker.value = this.currentLineWidth; this.fontSizeInput.value = parseInt(this.currentFontSize, 10); this.colorPicker.value = this.currentColor;
      this.resizeCanvas(); window.addEventListener('resize', this.resizeCanvas.bind(this));
      document.addEventListener('mousedown', this.handleMouseDown.bind(this)); document.addEventListener('mousemove', this.handleMouseMove.bind(this)); document.addEventListener('mouseup', this.handleMouseUp.bind(this)); document.addEventListener('contextmenu', (e) => e.preventDefault()); document.addEventListener('keydown', this.handleKeyDown.bind(this)); document.addEventListener('keyup', this.handleKeyUp.bind(this)); document.addEventListener('dblclick', this.handleDoubleClick.bind(this));
      this.colorPicker.addEventListener('input', this.handleColorChange.bind(this)); this.colorPicker.addEventListener('change', this.handleColorChange.bind(this)); this.lineWidthPicker.addEventListener('change', this.handleLineWidthChange.bind(this)); this.fontSizeInput.addEventListener('change', this.handleFontSizeChange.bind(this)); this.fontSizeInput.addEventListener('input', this.handleFontSizeChange.bind(this));
      const handleCanvasMouseEnter = () => { const activeElement = document.activeElement; if (activeElement === this.colorPicker || activeElement === this.lineWidthPicker || activeElement === this.fontSizeInput) { activeElement.blur(); setTimeout(() => { this.body.focus({ preventScroll: true }); }, 0); } };
      if (this.canvas) { this.canvas.addEventListener('mouseenter', handleCanvasMouseEnter); }
      this.body.focus({ preventScroll: true }); this.updateCursorBasedOnContext(); this.updateTransformHandles();
    }
  }
  new GraphEditor();
});
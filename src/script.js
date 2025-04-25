// Import KaTeX helper functions
import { formatStringToMathDisplay, renderStringToElement } from './katex.js';
// You might still need the main katex import if you use katex.render directly elsewhere
import katex from 'katex';

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

            this.DRAG_THRESHOLD = 5;
            this.NODE_HIT_THRESHOLD = 8;
            this.EDGE_HIT_THRESHOLD = 5;
            this.MAX_HISTORY = 50;
            this.HANDLE_ICON_SIZE = 16;
            this.HANDLE_VISUAL_OFFSET = this.HANDLE_ICON_SIZE * 1.5;
            this.MIN_FONT_SIZE = 1;
            this.MAX_FONT_SIZE = 400;
            this.MIN_SCALE = 0.05;

            this.nodeRegistry = new Map();
            this.edgeRegistry = new Map();
            this.textBoxRegistry = new Map();

            this.selectedTextBoxes = new Set();
            this.activeComponentData = new Map();
            this.selectedNodes = new Set();
            this.selectedEdges = new Set();
            this.elementSelectionActiveForComponentId = null;
            this.selectionLevel = 'component';

            this.activeTextBox = null;
            this.mouseOverBox = null;
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
            this.currentScaleFactor = 1; // Overall/uniform scale factor if applicable
            this.currentScaleFactorX = 1; // Non-uniform X scale factor
            this.currentScaleFactorY = 1; // Non-uniform Y scale factor
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

            this.init();
        }

        generateId() { return Date.now().toString(36) + Math.random().toString(36).substring(2); }
        moveCaretToEnd(element) { if (!element || typeof window.getSelection === 'undefined' || !element.isContentEditable) return; const range = document.createRange(); const selection = window.getSelection(); if (document.activeElement !== element) { element.focus({ preventScroll: true }); } setTimeout(() => { if (document.activeElement === element && element.isContentEditable) { try { range.selectNodeContents(element); range.collapse(false); selection.removeAllRanges(); selection.addRange(range); } catch (e) { console.error("Error moving caret:", e); } } }, 0); }
        sqrDist(p1, p2) { const dx = p1.x - p2.x; const dy = p1.y - p2.y; return dx * dx + dy * dy; }
        distToSegmentSquared(p, v, w) { const l2 = this.sqrDist(v, w); if (l2 === 0) return this.sqrDist(p, v); let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2; t = Math.max(0, Math.min(1, t)); const projection = { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) }; return this.sqrDist(p, projection); }
        getNodeAtPoint(point, threshold = this.NODE_HIT_THRESHOLD) { const thresholdSq = threshold * threshold; for (const node of this.nodeRegistry.values()) { if (this.sqrDist(point, node) <= thresholdSq) return node; } return null; }
        getEdgeAtPoint(point, threshold = this.EDGE_HIT_THRESHOLD) { const thresholdSq = threshold * threshold; const edges = Array.from(this.edgeRegistry.values()).reverse(); for (const edge of edges) { const n1 = this.nodeRegistry.get(edge.node1Id); const n2 = this.nodeRegistry.get(edge.node2Id); if (n1 && n2) { if (this.distToSegmentSquared(point, n1, n2) <= thresholdSq + (edge.lineWidth || 1)) { return edge; } } } return null; }
        findConnectedComponent(startElementId, elementType) { const componentNodes = new Set(); const componentEdges = new Set(); const queue = []; const visitedNodes = new Set(); const visitedEdges = new Set(); let startNodeId = null; let startEdge = null; let representativeId = startElementId; if (elementType === 'node') { if (!this.nodeRegistry.has(startElementId)) return { componentNodes, componentEdges, representativeId: null }; startNodeId = startElementId; } else if (elementType === 'edge') { startEdge = this.edgeRegistry.get(startElementId); if (!startEdge) return { componentNodes, componentEdges, representativeId: null }; visitedEdges.add(startElementId); componentEdges.add(startElementId); } else if (elementType === 'text') { return { componentNodes: new Set(), componentEdges: new Set(), representativeId: startElementId }; } else { return { componentNodes, componentEdges, representativeId: null }; } let initialNodeId = null; if (startNodeId) { initialNodeId = startNodeId; } else if (startEdge) { initialNodeId = startEdge.node1Id; } if (initialNodeId && this.nodeRegistry.has(initialNodeId) && !visitedNodes.has(initialNodeId)) { queue.push(initialNodeId); visitedNodes.add(initialNodeId); componentNodes.add(initialNodeId); representativeId = representativeId ?? initialNodeId; } if (startEdge && startEdge.node2Id && this.nodeRegistry.has(startEdge.node2Id) && !visitedNodes.has(startEdge.node2Id)) { const node2Id = startEdge.node2Id; queue.push(node2Id); visitedNodes.add(node2Id); componentNodes.add(node2Id); representativeId = representativeId ?? node2Id; } while (queue.length > 0) { const currentNodeId = queue.shift(); for (const edge of this.edgeRegistry.values()) { let neighborNodeId = null; if (edge.node1Id === currentNodeId && this.nodeRegistry.has(edge.node2Id) && !visitedNodes.has(edge.node2Id)) neighborNodeId = edge.node2Id; else if (edge.node2Id === currentNodeId && this.nodeRegistry.has(edge.node1Id) && !visitedNodes.has(edge.node1Id)) neighborNodeId = edge.node1Id; if (neighborNodeId) { visitedNodes.add(neighborNodeId); componentNodes.add(neighborNodeId); queue.push(neighborNodeId); } if ((edge.node1Id === currentNodeId || edge.node2Id === currentNodeId) && !visitedEdges.has(edge.id)) { visitedEdges.add(edge.id); componentEdges.add(edge.id); } } } return { componentNodes, componentEdges, representativeId }; }
        getComponentIdForElement(elementId, elementType) { if(elementType === 'text') return elementId; let foundKey = null; this.activeComponentData.forEach((data, key) => { if ((elementType === 'node' && data.componentNodes.has(elementId)) || (elementType === 'edge' && data.componentEdges.has(elementId))) { foundKey = key; } }); if (foundKey) return foundKey; const { representativeId } = this.findConnectedComponent(elementId, elementType); return representativeId; }
        getNodeDegree(nodeId) { let degree = 0; for (const edge of this.edgeRegistry.values()) { if (edge.node1Id === nodeId || edge.node2Id === nodeId) { degree++; } } return degree; }
        edgeExists(node1Id, node2Id) { for (const edge of this.edgeRegistry.values()) { if ((edge.node1Id === node1Id && edge.node2Id === node2Id) || (edge.node1Id === node2Id && edge.node2Id === node1Id)) { return true; } } return false; }
        setDrawingState(drawing, mode) { this.isDrawing = drawing; this.drawingMode = mode; }
        rotatePoint(point, center, angle) { const cosA = Math.cos(angle); const sinA = Math.sin(angle); const dx = point.x - center.x; const dy = point.y - center.y; const rotatedX = dx * cosA - dy * sinA + center.x; const rotatedY = dx * sinA + dy * cosA + center.y; return { x: rotatedX, y: rotatedY }; }
        getCombinedBoundingBox(nodeIds, textBoxIds, useRegistry = false) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            let elementCount = 0;
            const PADDING = 2; // Small padding around the bounding box

            nodeIds.forEach(nodeId => {
                const node = this.nodeRegistry.get(nodeId);
                if (node) {
                    minX = Math.min(minX, node.x);
                    minY = Math.min(minY, node.y);
                    maxX = Math.max(maxX, node.x);
                    maxY = Math.max(maxY, node.y);
                    elementCount++;
                }
            });

            textBoxIds.forEach(boxId => {
                const data = this.textBoxRegistry.get(boxId);
                const box = data?.element;

                if (!data) return;

                let x, y, width, height, rotation;

                if (box && box.offsetParent && !useRegistry) {
                    x = parseFloat(box.style.left);
                    y = parseFloat(box.style.top);
                    rotation = data.rotation ?? 0;
                    width = box.offsetWidth;
                    height = box.offsetHeight;
                } else {
                    x = data.x;
                    y = data.y;
                    rotation = data.rotation ?? 0;
                    width = data.width || 10;
                    height = data.height || 10;
                }

                if (isNaN(x) || isNaN(y) || width <= 0 || height <= 0) return;

                const cx = x + width / 2;
                const cy = y + height / 2;
                const center = { x: cx, y: cy };

                const points = [
                    { x: x, y: y },
                    { x: x + width, y: y },
                    { x: x + width, y: y + height },
                    { x: x, y: y + height }
                ];

                const rotatedPoints = points.map(p => this.rotatePoint(p, center, rotation));

                rotatedPoints.forEach(p => {
                    minX = Math.min(minX, p.x);
                    minY = Math.min(minY, p.y);
                    maxX = Math.max(maxX, p.x);
                    maxY = Math.max(maxY, p.y);
                });
                elementCount++;
            });

            if (elementCount === 0) return null;

            const finalMinX = minX - PADDING;
            const finalMinY = minY - PADDING;
            const finalMaxX = maxX + PADDING;
            const finalMaxY = maxY + PADDING;
            const finalWidth = Math.max(0, finalMaxX - finalMinX);
            const finalHeight = Math.max(0, finalMaxY - finalMinY);

            return {
                minX: finalMinX, minY: finalMinY,
                maxX: finalMaxX, maxY: finalMaxY,
                centerX: finalMinX + finalWidth / 2, centerY: finalMinY + finalHeight / 2,
                width: finalWidth, height: finalHeight
            };
        }
        getSelectionBoundingBox(useRegistry = false) {
            const nodeIds = new Set(); const textBoxIds = new Set();
            if (this.selectionLevel === 'component') {
                this.activeComponentData.forEach(compData => { compData.componentNodes.forEach(nid => nodeIds.add(nid)); });
                this.selectedTextBoxes.forEach(box => textBoxIds.add(box.dataset.id));
            }

            if (nodeIds.size > 0 || textBoxIds.size > 0) {
               return this.getCombinedBoundingBox(nodeIds, textBoxIds, useRegistry);
            } return null;
        }
        getRotatedTextBoxCorners(textBoxElement) {
            const data = this.textBoxRegistry.get(textBoxElement.dataset.id);
            if (!data || !textBoxElement.offsetParent) return null;
            const x = parseFloat(textBoxElement.style.left); const y = parseFloat(textBoxElement.style.top);
            if (isNaN(x) || isNaN(y)) return null;
            const rotation = data.rotation ?? 0;
            const width = textBoxElement.offsetWidth; const height = textBoxElement.offsetHeight;
            if (width <= 0 || height <= 0) return null;
            const cx = x + width / 2; const cy = y + height / 2; const center = { x: cx, y: cy };
            const points = { tl: { x: x, y: y }, tr: { x: x + width, y: y }, br: { x: x + width, y: y + height }, bl: { x: x, y: y + height } };
            return {
                tl: this.rotatePoint(points.tl, center, rotation),
                tr: this.rotatePoint(points.tr, center, rotation),
                br: this.rotatePoint(points.br, center, rotation),
                bl: this.rotatePoint(points.bl, center, rotation),
                center: center
            };
        }

        updateTransformHandles() {
            const rotateHandle = this.rotateHandleIconElem;
            const scaleHandle = this.scaleHandleIconElem;
            const isAnySelectionActive = this.selectionLevel === 'component' && (this.activeComponentData.size > 0 || this.selectedTextBoxes.size > 0);
            const isWritingMode = !!this.activeTextBox;
        
            if (isWritingMode || !isAnySelectionActive || this.isDrawing || this.isSelecting || this.selectionLevel === 'element') {
                rotateHandle.style.display = 'none'; scaleHandle.style.display = 'none'; return;
            }
        
            let refBoxWidth, refBoxHeight, centerForTransform, rotationForTransform;
        
            // During transform, use the start state scaled/rotated by current factors
            if (this.isRotating || this.isScaling) {
                if (!this.dragStartStates.length || !this.dragStartStates[0].startBBox || !this.dragStartStates[0].startCenter) {
                    rotateHandle.style.display = 'none'; scaleHandle.style.display = 'none'; return;
                }
                const startBBox = this.dragStartStates[0].startBBox;
                const startCenter = this.dragStartStates[0].startCenter;
                const startGroupRotation = this.dragStartStates[0].startGroupRotation ?? 0;
        
                centerForTransform = startCenter;
                rotationForTransform = startGroupRotation + (this.isRotating ? this.currentRotationAngle : 0);
        
                // Use the current X/Y scale factors calculated in mouseMove for handle positioning
                const scaleX = this.currentScaleFactorX;
                const scaleY = this.currentScaleFactorY;
        
                if (startBBox.width < 0 || startBBox.height < 0) { rotateHandle.style.display = 'none'; scaleHandle.style.display = 'none'; return; }
        
                refBoxWidth = startBBox.width * Math.abs(scaleX);
                refBoxHeight = startBBox.height * Math.abs(scaleY);
            }
            // When idle, use the persistent state or calculate it
            else {
                 const usePersistentState = this.initialBBox && this.initialBBox.width >= 0 && this.initialBBox.height >= 0 && this.scaleRotateCenter.x !== 0 && this.scaleRotateCenter.y !== 0;
                 const isSingleTextBoxSelected = this.selectedTextBoxes.size === 1 && this.activeComponentData.size === 0;
        
                 if (isSingleTextBoxSelected && !usePersistentState) {
                     const textBoxElement = this.selectedTextBoxes.values().next().value;
                     const corners = this.getRotatedTextBoxCorners(textBoxElement);
                     if (!corners || textBoxElement.offsetWidth <= 0 || textBoxElement.offsetHeight <= 0) { rotateHandle.style.display = 'none'; scaleHandle.style.display = 'none'; return; }
                     refBoxWidth = textBoxElement.offsetWidth; refBoxHeight = textBoxElement.offsetHeight; centerForTransform = corners.center; rotationForTransform = this.textBoxRegistry.get(textBoxElement.dataset.id)?.rotation ?? 0;
                     // Initialize persistent state based on this single box
                     this.initialBBox = this.getCombinedBoundingBox(new Set(), new Set([textBoxElement.dataset.id]));
                     if(this.initialBBox) { this.scaleRotateCenter = { x: this.initialBBox.centerX, y: this.initialBBox.centerY }; this.selectionRotationAngle = rotationForTransform; }
                     else { this.scaleRotateCenter = corners.center; this.selectionRotationAngle = rotationForTransform; this.initialBBox = {centerX: corners.center.x, centerY: corners.center.y, width: refBoxWidth, height: refBoxHeight, minX: corners.center.x - refBoxWidth/2, minY: corners.center.y - refBoxHeight/2, maxX: corners.center.x + refBoxWidth/2, maxY: corners.center.y + refBoxHeight/2 }; }
                 } else if (usePersistentState) {
                     refBoxWidth = this.initialBBox.width; refBoxHeight = this.initialBBox.height; centerForTransform = this.scaleRotateCenter; rotationForTransform = this.selectionRotationAngle;
                 } else {
                     const currentBBox = this.getSelectionBoundingBox();
                     if (!currentBBox || currentBBox.width < 0 || currentBBox.height < 0) { rotateHandle.style.display = 'none'; scaleHandle.style.display = 'none'; return; }
                     refBoxWidth = currentBBox.width; refBoxHeight = currentBBox.height; centerForTransform = { x: currentBBox.centerX, y: currentBBox.centerY }; rotationForTransform = 0;
                     // Initialize persistent state
                     this.initialBBox = currentBBox; this.scaleRotateCenter = centerForTransform; this.selectionRotationAngle = rotationForTransform;
                 }
            }
        
            // --- Calculate Visual Corners ---
            const halfWidth = refBoxWidth / 2;
            const halfHeight = refBoxHeight / 2;
            let relativeCorners = [ { x: -halfWidth, y: -halfHeight }, { x: halfWidth, y: -halfHeight }, { x: halfWidth, y: halfHeight }, { x: -halfWidth, y: halfHeight } ];
        
            // Check for negative scaling to flip corners for handle placement visually
            const visScaleX = this.isScaling ? this.currentScaleFactorX : 1;
            const visScaleY = this.isScaling ? this.currentScaleFactorY : 1;
            if (visScaleX < 0) { relativeCorners = relativeCorners.map(p => ({ x: -p.x, y: p.y })); }
            if (visScaleY < 0) { relativeCorners = relativeCorners.map(p => ({ x: p.x, y: -p.y })); }
        
            const visualCorners = {
                tl: this.rotatePoint({ x: centerForTransform.x + relativeCorners[0].x, y: centerForTransform.y + relativeCorners[0].y }, centerForTransform, rotationForTransform),
                tr: this.rotatePoint({ x: centerForTransform.x + relativeCorners[1].x, y: centerForTransform.y + relativeCorners[1].y }, centerForTransform, rotationForTransform),
                br: this.rotatePoint({ x: centerForTransform.x + relativeCorners[2].x, y: centerForTransform.y + relativeCorners[2].y }, centerForTransform, rotationForTransform),
                bl: this.rotatePoint({ x: centerForTransform.x + relativeCorners[3].x, y: centerForTransform.y + relativeCorners[3].y }, centerForTransform, rotationForTransform)
            };
        
            // --- Position Handles directly on corners ---
            const handleHalfSize = this.HANDLE_ICON_SIZE / 2;
        
            // Rotate Handle (Top Right)
            const rotateHandleCenterX = visualCorners.tr.x;
            const rotateHandleCenterY = visualCorners.tr.y;
            rotateHandle.style.left = `${rotateHandleCenterX - handleHalfSize}px`;
            rotateHandle.style.top = `${rotateHandleCenterY - handleHalfSize}px`;
            rotateHandle.style.display = 'block';
        
            // Scale Handle (Bottom Right)
            const scaleHandleCenterX = visualCorners.br.x;
            const scaleHandleCenterY = visualCorners.br.y;
            scaleHandle.style.left = `${scaleHandleCenterX - handleHalfSize}px`;
            scaleHandle.style.top = `${scaleHandleCenterY - handleHalfSize}px`;
            scaleHandle.style.display = 'block';
        }
        updateCursorBasedOnContext() {
            const targetElement = document.elementFromPoint(this.lastMousePos.x, this.lastMousePos.y);

            if (this.isRotating || this.isScaling || this.isDraggingNodes) { this.body.style.cursor = 'grabbing'; return; }
            if (this.isDraggingItems) { this.body.style.cursor = 'move'; return; }
            if (this.isDrawing || (this.isAltDown && !this.isAltDrawing) || this.isAltDrawing) { this.body.style.cursor = 'crosshair'; return; }
            if (this.isSelecting && !this.potentialRightClick) { this.body.style.cursor = 'default'; return; }

            if (targetElement === this.rotateHandleIconElem || targetElement === this.scaleHandleIconElem) { this.body.style.cursor = 'grab'; return; }

            let cursorStyle = 'default';
            const hoveringAnyTextBox = targetElement?.classList.contains('textBox');

            if (hoveringAnyTextBox) {
                cursorStyle = (targetElement === this.activeTextBox && targetElement.isContentEditable) ? 'text' : 'pointer';
            } else if (this.selectionLevel === 'element' && this.elementSelectionActiveForComponentId && (this.mouseOverNodeId || this.mouseOverEdgeId)) {
                cursorStyle = 'pointer';
            } else if (this.selectionLevel === 'component' && (this.mouseOverNodeId || this.mouseOverEdgeId || this.mouseOverBox)) {
                cursorStyle = 'pointer';
            }
            this.body.style.cursor = cursorStyle;
        }

        resizeCanvas() { this.canvas.width = window.innerWidth; this.canvas.height = window.innerHeight; this.redrawCanvas(); this.updateNodeHandles(); this.updateTransformHandles(); }
        drawEdge(edge, isSelected = false, isHovered = false) { const n1 = this.nodeRegistry.get(edge.node1Id); const n2 = this.nodeRegistry.get(edge.node2Id); if (!n1 || !n2) return; this.ctx.beginPath(); this.ctx.strokeStyle = edge.color; this.ctx.lineWidth = edge.lineWidth; this.ctx.lineJoin = 'round'; this.ctx.lineCap = 'round'; this.ctx.moveTo(n1.x, n1.y); this.ctx.lineTo(n2.x, n2.y); this.ctx.stroke(); const componentId = this.getComponentIdForElement(edge.id, 'edge'); const isElementSelected = this.selectionLevel === 'element' && this.selectedEdges.has(edge.id) && this.elementSelectionActiveForComponentId === componentId; const isComponentSelected = this.selectionLevel === 'component' && this.activeComponentData.has(componentId); const isFocusedElementComponent = this.selectionLevel === 'element' && this.elementSelectionActiveForComponentId === componentId; let showHighlight = false; let highlightColor = 'gray'; let highlightWidth = edge.lineWidth + 2; let highlightAlpha = 0.4; if (isElementSelected) { showHighlight = true; highlightColor = 'blue'; highlightWidth = edge.lineWidth + 3; highlightAlpha = 0.5; } else if (isComponentSelected && this.selectionLevel === 'component') {} else if (isFocusedElementComponent && !isElementSelected) { showHighlight = true; highlightColor = 'dodgerblue'; highlightWidth = edge.lineWidth + 2; highlightAlpha = 0.4; } if (isHovered && !showHighlight && this.selectionLevel === 'element' && isFocusedElementComponent) { showHighlight = true; highlightColor = 'blue'; highlightWidth = edge.lineWidth + 3; highlightAlpha = 0.5; } if (showHighlight) { this.ctx.beginPath(); this.ctx.strokeStyle = highlightColor; this.ctx.lineWidth = highlightWidth; this.ctx.globalAlpha = highlightAlpha; this.ctx.moveTo(n1.x, n1.y); this.ctx.lineTo(n2.x, n2.y); this.ctx.stroke(); this.ctx.globalAlpha = 1.0; } }
        drawNodeHighlight(node, isHovered = false) { if (!node || !isHovered || this.selectionLevel === 'component') return; if (!this.isDrawing && !this.isDraggingNodes && !this.isDraggingItems && this.mouseDownButton === -1) { this.ctx.beginPath(); this.ctx.strokeStyle = '#aaa'; this.ctx.lineWidth = 1; this.ctx.setLineDash([2,2]); this.ctx.arc(node.x, node.y, this.NODE_HIT_THRESHOLD * 1.2, 0, Math.PI * 2); this.ctx.stroke(); this.ctx.setLineDash([]); } }
        drawRotatedRect(corners, color = 'blue', dash = [4, 4]) { if (!corners || !corners.tl || !corners.tr || !corners.br || !corners.bl) return; this.ctx.save(); this.ctx.strokeStyle = color; this.ctx.lineWidth = 1; if (dash && dash.length > 0) this.ctx.setLineDash(dash); else this.ctx.setLineDash([]); this.ctx.beginPath(); this.ctx.moveTo(corners.tl.x, corners.tl.y); this.ctx.lineTo(corners.tr.x, corners.tr.y); this.ctx.lineTo(corners.br.x, corners.br.y); this.ctx.lineTo(corners.bl.x, corners.bl.y); this.ctx.closePath(); this.ctx.stroke(); this.ctx.restore(); }
        redrawCanvas() {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            const isWritingMode = !!this.activeTextBox;
        
            this.edgeRegistry.forEach(edge => {
                const isHovered = !this.isDrawing && !this.isDraggingNodes && !this.isDraggingItems && this.mouseOverEdgeId === edge.id && this.mouseDownButton === -1;
                this.drawEdge(edge, false, isHovered);
            });
        
            this.nodeRegistry.forEach(node => {
                const isHovered = !this.isDrawing && !this.isDraggingNodes && !this.isDraggingItems && this.mouseOverNodeId === node.id && this.mouseDownButton === -1;
                this.drawNodeHighlight(node, isHovered);
            });
        
            const isAnyComponentSelectionActive = this.selectionLevel === 'component' && (this.activeComponentData.size > 0 || this.selectedTextBoxes.size > 0);
        
            if (isAnyComponentSelectionActive && !isWritingMode) {
                let cornersToDraw = null;
                let dashStyle = [4, 4];
                let colorStyle = 'blue';
        
                // --- Scaling State ---
                if (this.isScaling) {
                    if (this.dragStartStates.length > 0 && this.dragStartStates[0].startBBox && this.dragStartStates[0].startCenter) {
                         const startBBox = this.dragStartStates[0].startBBox;
                         const centerToUse = this.dragStartStates[0].startCenter;
                         const angleToDraw = this.dragStartStates[0].startGroupRotation ?? 0;
                         const cursorPos = this.lastMousePos;
        
                         if(startBBox.width >= 0 && startBBox.height >= 0) {
                            // Calculate mouse position relative to center
                            const mouseRel = { x: cursorPos.x - centerToUse.x, y: cursorPos.y - centerToUse.y };
                            // Rotate mouse position back into the local coordinate system of the bbox
                            const cosA = Math.cos(-angleToDraw);
                            const sinA = Math.sin(-angleToDraw);
                            const mouseRelLocal = {
                                x: mouseRel.x * cosA - mouseRel.y * sinA,
                                y: mouseRel.x * sinA + mouseRel.y * cosA
                            };
        
                            // Determine the local coordinates of the four corners based on mouse
                            // The mouse position directly drives the bottom-right corner's local position
                            const local_BR = { x: mouseRelLocal.x, y: mouseRelLocal.y };
                            // Top-left is determined symmetrically for now (can be adjusted if needed)
                            // Or, more accurately, define corners based on mouseRelLocal extent
                            const newHalfWidthLocal = mouseRelLocal.x;
                            const newHalfHeightLocal = mouseRelLocal.y;
        
                            const local_TL = { x: -newHalfWidthLocal, y: -newHalfHeightLocal };
                            const local_TR = { x: newHalfWidthLocal, y: -newHalfHeightLocal };
                            // local_BR is already defined
                            const local_BL = { x: -newHalfWidthLocal, y: newHalfHeightLocal };
        
                            // Rotate local corners back to screen space
                            cornersToDraw = {
                                tl: this.rotatePoint({ x: centerToUse.x + local_TL.x, y: centerToUse.y + local_TL.y }, centerToUse, angleToDraw),
                                tr: this.rotatePoint({ x: centerToUse.x + local_TR.x, y: centerToUse.y + local_TR.y }, centerToUse, angleToDraw),
                                br: this.rotatePoint({ x: centerToUse.x + local_BR.x, y: centerToUse.y + local_BR.y }, centerToUse, angleToDraw),
                                bl: this.rotatePoint({ x: centerToUse.x + local_BL.x, y: centerToUse.y + local_BL.y }, centerToUse, angleToDraw)
                            };
                            colorStyle = 'dodgerblue';
                         }
                    }
                }
                // --- Rotating / Dragging / Idle State ---
                else {
                     let boxToDraw = null; let angleToDraw = 0; let centerToUse = null;
                     let visualScaleX = 1; let visualScaleY = 1; // For handling negative scales if needed
        
                     if (this.isRotating) {
                         if (this.dragStartStates.length > 0 && this.dragStartStates[0].startBBox && this.dragStartStates[0].startCenter) {
                             const startBBox = this.dragStartStates[0].startBBox; centerToUse = this.dragStartStates[0].startCenter;
                             const startGroupRotation = this.dragStartStates[0].startGroupRotation ?? 0;
                             angleToDraw = startGroupRotation + this.currentRotationAngle;
        
                             // Use current X/Y scale factors for visual representation during rotation
                             visualScaleX = this.currentScaleFactorX; // Should be 1 during rotation unless combined
                             visualScaleY = this.currentScaleFactorY; // Should be 1 during rotation unless combined
        
                             boxToDraw = { centerX: centerToUse.x, centerY: centerToUse.y, width: startBBox.width * Math.abs(visualScaleX), height: startBBox.height * Math.abs(visualScaleY) };
                             dashStyle = [4, 4]; colorStyle = 'dodgerblue';
                         }
                     } else if (this.isDraggingNodes || this.isDraggingItems) {
                          const usePersistentState = this.initialBBox && this.initialBBox.width >= 0 && this.initialBBox.height >= 0 && this.scaleRotateCenter.x !== 0 && this.scaleRotateCenter.y !== 0;
                          if (usePersistentState) {
                              boxToDraw = { centerX: this.scaleRotateCenter.x, centerY: this.scaleRotateCenter.y, width: this.initialBBox.width, height: this.initialBBox.height };
                              centerToUse = this.scaleRotateCenter; angleToDraw = this.selectionRotationAngle;
                              dashStyle = [4, 4]; colorStyle = 'dodgerblue';
                          } else {
                              const currentBBox = this.getSelectionBoundingBox();
                              if (currentBBox && currentBBox.width >= 0 && currentBBox.height >= 0) {
                                  boxToDraw = { ...currentBBox }; centerToUse = { x: currentBBox.centerX, y: currentBBox.centerY }; angleToDraw = 0; dashStyle = [4, 4]; colorStyle = 'dodgerblue';
                              }
                          }
                     } else { // Idle state
                          const usePersistentState = this.initialBBox && this.initialBBox.width >= 0 && this.initialBBox.height >= 0 && this.scaleRotateCenter.x !== 0 && this.scaleRotateCenter.y !== 0;
                          if (usePersistentState) {
                              boxToDraw = { centerX: this.scaleRotateCenter.x, centerY: this.scaleRotateCenter.y, width: this.initialBBox.width, height: this.initialBBox.height };
                              centerToUse = this.scaleRotateCenter; angleToDraw = this.selectionRotationAngle; dashStyle = [4, 4]; colorStyle = 'blue';
                          } else {
                              const currentBBox = this.getSelectionBoundingBox();
                              if (currentBBox && currentBBox.width >= 0 && currentBBox.height >= 0) {
                                  boxToDraw = { ...currentBBox }; centerToUse = { x: currentBBox.centerX, y: currentBBox.centerY }; angleToDraw = 0; dashStyle = [4, 4]; colorStyle = 'blue';
                                  // Initialize persistent state if calculated
                                  this.initialBBox = currentBBox; this.scaleRotateCenter = centerToUse; this.selectionRotationAngle = angleToDraw;
                              }
                          }
                     }
        
                     if (boxToDraw && centerToUse && boxToDraw.width >= 0 && boxToDraw.height >= 0) {
                         const halfWidth = boxToDraw.width / 2; const halfHeight = boxToDraw.height / 2;
                         let relativeCorners = [ { x: -halfWidth, y: -halfHeight }, { x: halfWidth, y: -halfHeight }, { x: halfWidth, y: halfHeight }, { x: -halfWidth, y: halfHeight } ];
        
                         // Check for negative scaling to flip corners for drawing if needed
                         if (visualScaleX < 0) { relativeCorners = relativeCorners.map(p => ({ x: -p.x, y: p.y })); }
                         if (visualScaleY < 0) { relativeCorners = relativeCorners.map(p => ({ x: p.x, y: -p.y })); }
        
                         const rotatedCorners = relativeCorners.map(p => this.rotatePoint({ x: centerToUse.x + p.x, y: centerToUse.y + p.y }, centerToUse, angleToDraw));
                         cornersToDraw = { tl: rotatedCorners[0], tr: rotatedCorners[1], br: rotatedCorners[2], bl: rotatedCorners[3] };
                     }
                }
        
                // --- Draw the calculated box ---
                if (cornersToDraw) {
                    this.drawRotatedRect(cornersToDraw, colorStyle, dashStyle);
                }
        
            } else if (this.selectionLevel === 'component' && !isWritingMode) {
                // Hover feedback logic remains the same...
                let hoverCorners = null;
                const targetElement = document.elementFromPoint(this.lastMousePos.x, this.lastMousePos.y);
                const isHoveringHandle = targetElement === this.rotateHandleIconElem || targetElement === this.scaleHandleIconElem;
                if (!isHoveringHandle && !this.isDrawing && !this.isSelecting && !this.isRotating && !this.isScaling && this.mouseDownButton === -1) {
                    if (this.mouseOverNodeId || this.mouseOverEdgeId) {
                        const hoveredElementId = this.mouseOverNodeId || this.mouseOverEdgeId; const hoveredElementType = this.mouseOverNodeId ? 'node' : 'edge'; const compId = this.getComponentIdForElement(hoveredElementId, hoveredElementType); if (compId) { const { componentNodes } = this.findConnectedComponent(hoveredElementId, hoveredElementType); const hoverBBox = this.getCombinedBoundingBox(componentNodes, []); if (hoverBBox && hoverBBox.width >= 0 && hoverBBox.height >= 0) { const hw=hoverBBox.width/2; const hh=hoverBBox.height/2; const hc= {x:hoverBBox.centerX, y:hoverBBox.centerY}; hoverCorners = { tl: { x: hc.x-hw, y: hc.y-hh }, tr: { x: hc.x+hw, y: hc.y-hh }, br: { x: hc.x+hw, y: hc.y+hh }, bl: { x: hc.x-hw, y: hc.y+hh } }; } }
                    } else if (this.mouseOverBox && this.textBoxRegistry.has(this.mouseOverBox.dataset.id)) {
                        hoverCorners = this.getRotatedTextBoxCorners(this.mouseOverBox);
                    }
                    if (hoverCorners) {
                        this.drawRotatedRect(hoverCorners, '#aaa', [3, 3]);
                    }
                }
            }
        
            // Alt-drawing preview logic remains the same...
            if (this.isAltDown && !this.isDrawing && !this.isDraggingNodes && !this.isDraggingItems && !this.isRotating && !this.isScaling && this.mouseDownButton === -1 && this.lastMousePos && (this.isAltDrawing || this.altPreviewSourceNodeIds.size > 0)) {
                const previewEndPoint = this.snapTargetNode ? this.snapTargetNode : this.lastMousePos;
                this.ctx.save(); this.ctx.lineWidth = this.currentLineWidth; this.ctx.setLineDash([4, 4]); this.ctx.strokeStyle = this.snapTargetNode ? 'red' : this.currentColor;
                if (this.isAltDrawing && this.altDrawingSourceNodeId) { const sourceNode = this.nodeRegistry.get(this.altDrawingSourceNodeId); if (sourceNode) { this.ctx.beginPath(); this.ctx.moveTo(sourceNode.x, sourceNode.y); this.ctx.lineTo(previewEndPoint.x, previewEndPoint.y); this.ctx.stroke(); } }
                else if (this.altPreviewSourceNodeIds.size > 0) { this.altPreviewSourceNodeIds.forEach(nid => { const node = this.nodeRegistry.get(nid); if(node){ this.ctx.beginPath(); this.ctx.moveTo(node.x, node.y); this.ctx.lineTo(previewEndPoint.x, previewEndPoint.y); this.ctx.stroke(); } }); }
                this.ctx.restore();
            }
        }

        updateNodeHandles() { this.nodeHandlesContainer.innerHTML = ''; this.snapIndicatorElem.style.display = 'none'; const nodesToShowHandles = new Set(); if (this.selectionLevel === 'element' && this.elementSelectionActiveForComponentId) { const compData = this.activeComponentData.get(this.elementSelectionActiveForComponentId); if (compData) { compData.componentNodes.forEach(nodeId => nodesToShowHandles.add(nodeId)); } } nodesToShowHandles.forEach(nodeId => { const node = this.nodeRegistry.get(nodeId); if (!node) return; const handle = document.createElement('div'); handle.className = 'node-handle'; handle.dataset.nodeId = nodeId; handle.style.left = `${node.x}px`; handle.style.top = `${node.y}px`; handle.style.display = 'block'; const componentId = this.getComponentIdForElement(nodeId, 'node'); if (this.selectionLevel === 'element' && this.elementSelectionActiveForComponentId === componentId) { if (this.selectedNodes.has(nodeId)) { handle.classList.add('element-selected'); } else { handle.classList.add('element-focus-component'); } } else { handle.style.display = 'none'; } handle.addEventListener('mousedown', this.handleNodeMouseDown.bind(this)); this.nodeHandlesContainer.appendChild(handle); }); if (this.isAltDown && (this.isAltDrawing || this.altPreviewSourceNodeIds.size > 0) && this.snapTargetNode) { this.snapIndicatorElem.style.left = `${this.snapTargetNode.x}px`; this.snapIndicatorElem.style.top = `${this.snapTargetNode.y}px`; this.snapIndicatorElem.style.display = 'block'; } }

        resetPersistentTransformState() { this.selectionRotationAngle = 0; this.initialBBox = null; this.scaleRotateCenter = { x: 0, y: 0 }; }
        selectTextBox(boxElement, add = false) { if (!boxElement || !this.textBoxRegistry.has(boxElement.dataset.id)) return; const data = this.textBoxRegistry.get(boxElement.dataset.id); let needsReset = false; if (!add) { this.deselectAllGraphElements(); needsReset = true; } if (!this.selectedTextBoxes.has(boxElement)) { this.selectedTextBoxes.add(boxElement); needsReset = true; } if (needsReset) { this.selectionLevel = 'component'; this.elementSelectionActiveForComponentId = null; this.resetPersistentTransformState(); this.redrawCanvas(); this.updateNodeHandles(); this.updateTransformHandles(); } }
        deselectTextBox(boxElement) { if (!boxElement || !this.textBoxRegistry.has(boxElement.dataset.id)) return; if (this.selectedTextBoxes.has(boxElement)) { this.selectedTextBoxes.delete(boxElement); this.resetPersistentTransformState(); this.redrawCanvas(); this.updateNodeHandles(); this.updateTransformHandles(); } }
        toggleSelectTextBox(boxElement) { if (!boxElement || !this.textBoxRegistry.has(boxElement.dataset.id)) return; if (this.selectedTextBoxes.has(boxElement)) { this.deselectTextBox(boxElement); } else { this.selectTextBox(boxElement, true); } }
        selectComponent(elementId, elementType, add = false) { if (this.selectionLevel !== 'component') return; const { componentNodes, componentEdges, representativeId } = this.findConnectedComponent(elementId, elementType); if (!representativeId || (componentNodes.size === 0 && componentEdges.size === 0)) return; if (!add) { this.deselectAllGraphElements(); this.deselectAllTextBoxes(); this.resetPersistentTransformState(); } if (!this.activeComponentData.has(representativeId)) { this.activeComponentData.set(representativeId, { componentNodes, componentEdges }); this.resetPersistentTransformState(); } this.redrawCanvas(); this.updateNodeHandles(); this.updateTransformHandles(); }
        toggleSelectComponent(elementId, elementType) { if (this.selectionLevel !== 'component') return; const { componentNodes, componentEdges, representativeId } = this.findConnectedComponent(elementId, elementType); if (!representativeId) return; let changed = false; if (this.activeComponentData.has(representativeId)) { this.activeComponentData.delete(representativeId); changed = true; } else if (componentNodes.size > 0 || componentEdges.size > 0) { this.activeComponentData.set(representativeId, { componentNodes, componentEdges }); changed = true; } if (changed) { this.resetPersistentTransformState(); this.redrawCanvas(); this.updateNodeHandles(); this.updateTransformHandles(); } }
        selectElement(elementId, elementType, add = false) { if (this.selectionLevel !== 'element' || !this.elementSelectionActiveForComponentId) return; const elementComponentId = this.getComponentIdForElement(elementId, elementType); if (elementComponentId !== this.elementSelectionActiveForComponentId) return; if (!add) { this.selectedNodes.clear(); this.selectedEdges.clear(); } if (elementType === 'node' && this.nodeRegistry.has(elementId)) this.selectedNodes.add(elementId); else if (elementType === 'edge' && this.edgeRegistry.has(elementId)) this.selectedEdges.add(elementId); this.redrawCanvas(); this.updateNodeHandles(); this.updateTransformHandles(); }
        toggleSelectElement(elementId, elementType) { if (this.selectionLevel !== 'element' || !this.elementSelectionActiveForComponentId) return; const elementComponentId = this.getComponentIdForElement(elementId, elementType); if (elementComponentId !== this.elementSelectionActiveForComponentId) return; let changed = false; if (elementType === 'node' && this.nodeRegistry.has(elementId)) { if (this.selectedNodes.has(elementId)) this.selectedNodes.delete(elementId); else this.selectedNodes.add(elementId); changed = true; } else if (elementType === 'edge' && this.edgeRegistry.has(elementId)) { if (this.selectedEdges.has(elementId)) this.selectedEdges.delete(elementId); else this.selectedEdges.add(elementId); changed = true; } if (changed) { this.redrawCanvas(); this.updateNodeHandles(); this.updateTransformHandles(); } }
        deselectAllTextBoxes() { let changed = this.selectedTextBoxes.size > 0; if (changed) { this.selectedTextBoxes.clear(); } if (this.activeTextBox) this.deactivateTextBox(); return changed; }
        deselectAllGraphElements() { let changed = false; if (this.activeComponentData.size > 0) { this.activeComponentData.clear(); changed = true; } if (this.selectedNodes.size > 0) { this.selectedNodes.clear(); changed = true; } if (this.selectedEdges.size > 0) { this.selectedEdges.clear(); changed = true; } if (this.elementSelectionActiveForComponentId) { this.elementSelectionActiveForComponentId = null; this.selectionLevel = 'component'; changed = true;} return changed; }
        deselectAll(keepTextBoxes = false) { let changedGraph = false; let changedText = false; if (!keepTextBoxes) { changedText = this.deselectAllTextBoxes(); } changedGraph = this.deselectAllGraphElements(); if (changedGraph || changedText) { this.resetPersistentTransformState(); this.redrawCanvas(); this.updateNodeHandles(); this.updateTransformHandles(); } }
        selectAllItems() { this.deselectAll(); this.textBoxRegistry.forEach(boxData => this.selectTextBox(boxData.element, true)); const processedNodes = new Set(); this.nodeRegistry.forEach(node => { if (!processedNodes.has(node.id)) { const { componentNodes, componentEdges, representativeId } = this.findConnectedComponent(node.id, 'node'); if (representativeId && (componentNodes.size > 0 || componentEdges.size > 0)) { if (!this.activeComponentData.has(representativeId)) { this.activeComponentData.set(representativeId, { componentNodes, componentEdges }); } componentNodes.forEach(nid => processedNodes.add(nid)); } } }); this.selectionLevel = 'component'; this.elementSelectionActiveForComponentId = null; this.resetPersistentTransformState(); this.redrawCanvas(); this.updateNodeHandles(); this.updateTransformHandles(); this.deactivateTextBox(); }

        renderTextBoxContent(textBoxElement, rawText) {
            if (!textBoxElement) {
                console.warn("renderTextBoxContent: Invalid element provided.");
                return;
            }
            const elementId = textBoxElement.dataset.id || 'unknown';
            const effectiveRawText = (rawText === null || rawText === undefined) ? '' : String(rawText);
            let katexInputString;
            try {
                katexInputString = formatStringToMathDisplay(effectiveRawText);
            } catch (error) {
                 console.error(`[${elementId}] Error during formatStringToMathDisplay call:`, error);
                 textBoxElement.textContent = `Format Error: ${error.message || effectiveRawText}`;
                 textBoxElement.style.width = `${textBoxElement.scrollWidth}px`;
                 textBoxElement.style.height = `${textBoxElement.scrollHeight}px`;
                 return;
            }
            textBoxElement.style.width = '';
            textBoxElement.style.height = '';
            textBoxElement.innerHTML = '';

            try {
                if (typeof renderStringToElement !== 'function') {
                    console.error("CRITICAL: renderStringToElement function is not defined or imported.");
                    textBoxElement.textContent = `Config Error: ${katexInputString}`;
                    textBoxElement.style.width = `${textBoxElement.scrollWidth}px`;
                    textBoxElement.style.height = `${textBoxElement.scrollHeight}px`;
                    return;
                }
                renderStringToElement(textBoxElement, katexInputString);
                if (!textBoxElement.querySelector('.katex')) {
                    console.warn(`[${elementId}] renderStringToElement did not produce KaTeX output. Input was:`, katexInputString, "Output HTML:", textBoxElement.innerHTML);
                }
            } catch (error) {
                console.error(`[${elementId}] Error during renderStringToElement call:`, error);
                textBoxElement.textContent = `Render Error: ${error.message || effectiveRawText}`;
                textBoxElement.style.width = `${textBoxElement.scrollWidth}px`;
                textBoxElement.style.height = `${textBoxElement.scrollHeight}px`;
                return;
            }

            let targetHeight = textBoxElement.scrollHeight;
            const baseElement = textBoxElement.querySelector('.katex-html .base');

            if (baseElement) {
                targetHeight = baseElement.offsetHeight;
            } else {
                const textSegment = textBoxElement.querySelector('.text-segment');
                if (textSegment && textBoxElement.children.length === 1) {
                    targetHeight = textSegment.offsetHeight > 0 ? textSegment.offsetHeight : textBoxElement.scrollHeight;
                } else if (textBoxElement.firstChild && textBoxElement.firstChild.nodeType === Node.TEXT_NODE) {
                    targetHeight = textBoxElement.scrollHeight;
                }
            }

            const targetWidth = textBoxElement.scrollWidth;
            textBoxElement.style.width = `${targetWidth}px`;
            const minHeight = parseInt(textBoxElement.style.fontSize, 10) || 16;
            const finalHeight = Math.max(targetHeight, minHeight);
            textBoxElement.style.height = `${finalHeight}px`;
        }

        _updateTextBoxPositionAndSize(textBoxElement, targetCenterX, targetCenterY) {
            const width = textBoxElement.offsetWidth;
            const height = textBoxElement.offsetHeight;
            const adjustedX = targetCenterX - width / 2;
            const adjustedY = targetCenterY - height / 2;
            textBoxElement.style.left = `${adjustedX}px`;
            textBoxElement.style.top = `${adjustedY}px`;
            const id = textBoxElement.dataset.id;
            const data = this.textBoxRegistry.get(id);
            if (data) {
                data.x = adjustedX;
                data.y = adjustedY;
                // Optionally store width/height for history
                // data.width = width;
                // data.height = height;
            }
            return { x: adjustedX, y: adjustedY, width, height };
        }
        createTextBoxElement(id, text, centerX, centerY, color = '#000000', fontSize = '16px', rotation = 0, isSelected = false, isActive = false) {
            const div = document.createElement('div');
            div.className = 'textBox';
            div.dataset.id = id;
            div.contentEditable = false;
            div.style.position = 'absolute';
            div.style.left = `${centerX}px`;
            div.style.top = `${centerY}px`;
            div.style.color = color;
            div.style.fontSize = fontSize;
            div.style.transform = `rotate(${rotation}rad)`;
            div.style.transformOrigin = 'center center';
            div.style.whiteSpace = 'pre';
            div.style.outline = 'none';
            div.style.border = 'none';
            div.style.padding = '0';
            div.style.textAlign = 'center';
            div.style.display = 'flex';
            div.style.justifyContent = 'center';
            div.style.alignItems = 'center';

            div.addEventListener('mouseenter', (event) => {
                if (this.activeTextBox !== event.currentTarget) {
                    this.mouseOverBox = event.currentTarget;
                    this.redrawCanvas();
                    this.updateCursorBasedOnContext();
                }
            });
            div.addEventListener('mouseleave', (event) => {
                if (this.mouseOverBox === event.currentTarget) {
                    this.mouseOverBox = null;
                    this.redrawCanvas();
                    this.updateCursorBasedOnContext();
                }
            });
            div.addEventListener('focusout', (event) => {
                setTimeout(() => {
                    if (event.currentTarget && this.activeTextBox === event.currentTarget && !event.currentTarget.contains(document.activeElement) && !this.isDraggingItems && !this.isRotating && !this.isScaling) {
                        this.deactivateTextBox(event.currentTarget);
                    }
                }, 50);
            });
            div.addEventListener('dragstart', (e) => e.preventDefault());
            div.addEventListener('input', (event) => {
                const currentElement = event.currentTarget;
                const currentId = currentElement.dataset.id;
                const data = this.textBoxRegistry.get(currentId);
                if (data) {
                    data.text = currentElement.textContent;
                    const oldWidth = currentElement.offsetWidth;
                    const oldHeight = currentElement.offsetHeight;
                    const currentX = parseFloat(currentElement.style.left);
                    const currentY = parseFloat(currentElement.style.top);
                    const currentCenterX = currentX + oldWidth / 2;
                    const currentCenterY = currentY + oldHeight / 2;
                    currentElement.style.width = '';
                    currentElement.style.height = '';
                    currentElement.style.width = `${currentElement.scrollWidth}px`;
                    currentElement.style.height = `${currentElement.scrollHeight}px`;
                    this._updateTextBoxPositionAndSize(currentElement, currentCenterX, currentCenterY);
                    this.resetPersistentTransformState();
                    this.updateTransformHandles();
                }
            });

            this.body.appendChild(div);
            this.textBoxRegistry.set(id, { element: div, text: text, x: centerX, y: centerY, color: color, fontSize: fontSize, rotation: rotation });
            this.renderTextBoxContent(div, text);
            const finalPos = this._updateTextBoxPositionAndSize(div, centerX, centerY);
            if (isSelected) this.selectTextBox(div);
            if (isActive) this.setActiveTextBox(div);
            return div;
        }

        createNewTextBox(screenX, screenY, initialChar) {
            const newId = this.generateId();
            this.deselectAll();
            this.deactivateTextBox();
            const div = this.createTextBoxElement(newId, initialChar, screenX, screenY, this.currentColor, this.currentFontSize, 0, false, true);
            const data = this.textBoxRegistry.get(newId);
            if (data) {
                this.addHistory({ type: 'create_text', boxInfo: { id: newId, text: initialChar, x: data.x, y: data.y, color: this.currentColor, fontSize: this.currentFontSize, rotation: 0 } });
            }
            return div;
        }

        deleteTextBox(id) { if (this.textBoxRegistry.has(id)) { try { const d = this.textBoxRegistry.get(id); if (this.mouseOverBox === d.element) this.mouseOverBox = null; this.deselectTextBox(d.element); if (this.activeTextBox === d.element) this.deactivateTextBox(d.element); d.element.remove(); this.textBoxRegistry.delete(id); this.resetPersistentTransformState(); return true; } catch (e) { return false; } } return false; }

        setActiveTextBox(textBoxElement) {
            if (!textBoxElement || !this.textBoxRegistry.has(textBoxElement.dataset.id)) return;
            if (this.activeTextBox && this.activeTextBox !== textBoxElement) {
                this.deactivateTextBox(this.activeTextBox);
            }
            this.activeTextBox = textBoxElement;
            const data = this.textBoxRegistry.get(textBoxElement.dataset.id);
            const rawText = data ? data.text : '';
            const oldWidth = textBoxElement.offsetWidth;
            const oldHeight = textBoxElement.offsetHeight;
            const currentX = parseFloat(textBoxElement.style.left);
            const currentY = parseFloat(textBoxElement.style.top);
            const currentCenterX = currentX + oldWidth / 2;
            const currentCenterY = currentY + oldHeight / 2;
            this.activeTextBox.innerHTML = '';
            this.activeTextBox.textContent = rawText;
            this.activeTextBox.contentEditable = true;
            this.activeTextBox.classList.add('writing-mode');
            this.activeTextBox.style.width = '';
            this.activeTextBox.style.height = '';
            this.activeTextBox.style.width = `${this.activeTextBox.scrollWidth}px`;
            this.activeTextBox.style.height = `${this.activeTextBox.scrollHeight}px`;
            this._updateTextBoxPositionAndSize(this.activeTextBox, currentCenterX, currentCenterY);
            this.activeTextBox.focus({ preventScroll: true });
            this.moveCaretToEnd(this.activeTextBox);
            this.rotateHandleIconElem.style.display = 'none';
            this.scaleHandleIconElem.style.display = 'none';
            this.redrawCanvas();
            this.updateCursorBasedOnContext();
        }

        deactivateTextBox(textBoxElement = this.activeTextBox) {
            if (!textBoxElement || !this.textBoxRegistry.has(textBoxElement.dataset.id)) return;
            if (this.activeTextBox === textBoxElement) {
                const data = this.textBoxRegistry.get(textBoxElement.dataset.id);
                if (data) {
                    const newText = textBoxElement.textContent;
                    const textChanged = data.text !== newText;
                    const oldWidth = textBoxElement.offsetWidth;
                    const oldHeight = textBoxElement.offsetHeight;
                    const currentX = parseFloat(textBoxElement.style.left);
                    const currentY = parseFloat(textBoxElement.style.top);
                    const currentCenterX = currentX + oldWidth / 2;
                    const currentCenterY = currentY + oldHeight / 2;
                    if (textChanged) {
                        data.text = newText;
                    }
                    textBoxElement.contentEditable = false;
                    textBoxElement.classList.remove('writing-mode');
                    textBoxElement.style.display = 'flex';
                    this.renderTextBoxContent(textBoxElement, data.text);
                    this._updateTextBoxPositionAndSize(textBoxElement, currentCenterX, currentCenterY);
                    if (textChanged) {
                       this.resetPersistentTransformState();
                    }
                }
                this.activeTextBox = null;
                this.deselectTextBox(textBoxElement);
                this.redrawCanvas();
                this.updateTransformHandles();
                this.updateCursorBasedOnContext();
            }
        }

        createNode(id, x, y) { if (this.nodeRegistry.has(id)) return this.nodeRegistry.get(id); const nodeData = { id, x, y }; this.nodeRegistry.set(id, nodeData); this.resetPersistentTransformState(); return nodeData; }
        _deleteNodeInternal(id) { if (!this.nodeRegistry.has(id)) return null; const deletedNode = { ...this.nodeRegistry.get(id) }; const compIdToDelete = this.getComponentIdForElement(id, 'node'); this.nodeRegistry.delete(id); this.selectedNodes.delete(id); if (this.activeComponentData.has(compIdToDelete)) { const compData = this.activeComponentData.get(compIdToDelete); compData.componentNodes.delete(id); if (compData.componentNodes.size === 0 && compData.componentEdges.size === 0) { this.activeComponentData.delete(compIdToDelete); if (this.elementSelectionActiveForComponentId === compIdToDelete) { this.deselectAll(); } } } if (this.mouseOverNodeId === id) this.mouseOverNodeId = null; this.resetPersistentTransformState(); return deletedNode; }
        _deleteEdgeInternal(id) { if (!this.edgeRegistry.has(id)) return null; const deletedEdge = { ...this.edgeRegistry.get(id) }; const compId = this.getComponentIdForElement(id, 'edge'); this.edgeRegistry.delete(id); this.selectedEdges.delete(id); if (this.activeComponentData.has(compId)) { const compData = this.activeComponentData.get(compId); compData.componentEdges.delete(id); const n1Exists = this.nodeRegistry.has(deletedEdge.node1Id); const n2Exists = this.nodeRegistry.has(deletedEdge.node2Id); if (n1Exists && n2Exists) { const { representativeId: rep1 } = this.findConnectedComponent(deletedEdge.node1Id, 'node'); const { representativeId: rep2 } = this.findConnectedComponent(deletedEdge.node2Id, 'node'); if (rep1 !== rep2) { if(this.activeComponentData.has(compId)){ this.activeComponentData.delete(compId); } if(rep1 && compData.componentNodes.has(deletedEdge.node1Id)) { const { componentNodes: c1n, componentEdges: c1e} = this.findConnectedComponent(rep1,'node'); this.activeComponentData.set(rep1, {componentNodes:c1n, componentEdges:c1e}); } if(rep2 && compData.componentNodes.has(deletedEdge.node2Id)) { const { componentNodes: c2n, componentEdges: c2e} = this.findConnectedComponent(rep2,'node'); this.activeComponentData.set(rep2, {componentNodes:c2n, componentEdges:c2e}); } if (this.elementSelectionActiveForComponentId === compId) { this.elementSelectionActiveForComponentId = rep1 || rep2 || null; if (!this.elementSelectionActiveForComponentId) this.selectionLevel = 'component'; } } } else if (compData.componentNodes.size === 0 && compData.componentEdges.size === 0) { this.activeComponentData.delete(compId); if(this.elementSelectionActiveForComponentId === compId) this.deselectAll(); } } if (this.mouseOverEdgeId === id) this.mouseOverEdgeId = null; this.resetPersistentTransformState(); return deletedEdge; }
        createEdge(id, node1Id, node2Id, color, lineWidth) { if (this.edgeRegistry.has(id)) return this.edgeRegistry.get(id); if (!this.nodeRegistry.has(node1Id) || !this.nodeRegistry.has(node2Id)) { return null; } const edgeData = { id, node1Id, node2Id, color, lineWidth }; this.edgeRegistry.set(id, edgeData); const compId1 = this.getComponentIdForElement(node1Id, 'node'); const compId2 = this.getComponentIdForElement(node2Id, 'node'); let mergeNeeded = false; let comp1Selected = this.activeComponentData.has(compId1); let comp2Selected = this.activeComponentData.has(compId2); let comp1ElementFocus = this.selectionLevel === 'element' && this.elementSelectionActiveForComponentId === compId1; let comp2ElementFocus = this.selectionLevel === 'element' && this.elementSelectionActiveForComponentId === compId2; if (compId1 && compId2 && compId1 !== compId2 && (comp1Selected || comp1ElementFocus) && (comp2Selected || comp2ElementFocus)) { mergeNeeded = true; } if (mergeNeeded) { const {componentNodes, componentEdges, representativeId} = this.findConnectedComponent(node1Id, 'node'); this.activeComponentData.delete(compId1); this.activeComponentData.delete(compId2); this.activeComponentData.set(representativeId, {componentNodes, componentEdges}); if (comp1ElementFocus || comp2ElementFocus) { this.selectionLevel = 'element'; this.elementSelectionActiveForComponentId = representativeId; } } this.resetPersistentTransformState(); return edgeData; }
        deleteEdgeSmart(edgeId) { const deletedItems = { edge: null, nodes: [], edges: [] }; const edge = this.edgeRegistry.get(edgeId); if (!edge) return deletedItems; const node1Id = edge.node1Id; const node2Id = edge.node2Id; deletedItems.edge = this._deleteEdgeInternal(edgeId); if (!deletedItems.edge) return deletedItems; if (this.nodeRegistry.has(node1Id) && this.getNodeDegree(node1Id) === 0) { const { node: dn, edges: de } = this.deleteNodeSmart(node1Id); if (dn) deletedItems.nodes.push(dn); deletedItems.edges.push(...de); } if (this.nodeRegistry.has(node2Id) && this.getNodeDegree(node2Id) === 0) { const { node: dn, edges: de } = this.deleteNodeSmart(node2Id); if (dn) deletedItems.nodes.push(dn); deletedItems.edges.push(...de); } return deletedItems; }
        deleteNodeSmart(nodeId) { const deletedItems = { node: null, edges: [], createdEdge: null }; if (!this.nodeRegistry.has(nodeId)) return deletedItems; const incidentEdges = []; for (const edge of this.edgeRegistry.values()) { if (edge.node1Id === nodeId || edge.node2Id === nodeId) { incidentEdges.push({ ...edge }); } } if (incidentEdges.length === 2) { const edge1 = incidentEdges[0]; const edge2 = incidentEdges[1]; const neighbour1Id = (edge1.node1Id === nodeId) ? edge1.node2Id : edge1.node1Id; const neighbour2Id = (edge2.node1Id === nodeId) ? edge2.node2Id : edge2.node1Id; if (neighbour1Id !== neighbour2Id && this.nodeRegistry.has(neighbour1Id) && this.nodeRegistry.has(neighbour2Id)) { if (!this.edgeExists(neighbour1Id, neighbour2Id)) { deletedItems.node = this._deleteNodeInternal(nodeId); if(deletedItems.node) { const deletedEdge1 = this._deleteEdgeInternal(edge1.id); const deletedEdge2 = this._deleteEdgeInternal(edge2.id); if(deletedEdge1) deletedItems.edges.push(deletedEdge1); if(deletedEdge2) deletedItems.edges.push(deletedEdge2); const newEdgeId = this.generateId(); const newEdge = this.createEdge(newEdgeId, neighbour1Id, neighbour2Id, edge1.color, edge1.lineWidth); if (newEdge) deletedItems.createdEdge = { ...newEdge }; } return deletedItems; } } } deletedItems.node = this._deleteNodeInternal(nodeId); if(deletedItems.node) { incidentEdges.forEach(edge => { const deletedEdge = this._deleteEdgeInternal(edge.id); if (deletedEdge) deletedItems.edges.push(deletedEdge); }); } return deletedItems; }
        deleteSelected() { const deletedHistory = { texts: [], nodes: [], edges: [], createdEdges: [] }; Array.from(this.selectedTextBoxes).forEach(box => { const id = box.dataset.id; if (!this.textBoxRegistry.has(id)) return; const d = this.textBoxRegistry.get(id); deletedHistory.texts.push({ id: id, text: d.text, x: d.x, y: d.y, color: d.color, fontSize: d.fontSize, rotation: d.rotation ?? 0 }); this.deleteTextBox(id); }); const nodesToDelete = new Set(); const edgesToDelete = new Set(); if (this.selectionLevel === 'element' && this.elementSelectionActiveForComponentId) { const compData = this.activeComponentData.get(this.elementSelectionActiveForComponentId); if (compData) { this.selectedNodes.forEach(nid => { if (compData.componentNodes.has(nid)) nodesToDelete.add(nid); }); this.selectedEdges.forEach(eid => { if (compData.componentEdges.has(eid)) edgesToDelete.add(eid); }); } } else { this.activeComponentData.forEach(compData => { compData.componentNodes.forEach(nid => nodesToDelete.add(nid)); compData.componentEdges.forEach(eid => edgesToDelete.add(eid)); }); } const processedEdges = new Set(); const processedNodes = new Set(); edgesToDelete.forEach(edgeId => { if (processedEdges.has(edgeId) || !this.edgeRegistry.has(edgeId)) return; const { edge: de, nodes: dn_consq, edges: de_consq } = this.deleteEdgeSmart(edgeId); if (de) { deletedHistory.edges.push(de); processedEdges.add(de.id); } dn_consq.forEach(n => { if (!processedNodes.has(n.id)) { deletedHistory.nodes.push(n); processedNodes.add(n.id); } }); de_consq.forEach(e => { if (!processedEdges.has(e.id)) { deletedHistory.edges.push(e); processedEdges.add(e.id); } }); }); nodesToDelete.forEach(nodeId => { if (processedNodes.has(nodeId) || !this.nodeRegistry.has(nodeId)) return; const { node: dn, edges: de, createdEdge: ce } = this.deleteNodeSmart(nodeId); if (dn) { deletedHistory.nodes.push(dn); processedNodes.add(dn.id); } de.forEach(e => { if (!processedEdges.has(e.id)) { deletedHistory.edges.push(e); processedEdges.add(e.id); } }); if (ce) { deletedHistory.createdEdges.push(ce); } }); const deletedSomething = deletedHistory.texts.length > 0 || deletedHistory.nodes.length > 0 || deletedHistory.edges.length > 0 || deletedHistory.createdEdges.length > 0; if (deletedSomething) { this.addHistory({ type: 'delete_selected', deletedInfo: deletedHistory }); } this.deselectAll(); this.redrawCanvas(); this.updateNodeHandles(); this.updateTransformHandles(); this.body.focus({ preventScroll: true }); }

        handleGraphElementModifierClick(elementId, elementType) { if (this.selectionLevel === 'component') { if (this.isCtrlDown) this.toggleSelectComponent(elementId, elementType); else if (this.isShiftDown) this.selectComponent(elementId, elementType, true); } else if (this.selectionLevel === 'element' && this.elementSelectionActiveForComponentId) { const elementCompId = this.getComponentIdForElement(elementId, elementType); if (elementCompId === this.elementSelectionActiveForComponentId) { if (this.isCtrlDown) this.toggleSelectElement(elementId, elementType); else if (this.isShiftDown) this.selectElement(elementId, elementType, true); } } }
        prepareNodeDrag() {
            const nodesToDrag = new Set(); this.dragStartStates = [];
            const startingPersistentCenter = this.scaleRotateCenter && this.initialBBox ? { ...this.scaleRotateCenter } : null;
            const startingPersistentBBox = this.initialBBox ? { ...this.initialBBox } : null;
            const startingPersistentAngle = this.selectionRotationAngle;

            if (this.selectionLevel === 'element' && this.elementSelectionActiveForComponentId) {
                const compData = this.activeComponentData.get(this.elementSelectionActiveForComponentId);
                if (compData) {
                    this.selectedNodes.forEach(nodeId => { if (this.nodeRegistry.has(nodeId) && compData.componentNodes.has(nodeId)) { nodesToDrag.add(nodeId); } });
                    this.selectedEdges.forEach(edgeId => {
                        if (compData.componentEdges.has(edgeId)) {
                            const edge = this.edgeRegistry.get(edgeId);
                            if (edge) {
                                if (this.nodeRegistry.has(edge.node1Id) && compData.componentNodes.has(edge.node1Id)) { nodesToDrag.add(edge.node1Id); }
                                if (this.nodeRegistry.has(edge.node2Id) && compData.componentNodes.has(edge.node2Id)) { nodesToDrag.add(edge.node2Id); }
                            }
                        }
                    });
                }
                nodesToDrag.forEach(nid => {
                    const node = this.nodeRegistry.get(nid);
                    if (node) {
                        this.dragStartStates.push({ type: 'node', id: nid, startX: node.x, startY: node.y });
                    }
                });
            } else {
                this.activeComponentData.forEach(compData => {
                    compData.componentNodes.forEach(nid => { if (this.nodeRegistry.has(nid)) { nodesToDrag.add(nid); } });
                });
                nodesToDrag.forEach(nid => {
                    const node = this.nodeRegistry.get(nid);
                    if (node) {
                        this.dragStartStates.push({
                            type: 'node', id: nid, startX: node.x, startY: node.y,
                            startGroupRotation: startingPersistentAngle,
                            startCenter: startingPersistentCenter,
                            startBBox: startingPersistentBBox
                        });
                    }
                });
            }
        }
        handleNodeMouseDown(event) { event.stopPropagation(); this.mouseDownButton = event.button; if (this.mouseDownButton !== 0 && this.mouseDownButton !== 2) return; const handle = event.target; const nodeId = handle.dataset.nodeId; const node = this.nodeRegistry.get(nodeId); if (!node) return; if(this.isDrawing) this.finalizeCurrentDrawing(); this.isDraggingNodes = false; this.potentialNodeHandleClick = true; this.potentialGraphElementClick = false; this.clickedElementInfo = { id: nodeId, type: 'node' }; this.dragStartMousePos = { x: event.clientX, y: event.clientY }; this.isCtrlDown = event.ctrlKey || event.metaKey; this.isShiftDown = event.shiftKey; this.isAltDown = event.altKey; if (this.mouseDownButton === 0 && !this.isAltDown) { if (this.isCtrlDown || this.isShiftDown) { this.handleGraphElementModifierClick(nodeId, 'node'); this.redrawCanvas(); this.updateNodeHandles(); } else { if (this.selectionLevel === 'element' && this.elementSelectionActiveForComponentId) { const elementCompId = this.getComponentIdForElement(nodeId, 'node'); if (elementCompId === this.elementSelectionActiveForComponentId) { if (!this.selectedNodes.has(nodeId)) { this.selectElement(nodeId, 'node', false); } } } else if (this.selectionLevel === 'component') { const compId = this.getComponentIdForElement(nodeId, 'node'); if (compId && !this.activeComponentData.has(compId)) { this.deselectAll(false); this.selectComponent(nodeId, 'node'); this.redrawCanvas(); this.updateNodeHandles(); } } } } }
        handleMouseDown(event) {
            const target = event.target;
            if (target.closest('#toolbar')) return;
        
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
            this.currentScaleFactor = 1;
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
                if (!this.initialBBox || !this.scaleRotateCenter) {
                    this.updateTransformHandles();
                     if (!this.initialBBox || !this.scaleRotateCenter || (this.initialBBox.width < 0 || this.initialBBox.height < 0)) {
                         this.potentialTransformHandleClick = null;
                         return;
                    }
                }
                if(this.activeTextBox) this.deactivateTextBox();
        
                this.dragStartStates = [];
                const currentAngle = this.selectionRotationAngle;
                const currentCenter = { ...this.scaleRotateCenter };
                const currentBBox = { ...this.initialBBox };
                this.activeComponentData.forEach(compData => {
                    compData.componentNodes.forEach(nid => {
                        const node = this.nodeRegistry.get(nid);
                        if (node) this.dragStartStates.push({ type: 'node', id: nid, startX: node.x, startY: node.y, startGroupRotation: currentAngle, startCenter: currentCenter, startBBox: currentBBox });
                    });
                });
                this.selectedTextBoxes.forEach(box => {
                    const boxId = box.dataset.id;
                    const d = this.textBoxRegistry.get(boxId);
                    if(d && box.offsetParent) {
                        const fontSizePx = parseFloat(d.fontSize || '16px');
                        const startWidth = box.offsetWidth;
                        const startHeight = box.offsetHeight;
                        this.dragStartStates.push({
                            type: 'text', id: boxId, element: box,
                            startX: d.x, startY: d.y,
                            startWidth: startWidth, startHeight: startHeight,
                            startRotation: d.rotation ?? 0, startFontSize: fontSizePx,
                            startGroupRotation: currentAngle, startCenter: currentCenter, startBBox: currentBBox
                        });
                    }
                });
        
                if (this.potentialTransformHandleClick === 'rotate') {
                    const initialMouseAngleRad = Math.atan2(clickPoint.y - currentCenter.y, clickPoint.x - currentCenter.x);
                    this.startAngle = initialMouseAngleRad;
                } else {
                    const vec = {x: clickPoint.x - currentCenter.x, y: clickPoint.y - currentCenter.y};
                    const dist = Math.sqrt(vec.x*vec.x + vec.y*vec.y);
                    this.startDistanceInfo = { dist: dist, vec: vec };
                }
                this.updateCursorBasedOnContext();
                return;
            }
            this.potentialTransformHandleClick = null;
        
            if (this.mouseDownButton === 0 && !this.isShiftDown && !this.isCtrlDown &&
                !target.closest('.textBox') && !hitNode && !hitEdge &&
                target !== this.rotateHandleIconElem && target !== this.scaleHandleIconElem &&
                !target.closest('.node-handle') && target === this.canvas)
            {
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
                 this.deactivateTextBox();
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
                             const newNodeId = this.generateId();
                             const newNode = this.createNode(newNodeId, clickPoint.x, clickPoint.y);
                             if(newNode){
                                 targetId = newNodeId;
                                 historyData.createdNode = {...newNode};
                             } else {
                                 return;
                             }
                         }
                         if (targetId && !this.edgeExists(sourceNodeId, targetId)) {
                             const edgeId = this.generateId();
                             const edge = this.createEdge(edgeId, sourceNodeId, targetId, this.currentColor, this.currentLineWidth);
                             if (edge) {
                                 historyData.createdEdges.push({...edge});
                                 historyData.type = 'create_graph_elements';
                             }
                         }
                         this.altDrawingSourceNodeId = targetId;
                         if (!targetId) {
                             this.isAltDrawing = false;
                         }
                     } else {
                         const sourcePoints = new Set(this.altPreviewSourceNodeIds);
                         let targetId = null;
                         if (targetNode) {
                             targetId = targetNode.id;
                             this.altPreviewSourceNodeIds.clear();
                         } else {
                             const newNodeId = this.generateId();
                             const newNode = this.createNode(newNodeId, clickPoint.x, clickPoint.y);
                             if(newNode){
                                 targetId = newNodeId;
                                 historyData.createdNode = {...newNode};
                             } else {
                                 return;
                             }
                         }
                         if (targetId && sourcePoints.size > 0) {
                             historyData.type = 'create_graph_elements';
                             sourcePoints.forEach(sourceId => {
                                 if (sourceId !== targetId && !this.edgeExists(sourceId, targetId)) {
                                     const edgeId = this.generateId();
                                     const edge = this.createEdge(edgeId, sourceId, targetId, this.currentColor, this.currentLineWidth);
                                     if (edge) historyData.createdEdges.push({...edge});
                                 }
                             });
                             this.altPreviewSourceNodeIds.clear();
                         } else if (targetId && historyData.createdNode) {
                              historyData.type = 'create_graph_elements';
                              this.altPreviewSourceNodeIds.clear();
                         }
                         if(targetId) {
                             this.isAltDrawing = true;
                             this.altDrawingSourceNodeId = targetId;
                         } else {
                             this.isAltDrawing = false;
                             this.altDrawingSourceNodeId = null;
                         }
                     }
                     if (historyData.type) {
                         this.addHistory({ type: historyData.type, nodes: historyData.createdNode ? [historyData.createdNode] : [], edges: historyData.createdEdges });
                     }
                     this.redrawCanvas();
                     this.updateNodeHandles();
                     this.updateTransformHandles();
                     event.preventDefault();
                     return;
                 }
                 else {
                     if (this.isAltDrawing) {
                         this.isAltDrawing = false;
                         this.altDrawingSourceNodeId = null;
                     }
                     const targetBox = target.closest('.textBox');
                     if (targetBox) {
                         if (this.isDrawing) this.finalizeCurrentDrawing();
                         event.stopPropagation();
                         if (!this.textBoxRegistry.has(targetBox.dataset.id)) return;
                         if (this.activeTextBox && this.activeTextBox !== targetBox) {
                             this.deactivateTextBox(this.activeTextBox);
                         }
                         this.clickedElementInfo = { id: targetBox.dataset.id, type: 'text' };
                         this.potentialGraphElementClick = false;
                         this.potentialNodeHandleClick = false;
                         this.potentialDragTarget = { type: 'text', id: targetBox.dataset.id };
                         if (this.isCtrlDown) {
                             this.toggleSelectTextBox(targetBox);
                         } else if (this.isShiftDown) {
                             this.selectTextBox(targetBox, true);
                         } else {
                             if (!this.selectedTextBoxes.has(targetBox) || this.selectedTextBoxes.size > 1 || this.activeComponentData.size > 0) {
                                 this.deselectAll(false);
                                 this.selectTextBox(targetBox);
                             }
                         }
                         if(this.selectionLevel === 'element') {
                             this.deselectAllGraphElements();
                         }
                         this.redrawCanvas();
                         this.updateNodeHandles();
                         this.updateTransformHandles();
                     }
                     else if (target === this.canvas) {
                         if (this.activeTextBox) this.deactivateTextBox();
                         if (hitElementId) {
                             if (this.isDrawing) this.finalizeCurrentDrawing();
                             this.potentialGraphElementClick = true;
                             if(!this.clickedElementInfo) this.clickedElementInfo = { id: hitElementId, type: hitElementType };
                             this.potentialNodeHandleClick = false;
                             this.potentialDragTarget = { type: 'graph', representativeId: hitElementId, elementType: hitElementType };
                             if (this.isCtrlDown || this.isShiftDown) {
                                 this.handleGraphElementModifierClick(hitElementId, hitElementType);
                             } else {
                                 if (this.selectionLevel === 'element' && this.elementSelectionActiveForComponentId) {
                                     const elementCompId = this.getComponentIdForElement(hitElementId, hitElementType);
                                     if (elementCompId === this.elementSelectionActiveForComponentId) {
                                         const isAlreadySelected = (hitElementType === 'node' && this.selectedNodes.has(hitElementId)) ||
                                                                   (hitElementType === 'edge' && this.selectedEdges.has(hitElementId));
                                         if (!isAlreadySelected || this.selectedNodes.size + this.selectedEdges.size > 1) {
                                             this.selectElement(hitElementId, hitElementType, false);
                                         }
                                     } else {
                                         this.deselectAll(false);
                                         this.selectComponent(hitElementId, hitElementType);
                                     }
                                 } else if (this.selectionLevel === 'component') {
                                     const compId = this.getComponentIdForElement(hitElementId, hitElementType);
                                     const currentCompData = this.activeComponentData;
                                     if (compId && (!currentCompData.has(compId) || currentCompData.size > 1 || this.selectedTextBoxes.size > 0)) {
                                         this.deselectAll(false);
                                         this.selectComponent(hitElementId, hitElementType);
                                     } else if (!compId && isAnySelectionActive) {
                                         this.deselectAll();
                                     }
                                 }
                             }
                             this.redrawCanvas();
                             this.updateNodeHandles();
                             this.updateTransformHandles();
                         }
                         else {
                             if (this.isDrawing) this.finalizeCurrentDrawing();
                             this.setDrawingState(true, 'freehand');
                             const startNodeId = this.generateId();
                             const startNode = this.createNode(startNodeId, clickPoint.x, clickPoint.y);
                             if (startNode) {
                                 this.currentDrawingStartNodeId = startNodeId;
                                 this.currentDrawingLastNodeId = startNodeId;
                                 this.currentTempNodes = [{...startNode}];
                                 this.currentTempEdges = [];
                             } else {
                                 this.setDrawingState(false, 'freehand');
                             }
                             this.potentialDragTarget = null;
                             this.potentialGraphElementClick = false;
                             this.potentialNodeHandleClick = false;
                             event.preventDefault();
                         }
                     }
                     else {
                         if (this.isDrawing) this.finalizeCurrentDrawing();
                         this.potentialGraphElementClick = false;
                         this.potentialDragTarget = null;
                         if (!target.closest('.textBox') && !target.closest('#toolbar') && !target.classList.contains('transform-handle') && !target.classList.contains('node-handle')) {
                             if (this.activeTextBox) this.deactivateTextBox();
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
            const previousLastMousePos = this.lastMousePos;
            this.lastMousePos = currentPoint;
            let needsCanvasRedraw = false;
            let needsHandleUpdate = false;
            let previewNeedsRedraw = false;

            // --- Update Hover State / Alt-Preview / Selection Box ---
            // ... (Existing logic for hover, alt-draw, selection rect remains the same) ...
             if (this.activeTextBox && !this.isDraggingItems && !this.isRotating && !this.isScaling && this.mouseDownButton === -1) {
                 const rect = this.activeTextBox.getBoundingClientRect();
                 const buffer = 2;
                 if (screenX < rect.left - buffer || screenX > rect.right + buffer || screenY < rect.top - buffer || screenY > rect.bottom + buffer) {
                     if (this.textBoxRegistry.has(this.activeTextBox.dataset.id)) {
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
                     const hoveredTextBox = targetElement?.closest('.textBox');
                     if (hoveredTextBox && hoveredTextBox !== this.activeTextBox) {
                         this.mouseOverBox = hoveredTextBox;
                     }
                     else if (targetElement === this.canvas) {
                         const node = this.getNodeAtPoint(currentPoint);
                         const edge = node ? null : this.getEdgeAtPoint(currentPoint);
                         if (this.selectionLevel === 'element' && this.elementSelectionActiveForComponentId) {
                             const compId = this.elementSelectionActiveForComponentId;
                             if (node && this.getComponentIdForElement(node.id, 'node') === compId) this.mouseOverNodeId = node.id;
                             if (edge && this.getComponentIdForElement(edge.id, 'edge') === compId) this.mouseOverEdgeId = edge.id;
                         } else if (this.selectionLevel === 'component'){
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
                 needsCanvasRedraw = false; needsHandleUpdate = false; previewNeedsRedraw = false; // No redraw needed for selection rect itself
             }
             // --- Left Mouse Button Held Down ---
             else if (this.mouseDownButton === 0) {
                 const movedEnough = Math.abs(screenX - this.dragStartMousePos.x) > this.DRAG_THRESHOLD || Math.abs(screenY - this.dragStartMousePos.y) > this.DRAG_THRESHOLD;
                 let dragJustStarted = false;

                 // --- Initiate Drag/Transform/Draw if threshold met ---
                 if (!this.isDrawing && !this.isAltDrawing && !this.isDraggingNodes && !this.isDraggingItems && !this.isRotating && !this.isScaling && movedEnough) {
                      if (this.potentialTransformHandleClick || this.potentialNodeHandleClick || this.potentialGraphElementClick || this.potentialDragTarget?.type === 'text') {
                          if (this.activeTextBox) { this.deactivateTextBox(); }
                      }

                      if (this.potentialTransformHandleClick) {
                          if (this.potentialTransformHandleClick === 'rotate') { this.isRotating = true; }
                          else if (this.potentialTransformHandleClick === 'scale') { this.isScaling = true; }
                          dragJustStarted = true; this.body.style.cursor = 'grabbing'; this.potentialTransformHandleClick = null; this.potentialGraphElementClick = false; this.potentialNodeHandleClick = false; this.potentialDragTarget = null;
                      }
                      else if (this.potentialNodeHandleClick || this.potentialGraphElementClick) {
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
                          if (canDrag) { this.prepareNodeDrag(); if (this.dragStartStates.length > 0) { this.isDraggingNodes = true; dragJustStarted = true; this.body.style.cursor = 'grabbing'; } }
                          this.potentialNodeHandleClick = false; this.potentialGraphElementClick = false; this.potentialDragTarget = null;
                      }
                      else if (this.potentialDragTarget?.type === 'text') {
                          const box = this.textBoxRegistry.get(this.potentialDragTarget.id)?.element;
                          if(box && this.selectedTextBoxes.has(box)){ this.isDraggingItems = true; dragJustStarted = true; this.body.style.cursor = 'move'; this.body.style.userSelect = 'none'; this.body.style.webkitUserSelect = 'none'; const startingPersistentCenter = this.scaleRotateCenter && this.initialBBox ? { ...this.scaleRotateCenter } : null; const startingPersistentBBox = this.initialBBox ? { ...this.initialBBox } : null; const startingPersistentAngle = this.selectionRotationAngle; this.dragStartStates = []; this.selectedTextBoxes.forEach(b => { const boxId = b.dataset.id; const d = this.textBoxRegistry.get(boxId); if(d) { const fontSizePx = parseFloat(d.fontSize || '16px'); this.dragStartStates.push({ type: 'text', id: boxId, element: b, startX: d.x, startY: d.y, startWidth: b.offsetWidth, startHeight: b.offsetHeight, startRotation: d.rotation ?? 0, startFontSize: fontSizePx, startGroupRotation: startingPersistentAngle, startCenter: startingPersistentCenter, startBBox: startingPersistentBBox }); } }); }
                          this.potentialGraphElementClick = false; this.potentialNodeHandleClick = false; this.potentialDragTarget = null;
                      }
                      else { this.potentialNodeHandleClick = false; this.potentialGraphElementClick = false; this.potentialDragTarget = null; this.potentialTransformHandleClick = false; }
                      if(dragJustStarted){ needsCanvasRedraw = true; needsHandleUpdate = true; }
                 }

                 // --- Apply Drag/Transform/Draw based on current state ---
                 const dx = screenX - this.dragStartMousePos.x;
                 const dy = screenY - this.dragStartMousePos.y;

                 // Apply Rotation
                 if (this.isRotating) {
                     // ... (Rotation logic remains unchanged) ...
                     event.preventDefault();
                     if (!this.dragStartStates.length || !this.dragStartStates[0].startCenter) return;
                     const rotationCenter = this.dragStartStates[0].startCenter;
                     const currentMouseAngle = Math.atan2(currentPoint.y - rotationCenter.y, currentPoint.x - rotationCenter.x);
                     let deltaAngle = currentMouseAngle - this.startAngle;
                     if (deltaAngle > Math.PI) deltaAngle -= 2 * Math.PI; else if (deltaAngle <= -Math.PI) deltaAngle += 2 * Math.PI;
                     this.currentRotationAngle = deltaAngle;
                     const startGroupRotation = this.dragStartStates[0].startGroupRotation ?? 0;
                     this.currentDragTargetAngle = startGroupRotation + deltaAngle;

                     this.dragStartStates.forEach(itemState => {
                         const startX_orig = itemState.startX; const startY_orig = itemState.startY;
                         let itemStartX = startX_orig; let itemStartY = startY_orig;
                         if(itemState.type === 'text') {
                             itemStartX = startX_orig + (itemState.startWidth / 2);
                             itemStartY = startY_orig + (itemState.startHeight / 2);
                         } else if(itemState.type === 'node'){
                             itemStartX = startX_orig;
                             itemStartY = startY_orig;
                         }

                         const startRelX = itemStartX - rotationCenter.x; const startRelY = itemStartY - rotationCenter.y;
                         const cosDelta = Math.cos(deltaAngle); const sinDelta = Math.sin(deltaAngle);
                         const rotatedRelX = startRelX * cosDelta - startRelY * sinDelta; const rotatedRelY = startRelX * sinDelta + startRelY * cosDelta;
                         const newCenterX = rotationCenter.x + rotatedRelX; const newCenterY = rotationCenter.y + rotatedRelY;

                         if (itemState.type === 'node') { const node = this.nodeRegistry.get(itemState.id); if (node) { node.x = newCenterX; node.y = newCenterY; } }
                         else if (itemState.type === 'text') { const textData = this.textBoxRegistry.get(itemState.id); if (textData?.element) { const width = textData.element.offsetWidth; const height = textData.element.offsetHeight; const newTopLeftX = newCenterX - width / 2; const newTopLeftY = newCenterY - height / 2; textData.x = newTopLeftX; textData.y = newTopLeftY; const textStartRotation = itemState.startRotation ?? 0; const newAbsRotation = textStartRotation + deltaAngle; textData.rotation = newAbsRotation; textData.element.style.left = `${newTopLeftX}px`; textData.element.style.top = `${newTopLeftY}px`;
                         // Keep existing scale transforms if any, add rotation
                         const currentTransform = textData.element.style.transform;
                         const scaleMatch = currentTransform.match(/scale\([^)]+\)/);
                         const scaleStr = scaleMatch ? scaleMatch[0] : '';
                         textData.element.style.transform = `rotate(${newAbsRotation}rad) ${scaleStr}`.trim();
                        } }
                     });
                     needsCanvasRedraw = true; needsHandleUpdate = true;
                 }

                 // Apply Scaling
                 else if (this.isScaling) {
                     event.preventDefault();
                     if (!this.dragStartStates.length || !this.dragStartStates[0].startCenter || !this.dragStartStates[0].startBBox || !this.startDistanceInfo) return;

                     const rotationCenter = this.dragStartStates[0].startCenter;
                     const startBBox = this.dragStartStates[0].startBBox;
                     const startGroupRotation = this.dragStartStates[0].startGroupRotation ?? 0;
                     const cosA = Math.cos(-startGroupRotation); const sinA = Math.sin(-startGroupRotation);

                     // --- Calculate implied scale factors based on mouse position ---
                     const mouseRel = { x: currentPoint.x - rotationCenter.x, y: currentPoint.y - rotationCenter.y };
                     const mouseRelLocal = { x: mouseRel.x * cosA - mouseRel.y * sinA, y: mouseRel.x * sinA + mouseRel.y * cosA };

                     const startHalfWidth = (startBBox.width / 2) || 1e-6; // Avoid division by zero
                     const startHalfHeight = (startBBox.height / 2) || 1e-6;

                     const scaleX_needed = mouseRelLocal.x / startHalfWidth;
                     const scaleY_needed = mouseRelLocal.y / startHalfHeight;

                     // --- Determine actual scale factors (aspect ratio, clamping) ---
                     const hasNodes = this.dragStartStates.some(s => s.type === 'node');
                     const hasText = this.dragStartStates.some(s => s.type === 'text');
                     const maintainAspect = hasText || this.isCtrlDown; // Ctrl or presence of text locks aspect

                     let actualScaleX = scaleX_needed;
                     let actualScaleY = scaleY_needed;
                     let fontSizeScale = 1;

                     if (maintainAspect) {
                         // *** CHANGE HERE: Use Math.min for aspect ratio scaling ***
                         // Use the smaller scale factor to ensure the object fits within the rectangle
                         const s = Math.min(Math.abs(scaleX_needed), Math.abs(scaleY_needed));
                         actualScaleX = s * Math.sign(scaleX_needed || 1);
                         actualScaleY = s * Math.sign(scaleY_needed || 1);
                         fontSizeScale = s; // Font size scales uniformly
                     } else {
                         // Free scaling (aspect ratio not maintained)
                         fontSizeScale = Math.sqrt(Math.abs(actualScaleX * actualScaleY)); // Geometric mean for font
                     }

                     // Apply minimum scale clamp
                     actualScaleX = Math.max(this.MIN_SCALE, Math.abs(actualScaleX)) * Math.sign(actualScaleX || 1);
                     actualScaleY = Math.max(this.MIN_SCALE, Math.abs(actualScaleY)) * Math.sign(actualScaleY || 1);
                     fontSizeScale = Math.max(this.MIN_SCALE, Math.abs(fontSizeScale));

                     // Store final adjusted factors for handle positioning and potential use on mouseUp
                     this.currentScaleFactorX = actualScaleX;
                     this.currentScaleFactorY = actualScaleY;

                     // --- Apply scaling to all items using the final actualScaleX/Y ---
                     this.dragStartStates.forEach(itemState => {
                         let startCenterX, startCenterY;
                         if (itemState.type === 'node') {
                             startCenterX = itemState.startX;
                             startCenterY = itemState.startY;
                         } else if (itemState.type === 'text') {
                             startCenterX = itemState.startX + (itemState.startWidth / 2);
                             startCenterY = itemState.startY + (itemState.startHeight / 2);
                         } else { return; }

                         const startRelCenterX = startCenterX - rotationCenter.x;
                         const startRelCenterY = startCenterY - rotationCenter.y;
                         const localRelX = startRelCenterX * cosA - startRelCenterY * sinA;
                         const localRelY = startRelCenterX * sinA + startRelCenterY * cosA;

                         const scaledLocalRelX = localRelX * actualScaleX; // Use final clamped/aspect factors
                         const scaledLocalRelY = localRelY * actualScaleY; // Use final clamped/aspect factors

                         const cosEnd = Math.cos(startGroupRotation); const sinEnd = Math.sin(startGroupRotation);
                         const scaledRelX = scaledLocalRelX * cosEnd - scaledLocalRelY * sinEnd;
                         const scaledRelY = scaledLocalRelX * sinEnd + scaledLocalRelY * cosEnd;

                         const newTargetCenterX = rotationCenter.x + scaledRelX;
                         const newTargetCenterY = rotationCenter.y + scaledRelY;

                         if (itemState.type === 'node') {
                             const node = this.nodeRegistry.get(itemState.id);
                             if (node) { node.x = newTargetCenterX; node.y = newTargetCenterY; }
                         }
                         else if (itemState.type === 'text') {
                             const textData = this.textBoxRegistry.get(itemState.id);
                             if (textData?.element) {
                                 const startFontSize = itemState.startFontSize || 16;
                                 let newFontSize = Math.round(startFontSize * fontSizeScale); // Use clamped font scale
                                 newFontSize = Math.max(this.MIN_FONT_SIZE, Math.min(this.MAX_FONT_SIZE, newFontSize));
                                 const newFontSizePx = `${newFontSize}px`;

                                 let needsRender = false;
                                 if (textData.fontSize !== newFontSizePx) {
                                     textData.fontSize = newFontSizePx;
                                     textData.element.style.fontSize = textData.fontSize;
                                     needsRender = true;
                                 }

                                 const scaleXSign = actualScaleX < 0 ? -1 : 1;
                                 const scaleYSign = actualScaleY < 0 ? -1 : 1;
                                 const startRotation = itemState.startRotation ?? 0;
                                 textData.rotation = startRotation;
                                 textData.element.style.transform = `rotate(${startRotation}rad) scale(${scaleXSign}, ${scaleYSign})`;

                                 if (needsRender) {
                                     this.renderTextBoxContent(textData.element, textData.text);
                                 }

                                 const newWidth = textData.element.offsetWidth;
                                 const newHeight = textData.element.offsetHeight;
                                 const newTopLeftX = newTargetCenterX - newWidth / 2;
                                 const newTopLeftY = newTargetCenterY - newHeight / 2;

                                 textData.x = newTopLeftX;
                                 textData.y = newTopLeftY;
                                 textData.element.style.left = `${newTopLeftX}px`;
                                 textData.element.style.top = `${newTopLeftY}px`;
                             }
                         }
                     });
                     needsCanvasRedraw = true; needsHandleUpdate = true;
                 }

                 // Apply Node Drag
                 else if (this.isDraggingNodes) {
                     // ... (Node drag logic remains unchanged) ...
                      event.preventDefault();
                     this.dragStartStates.forEach(itemState => { if (itemState.type === 'node') { const node = this.nodeRegistry.get(itemState.id); if (node) { node.x = itemState.startX + dx; node.y = itemState.startY + dy; } } });
                     needsCanvasRedraw = true; needsHandleUpdate = true;
                 }
                 // Apply Text Box Drag
                 else if (this.isDraggingItems) {
                      // ... (Text drag logic remains unchanged) ...
                     event.preventDefault();
                     this.dragStartStates.forEach(itemState => { if (itemState.type === 'text') { const newTopLeftX = itemState.startX + dx; const newTopLeftY = itemState.startY + dy; const textData = this.textBoxRegistry.get(itemState.id); if (textData) { textData.x = newTopLeftX; textData.y = newTopLeftY; } itemState.element.style.left = `${newTopLeftX}px`; itemState.element.style.top = `${newTopLeftY}px`;
                      // Restore original transform (rotation only) during simple drag
                      const startRotation = itemState.startRotation ?? 0;
                      itemState.element.style.transform = `rotate(${startRotation}rad)`; // Reset any scaling from previous ops
                     } });
                     needsCanvasRedraw = true; needsHandleUpdate = true;
                 }

                 // Apply Freehand Drawing
                 else if (this.isDrawing && this.drawingMode === 'freehand') {
                      // ... (Freehand logic remains unchanged) ...
                      event.preventDefault();
                      const lastNode = this.nodeRegistry.get(this.currentDrawingLastNodeId);
                      if (lastNode && this.sqrDist(currentPoint, lastNode) > (this.DRAG_THRESHOLD * this.DRAG_THRESHOLD * 0.5)) {
                          const newNodeId = this.generateId(); const newNode = this.createNode(newNodeId, currentPoint.x, currentPoint.y); const edgeId = this.generateId(); const edge = this.createEdge(edgeId, this.currentDrawingLastNodeId, newNodeId, this.currentColor, this.currentLineWidth);
                          if (newNode && edge) { this.currentTempNodes.push({ ...newNode }); this.currentTempEdges.push({ ...edge }); this.currentDrawingLastNodeId = newNodeId; needsCanvasRedraw = true; }
                           else if(newNode && !edge) { console.warn("Edge creation failed during freehand draw."); this.currentDrawingLastNodeId = newNodeId; needsCanvasRedraw = true; }
                      }
                 }

                 // Update Persistent BBox/Center during Drag
                  if (this.isDraggingNodes || this.isDraggingItems) {
                     // ... (Persistent state update logic remains unchanged) ...
                      const startState = this.dragStartStates[0];
                      if (startState?.startCenter && startState?.startBBox && this.scaleRotateCenter && this.initialBBox) {
                          const initialDragCenter = startState.startCenter;
                          this.scaleRotateCenter.x = initialDragCenter.x + dx; this.scaleRotateCenter.y = initialDragCenter.y + dy;
                          this.initialBBox.centerX = this.scaleRotateCenter.x; this.initialBBox.centerY = this.scaleRotateCenter.y; this.initialBBox.minX = this.scaleRotateCenter.x - this.initialBBox.width / 2; this.initialBBox.maxX = this.scaleRotateCenter.x + this.initialBBox.width / 2; this.initialBBox.minY = this.scaleRotateCenter.y - this.initialBBox.height / 2; this.initialBBox.maxY = this.scaleRotateCenter.y + this.initialBBox.height / 2;
                          needsHandleUpdate = true;
                      }
                  }
            }

            // --- Final Redraw/Update ---
            if (previewNeedsRedraw || needsCanvasRedraw) {
                this.redrawCanvas();
            }
            if (needsHandleUpdate) {
                this.updateNodeHandles();
                this.updateTransformHandles();
            }
        }
        
        handleMouseUp(event) {
            const releasedButton = event.button;
            const screenX = event.clientX;
            const screenY = event.clientY;
            const dragOccurred = Math.abs(screenX - this.dragStartMousePos.x) > this.DRAG_THRESHOLD || Math.abs(screenY - this.dragStartMousePos.y) > this.DRAG_THRESHOLD;
            const wasDrawingFreehand = this.isDrawing && this.drawingMode === 'freehand';
            const wasDraggingNodes = this.isDraggingNodes;
            const wasDraggingItems = this.isDraggingItems;
            const wasRotating = this.isRotating;
            const wasScaling = this.isScaling;
            const wasSelecting = this.isSelecting;
            const clickTargetInfo = this.clickedElementInfo;

            // Use the state exactly as it was at the end of the last mouseMove
            const finalDeltaAngle = this.currentRotationAngle;
            const finalScaleFactorX = this.currentScaleFactorX;
            const finalScaleFactorY = this.currentScaleFactorY;

            let startPersistentStateForHistory = null;
            // Capture the state *before* the transform/drag began for history/undo
            if ((wasRotating || wasScaling || wasDraggingNodes || wasDraggingItems) && this.dragStartStates.length > 0) {
                 // Prefer start state captured during the operation if available
                 const firstState = this.dragStartStates[0];
                 if(firstState.startCenter && firstState.startBBox){
                    startPersistentStateForHistory = { angle: firstState.startGroupRotation ?? 0, center: { ...firstState.startCenter }, box: { ...firstState.startBBox } };
                 } else {
                    // Fallback to current persistent state if start state wasn't fully captured (shouldn't happen often)
                    startPersistentStateForHistory = { angle: this.selectionRotationAngle, center: this.scaleRotateCenter ? { ...this.scaleRotateCenter } : { x: 0, y: 0 }, box: this.initialBBox ? { ...this.initialBBox } : null };
                 }
            }


            this.potentialNodeHandleClick = false; this.potentialGraphElementClick = false; this.potentialTransformHandleClick = null;

            // --- Right Click Release ---
            if (releasedButton === 2 && wasSelecting) {
                event.preventDefault();
                const wasSelectingRect = !this.potentialRightClick;
                let rectBounds = null;
                if (wasSelectingRect && this.selectionRectElem.style.display !== 'none') { rectBounds = this.selectionRectElem.getBoundingClientRect(); }
                this.selectionRectElem.style.display = 'none'; this.isSelecting = false; this.potentialRightClick = false;
                if (wasSelectingRect && rectBounds && rectBounds.width > 0 && rectBounds.height > 0) {
                    // ... (Selection logic remains the same) ...
                    let newlySelectedTextBoxesInRect = new Set(); let newlySelectedComponentsInRect = new Map();
                    this.textBoxRegistry.forEach(boxData => { const el = boxData.element; if (!el || !el.offsetParent) return; const b = el.getBoundingClientRect(); const intersects = b.left < rectBounds.right && b.right > rectBounds.left && b.top < rectBounds.bottom && b.bottom > rectBounds.top; if (intersects) { newlySelectedTextBoxesInRect.add(el); } });
                    this.selectionLevel = 'component'; this.elementSelectionActiveForComponentId = null; this.selectedNodes.clear(); this.selectedEdges.clear(); const processedNodesRect = new Set();
                    this.nodeRegistry.forEach(node => { const nodeInBounds = node.x >= rectBounds.left && node.x <= rectBounds.right && node.y >= rectBounds.top && node.y <= rectBounds.bottom; if (nodeInBounds && !processedNodesRect.has(node.id)) { const { componentNodes, componentEdges, representativeId } = this.findConnectedComponent(node.id, 'node'); if (representativeId && (componentNodes.size > 0 || componentEdges.size > 0)) { if (!newlySelectedComponentsInRect.has(representativeId)) { newlySelectedComponentsInRect.set(representativeId, { componentNodes, componentEdges }); } componentNodes.forEach(nid => processedNodesRect.add(nid)); } } });
                    const previouslySelectedTextBoxes = new Set(this.selectedTextBoxes); const previouslyActiveComponentData = new Map(this.activeComponentData); let finalSelectedTextBoxes = new Set(previouslySelectedTextBoxes); let finalActiveComponentData = new Map(previouslyActiveComponentData);
                    if (this.isCtrlDown) { newlySelectedTextBoxesInRect.forEach(box => { if (previouslySelectedTextBoxes.has(box)) finalSelectedTextBoxes.delete(box); else finalSelectedTextBoxes.add(box); }); newlySelectedComponentsInRect.forEach((compData, compId) => { if (previouslyActiveComponentData.has(compId)) finalActiveComponentData.delete(compId); else finalActiveComponentData.set(compId, compData); }); }
                    else if (this.isShiftDown) { newlySelectedTextBoxesInRect.forEach(box => finalSelectedTextBoxes.add(box)); newlySelectedComponentsInRect.forEach((compData, compId) => finalActiveComponentData.set(compId, compData)); }
                    else { finalSelectedTextBoxes = newlySelectedTextBoxesInRect; finalActiveComponentData = newlySelectedComponentsInRect; }
                    this.selectedTextBoxes = finalSelectedTextBoxes; this.activeComponentData = finalActiveComponentData;
                    this.resetPersistentTransformState(); this.redrawCanvas(); this.updateNodeHandles(); this.updateTransformHandles();
                }
            }
            // --- Left Click Release ---
            else if (releasedButton === 0) {
                if (wasDrawingFreehand) { this.finalizeCurrentDrawing(); }

                // Finalize Rotation or Scaling
                else if ((wasRotating || wasScaling) && startPersistentStateForHistory?.center && startPersistentStateForHistory?.box) {
                    const transformType = wasRotating ? 'rotate' : 'scale';
                    const transformHistory = {
                        type: 'transform_items', transformType: transformType,
                        center: { ...startPersistentStateForHistory.center }, items: [],
                        startAngle: startPersistentStateForHistory.angle,
                        startCenter: { ...startPersistentStateForHistory.center },
                        startBBox: { ...startPersistentStateForHistory.box },
                        endScaleX: finalScaleFactorX,
                        endScaleY: finalScaleFactorY
                    };
                    let transformApplied = false;
                    const rotationCenter = startPersistentStateForHistory.center;

                    let finalFontSizeScale = 1;
                    if (wasScaling) {
                        const hasText = this.dragStartStates.some(s => s.type === 'text');
                        const maintainAspect = hasText || this.isCtrlDown;
                        if (maintainAspect) { const s = Math.min(Math.abs(finalScaleFactorX), Math.abs(finalScaleFactorY)); finalFontSizeScale = s;}
                        else { finalFontSizeScale = Math.sqrt(Math.abs(finalScaleFactorX * finalScaleFactorY)); }
                        finalFontSizeScale = Math.max(this.MIN_SCALE, Math.abs(finalFontSizeScale));
                    }

                    this.dragStartStates.forEach(itemState => {
                         let finalX, finalY, finalRotation, finalFontSize;
                         const startX_orig = itemState.startX; const startY_orig = itemState.startY;
                         const startRotation_orig = itemState.startRotation ?? 0;
                         const startFontSize_orig = itemState.startFontSize;
                         const startGroupRotation = itemState.startGroupRotation ?? 0;
                         let startCenterX, startCenterY;
                         if (itemState.type === 'node') { startCenterX = startX_orig; startCenterY = startY_orig; }
                         else if (itemState.type === 'text') { startCenterX = startX_orig + (itemState.startWidth / 2); startCenterY = startY_orig + (itemState.startHeight / 2); }
                         else { return; }
                         const startRelCenterX = startCenterX - rotationCenter.x; const startRelCenterY = startCenterY - rotationCenter.y;

                         if (wasRotating) {
                             const cosDelta = Math.cos(finalDeltaAngle); const sinDelta = Math.sin(finalDeltaAngle);
                             const rotatedRelX = startRelCenterX * cosDelta - startRelCenterY * sinDelta; const rotatedRelY = startRelCenterX * sinDelta + startRelCenterY * cosDelta;
                             const endCenterX = rotationCenter.x + rotatedRelX; const endCenterY = rotationCenter.y + rotatedRelY;
                             finalRotation = startRotation_orig + finalDeltaAngle; finalFontSize = startFontSize_orig;
                             if(itemState.type === 'node'){ finalX = endCenterX; finalY = endCenterY; }
                             else { const d = this.textBoxRegistry.get(itemState.id); const currentWidth = d?.element?.offsetWidth ?? itemState.startWidth; const currentHeight = d?.element?.offsetHeight ?? itemState.startHeight; finalX = endCenterX - currentWidth / 2; finalY = endCenterY - currentHeight / 2;}
                         } else { // wasScaling
                             const cosStart = Math.cos(-startGroupRotation); const sinStart = Math.sin(-startGroupRotation); const localRelX = startRelCenterX * cosStart - startRelCenterY * sinStart; const localRelY = startRelCenterX * sinStart + startRelCenterY * cosStart;
                             const scaledLocalRelX = localRelX * finalScaleFactorX; const scaledLocalRelY = localRelY * finalScaleFactorY;
                             const cosEnd = Math.cos(startGroupRotation); const sinEnd = Math.sin(startGroupRotation); const scaledRelX = scaledLocalRelX * cosEnd - scaledLocalRelY * sinEnd; const scaledRelY = scaledLocalRelX * sinEnd + scaledLocalRelY * cosEnd;
                             const endCenterX = rotationCenter.x + scaledRelX; const endCenterY = rotationCenter.y + scaledRelY;
                             finalRotation = startRotation_orig; finalFontSize = Math.round((startFontSize_orig || 16) * finalFontSizeScale); finalFontSize = Math.max(this.MIN_FONT_SIZE, Math.min(this.MAX_FONT_SIZE, finalFontSize));
                             if(itemState.type === 'node'){ finalX = endCenterX; finalY = endCenterY; }
                             else { const d = this.textBoxRegistry.get(itemState.id); const currentWidth = d?.element?.offsetWidth ?? itemState.startWidth; const currentHeight = d?.element?.offsetHeight ?? itemState.startHeight; finalX = endCenterX - currentWidth / 2; finalY = endCenterY - currentHeight / 2; }
                         }

                         let moved = false;
                         if (finalX !== undefined && finalY !== undefined) {
                             if (itemState.type === 'node') { moved = Math.abs(finalX - itemState.startX) > 0.1 || Math.abs(finalY - itemState.startY) > 0.1; }
                             else if (itemState.type === 'text') { moved = Math.abs(finalX - itemState.startX) > 0.1 || Math.abs(finalY - itemState.startY) > 0.1 || Math.abs(finalRotation - startRotation_orig) > 0.01 || Math.abs(finalFontSize - (startFontSize_orig ?? 0)) > 0.1; }
                         }

                         if (moved) {
                             transformHistory.items.push({ id: itemState.id, type: itemState.type, startX: itemState.startX, startY: itemState.startY, endX: finalX, endY: finalY, startWidth: itemState.startWidth, startHeight: itemState.startHeight, startRotation: startRotation_orig, endRotation: finalRotation, startFontSize: startFontSize_orig, endFontSize: finalFontSize, startScaleX: 1, startScaleY: 1, endScaleX: finalScaleFactorX, endScaleY: finalScaleFactorY });
                             transformApplied = true;
                         }
                    });

                    if (transformApplied) {
                        this.applyTransform(transformHistory.items, false); // Apply final calculated state
                        this.addHistory(transformHistory);
                    }

                    // Update Persistent State
                    const startGroupRotation_mu = startPersistentStateForHistory.angle;
                    const newPersistentAngle = startGroupRotation_mu + (wasRotating ? finalDeltaAngle : 0);
                    this.selectionRotationAngle = newPersistentAngle;
                    this.scaleRotateCenter = { ...startPersistentStateForHistory.center }; // Center doesn't change
                    let newWidth = startPersistentStateForHistory.box.width; let newHeight = startPersistentStateForHistory.box.height;
                    if (wasScaling) { newWidth *= Math.abs(finalScaleFactorX); newHeight *= Math.abs(finalScaleFactorY); }
                    if (newWidth >= 0 && newHeight >= 0) { this.initialBBox = { centerX: this.scaleRotateCenter.x, centerY: this.scaleRotateCenter.y, width: newWidth, height: newHeight, minX: this.scaleRotateCenter.x - newWidth / 2, minY: this.scaleRotateCenter.y - newHeight / 2, maxX: this.scaleRotateCenter.x + newWidth / 2, maxY: this.scaleRotateCenter.y + newHeight / 2 }; }
                    else { this.initialBBox = null; }
                    this.isRotating = false; this.isScaling = false;
                }
                // Finalize Node Drag
                else if (wasDraggingNodes) {
                    const dx = screenX - this.dragStartMousePos.x; const dy = screenY - this.dragStartMousePos.y;
                    const moves = [];
                    this.dragStartStates.forEach(itemState => { if (itemState.type === 'node') { const node = this.nodeRegistry.get(itemState.id); if (node) { const finalX = node.x; const finalY = node.y; if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) { moves.push({ id: itemState.id, startX: itemState.startX, startY: itemState.startY, endX: finalX, endY: finalY }); } } } });
                    if (moves.length > 0) { this.addHistory({ type: 'move_nodes', moves: moves }); }
                    // Update persistent state - This should be correct as is
                    if (startPersistentStateForHistory?.center && startPersistentStateForHistory?.box) { const initialDragCenter = startPersistentStateForHistory.center; this.scaleRotateCenter.x = initialDragCenter.x + dx; this.scaleRotateCenter.y = initialDragCenter.y + dy; this.initialBBox = { ...startPersistentStateForHistory.box }; this.initialBBox.centerX = this.scaleRotateCenter.x; this.initialBBox.centerY = this.scaleRotateCenter.y; this.initialBBox.minX = this.scaleRotateCenter.x - this.initialBBox.width / 2; this.initialBBox.maxX = this.scaleRotateCenter.x + this.initialBBox.width / 2; this.initialBBox.minY = this.scaleRotateCenter.y - this.initialBBox.height / 2; this.initialBBox.maxY = this.scaleRotateCenter.y + this.initialBBox.height / 2; }
                    else { this.resetPersistentTransformState(); }
                    this.isDraggingNodes = false;
                }
                // Finalize Text Box Drag
                else if (wasDraggingItems) {
                    this.body.style.userSelect = 'auto'; this.body.style.webkitUserSelect = 'auto';
                    const dx = screenX - this.dragStartMousePos.x; const dy = screenY - this.dragStartMousePos.y;
                    const moves = [];

                    // Create history entry based on final positions from registry (set by last mouseMove)
                    this.dragStartStates.forEach(itemState => {
                        if (itemState.type === 'text') {
                            const boxData = this.textBoxRegistry.get(itemState.id);
                            if (boxData) {
                                const finalX = boxData.x; const finalY = boxData.y;
                                const itemRotation = boxData.rotation ?? itemState.startRotation ?? 0;
                                const itemFontSize = parseFloat(boxData.fontSize || itemState.startFontSize || '16px');
                                // Check if position actually changed substantially since drag start
                                if (Math.abs(finalX - itemState.startX) > 0.1 || Math.abs(finalY - itemState.startY) > 0.1) {
                                    moves.push({ id: itemState.id, type: 'text', startX: itemState.startX, startY: itemState.startY, endX: finalX, endY: finalY, startRotation: itemState.startRotation, endRotation: itemRotation, startFontSize: itemState.startFontSize, endFontSize: itemFontSize });
                                }
                            }
                        }
                    });
                    if (moves.length > 0) {
                        this.addHistory({ type: 'move_text', moves: moves });
                    }

                    // *** CHANGE: Remove persistent state update here ***
                    // Assume the persistent state was correctly updated during the last handleMouseMove
                    // If startPersistentStateForHistory is missing here, it indicates a deeper problem
                    if (!startPersistentStateForHistory?.center || !startPersistentStateForHistory?.box) {
                         console.warn("Drag ended without valid start persistent state captured.");
                         // Attempt to recalculate or reset? Resetting is safer.
                         this.resetPersistentTransformState();
                     } else {
                        // We trust the state set by mouseMove.
                        // Verify the final state is consistent (optional debug check)
                        // const expectedCenterX = startPersistentStateForHistory.center.x + dx;
                        // const expectedCenterY = startPersistentStateForHistory.center.y + dy;
                        // if (Math.abs(this.scaleRotateCenter.x - expectedCenterX) > 1 || Math.abs(this.scaleRotateCenter.y - expectedCenterY) > 1) {
                        //    console.warn("Potential mismatch between mouseUp delta and mouseMove persistent state update");
                        //}
                     }

                    this.isDraggingItems = false;
                }
                // Simple Click (No Drag/Draw/Transform)
                else if (!dragOccurred && !wasDrawingFreehand && !this.isAltDown) {
                    if (clickTargetInfo && clickTargetInfo.type === 'text') {
                        const targetBox = this.textBoxRegistry.get(clickTargetInfo.id)?.element;
                        if (targetBox && this.selectedTextBoxes.has(targetBox) && this.selectedTextBoxes.size === 1 && this.activeComponentData.size === 0) { /* Prep for dblclick */ }
                    }
                }
            } // End Left Click Release

            // --- Reset States ---
            this.mouseDownButton = -1;
            this.isSelecting = false;
            this.dragStartStates = [];
            this.snapTargetNode = null;
            this.potentialDragTarget = null;
            this.clickedElementInfo = null;
            this.potentialRightClick = false;
            this.currentRotationAngle = 0;
            this.currentScaleFactor = 1;
            this.currentScaleFactorX = 1;
            this.currentScaleFactorY = 1;
            if (this.isAltDrawing && !this.isAltDown) { this.isAltDrawing = false; this.altDrawingSourceNodeId = null; }

            // --- Final UI Update ---
            this.updateCursorBasedOnContext();
            this.redrawCanvas();
            this.updateNodeHandles();
            this.updateTransformHandles();
        }
        finalizeCurrentDrawing() {
            if (!this.isDrawing && !this.isAltDrawing) return;
            if (this.isDrawing && this.drawingMode === 'freehand') { const historyType = 'create_graph_elements'; const wasSimpleClick = this.currentTempNodes.length === 1 && this.currentTempEdges.length === 0; const startNode = this.currentTempNodes.length > 0 ? this.nodeRegistry.get(this.currentTempNodes[0]?.id) : null; const movedNegligibly = startNode && this.dragStartMousePos && this.sqrDist(this.dragStartMousePos, startNode) < (this.DRAG_THRESHOLD * this.DRAG_THRESHOLD); if ((wasSimpleClick || this.currentTempEdges.length === 0) && movedNegligibly) { const nodeIdToDelete = this.currentTempNodes[0]?.id; if (nodeIdToDelete && this.nodeRegistry.has(nodeIdToDelete)) { this._deleteNodeInternal(nodeIdToDelete); } } else if (this.currentTempNodes.length > 0 || this.currentTempEdges.length > 0) { this.addHistory({ type: historyType, nodes: JSON.parse(JSON.stringify(this.currentTempNodes)), edges: JSON.parse(JSON.stringify(this.currentTempEdges)) }); if(this.currentDrawingStartNodeId) { this.deselectAll(); this.selectComponent(this.currentDrawingStartNodeId, 'node'); } } this.setDrawingState(false, 'freehand'); this.currentDrawingStartNodeId = null; this.currentDrawingLastNodeId = null; this.currentTempNodes = []; this.currentTempEdges = []; }
            else if (this.isAltDrawing) { const lastNodeId = this.altDrawingSourceNodeId; this.isAltDrawing = false; this.altDrawingSourceNodeId = null; if (lastNodeId && this.nodeRegistry.has(lastNodeId)) { this.deselectAll(); this.selectComponent(lastNodeId, 'node'); } }
            this.snapTargetNode = null; this.redrawCanvas(); this.updateNodeHandles(); this.updateTransformHandles(); this.updateCursorBasedOnContext();
        }
        handleDoubleClick(event) {
            const target = event.target;
            if (target.closest('#toolbar') || target.classList.contains('transform-handle') || target.classList.contains('node-handle')) return;
            if (this.isDrawing || this.isAltDrawing || this.isSelecting || this.isRotating || this.isScaling || this.isDraggingItems || this.isDraggingNodes) return;

            const screenX = event.clientX;
            const screenY = event.clientY;
            const clickPoint = { x: screenX, y: screenY };

            const targetBox = target.closest('.textBox');
            if (targetBox) {
                if (!this.textBoxRegistry.has(targetBox.dataset.id)) return;
                event.stopPropagation();
                event.preventDefault();
                this.deselectAllGraphElements();
                this.selectedTextBoxes.forEach(selectedBox => {
                    if (selectedBox !== targetBox) {
                        this.selectedTextBoxes.delete(selectedBox);
                    }
                });
                if (!this.selectedTextBoxes.has(targetBox)) {
                    this.selectedTextBoxes.add(targetBox);
                }
                this.resetPersistentTransformState();
                this.setActiveTextBox(targetBox);
                return;
            }

            const hitNode = this.getNodeAtPoint(clickPoint);
            const hitEdge = hitNode ? null : this.getEdgeAtPoint(clickPoint);
            const hitElementId = hitNode?.id || hitEdge?.id;
            const hitElementType = hitNode ? 'node' : (hitEdge ? 'edge' : null);

            if (hitElementId) {
                event.stopPropagation();
                event.preventDefault();
                const componentId = this.getComponentIdForElement(hitElementId, hitElementType);
                if (!componentId) return;
                this.deselectAll(false);
                this.selectionLevel = 'element';
                this.elementSelectionActiveForComponentId = componentId;
                const { componentNodes, componentEdges } = this.findConnectedComponent(hitElementId, hitElementType);
                if (componentNodes.size > 0 || componentEdges.size > 0) {
                    this.activeComponentData.set(componentId, { componentNodes, componentEdges });
                }
                this.selectElement(hitElementId, hitElementType, false);
                this.resetPersistentTransformState();
                this.redrawCanvas();
                this.updateNodeHandles();
                this.updateTransformHandles();
                return;
            }

            if (target === this.canvas && this.selectionLevel === 'element') {
                event.stopPropagation();
                event.preventDefault();
                this.deselectAll();
                return;
            }
        }

        handleKeyDown(event) {
            const wasAltDown = this.isAltDown;
            this.isCtrlDown = event.ctrlKey || event.metaKey;
            this.isShiftDown = event.shiftKey;
            this.isAltDown = event.altKey;

            if (this.isAltDown && !wasAltDown && !this.isRotating && !this.isScaling && !this.isDraggingItems && !this.isDraggingNodes && !this.isAltDrawing) {
                this.altPreviewSourceNodeIds.clear();
                if (this.selectionLevel === 'element' && this.elementSelectionActiveForComponentId) { this.selectedNodes.forEach(nid => this.altPreviewSourceNodeIds.add(nid)); }
                else if (this.selectionLevel === 'component') { this.activeComponentData.forEach(comp => comp.componentNodes.forEach(nid => this.altPreviewSourceNodeIds.add(nid))); }
                if(this.altPreviewSourceNodeIds.size > 0) { this.redrawCanvas(); this.updateNodeHandles(); }
                this.updateCursorBasedOnContext();
            }

            const focusIsOnToolbarInput = document.activeElement === this.colorPicker || document.activeElement === this.lineWidthPicker || document.activeElement === this.fontSizeInput;
            if (focusIsOnToolbarInput) return;

            const currentActiveTextBox = this.activeTextBox;
            const focusIsOnEditableTextBox = currentActiveTextBox && document.activeElement === currentActiveTextBox && currentActiveTextBox.isContentEditable;

            if (event.key === 'Escape') {
                event.preventDefault();
                if (this.isRotating || this.isScaling) { this.applyTransform(this.dragStartStates, true); const startState = this.dragStartStates[0]; if (startState) { this.selectionRotationAngle = startState.startGroupRotation ?? 0; this.initialBBox = startState.startBBox ? { ...startState.startBBox } : null; this.scaleRotateCenter = startState.startCenter ? { ...startState.startCenter } : {x:0,y:0}; } else { this.resetPersistentTransformState(); } this.isRotating = false; this.isScaling = false; this.dragStartStates = []; this.currentRotationAngle = 0; this.currentScaleFactor = 1; this.currentScaleFactorX = 1; this.currentScaleFactorY = 1; this.redrawCanvas(); this.updateNodeHandles(); this.updateTransformHandles(); this.updateCursorBasedOnContext(); }
                else if (this.isDrawing || this.isAltDrawing) { this.finalizeCurrentDrawing(); }
                else if (this.isSelecting) { this.isSelecting = false; this.potentialRightClick = false; this.selectionRectElem.style.display = 'none'; }
                else if (focusIsOnEditableTextBox) { this.deactivateTextBox(currentActiveTextBox); this.body.focus({ preventScroll: true }); }
                else if (this.selectionLevel === 'element' || this.selectedTextBoxes.size > 0 || this.activeComponentData.size > 0 || this.initialBBox){ this.deselectAll(); }
                return;
            }

            if (focusIsOnEditableTextBox) {
                if (event.key === 'Enter' && !this.isShiftDown) {
                    event.preventDefault();
                    this.deactivateTextBox(currentActiveTextBox);
                    this.body.focus({ preventScroll: true });
                }
                return;
            }

            if (this.isCtrlDown && event.key.toLowerCase() === 'a') { event.preventDefault(); this.selectAllItems(); return; }
            if (this.isCtrlDown && event.key.toLowerCase() === 'z') { event.preventDefault(); this.undo(); return; }
            if (this.isCtrlDown && event.key.toLowerCase() === 'y') { event.preventDefault(); this.redo(); return; }
            if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); this.deleteSelected(); return; }

            const isPrintable = event.key.length === 1 && !this.isCtrlDown && !this.isAltDown;
            if (isPrintable && this.lastMousePos) {
                if (!this.isDrawing && !this.isAltDrawing && !this.isRotating && !this.isScaling && !this.isDraggingItems && !this.isDraggingNodes && !this.isSelecting) {
                    if (this.selectionLevel === 'element') this.deselectAll();
                    this.createNewTextBox(this.lastMousePos.x, this.lastMousePos.y, event.key);
                    event.preventDefault(); return;
                }
            }
        }
        handleKeyUp(event) { const wasAltDown = this.isAltDown; this.isCtrlDown = event.ctrlKey || event.metaKey; this.isShiftDown = event.shiftKey; this.isAltDown = event.altKey; this.updateCursorBasedOnContext(); if (event.key === 'Alt' && wasAltDown && !this.isAltDown) { if (this.isAltDrawing) { this.finalizeCurrentDrawing(); } this.altPreviewSourceNodeIds.clear(); this.redrawCanvas(); this.updateNodeHandles(); } }
        handleColorChange(event) { const newColor = event.target.value; this.currentColor = newColor; const changes = { texts: [], edges: [] }; let redrawNeeded = false; this.selectedTextBoxes.forEach(box => { const id = box.dataset.id; if (!this.textBoxRegistry.has(id)) return; const d = this.textBoxRegistry.get(id); const oldColor = d.color; if (oldColor !== newColor) { d.color = newColor; d.element.style.color = newColor; changes.texts.push({ id, oldColor, newColor }); } }); const edgesToChange = new Set(); if (this.selectionLevel === 'element' && this.elementSelectionActiveForComponentId) { this.selectedEdges.forEach(eid => edgesToChange.add(eid)); } else { this.activeComponentData.forEach(compData => compData.componentEdges.forEach(eid => edgesToChange.add(eid))); } edgesToChange.forEach(id => { if (this.edgeRegistry.has(id)) { const d = this.edgeRegistry.get(id); const oldColor = d.color; if (oldColor !== newColor) { d.color = newColor; changes.edges.push({ id, oldColor, newColor }); redrawNeeded = true; } } }); if (changes.texts.length > 0 || changes.edges.length > 0) { this.addHistory({ type: 'change_color', changes }); if (redrawNeeded) this.redrawCanvas(); } }
        handleLineWidthChange(event) { const newLineWidth = parseInt(event.target.value, 10); if (isNaN(newLineWidth) || newLineWidth < 1) return; this.currentLineWidth = newLineWidth; this.lineWidthPicker.value = newLineWidth; const changes = []; let redrawNeeded = false; const edgesToChange = new Set(); if (this.selectionLevel === 'element' && this.elementSelectionActiveForComponentId) { this.selectedEdges.forEach(eid => edgesToChange.add(eid)); } else { this.activeComponentData.forEach(compData => compData.componentEdges.forEach(eid => edgesToChange.add(eid))); } edgesToChange.forEach(id => { if (this.edgeRegistry.has(id)) { const d = this.edgeRegistry.get(id); const oldLineWidth = d.lineWidth || 2; if (oldLineWidth !== newLineWidth) { d.lineWidth = newLineWidth; changes.push({ id, oldLineWidth, newLineWidth }); redrawNeeded = true; } } }); if (changes.length > 0) { this.addHistory({ type: 'change_linewidth', changes }); if (redrawNeeded) this.redrawCanvas(); } }
        handleFontSizeChange(event) { let newFontSizeVal = parseInt(event.target.value, 10); if (isNaN(newFontSizeVal)) return; newFontSizeVal = Math.max(this.MIN_FONT_SIZE, Math.min(this.MAX_FONT_SIZE, newFontSizeVal)); this.fontSizeInput.value = newFontSizeVal; const newFontSize = `${newFontSizeVal}px`; this.currentFontSize = newFontSize; const changes = []; this.selectedTextBoxes.forEach(box => { const id = box.dataset.id; if (!this.textBoxRegistry.has(id)) return; const d = this.textBoxRegistry.get(id); const oldFontSize = d.fontSize || '16px'; if (oldFontSize !== newFontSize) { const centerX = d.x + d.element.offsetWidth / 2; const centerY = d.y + d.element.offsetHeight / 2; d.fontSize = newFontSize; d.element.style.fontSize = newFontSize; this.renderTextBoxContent(d.element, d.text); this._updateTextBoxPositionAndSize(d.element, centerX, centerY); changes.push({ id, oldFontSize, newFontSize }); } }); if (changes.length > 0) { this.addHistory({ type: 'change_fontsize', changes }); this.resetPersistentTransformState(); this.redrawCanvas(); this.updateTransformHandles(); } }

        applyTransform(itemStates, applyStart = false) {
            itemStates.forEach(itemState => {
                const isNode = itemState.type === 'node';
                const isText = itemState.type === 'text';
       
                const startX = itemState.startX; const startY = itemState.startY;
                const endX = itemState.endX; const endY = itemState.endY;
                const startRotation = itemState.startRotation ?? 0;
                const endRotation = itemState.endRotation ?? startRotation;
                const startFontSize = itemState.startFontSize;
                const endFontSize = itemState.endFontSize ?? startFontSize;
                const startWidth = itemState.startWidth;
                const startHeight = itemState.startHeight;
                const endScaleX = itemState.endScaleX ?? 1; // Scale factor at the end state
                const endScaleY = itemState.endScaleY ?? 1;
       
                // Target state depends on whether we are undoing or redoing/applying final
                const targetX = applyStart ? startX : endX; // Target Top-Left X for text, Center X for node
                const targetY = applyStart ? startY : endY; // Target Top-Left Y for text, Center Y for node
                const targetRotation = applyStart ? startRotation : endRotation;
                const targetFontSize = applyStart ? startFontSize : endFontSize;
                const targetScaleX = applyStart ? 1 : endScaleX; // Apply scale only when applying end state
                const targetScaleY = applyStart ? 1 : endScaleY;
       
       
                if (isNode) {
                    const node = this.nodeRegistry.get(itemState.id);
                    if (node) {
                        node.x = targetX;
                        node.y = targetY;
                    }
                } else if (isText) {
                    const textData = this.textBoxRegistry.get(itemState.id);
                    if (textData?.element) {
                        // Apply target font size and rotation first
                        textData.fontSize = `${targetFontSize}px`;
                        textData.rotation = targetRotation; // Store final logical rotation
                        textData.element.style.fontSize = textData.fontSize;
       
                        // Apply transform: rotation and potential flip based on target scale signs
                        const scaleXSign = targetScaleX < 0 ? -1 : 1;
                        const scaleYSign = targetScaleY < 0 ? -1 : 1;
                        textData.element.style.transform = `rotate(${targetRotation}rad) scale(${scaleXSign}, ${scaleYSign})`;
       
                        // Re-render content which updates element size based on font
                        this.renderTextBoxContent(textData.element, textData.text);
       
                        // Calculate the target center based on the target top-left
                        // and the *newly rendered* size (or start size if applying start).
                        const currentWidth = textData.element.offsetWidth;
                        const currentHeight = textData.element.offsetHeight;
                        const widthForCenter = applyStart ? (startWidth ?? currentWidth) : currentWidth;
                        const heightForCenter = applyStart ? (startHeight ?? currentHeight) : currentHeight;
       
                        const targetCenterX = targetX + widthForCenter / 2;
                        const targetCenterY = targetY + heightForCenter / 2;
       
                        // Use the helper to set the final top-left based on the target center and current size
                        this._updateTextBoxPositionAndSize(textData.element, targetCenterX, targetCenterY);
                    }
                }
            });
        }

        addHistory(action) { if (this.undoStack.length >= this.MAX_HISTORY) { this.undoStack.shift(); } this.undoStack.push(action); this.redoStack = []; }
        undo() {
            if (this.undoStack.length === 0) return;
            const action = this.undoStack.pop(); let redo = null;
            const oldPersistent = { angle: this.selectionRotationAngle, box: this.initialBBox ? {...this.initialBBox} : null, center: this.scaleRotateCenter ? {...this.scaleRotateCenter} : null };
            try {
                switch (action.type) {
                    case 'create_text': const currentRawText = this.textBoxRegistry.get(action.boxInfo.id)?.text; redo = { type: 'create_text', boxInfo: { ...action.boxInfo, text: currentRawText ?? action.boxInfo.text } }; this.deleteTextBox(action.boxInfo.id); break;
                    case 'delete_selected': action.deletedInfo.nodes.forEach(n => { this.createNode(n.id, n.x, n.y); }); action.deletedInfo.edges.forEach(e => { this.createEdge(e.id, e.node1Id, e.node2Id, e.color, e.lineWidth); }); action.deletedInfo.texts.forEach(t => { const box = this.createTextBoxElement(t.id, t.text, t.x + (t.width ?? 10)/2, t.y + (t.height ?? 10)/2, t.color, t.fontSize, t.rotation ?? 0); this.selectTextBox(box, true); }); action.deletedInfo.createdEdges?.forEach(ce => { if (this.edgeRegistry.has(ce.id)) this.deleteEdgeSmart(ce.id); }); redo = { type: 'delete_selected', deletedInfo: JSON.parse(JSON.stringify(action.deletedInfo)) }; this.deselectAll(); break;
                    case 'create_graph_elements': const redoNodes_c = []; const redoEdges_c = []; action.edges?.slice().reverse().forEach(ei => { if(this.edgeRegistry.has(ei.id)) { const { edge:de } = this.deleteEdgeSmart(ei.id); if(de) redoEdges_c.unshift(de); } }); action.nodes?.slice().reverse().forEach(ni => { if (this.nodeRegistry.has(ni.id)) { const { node:dn, edges: de_c } = this.deleteNodeSmart(ni.id); if(dn) redoNodes_c.unshift(dn); de_c.forEach(e=>redoEdges_c.unshift(e)); } }); redo = { type: 'create_graph_elements', nodes: redoNodes_c.filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i), edges: redoEdges_c.filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i) }; this.deselectAll(); break;
                    case 'move_nodes': const rNodeMoves = []; action.moves.forEach(m => { const n = this.nodeRegistry.get(m.id); if (n) { n.x = m.startX; n.y = m.startY; rNodeMoves.push({ ...m, startX: m.endX, startY: m.endY, endX: m.startX, endY: m.startY }); } }); redo = { type: 'move_nodes', moves: rNodeMoves }; this.resetPersistentTransformState(); break;
                    case 'move_text': const rTextMoves = []; action.moves.forEach(m => { const d = this.textBoxRegistry.get(m.id); if (d?.element) { const centerX = m.startX + d.element.offsetWidth / 2; const centerY = m.startY + d.element.offsetHeight / 2; this._updateTextBoxPositionAndSize(d.element, centerX, centerY); d.rotation = m.startRotation ?? 0; d.element.style.transform = `rotate(${d.rotation}rad)`; this.renderTextBoxContent(d.element, d.text); rTextMoves.push({ ...m, startX: m.endX, startY: m.endY, endX: m.startX, endY: m.startY, startRotation: m.endRotation, endRotation: m.startRotation }); } }); redo = { type: 'move_text', moves: rTextMoves }; this.resetPersistentTransformState(); break;
                    case 'transform_items':
                        this.applyTransform(action.items, true);
                        this.selectionRotationAngle = action.startAngle ?? 0;
                        this.scaleRotateCenter = action.startCenter ? { ...action.startCenter } : { x: 0, y: 0 };
                        this.initialBBox = action.startBBox ? { ...action.startBBox } : null;
                        action.items.forEach(item => { if(item.type === 'text') { const d = this.textBoxRegistry.get(item.id); if(d) this.renderTextBoxContent(d.element, d.text); }});
                        redo = { ...action, prevPersistent: oldPersistent };
                        break;
                    case 'change_color': const rColChanges = { texts: [], edges: [] }; action.changes.texts.forEach(c => { const d = this.textBoxRegistry.get(c.id); if(d){ d.color = c.oldColor; d.element.style.color = c.oldColor; rColChanges.texts.push({ id: c.id, oldColor: c.newColor, newColor: c.oldColor }); } }); action.changes.edges.forEach(c => { const d = this.edgeRegistry.get(c.id); if(d){ d.color = c.oldColor; rColChanges.edges.push({ id: c.id, oldColor: c.newColor, newColor: c.oldColor }); } }); redo = { type: 'change_color', changes: rColChanges }; break;
                    case 'change_linewidth': const rLwChanges = []; action.changes.forEach(c => { const d = this.edgeRegistry.get(c.id); if(d){ d.lineWidth = c.oldLineWidth; rLwChanges.push({ id: c.id, oldLineWidth: c.newLineWidth, newLineWidth: c.oldLineWidth }); } }); redo = { type: 'change_linewidth', changes: rLwChanges }; break;
                    case 'change_fontsize': const rFsChanges = []; action.changes.forEach(c => { const d = this.textBoxRegistry.get(c.id); if(d?.element){ const centerX = d.x + d.element.offsetWidth / 2; const centerY = d.y + d.element.offsetHeight / 2; d.fontSize = c.oldFontSize; d.element.style.fontSize = c.oldFontSize; this.renderTextBoxContent(d.element, d.text); this._updateTextBoxPositionAndSize(d.element, centerX, centerY); rFsChanges.push({ id: c.id, oldFontSize: c.newFontSize, newFontSize: c.oldFontSize }); } }); redo = { type: 'change_fontsize', changes: rFsChanges }; this.resetPersistentTransformState(); break;
                }
                if (redo) this.redoStack.push(redo);
            } catch (e) { console.error("Undo err:", e, action); this.redoStack = []; this.resetPersistentTransformState(); }
            this.redrawCanvas(); this.updateNodeHandles(); this.updateTransformHandles(); this.updateCursorBasedOnContext();
        }

        redo() {
            if (this.redoStack.length === 0) return;
            const action = this.redoStack.pop(); let undo = null;
            const oldPersistent = { angle: this.selectionRotationAngle, box: this.initialBBox ? {...this.initialBBox} : null, center: this.scaleRotateCenter ? {...this.scaleRotateCenter} : null };
            try {
                switch (action.type) {
                    case 'create_text': const { id: tid_r, text: tt_r, x: tx_r, y: ty_r, color: tc_r, fontSize: tf_r, rotation: tr_r } = action.boxInfo; const box = this.createTextBoxElement(tid_r, tt_r, tx_r, ty_r, tc_r, tf_r, tr_r ?? 0); undo = { type: 'create_text', boxInfo: { ...action.boxInfo } }; this.deselectAll(); this.selectTextBox(box); break;
                    case 'delete_selected': const deleted_ds_r = { texts: [], nodes: [], edges: [], createdEdges: [] }; action.deletedInfo.texts.slice().reverse().forEach(t => { const currentRawText = this.textBoxRegistry.get(t.id)?.text; if(this.deleteTextBox(t.id)) { deleted_ds_r.texts.unshift({ ...t, text: currentRawText ?? t.text }); } }); action.deletedInfo.edges.slice().reverse().forEach(e => { if(this.edgeRegistry.has(e.id)) { const { edge:de } = this.deleteEdgeSmart(e.id); if(de) deleted_ds_r.edges.unshift(de); } }); action.deletedInfo.nodes.slice().reverse().forEach(n => { if(this.nodeRegistry.has(n.id)) { const { node:dn, edges:de, createdEdge:ce } = this.deleteNodeSmart(n.id); if(dn) deleted_ds_r.nodes.unshift(dn); de.forEach(e2 => deleted_ds_r.edges.unshift(e2)); if(ce) deleted_ds_r.createdEdges.unshift(ce); } }); deleted_ds_r.nodes = deleted_ds_r.nodes.filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i); deleted_ds_r.edges = deleted_ds_r.edges.filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i); deleted_ds_r.createdEdges = deleted_ds_r.createdEdges.filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i); if (deleted_ds_r.texts.length > 0 || deleted_ds_r.nodes.length > 0 || deleted_ds_r.edges.length > 0 || deleted_ds_r.createdEdges.length > 0) { undo = { type: 'delete_selected', deletedInfo: deleted_ds_r }; } this.deselectAll(); break;
                    case 'create_graph_elements': const undoNodes_c = []; const undoEdges_c = []; action.nodes?.forEach(n => { const cn = this.createNode(n.id, n.x, n.y); if(cn) undoNodes_c.push({...cn}); }); action.edges?.forEach(e => { const ce = this.createEdge(e.id, e.node1Id, e.node2Id, e.color, e.lineWidth); if(ce) undoEdges_c.push({...ce}); }); undo = { type: 'create_graph_elements', nodes: undoNodes_c, edges: undoEdges_c }; const firstNodeId_r = action.nodes?.[0]?.id || action.edges?.[0]?.node1Id; this.deselectAll(); if (firstNodeId_r) this.selectComponent(firstNodeId_r, 'node'); break;
                    case 'move_nodes': const uNodeMoves = []; action.moves.forEach(m => { const n = this.nodeRegistry.get(m.id); if (n) { n.x = m.endX; n.y = m.endY; uNodeMoves.push({ ...m, startX: m.endX, startY: m.endY, endX: m.startX, endY: m.startY }); } }); undo = { type: 'move_nodes', moves: uNodeMoves }; this.resetPersistentTransformState(); break;
                    case 'move_text': const uTextMoves = []; action.moves.forEach(m => { const d = this.textBoxRegistry.get(m.id); if (d?.element) { const centerX = m.endX + d.element.offsetWidth / 2; const centerY = m.endY + d.element.offsetHeight / 2; this._updateTextBoxPositionAndSize(d.element, centerX, centerY); d.rotation = m.endRotation ?? 0; d.element.style.transform = `rotate(${d.rotation}rad)`; this.renderTextBoxContent(d.element, d.text); uTextMoves.push({ ...m, startX: m.endX, startY: m.endY, endX: m.startX, endY: m.startY, startRotation: m.endRotation, endRotation: m.startRotation }); } }); undo = { type: 'move_text', moves: uTextMoves }; this.resetPersistentTransformState(); break;
                    case 'transform_items':
                        this.applyTransform(action.items, false);
                        if (action.prevPersistent) {
                            this.selectionRotationAngle = action.prevPersistent.angle;
                            this.initialBBox = action.prevPersistent.box ? { ...action.prevPersistent.box } : null;
                            this.scaleRotateCenter = action.prevPersistent.center ? { ...action.prevPersistent.center } : null;
                        } else { this.resetPersistentTransformState(); }
                        action.items.forEach(item => { if(item.type === 'text') { const d = this.textBoxRegistry.get(item.id); if(d) this.renderTextBoxContent(d.element, d.text); }});
                        undo = { ...action, prevPersistent: oldPersistent };
                        break;
                    case 'change_color': const uColChanges = { texts: [], edges: [] }; action.changes.texts.forEach(c => { const d = this.textBoxRegistry.get(c.id); if(d){ d.color = c.newColor; d.element.style.color = c.newColor; uColChanges.texts.push({ id: c.id, oldColor: c.newColor, newColor: c.oldColor }); } }); action.changes.edges.forEach(c => { const d = this.edgeRegistry.get(c.id); if(d){ d.color = c.newColor; uColChanges.edges.push({ id: c.id, oldColor: c.newColor, newColor: c.oldColor }); } }); undo = { type: 'change_color', changes: uColChanges }; break;
                    case 'change_linewidth': const uLwChanges = []; action.changes.forEach(c => { const d = this.edgeRegistry.get(c.id); if(d){ d.lineWidth = c.newLineWidth; uLwChanges.push({ id: c.id, oldLineWidth: c.newLineWidth, newLineWidth: c.oldLineWidth }); } }); undo = { type: 'change_linewidth', changes: uLwChanges }; break;
                    case 'change_fontsize': const uFsChanges = []; action.changes.forEach(c => { const d = this.textBoxRegistry.get(c.id); if(d?.element){ const centerX = d.x + d.element.offsetWidth / 2; const centerY = d.y + d.element.offsetHeight / 2; d.fontSize = c.newFontSize; d.element.style.fontSize = c.newFontSize; this.renderTextBoxContent(d.element, d.text); this._updateTextBoxPositionAndSize(d.element, centerX, centerY); uFsChanges.push({ id: c.id, oldFontSize: c.newFontSize, newFontSize: c.oldFontSize }); } }); undo = { type: 'change_fontsize', changes: uFsChanges }; this.resetPersistentTransformState(); break;
                }
                if (undo) this.undoStack.push(undo);
            } catch (e) { console.error("Redo err:", e, action); this.undoStack = []; this.resetPersistentTransformState(); }
            this.redrawCanvas(); this.updateNodeHandles(); this.updateTransformHandles(); this.updateCursorBasedOnContext();
        }

        init() {
            this.lineWidthPicker.value = this.currentLineWidth;
            this.fontSizeInput.value = parseInt(this.currentFontSize, 10);
            this.colorPicker.value = this.currentColor;

            this.resizeCanvas();
            window.addEventListener('resize', this.resizeCanvas.bind(this));

            document.addEventListener('mousedown', this.handleMouseDown.bind(this));
            document.addEventListener('mousemove', this.handleMouseMove.bind(this));
            document.addEventListener('mouseup', this.handleMouseUp.bind(this));
            document.addEventListener('contextmenu', (e) => e.preventDefault());
            document.addEventListener('keydown', this.handleKeyDown.bind(this));
            document.addEventListener('keyup', this.handleKeyUp.bind(this));
            document.addEventListener('dblclick', this.handleDoubleClick.bind(this));

            this.colorPicker.addEventListener('input', this.handleColorChange.bind(this));
            this.colorPicker.addEventListener('change', this.handleColorChange.bind(this));
            this.lineWidthPicker.addEventListener('change', this.handleLineWidthChange.bind(this));
            this.fontSizeInput.addEventListener('change', this.handleFontSizeChange.bind(this));
            this.fontSizeInput.addEventListener('input', this.handleFontSizeChange.bind(this));

            const handleCanvasMouseEnter = () => {
                const activeElement = document.activeElement;
                if (activeElement === this.colorPicker ||
                    activeElement === this.lineWidthPicker ||
                    activeElement === this.fontSizeInput) {
                    activeElement.blur();
                    setTimeout(() => { this.body.focus({ preventScroll: true }); }, 0);
                }
            };
            if (this.canvas) {
                 this.canvas.addEventListener('mouseenter', handleCanvasMouseEnter);
            }

            this.body.focus({ preventScroll: true });
            this.updateCursorBasedOnContext();
            this.updateTransformHandles();
        }
    }

    new GraphEditor();
});
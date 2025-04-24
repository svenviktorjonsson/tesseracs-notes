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
            this.currentScaleFactor = 1;
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
            const PADDING = 2;

            nodeIds.forEach(nodeId => {
                const node = this.nodeRegistry.get(nodeId);
                if (node) {
                    minX = Math.min(minX, node.x); minY = Math.min(minY, node.y);
                    maxX = Math.max(maxX, node.x); maxY = Math.max(maxY, node.y);
                    elementCount++;
                }
            });

            textBoxIds.forEach(boxId => {
                const data = this.textBoxRegistry.get(boxId);
                const box = data?.element;
                if (!data) return;

                let x, y, width, height, rotation;
                if (box && box.offsetParent && !useRegistry) {
                    x = parseFloat(box.style.left); y = parseFloat(box.style.top); rotation = data.rotation ?? 0;
                    width = box.offsetWidth; height = box.offsetHeight;
                } else {
                    x = data.x; y = data.y; rotation = data.rotation ?? 0;
                    const approxCharWidth = parseFloat(data.fontSize || '16px') * 0.6;
                    const approxCharHeight = parseFloat(data.fontSize || '16px') * 1.2;
                    const textLength = data.text?.length || 1;
                    const lines = data.text?.split('\n').length || 1;
                    width = Math.max(10, (textLength / lines) * approxCharWidth);
                    height = Math.max(10, lines * approxCharHeight);
                }

                if (isNaN(x) || isNaN(y) || width <= 0 || height <= 0) return;

                const cx = x + width / 2; const cy = y + height / 2; const center = { x: cx, y: cy };
                const points = [ { x: x, y: y }, { x: x + width, y: y }, { x: x + width, y: y + height }, { x: x, y: y + height } ];
                const rotatedPoints = points.map(p => this.rotatePoint(p, center, rotation));

                rotatedPoints.forEach(p => {
                    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
                    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
                });
                elementCount++;
            });

            if (elementCount === 0) return null;
            const finalMinX = minX - PADDING; const finalMinY = minY - PADDING;
            const finalMaxX = maxX + PADDING; const finalMaxY = maxY + PADDING;
            const finalWidth = Math.max(0, finalMaxX - finalMinX); const finalHeight = Math.max(0, finalMaxY - finalMinY);
            return {
                minX: finalMinX, minY: finalMinY, maxX: finalMaxX, maxY: finalMaxY,
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

             const isSingleTextBoxSelected = this.selectedTextBoxes.size === 1 && this.activeComponentData.size === 0;
             let refBoxWidth, refBoxHeight, centerForTransform, rotationForTransform;
             const usePersistentState = this.initialBBox && this.initialBBox.width > 0 && this.initialBBox.height > 0 && this.scaleRotateCenter.x !== 0 && this.scaleRotateCenter.y !== 0;

              if (isSingleTextBoxSelected && !usePersistentState) {
                 const textBoxElement = this.selectedTextBoxes.values().next().value;
                 const corners = this.getRotatedTextBoxCorners(textBoxElement);
                  if (!corners || textBoxElement.offsetWidth <= 0 || textBoxElement.offsetHeight <= 0) { rotateHandle.style.display = 'none'; scaleHandle.style.display = 'none'; return; }
                   refBoxWidth = textBoxElement.offsetWidth; refBoxHeight = textBoxElement.offsetHeight; centerForTransform = corners.center; rotationForTransform = this.textBoxRegistry.get(textBoxElement.dataset.id)?.rotation ?? 0;
                   this.initialBBox = this.getCombinedBoundingBox(new Set(), new Set([textBoxElement.dataset.id]));
                   if(this.initialBBox) { this.scaleRotateCenter = { x: this.initialBBox.centerX, y: this.initialBBox.centerY }; this.selectionRotationAngle = rotationForTransform; }
                   else { this.scaleRotateCenter = corners.center; this.selectionRotationAngle = rotationForTransform; this.initialBBox = {centerX: corners.center.x, centerY: corners.center.y, width: refBoxWidth, height: refBoxHeight, minX: corners.center.x - refBoxWidth/2, minY: corners.center.y - refBoxHeight/2, maxX: corners.center.x + refBoxWidth/2, maxY: corners.center.y + refBoxHeight/2 }; }
              } else if (usePersistentState) {
                   refBoxWidth = this.initialBBox.width; refBoxHeight = this.initialBBox.height; centerForTransform = this.scaleRotateCenter; rotationForTransform = this.selectionRotationAngle;
               } else {
                   const currentBBox = this.getSelectionBoundingBox();
                    if (!currentBBox || currentBBox.width <= 0 || currentBBox.height <= 0) { rotateHandle.style.display = 'none'; scaleHandle.style.display = 'none'; return; }
                        refBoxWidth = currentBBox.width; refBoxHeight = currentBBox.height; centerForTransform = { x: currentBBox.centerX, y: currentBBox.centerY }; rotationForTransform = 0;
                        this.initialBBox = currentBBox; this.scaleRotateCenter = centerForTransform; this.selectionRotationAngle = rotationForTransform;
               }

               if (this.isRotating || this.isScaling) {
                   if (!this.dragStartStates.length || !this.dragStartStates[0].startBBox || !this.dragStartStates[0].startCenter) { rotateHandle.style.display = 'none'; scaleHandle.style.display = 'none'; return; }
                   const startBBox = this.dragStartStates[0].startBBox; const startCenter = this.dragStartStates[0].startCenter; const startGroupRotation = this.dragStartStates[0].startGroupRotation ?? 0; // Use startGroupRotation
                   centerForTransform = startCenter; rotationForTransform = startGroupRotation + (this.isRotating ? this.currentRotationAngle : 0);
                   const scaleFactor = this.isScaling ? this.currentScaleFactor : 1; const absScaleFactor = Math.abs(scaleFactor);
                   if (startBBox.width <= 0 || startBBox.height <= 0) { rotateHandle.style.display = 'none'; scaleHandle.style.display = 'none'; return; }
                   refBoxWidth = startBBox.width * absScaleFactor; refBoxHeight = startBBox.height * absScaleFactor;
               }

               const halfWidth = refBoxWidth / 2; const halfHeight = refBoxHeight / 2;
               let relativeCorners = [ { x: -halfWidth, y: -halfHeight }, { x: halfWidth, y: -halfHeight }, { x: halfWidth, y: halfHeight }, { x: -halfWidth, y: halfHeight } ];
               if (this.isScaling && this.currentScaleFactor < 0) { relativeCorners = relativeCorners.map(p => ({ x: -p.x, y: -p.y })); }
               const visualCorners = {
                   tl: this.rotatePoint({ x: centerForTransform.x + relativeCorners[0].x, y: centerForTransform.y + relativeCorners[0].y }, centerForTransform, rotationForTransform),
                   tr: this.rotatePoint({ x: centerForTransform.x + relativeCorners[1].x, y: centerForTransform.y + relativeCorners[1].y }, centerForTransform, rotationForTransform),
                   br: this.rotatePoint({ x: centerForTransform.x + relativeCorners[2].x, y: centerForTransform.y + relativeCorners[2].y }, centerForTransform, rotationForTransform),
                   bl: this.rotatePoint({ x: centerForTransform.x + relativeCorners[3].x, y: centerForTransform.y + relativeCorners[3].y }, centerForTransform, rotationForTransform)
               };

               const newOffset = this.HANDLE_ICON_SIZE * 1.5;

               const topEdgeDx = visualCorners.tr.x - visualCorners.tl.x;
               const topEdgeDy = visualCorners.tr.y - visualCorners.tl.y;
               const topEdgeAngle = Math.atan2(topEdgeDy, topEdgeDx);
               const rotateOffsetAngle = topEdgeAngle - Math.PI / 4;
               const rotateHandleCenterX = visualCorners.tr.x + Math.cos(rotateOffsetAngle) * newOffset;
               const rotateHandleCenterY = visualCorners.tr.y + Math.sin(rotateOffsetAngle) * newOffset;
               rotateHandle.style.left = `${rotateHandleCenterX - (this.HANDLE_ICON_SIZE / 2)}px`;
               rotateHandle.style.top = `${rotateHandleCenterY - (this.HANDLE_ICON_SIZE / 2)}px`;
               rotateHandle.style.display = 'block';

               const rightEdgeDx = visualCorners.br.x - visualCorners.tr.x;
               const rightEdgeDy = visualCorners.br.y - visualCorners.tr.y;
               const rightEdgeAngle = Math.atan2(rightEdgeDy, rightEdgeDx);
               const scaleOffsetAngle = rightEdgeAngle - Math.PI / 4;
               const scaleHandleCenterX = visualCorners.br.x + Math.cos(scaleOffsetAngle) * newOffset;
               const scaleHandleCenterY = visualCorners.br.y + Math.sin(scaleOffsetAngle) * newOffset;
               scaleHandle.style.left = `${scaleHandleCenterX - (this.HANDLE_ICON_SIZE / 2)}px`;
               scaleHandle.style.top = `${scaleHandleCenterY - (this.HANDLE_ICON_SIZE / 2)}px`;
               scaleHandle.style.display = 'block';
        }
        updateCursorBasedOnContext() {
            const targetElement = document.elementFromPoint(this.lastMousePos.x, this.lastMousePos.y);

            if (this.isRotating) { this.body.style.cursor = 'grabbing'; return; }
            if (this.isScaling) { this.body.style.cursor = 'grabbing'; return; }
            if (this.isDraggingNodes) { this.body.style.cursor = 'grabbing'; return; }
            if (this.isDraggingItems) { this.body.style.cursor = 'move'; return; }
            if (this.isDrawing) { this.body.style.cursor = 'crosshair'; return; }
            if (this.isAltDown && !this.isAltDrawing) { this.body.style.cursor = 'crosshair'; return; }
            if (this.isAltDrawing) { this.body.style.cursor = 'crosshair'; return; }
            if (this.isSelecting && !this.potentialRightClick) { this.body.style.cursor = 'default'; return; }

            if (targetElement === this.rotateHandleIconElem) { this.body.style.cursor = 'grab'; return; }
            if (targetElement === this.scaleHandleIconElem) { this.body.style.cursor = 'grab'; return; }

            let cursorStyle = 'default';
            const hoveringAnyTextBox = targetElement?.classList.contains('textBox');

            if (hoveringAnyTextBox) {
                if(targetElement === this.activeTextBox && targetElement.isContentEditable) { cursorStyle = 'text'; }
                else { cursorStyle = 'pointer'; }
            } else if (this.selectionLevel === 'element' && this.elementSelectionActiveForComponentId && (this.mouseOverNodeId || this.mouseOverEdgeId)) { cursorStyle = 'pointer'; }
            else if (this.selectionLevel === 'component' && (this.mouseOverNodeId || this.mouseOverEdgeId || this.mouseOverBox)) { cursorStyle = 'pointer'; }
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
                 const usePersistentState = this.initialBBox && this.initialBBox.width > 0 && this.initialBBox.height > 0 && this.scaleRotateCenter.x !== 0 && this.scaleRotateCenter.y !== 0;
                 let boxToDraw = null; let angleToDraw = 0; let centerToUse = null; let dashStyle = [4, 4]; let colorStyle = 'blue';

                  if (this.isRotating || this.isScaling) {
                       if (this.dragStartStates.length > 0 && this.dragStartStates[0].startBBox && this.dragStartStates[0].startCenter) {
                           const startBBox = this.dragStartStates[0].startBBox; centerToUse = this.dragStartStates[0].startCenter;
                           // ******** FIX START ********
                           // Use startGroupRotation (object's angle before drag) instead of startAngle (mouse angle at drag start)
                           const startGroupRotation = this.dragStartStates[0].startGroupRotation ?? 0;
                           angleToDraw = startGroupRotation + (this.isRotating ? this.currentRotationAngle : 0);
                           // ******** FIX END ********
                           const scaleFactor = this.isScaling ? this.currentScaleFactor : 1;
                           boxToDraw = { centerX: centerToUse.x, centerY: centerToUse.y, width: startBBox.width * Math.abs(scaleFactor), height: startBBox.height * Math.abs(scaleFactor) };
                           dashStyle = [4, 4]; colorStyle = 'dodgerblue';
                       }
                  } else if (this.isDraggingNodes || this.isDraggingItems) {
                       if (usePersistentState) {
                            boxToDraw = { centerX: this.scaleRotateCenter.x, centerY: this.scaleRotateCenter.y, width: this.initialBBox.width, height: this.initialBBox.height };
                            centerToUse = this.scaleRotateCenter; angleToDraw = this.selectionRotationAngle;
                            dashStyle = [4, 4]; colorStyle = 'dodgerblue';
                       } else {
                           const currentBBox = this.getSelectionBoundingBox();
                           if (currentBBox && currentBBox.width > 0 && currentBBox.height > 0) {
                                boxToDraw = { centerX: currentBBox.centerX, centerY: currentBBox.centerY, width: currentBBox.width, height: currentBBox.height };
                                centerToUse = { x: currentBBox.centerX, y: currentBBox.centerY }; angleToDraw = 0;
                                dashStyle = [4, 4]; colorStyle = 'dodgerblue';
                           }
                       }
                  } else if (usePersistentState) {
                       boxToDraw = { centerX: this.scaleRotateCenter.x, centerY: this.scaleRotateCenter.y, width: this.initialBBox.width, height: this.initialBBox.height };
                       centerToUse = this.scaleRotateCenter; angleToDraw = this.selectionRotationAngle; dashStyle = [4, 4]; colorStyle = 'blue';
                  } else {
                       const currentBBox = this.getSelectionBoundingBox();
                       if (currentBBox && currentBBox.width > 0 && currentBBox.height > 0) {
                            boxToDraw = { centerX: currentBBox.centerX, centerY: currentBBox.centerY, width: currentBBox.width, height: currentBBox.height };
                            centerToUse = { x: currentBBox.centerX, y: currentBBox.centerY }; angleToDraw = 0; dashStyle = [4, 4]; colorStyle = 'blue';
                       }
                  }

                 if (boxToDraw && centerToUse && boxToDraw.width > 0 && boxToDraw.height > 0) {
                      const halfWidth = boxToDraw.width / 2; const halfHeight = boxToDraw.height / 2;
                      let relativeCorners = [ { x: -halfWidth, y: -halfHeight }, { x: halfWidth, y: -halfHeight }, { x: halfWidth, y: halfHeight }, { x: -halfWidth, y: halfHeight } ];
                      if (this.isScaling && this.currentScaleFactor < 0) { relativeCorners = relativeCorners.map(p => ({ x: -p.x, y: -p.y })); }
                        const rotatedCorners = relativeCorners.map(p => this.rotatePoint({ x: centerToUse.x + p.x, y: centerToUse.y + p.y }, centerToUse, angleToDraw));
                      this.drawRotatedRect({ tl: rotatedCorners[0], tr: rotatedCorners[1], br: rotatedCorners[2], bl: rotatedCorners[3] }, colorStyle, dashStyle);
                 }
             } else if (this.selectionLevel === 'component' && !isWritingMode) {
                 let hoverCorners = null;
                 const targetElement = document.elementFromPoint(this.lastMousePos.x, this.lastMousePos.y);
                 const isHoveringHandle = targetElement === this.rotateHandleIconElem || targetElement === this.scaleHandleIconElem;
                 if (!isHoveringHandle && !this.isDrawing && !this.isSelecting && !this.isRotating && !this.isScaling && this.mouseDownButton === -1) {
                      if (this.mouseOverNodeId || this.mouseOverEdgeId) {
                         const hoveredElementId = this.mouseOverNodeId || this.mouseOverEdgeId; const hoveredElementType = this.mouseOverNodeId ? 'node' : 'edge'; const compId = this.getComponentIdForElement(hoveredElementId, hoveredElementType); if (compId) { const { componentNodes } = this.findConnectedComponent(hoveredElementId, hoveredElementType); const hoverBBox = this.getCombinedBoundingBox(componentNodes, []); if (hoverBBox && hoverBBox.width > 0 && hoverBBox.height > 0) { const hw=hoverBBox.width/2; const hh=hoverBBox.height/2; const hc= {x:hoverBBox.centerX, y:hoverBBox.centerY}; hoverCorners = { tl: { x: hc.x-hw, y: hc.y-hh }, tr: { x: hc.x+hw, y: hc.y-hh }, br: { x: hc.x+hw, y: hc.y+hh }, bl: { x: hc.x-hw, y: hc.y+hh } }; } }
                      } else if (this.mouseOverBox && this.textBoxRegistry.has(this.mouseOverBox.dataset.id)) {
                          hoverCorners = this.getRotatedTextBoxCorners(this.mouseOverBox);
                      }
                      if (hoverCorners) {
                          this.drawRotatedRect(hoverCorners, '#aaa', [3, 3]);
                      }
                 }
             }

              if (this.isAltDown && !this.isDrawing && !this.isDraggingNodes && !this.isDraggingItems && !this.isRotating && !this.isScaling && this.mouseDownButton === -1 && this.lastMousePos) {
                  const previewEndPoint = this.snapTargetNode ? this.snapTargetNode : this.lastMousePos; this.ctx.save(); this.ctx.lineWidth = this.currentLineWidth; this.ctx.setLineDash([4, 4]); this.ctx.strokeStyle = this.snapTargetNode ? 'red' : this.currentColor;
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

        createTextBoxElement(id, text, screenX, screenY, color = '#000000', fontSize = '16px', rotation = 0, isSelected = false, isActive = false) {
             const div = document.createElement('div'); div.className = 'textBox'; div.dataset.id = id; div.contentEditable = false;
             div.style.position = 'absolute'; div.style.left = `${screenX}px`; div.style.top = `${screenY}px`; div.style.color = color; div.style.fontSize = fontSize; div.style.transform = `rotate(${rotation}rad)`;
             div.style.whiteSpace = 'pre'; div.style.outline = 'none'; div.style.border = 'none'; div.style.padding = '1px'; div.textContent = text;
             div.addEventListener('mouseenter', (event) => { if (this.activeTextBox !== event.currentTarget) { this.mouseOverBox = event.currentTarget; this.redrawCanvas(); this.updateCursorBasedOnContext(); } });
             div.addEventListener('mouseleave', (event) => { if (this.mouseOverBox === event.currentTarget) { this.mouseOverBox = null; this.redrawCanvas(); this.updateCursorBasedOnContext(); } });
             div.addEventListener('focusout', (event) => { setTimeout(() => { if (event.currentTarget && this.activeTextBox === event.currentTarget && !event.currentTarget.contains(document.activeElement) && !this.isDraggingItems && !this.isRotating && !this.isScaling) { this.deactivateTextBox(event.currentTarget); } }, 50); });
             div.addEventListener('dragstart', (e) => e.preventDefault());
             div.addEventListener('input', (event) => { const currentId = event.currentTarget.dataset.id; const data = this.textBoxRegistry.get(currentId); if (data) { data.text = event.currentTarget.textContent; this.resetPersistentTransformState(); this.updateTransformHandles(); } });
             this.body.appendChild(div);
             this.textBoxRegistry.set(id, { element: div, text: text, x: screenX, y: screenY, color: color, fontSize: fontSize, rotation: rotation });
             if (isSelected) this.selectTextBox(div); if (isActive) this.setActiveTextBox(div); return div;
        }
        createNewTextBox(screenX, screenY, initialChar) {
             const tempDiv = document.createElement('div'); tempDiv.style.fontSize = this.currentFontSize; tempDiv.style.fontFamily = getComputedStyle(this.body).fontFamily; tempDiv.style.position = 'absolute'; tempDiv.style.visibility = 'hidden'; tempDiv.style.whiteSpace = 'pre'; tempDiv.textContent = 'A'; this.body.appendChild(tempDiv); const charHeight = tempDiv.offsetHeight; const charWidth = tempDiv.offsetWidth; this.body.removeChild(tempDiv); const newX = screenX - (charWidth / 2); const newY = screenY - (charHeight * 0.8); const newId = this.generateId();

             this.deselectAll();
             this.deactivateTextBox();

             const div = this.createTextBoxElement(newId, initialChar, newX, newY, this.currentColor, this.currentFontSize, 0, false, true);

             this.addHistory({ type: 'create_text', boxInfo: { id: newId, text: initialChar, x: newX, y: newY, color: this.currentColor, fontSize: this.currentFontSize, rotation: 0 } });
             return div;
        }
        deleteTextBox(id) { if (this.textBoxRegistry.has(id)) { try { const d = this.textBoxRegistry.get(id); if (this.mouseOverBox === d.element) this.mouseOverBox = null; this.deselectTextBox(d.element); if (this.activeTextBox === d.element) this.deactivateTextBox(d.element); d.element.remove(); this.textBoxRegistry.delete(id); this.resetPersistentTransformState(); return true; } catch (e) { return false; } } return false; }
        createNode(id, x, y) { if (this.nodeRegistry.has(id)) return this.nodeRegistry.get(id); const nodeData = { id, x, y }; this.nodeRegistry.set(id, nodeData); this.resetPersistentTransformState(); return nodeData; }
        _deleteNodeInternal(id) { if (!this.nodeRegistry.has(id)) return null; const deletedNode = { ...this.nodeRegistry.get(id) }; const compIdToDelete = this.getComponentIdForElement(id, 'node'); this.nodeRegistry.delete(id); this.selectedNodes.delete(id); if (this.activeComponentData.has(compIdToDelete)) { const compData = this.activeComponentData.get(compIdToDelete); compData.componentNodes.delete(id); if (compData.componentNodes.size === 0 && compData.componentEdges.size === 0) { this.activeComponentData.delete(compIdToDelete); if (this.elementSelectionActiveForComponentId === compIdToDelete) { this.deselectAll(); } } } if (this.mouseOverNodeId === id) this.mouseOverNodeId = null; this.resetPersistentTransformState(); return deletedNode; }
        _deleteEdgeInternal(id) { if (!this.edgeRegistry.has(id)) return null; const deletedEdge = { ...this.edgeRegistry.get(id) }; const compId = this.getComponentIdForElement(id, 'edge'); this.edgeRegistry.delete(id); this.selectedEdges.delete(id); if (this.activeComponentData.has(compId)) { const compData = this.activeComponentData.get(compId); compData.componentEdges.delete(id); const n1Exists = this.nodeRegistry.has(deletedEdge.node1Id); const n2Exists = this.nodeRegistry.has(deletedEdge.node2Id); if (n1Exists && n2Exists) { const { representativeId: rep1 } = this.findConnectedComponent(deletedEdge.node1Id, 'node'); const { representativeId: rep2 } = this.findConnectedComponent(deletedEdge.node2Id, 'node'); if (rep1 !== rep2) { if(this.activeComponentData.has(compId)){ this.activeComponentData.delete(compId); } if(rep1 && compData.componentNodes.has(deletedEdge.node1Id)) { const { componentNodes: c1n, componentEdges: c1e} = this.findConnectedComponent(rep1,'node'); this.activeComponentData.set(rep1, {componentNodes:c1n, componentEdges:c1e}); } if(rep2 && compData.componentNodes.has(deletedEdge.node2Id)) { const { componentNodes: c2n, componentEdges: c2e} = this.findConnectedComponent(rep2,'node'); this.activeComponentData.set(rep2, {componentNodes:c2n, componentEdges:c2e}); } if (this.elementSelectionActiveForComponentId === compId) { this.elementSelectionActiveForComponentId = rep1 || rep2 || null; if (!this.elementSelectionActiveForComponentId) this.selectionLevel = 'component'; } } } else if (compData.componentNodes.size === 0 && compData.componentEdges.size === 0) { this.activeComponentData.delete(compId); if(this.elementSelectionActiveForComponentId === compId) this.deselectAll(); } } if (this.mouseOverEdgeId === id) this.mouseOverEdgeId = null; this.resetPersistentTransformState(); return deletedEdge; }
        createEdge(id, node1Id, node2Id, color, lineWidth) { if (this.edgeRegistry.has(id)) return this.edgeRegistry.get(id); if (!this.nodeRegistry.has(node1Id) || !this.nodeRegistry.has(node2Id)) { return null; } const edgeData = { id, node1Id, node2Id, color, lineWidth }; this.edgeRegistry.set(id, edgeData); const compId1 = this.getComponentIdForElement(node1Id, 'node'); const compId2 = this.getComponentIdForElement(node2Id, 'node'); let mergeNeeded = false; let comp1Selected = this.activeComponentData.has(compId1); let comp2Selected = this.activeComponentData.has(compId2); let comp1ElementFocus = this.selectionLevel === 'element' && this.elementSelectionActiveForComponentId === compId1; let comp2ElementFocus = this.selectionLevel === 'element' && this.elementSelectionActiveForComponentId === compId2; if (compId1 && compId2 && compId1 !== compId2 && (comp1Selected || comp1ElementFocus) && (comp2Selected || comp2ElementFocus)) { mergeNeeded = true; } if (mergeNeeded) { const {componentNodes, componentEdges, representativeId} = this.findConnectedComponent(node1Id, 'node'); this.activeComponentData.delete(compId1); this.activeComponentData.delete(compId2); this.activeComponentData.set(representativeId, {componentNodes, componentEdges}); if (comp1ElementFocus || comp2ElementFocus) { this.selectionLevel = 'element'; this.elementSelectionActiveForComponentId = representativeId; } } this.resetPersistentTransformState(); return edgeData; }
        deleteEdgeSmart(edgeId) { const deletedItems = { edge: null, nodes: [], edges: [] }; const edge = this.edgeRegistry.get(edgeId); if (!edge) return deletedItems; const node1Id = edge.node1Id; const node2Id = edge.node2Id; deletedItems.edge = this._deleteEdgeInternal(edgeId); if (!deletedItems.edge) return deletedItems; if (this.nodeRegistry.has(node1Id) && this.getNodeDegree(node1Id) === 0) { const { node: dn, edges: de } = this.deleteNodeSmart(node1Id); if (dn) deletedItems.nodes.push(dn); deletedItems.edges.push(...de); } if (this.nodeRegistry.has(node2Id) && this.getNodeDegree(node2Id) === 0) { const { node: dn, edges: de } = this.deleteNodeSmart(node2Id); if (dn) deletedItems.nodes.push(dn); deletedItems.edges.push(...de); } return deletedItems; }
        deleteNodeSmart(nodeId) { const deletedItems = { node: null, edges: [], createdEdge: null }; if (!this.nodeRegistry.has(nodeId)) return deletedItems; const incidentEdges = []; for (const edge of this.edgeRegistry.values()) { if (edge.node1Id === nodeId || edge.node2Id === nodeId) { incidentEdges.push({ ...edge }); } } if (incidentEdges.length === 2) { const edge1 = incidentEdges[0]; const edge2 = incidentEdges[1]; const neighbour1Id = (edge1.node1Id === nodeId) ? edge1.node2Id : edge1.node1Id; const neighbour2Id = (edge2.node1Id === nodeId) ? edge2.node2Id : edge2.node1Id; if (neighbour1Id !== neighbour2Id && this.nodeRegistry.has(neighbour1Id) && this.nodeRegistry.has(neighbour2Id)) { if (!this.edgeExists(neighbour1Id, neighbour2Id)) { deletedItems.node = this._deleteNodeInternal(nodeId); if(deletedItems.node) { const deletedEdge1 = this._deleteEdgeInternal(edge1.id); const deletedEdge2 = this._deleteEdgeInternal(edge2.id); if(deletedEdge1) deletedItems.edges.push(deletedEdge1); if(deletedEdge2) deletedItems.edges.push(deletedEdge2); const newEdgeId = this.generateId(); const newEdge = this.createEdge(newEdgeId, neighbour1Id, neighbour2Id, edge1.color, edge1.lineWidth); if (newEdge) deletedItems.createdEdge = { ...newEdge }; } return deletedItems; } } } deletedItems.node = this._deleteNodeInternal(nodeId); if(deletedItems.node) { incidentEdges.forEach(edge => { const deletedEdge = this._deleteEdgeInternal(edge.id); if (deletedEdge) deletedItems.edges.push(deletedEdge); }); } return deletedItems; }
        deleteSelected() { const deletedHistory = { texts: [], nodes: [], edges: [], createdEdges: [] }; Array.from(this.selectedTextBoxes).forEach(box => { const id = box.dataset.id; if (!this.textBoxRegistry.has(id)) return; const d = this.textBoxRegistry.get(id); deletedHistory.texts.push({ id: id, text: box.textContent, x: d.x, y: d.y, color: d.color, fontSize: d.fontSize, rotation: d.rotation ?? 0 }); this.deleteTextBox(id); }); const nodesToDelete = new Set(); const edgesToDelete = new Set(); if (this.selectionLevel === 'element' && this.elementSelectionActiveForComponentId) { const compData = this.activeComponentData.get(this.elementSelectionActiveForComponentId); if (compData) { this.selectedNodes.forEach(nid => { if (compData.componentNodes.has(nid)) nodesToDelete.add(nid); }); this.selectedEdges.forEach(eid => { if (compData.componentEdges.has(eid)) edgesToDelete.add(eid); }); } } else { this.activeComponentData.forEach(compData => { compData.componentNodes.forEach(nid => nodesToDelete.add(nid)); compData.componentEdges.forEach(eid => edgesToDelete.add(eid)); }); } const processedEdges = new Set(); const processedNodes = new Set(); edgesToDelete.forEach(edgeId => { if (processedEdges.has(edgeId) || !this.edgeRegistry.has(edgeId)) return; const { edge: de, nodes: dn_consq, edges: de_consq } = this.deleteEdgeSmart(edgeId); if (de) { deletedHistory.edges.push(de); processedEdges.add(de.id); } dn_consq.forEach(n => { if (!processedNodes.has(n.id)) { deletedHistory.nodes.push(n); processedNodes.add(n.id); } }); de_consq.forEach(e => { if (!processedEdges.has(e.id)) { deletedHistory.edges.push(e); processedEdges.add(e.id); } }); }); nodesToDelete.forEach(nodeId => { if (processedNodes.has(nodeId) || !this.nodeRegistry.has(nodeId)) return; const { node: dn, edges: de, createdEdge: ce } = this.deleteNodeSmart(nodeId); if (dn) { deletedHistory.nodes.push(dn); processedNodes.add(dn.id); } de.forEach(e => { if (!processedEdges.has(e.id)) { deletedHistory.edges.push(e); processedEdges.add(e.id); } }); if (ce) { deletedHistory.createdEdges.push(ce); } }); const deletedSomething = deletedHistory.texts.length > 0 || deletedHistory.nodes.length > 0 || deletedHistory.edges.length > 0 || deletedHistory.createdEdges.length > 0; if (deletedSomething) { this.addHistory({ type: 'delete_selected', deletedInfo: deletedHistory }); } this.deselectAll(); this.redrawCanvas(); this.updateNodeHandles(); this.updateTransformHandles(); this.body.focus({ preventScroll: true }); }

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
                            startGroupRotation: startingPersistentAngle, // Use startGroupRotation
                            startCenter: startingPersistentCenter,
                            startBBox: startingPersistentBBox
                        });
                    }
                });
            }
        }
        handleNodeMouseDown(event) { event.stopPropagation(); this.mouseDownButton = event.button; if (this.mouseDownButton !== 0 && this.mouseDownButton !== 2) return; const handle = event.target; const nodeId = handle.dataset.nodeId; const node = this.nodeRegistry.get(nodeId); if (!node) return; if(this.isDrawing) this.finalizeCurrentDrawing(); this.isDraggingNodes = false; this.potentialNodeHandleClick = true; this.potentialGraphElementClick = false; this.clickedElementInfo = { id: nodeId, type: 'node' }; this.dragStartMousePos = { x: event.clientX, y: event.clientY }; this.isCtrlDown = event.ctrlKey || event.metaKey; this.isShiftDown = event.shiftKey; this.isAltDown = event.altKey; if (this.mouseDownButton === 0 && !this.isAltDown) { if (this.isCtrlDown || this.isShiftDown) { this.handleGraphElementModifierClick(nodeId, 'node'); this.redrawCanvas(); this.updateNodeHandles(); } else { if (this.selectionLevel === 'element' && this.elementSelectionActiveForComponentId) { const elementCompId = this.getComponentIdForElement(nodeId, 'node'); if (elementCompId === this.elementSelectionActiveForComponentId) { if (!this.selectedNodes.has(nodeId)) { this.selectElement(nodeId, 'node', false); } } } else if (this.selectionLevel === 'component') { const compId = this.getComponentIdForElement(nodeId, 'node'); if (compId && !this.activeComponentData.has(compId)) { this.deselectAll(false); this.selectComponent(nodeId, 'node'); this.redrawCanvas(); this.updateNodeHandles(); } } } } }
        handleMouseDown(event) {
            const target = event.target; if (target.closest('#toolbar')) return;
            this.potentialTransformHandleClick = null; if (target === this.rotateHandleIconElem) this.potentialTransformHandleClick = 'rotate'; else if (target === this.scaleHandleIconElem) this.potentialTransformHandleClick = 'scale';
            this.mouseDownButton = event.button; const screenX = event.clientX; const screenY = event.clientY; const clickPoint = { x: screenX, y: screenY }; this.lastMousePos = clickPoint; this.dragStartMousePos = clickPoint;
            this.potentialGraphElementClick = false; this.clickedElementInfo = null; this.potentialNodeHandleClick = false; this.potentialRightClick = false; this.potentialDragTarget = null;
            this.isDraggingNodes = false; this.isDraggingItems = false; this.isSelecting = false; this.isRotating = false; this.isScaling = false;
            this.isAltDown = event.altKey; this.isCtrlDown = event.ctrlKey || event.metaKey; this.isShiftDown = event.shiftKey;
            this.snapTargetNode = null; this.currentRotationAngle = 0; this.currentScaleFactor = 1;
            const hitNode = (target === this.canvas) ? this.getNodeAtPoint(clickPoint) : null; const hitEdge = (target === this.canvas && !hitNode) ? this.getEdgeAtPoint(clickPoint) : null; const hitElementId = hitNode?.id || hitEdge?.id; const hitElementType = hitNode ? 'node' : (hitEdge ? 'edge' : null); const isAnySelectionActive = this.selectionLevel === 'component' && (this.activeComponentData.size > 0 || this.selectedTextBoxes.size > 0);
             if (this.mouseDownButton === 0 && this.potentialTransformHandleClick && isAnySelectionActive) { event.preventDefault(); event.stopPropagation(); if (this.isDrawing) this.finalizeCurrentDrawing(); if (!this.initialBBox || !this.scaleRotateCenter) { this.updateTransformHandles(); if (!this.initialBBox || !this.scaleRotateCenter || this.initialBBox.width <= 0 || this.initialBBox.height <= 0) { this.potentialTransformHandleClick = null; return; } } if(this.activeTextBox) this.deactivateTextBox(); this.dragStartStates = []; const currentAngle = this.selectionRotationAngle; const currentCenter = { ...this.scaleRotateCenter }; const currentBBox = { ...this.initialBBox }; this.activeComponentData.forEach(compData => { compData.componentNodes.forEach(nid => { const node = this.nodeRegistry.get(nid); if (node) this.dragStartStates.push({ type: 'node', id: nid, startX: node.x, startY: node.y, startGroupRotation: currentAngle, startCenter: currentCenter, startBBox: currentBBox }); }); }); this.selectedTextBoxes.forEach(box => { const boxId = box.dataset.id; const d = this.textBoxRegistry.get(boxId); if(d) { const fontSizePx = parseFloat(d.fontSize || '16px'); this.dragStartStates.push({ type: 'text', id: boxId, element: box, startX: d.x, startY: d.y, startRotation: d.rotation ?? 0, startFontSize: fontSizePx, startGroupRotation: currentAngle, startCenter: currentCenter, startBBox: currentBBox }); } }); if (this.potentialTransformHandleClick === 'rotate') {
                 const initialMouseAngleRad = Math.atan2(clickPoint.y - currentCenter.y, clickPoint.x - currentCenter.x);
                 this.startAngle = initialMouseAngleRad;
                 console.log(`[Rotate Start] Time: ${Date.now()}`);
                 console.log(`  Initial Selection Angle (deg): ${(currentAngle * 180 / Math.PI).toFixed(2)}`);
                 console.log(`  Initial Mouse Angle (deg): ${(initialMouseAngleRad * 180 / Math.PI).toFixed(2)}`);
                 console.log(`  Stored this.startAngle (rad): ${this.startAngle.toFixed(4)}`);
             } else { const vec = {x: clickPoint.x - currentCenter.x, y: clickPoint.y - currentCenter.y}; const dist = Math.sqrt(vec.x*vec.x + vec.y*vec.y); this.startDistanceInfo = { dist: dist, vec: vec }; } this.updateCursorBasedOnContext(); return; }
             this.potentialTransformHandleClick = null;
              if (this.mouseDownButton === 0 && !this.isShiftDown && !this.isCtrlDown && !target.classList.contains('textBox') && !hitNode && !hitEdge && target !== this.rotateHandleIconElem && target !== this.scaleHandleIconElem) { if (this.initialBBox || this.selectionRotationAngle !== 0) { this.resetPersistentTransformState(); if (isAnySelectionActive) { this.deselectAll(); } else { this.redrawCanvas(); this.updateTransformHandles(); } } else if (isAnySelectionActive) { this.deselectAll(); } }
             if (this.mouseDownButton === 2) { if (this.isDrawing) this.finalizeCurrentDrawing(); if (this.isAltDrawing) { this.isAltDrawing = false; this.altDrawingSourceNodeId = null; this.redrawCanvas(); this.updateNodeHandles(); this.updateTransformHandles(); } event.preventDefault(); this.isSelecting = true; this.potentialRightClick = true; this.selectionStartPos = clickPoint; this.selectionRectElem.style.left = `${screenX}px`; this.selectionRectElem.style.top = `${screenY}px`; this.selectionRectElem.style.width = '0px'; this.selectionRectElem.style.height = '0px'; this.selectionRectElem.style.display = 'none'; if (!this.isCtrlDown && !this.isShiftDown) { this.deselectAll(); } this.deactivateTextBox(); this.updateCursorBasedOnContext(); return; }
             if (this.mouseDownButton === 0) { this.isSelecting = false; if (this.isAltDown) { if (this.isDrawing) this.finalizeCurrentDrawing(); this.potentialGraphElementClick = false; this.potentialNodeHandleClick = false; const historyData = { type: null, createdNode: null, createdEdges: [] }; const targetNode = hitNode || this.getNodeAtPoint(clickPoint, this.NODE_HIT_THRESHOLD); if (this.isAltDrawing && this.altDrawingSourceNodeId) { const sourceNodeId = this.altDrawingSourceNodeId; let targetId = null; if (targetNode && targetNode.id !== sourceNodeId) { targetId = targetNode.id; } else if (!targetNode) { const newNodeId = this.generateId(); const newNode = this.createNode(newNodeId, clickPoint.x, clickPoint.y); if(newNode){ targetId = newNodeId; historyData.createdNode = {...newNode}; } else { return; } } if (targetId && !this.edgeExists(sourceNodeId, targetId)) { const edgeId = this.generateId(); const edge = this.createEdge(edgeId, sourceNodeId, targetId, this.currentColor, this.currentLineWidth); if (edge) { historyData.createdEdges.push({...edge}); historyData.type = 'create_graph_elements'; }} this.altDrawingSourceNodeId = targetId; if (!targetId) { this.isAltDrawing = false; } } else { const sourcePoints = new Set(this.altPreviewSourceNodeIds); let targetId = null; if (targetNode) { targetId = targetNode.id; this.altPreviewSourceNodeIds.clear(); } else { const newNodeId = this.generateId(); const newNode = this.createNode(newNodeId, clickPoint.x, clickPoint.y); if(newNode){ targetId = newNodeId; historyData.createdNode = {...newNode}; } else { return; } } if (targetId && sourcePoints.size > 0) { historyData.type = 'create_graph_elements'; sourcePoints.forEach(sourceId => { if (sourceId !== targetId && !this.edgeExists(sourceId, targetId)) { const edgeId = this.generateId(); const edge = this.createEdge(edgeId, sourceId, targetId, this.currentColor, this.currentLineWidth); if (edge) historyData.createdEdges.push({...edge}); }}); this.altPreviewSourceNodeIds.clear(); } else if (targetId && historyData.createdNode) { historyData.type = 'create_graph_elements'; this.altPreviewSourceNodeIds.clear(); } if(targetId) { this.isAltDrawing = true; this.altDrawingSourceNodeId = targetId; } else { this.isAltDrawing = false; this.altDrawingSourceNodeId = null; } } if (historyData.type) { this.addHistory({ type: historyData.type, nodes: historyData.createdNode ? [historyData.createdNode] : [], edges: historyData.createdEdges }); } this.redrawCanvas(); this.updateNodeHandles(); this.updateTransformHandles(); event.preventDefault(); return; }
                 else { if (this.isAltDrawing) { this.isAltDrawing = false; this.altDrawingSourceNodeId = null; } if (target.classList.contains('textBox')) { if (this.isDrawing) this.finalizeCurrentDrawing(); event.stopPropagation(); const targetBox = target; const boxId = targetBox.dataset.id; if (!this.textBoxRegistry.has(boxId)) return; if (this.activeTextBox && this.activeTextBox !== targetBox) { this.deactivateTextBox(this.activeTextBox); } this.clickedElementInfo = { id: boxId, type: 'text' }; this.potentialGraphElementClick = false; this.potentialNodeHandleClick = false; this.potentialDragTarget = { type: 'text', id: boxId }; if (this.isCtrlDown) { this.toggleSelectTextBox(targetBox); } else if (this.isShiftDown) { this.selectTextBox(targetBox, true); } else { if (!this.selectedTextBoxes.has(targetBox) || this.selectedTextBoxes.size > 1 || this.activeComponentData.size > 0) { this.deselectAll(false); this.selectTextBox(targetBox); } } if(this.selectionLevel === 'element') { this.deselectAllGraphElements(); this.selectionLevel = 'component'; this.elementSelectionActiveForComponentId = null; } this.redrawCanvas(); this.updateNodeHandles(); this.updateTransformHandles(); }
                     else if (target === this.canvas) { if (this.activeTextBox) this.deactivateTextBox(); if (hitElementId) { if (this.isDrawing) this.finalizeCurrentDrawing(); this.potentialGraphElementClick = true; if(!this.clickedElementInfo) this.clickedElementInfo = { id: hitElementId, type: hitElementType }; this.potentialNodeHandleClick = false; this.potentialDragTarget = { type: 'graph', representativeId: hitElementId, elementType: hitElementType }; if (this.isCtrlDown || this.isShiftDown) { this.handleGraphElementModifierClick(hitElementId, hitElementType); } else { if (this.selectionLevel === 'element' && this.elementSelectionActiveForComponentId) { const elementCompId = this.getComponentIdForElement(hitElementId, hitElementType); if (elementCompId === this.elementSelectionActiveForComponentId) { const isAlreadySelected = (hitElementType === 'node' && this.selectedNodes.has(hitElementId)) || (hitElementType === 'edge' && this.selectedEdges.has(hitElementId)); if (!isAlreadySelected || this.selectedNodes.size + this.selectedEdges.size > 1) { this.selectElement(hitElementId, hitElementType, false); } } else { this.deselectAll(false); this.selectComponent(hitElementId, hitElementType); } } else if (this.selectionLevel === 'component') { const compId = this.getComponentIdForElement(hitElementId, hitElementType); const currentCompData = this.activeComponentData; if (compId && (!currentCompData.has(compId) || currentCompData.size > 1 || this.selectedTextBoxes.size > 0)) { this.deselectAll(false); this.selectComponent(hitElementId, hitElementType); } else if (!compId && isAnySelectionActive) { this.deselectAll(); } } } this.redrawCanvas(); this.updateNodeHandles(); this.updateTransformHandles(); }
                         else { if (this.isDrawing) this.finalizeCurrentDrawing(); this.setDrawingState(true, 'freehand'); const startNodeId = this.generateId(); const startNode = this.createNode(startNodeId, clickPoint.x, clickPoint.y); if (startNode) { this.currentDrawingStartNodeId = startNodeId; this.currentDrawingLastNodeId = startNodeId; this.currentTempNodes = [{...startNode}]; this.currentTempEdges = []; } else { this.setDrawingState(false, 'freehand'); } this.potentialDragTarget = null; this.potentialGraphElementClick = false; this.potentialNodeHandleClick = false; event.preventDefault(); } }
                     else { if (this.isDrawing) this.finalizeCurrentDrawing(); this.potentialGraphElementClick = false; this.potentialDragTarget = null; if (!target.closest('.textBox') && !target.closest('#toolbar') && !target.classList.contains('transform-handle') && !target.classList.contains('node-handle')) { if (this.activeTextBox) this.deactivateTextBox(); } } } }
            this.updateCursorBasedOnContext();
        }
        handleMouseMove(event) {
            const screenX = event.clientX; const screenY = event.clientY; const currentPoint = { x: screenX, y: screenY }; this.lastMousePos = currentPoint; let needsCanvasRedraw = false; let needsHandleUpdate = false; let previewNeedsRedraw = false;

            // --- Mouse hover / text exit ---
            if (this.activeTextBox && !this.isDraggingItems && !this.isRotating && !this.isScaling && this.mouseDownButton === -1) {
                const rect = this.activeTextBox.getBoundingClientRect(); const mouseX = currentPoint.x; const mouseY = currentPoint.y; const buffer = 2;
                if (mouseX < rect.left - buffer || mouseX > rect.right + buffer || mouseY < rect.top - buffer || mouseY > rect.bottom + buffer) { if (this.textBoxRegistry.has(this.activeTextBox.dataset.id)) { const elementToDeactivate = this.activeTextBox; this.deactivateTextBox(elementToDeactivate); needsCanvasRedraw = true; needsHandleUpdate = true; } }
            }
            let oldMouseOverNodeId = this.mouseOverNodeId; let oldMouseOverEdgeId = this.mouseOverEdgeId; let oldMouseOverBox = this.mouseOverBox;
            if (!this.isDrawing && !this.isAltDrawing && !this.isDraggingNodes && !this.isDraggingItems && !this.isSelecting && !this.isRotating && !this.isScaling && this.mouseDownButton === -1) {
                this.mouseOverNodeId = null; this.mouseOverEdgeId = null; this.mouseOverBox = null;
                const targetElement = document.elementFromPoint(screenX, screenY); const isHoveringHandle = targetElement === this.rotateHandleIconElem || targetElement === this.scaleHandleIconElem;
                if (!isHoveringHandle) {
                    if (targetElement?.classList.contains('textBox') && targetElement !== this.activeTextBox) { this.mouseOverBox = targetElement; }
                    else if (targetElement === this.canvas) { const node = this.getNodeAtPoint(currentPoint); const edge = node ? null : this.getEdgeAtPoint(currentPoint); if (this.selectionLevel === 'element' && this.elementSelectionActiveForComponentId) { const compId = this.elementSelectionActiveForComponentId; if (node && this.getComponentIdForElement(node.id, 'node') === compId) this.mouseOverNodeId = node.id; if (edge && this.getComponentIdForElement(edge.id, 'edge') === compId) this.mouseOverEdgeId = edge.id; } else if (this.selectionLevel === 'component'){ this.mouseOverNodeId = node ? node.id : null; this.mouseOverEdgeId = edge ? edge.id : null; } }
                }
                if (this.mouseOverNodeId !== oldMouseOverNodeId || this.mouseOverEdgeId !== oldMouseOverEdgeId || this.mouseOverBox !== oldMouseOverBox) { needsCanvasRedraw = true; }
            }
            this.updateCursorBasedOnContext();
            let previousSnapTarget = this.snapTargetNode; this.snapTargetNode = null;
            if (this.isAltDown && !this.isDrawing && !this.isDraggingNodes && !this.isDraggingItems && !this.isRotating && !this.isScaling && this.mouseDownButton === -1 && (this.isAltDrawing || this.altPreviewSourceNodeIds.size > 0)) { const potentialSnap = this.getNodeAtPoint(currentPoint, this.NODE_HIT_THRESHOLD * 1.5); if (potentialSnap && (!this.isAltDrawing || potentialSnap.id !== this.altDrawingSourceNodeId)) { this.snapTargetNode = potentialSnap; } previewNeedsRedraw = true; if (this.snapTargetNode !== previousSnapTarget) { needsHandleUpdate = true; } }
            else { if (this.snapIndicatorElem.style.display !== 'none') { needsHandleUpdate = true; } if (!this.isAltDown && (this.isAltDrawing || this.altPreviewSourceNodeIds.size > 0) && this.mouseDownButton === -1){ previewNeedsRedraw = true; } }
            // --- End Mouse hover ---

            // --- Drag initiation ---
             if (this.isSelecting && this.mouseDownButton === 2) { event.preventDefault(); const movedBeyondThreshold = Math.abs(screenX - this.dragStartMousePos.x) > this.DRAG_THRESHOLD || Math.abs(screenY - this.dragStartMousePos.y) > this.DRAG_THRESHOLD; if (this.potentialRightClick && movedBeyondThreshold) { this.potentialRightClick = false; this.selectionRectElem.style.display = 'block'; document.body.style.cursor = 'default'; } if (!this.potentialRightClick) { const rectX = Math.min(this.selectionStartPos.x, screenX); const rectY = Math.min(this.selectionStartPos.y, screenY); const rectW = Math.abs(screenX - this.selectionStartPos.x); const rectH = Math.abs(screenY - this.selectionStartPos.y); this.selectionRectElem.style.left = `${rectX}px`; this.selectionRectElem.style.top = `${rectY}px`; this.selectionRectElem.style.width = `${rectW}px`; this.selectionRectElem.style.height = `${rectH}px`; } needsCanvasRedraw = false; needsHandleUpdate = false; previewNeedsRedraw = false; }
             else if (this.mouseDownButton === 0) {
                 const movedEnough = Math.abs(screenX - this.dragStartMousePos.x) > this.DRAG_THRESHOLD || Math.abs(screenY - this.dragStartMousePos.y) > this.DRAG_THRESHOLD;
                 let dragJustStarted = false;
                 if (!this.isDrawing && !this.isAltDrawing && !this.isDraggingNodes && !this.isDraggingItems && !this.isRotating && !this.isScaling && movedEnough) { if (this.potentialTransformHandleClick || this.potentialNodeHandleClick || this.potentialGraphElementClick || this.potentialDragTarget?.type === 'text') { if (this.activeTextBox) { this.deactivateTextBox(); } } if (this.potentialTransformHandleClick) { if (this.potentialTransformHandleClick === 'rotate') { this.isRotating = true; dragJustStarted = true; this.body.style.cursor = 'grabbing'; } else if (this.potentialTransformHandleClick === 'scale') { this.isScaling = true; dragJustStarted = true; this.body.style.cursor = 'grabbing'; } this.potentialTransformHandleClick = null; this.potentialGraphElementClick = false; this.potentialNodeHandleClick = false; this.potentialDragTarget = null; } else if (this.potentialNodeHandleClick || this.potentialGraphElementClick) { let canDrag = false; if (this.clickedElementInfo) { if (this.selectionLevel === 'element' && this.elementSelectionActiveForComponentId) { const compId = this.getComponentIdForElement(this.clickedElementInfo.id, this.clickedElementInfo.type); if (compId === this.elementSelectionActiveForComponentId) { const isClickedSelected = (this.clickedElementInfo.type === 'node' && this.selectedNodes.has(this.clickedElementInfo.id)) || (this.clickedElementInfo.type === 'edge' && this.selectedEdges.has(this.clickedElementInfo.id)); if (isClickedSelected) { canDrag = true; } } } else if (this.selectionLevel === 'component') { const compId = this.getComponentIdForElement(this.clickedElementInfo.id, this.clickedElementInfo.type); if (compId && this.activeComponentData.has(compId)) { canDrag = true; } } } if (canDrag) { this.prepareNodeDrag(); if (this.dragStartStates.length > 0) { this.isDraggingNodes = true; dragJustStarted = true; this.body.style.cursor = 'grabbing'; } } this.potentialNodeHandleClick = false; this.potentialGraphElementClick = false; this.potentialDragTarget = null; } else if (this.potentialDragTarget?.type === 'text') { const box = this.textBoxRegistry.get(this.potentialDragTarget.id)?.element; if(box && this.selectedTextBoxes.has(box)){ this.isDraggingItems = true; dragJustStarted = true; this.body.style.cursor = 'move'; this.body.style.userSelect = 'none'; this.body.style.webkitUserSelect = 'none'; const startingPersistentCenter = this.scaleRotateCenter && this.initialBBox ? { ...this.scaleRotateCenter } : null; const startingPersistentBBox = this.initialBBox ? { ...this.initialBBox } : null; const startingPersistentAngle = this.selectionRotationAngle; this.dragStartStates = []; this.selectedTextBoxes.forEach(b => { const boxId = b.dataset.id; const d = this.textBoxRegistry.get(boxId); if(d) { const fontSizePx = parseFloat(d.fontSize || '16px'); this.dragStartStates.push({ type: 'text', id: boxId, element: b, startX: d.x, startY: d.y, startRotation: d.rotation ?? 0, startFontSize: fontSizePx, startGroupRotation: startingPersistentAngle, startCenter: startingPersistentCenter, startBBox: startingPersistentBBox }); } }); } this.potentialGraphElementClick = false; this.potentialNodeHandleClick = false; this.potentialDragTarget = null; } else { this.potentialNodeHandleClick = false; this.potentialGraphElementClick = false; this.potentialDragTarget = null; this.potentialTransformHandleClick = false; } if(dragJustStarted){ needsCanvasRedraw = true; needsHandleUpdate = true; } }
            // --- End Drag initiation ---

                 const dx = screenX - this.dragStartMousePos.x;
                 const dy = screenY - this.dragStartMousePos.y;

                 // --- Rotation Logic ---
                 if (this.isRotating) {
                     event.preventDefault();
                     if (!this.dragStartStates.length || !this.dragStartStates[0].startCenter) return;

                     const rotationCenter = this.dragStartStates[0].startCenter;
                     const currentMouseAngle = Math.atan2(currentPoint.y - rotationCenter.y, currentPoint.x - rotationCenter.x);
                     let deltaAngle = currentMouseAngle - this.startAngle;

                     if (deltaAngle > Math.PI) deltaAngle -= 2 * Math.PI;
                     else if (deltaAngle <= -Math.PI) deltaAngle += 2 * Math.PI;

                     this.currentRotationAngle = deltaAngle; // Store delta for history/mouseup

                     const startGroupRotation = this.dragStartStates[0].startGroupRotation ?? 0;
                     this.currentDragTargetAngle = startGroupRotation + deltaAngle; // Store target for visuals

                     this.dragStartStates.forEach(itemState => {
                         const startX = itemState.startX;
                         const startY = itemState.startY;
                         const startRelX = startX - rotationCenter.x;
                         const startRelY = startY - rotationCenter.y;

                         const cosDelta = Math.cos(deltaAngle);
                         const sinDelta = Math.sin(deltaAngle);
                         const rotatedRelX = startRelX * cosDelta - startRelY * sinDelta;
                         const rotatedRelY = startRelX * sinDelta + startRelY * cosDelta;

                         const newX = rotationCenter.x + rotatedRelX;
                         const newY = rotationCenter.y + rotatedRelY;

                         if (itemState.type === 'node') {
                             const node = this.nodeRegistry.get(itemState.id);
                             if (node) {
                                 node.x = newX; // Update registry data
                                 node.y = newY;
                             }
                         } else if (itemState.type === 'text') {
                             const textData = this.textBoxRegistry.get(itemState.id);
                             if (textData?.element) {
                                 textData.x = newX;
                                 textData.y = newY;
                                 const textStartRotation = itemState.startRotation ?? 0;
                                 const newAbsRotation = textStartRotation + deltaAngle;
                                 textData.element.style.left = `${newX}px`;
                                 textData.element.style.top = `${newY}px`;
                                 textData.element.style.transform = `rotate(${newAbsRotation}rad)`;
                             }
                         }
                     });
                     needsCanvasRedraw = true; needsHandleUpdate = true;
                 }
                 // --- End Rotation Logic ---

                 // --- Scaling Logic ---
                 else if (this.isScaling) {
                     event.preventDefault();
                     if (!this.dragStartStates.length || !this.dragStartStates[0].startCenter || !this.startDistanceInfo) return;
                     const rotationCenter = this.dragStartStates[0].startCenter;
                     const currentVec = {x: currentPoint.x - rotationCenter.x, y: currentPoint.y - rotationCenter.y};
                     const currentDist = Math.sqrt(currentVec.x*currentVec.x + currentVec.y*currentVec.y);
                     let scaleFactor = this.startDistanceInfo.dist > 1e-6 ? currentDist / this.startDistanceInfo.dist : 1;
                     const dotProduct = this.startDistanceInfo.vec.x * currentVec.x + this.startDistanceInfo.vec.y * currentVec.y;
                     if (dotProduct < 0 && this.startDistanceInfo.dist > 1e-6) { scaleFactor = -scaleFactor; }
                     const absScale = Math.abs(scaleFactor);
                     if(absScale < this.MIN_SCALE) { scaleFactor = this.MIN_SCALE * Math.sign(scaleFactor || 1); }
                     this.currentScaleFactor = scaleFactor;

                     this.dragStartStates.forEach(itemState => {
                         const startX = itemState.startX; const startY = itemState.startY;
                         const startRelX = startX - rotationCenter.x; const startRelY = startY - rotationCenter.y;
                         const scaledRelX = startRelX * this.currentScaleFactor; const scaledRelY = startRelY * this.currentScaleFactor;
                         const newX = rotationCenter.x + scaledRelX; const newY = rotationCenter.y + scaledRelY;

                         if (itemState.type === 'node') {
                             const node = this.nodeRegistry.get(itemState.id); if (node) { node.x = newX; node.y = newY; }
                         } else if (itemState.type === 'text') {
                             const textData = this.textBoxRegistry.get(itemState.id); if (textData?.element) {
                                 textData.x = newX;
                                 textData.y = newY;
                                 textData.element.style.left = `${newX}px`;
                                 textData.element.style.top = `${newY}px`;
                                 const startFontSize = itemState.startFontSize || 16;
                                 let newFontSize = Math.round(startFontSize * Math.abs(this.currentScaleFactor));
                                 newFontSize = Math.max(this.MIN_FONT_SIZE, Math.min(this.MAX_FONT_SIZE, newFontSize));
                                 textData.element.style.fontSize = `${newFontSize}px`;
                                 const startRotation = itemState.startRotation ?? 0;
                                 textData.element.style.transform = `rotate(${startRotation}rad)`;
                             }
                         }
                     });
                     needsCanvasRedraw = true; needsHandleUpdate = true;
                 }
                 // --- End Scaling Logic ---

                 // --- Dragging Nodes / Items Logic ---
                 else if (this.isDraggingNodes) {
                      event.preventDefault();
                      this.dragStartStates.forEach(itemState => { if (itemState.type === 'node') { const node = this.nodeRegistry.get(itemState.id); if (node) { node.x = itemState.startX + dx; node.y = itemState.startY + dy; } } });
                      needsCanvasRedraw = true; needsHandleUpdate = true;
                 }
                 else if (this.isDraggingItems) {
                      event.preventDefault();
                      this.dragStartStates.forEach(itemState => {
                           if (itemState.type === 'text') {
                               const newX = itemState.startX + dx;
                               const newY = itemState.startY + dy;
                               const textData = this.textBoxRegistry.get(itemState.id);
                               if (textData) { textData.x = newX; textData.y = newY;}
                               itemState.element.style.left = `${newX}px`;
                               itemState.element.style.top = `${newY}px`;
                               const startRotation = itemState.startRotation ?? 0;
                               itemState.element.style.transform = `rotate(${startRotation}rad)`;
                           }
                      });
                      needsCanvasRedraw = true; needsHandleUpdate = true;
                 }
                 // --- End Dragging ---

                 // --- Freehand Drawing Logic ---
                 else if (this.isDrawing && this.drawingMode === 'freehand') { event.preventDefault(); const lastNode = this.nodeRegistry.get(this.currentDrawingLastNodeId); if (lastNode && this.sqrDist(currentPoint, lastNode) > (this.DRAG_THRESHOLD * this.DRAG_THRESHOLD * 0.5)) { const newNodeId = this.generateId(); const newNode = this.createNode(newNodeId, currentPoint.x, currentPoint.y); const edgeId = this.generateId(); const edge = this.createEdge(edgeId, this.currentDrawingLastNodeId, newNodeId, this.currentColor, this.currentLineWidth); if (newNode && edge) { this.currentTempNodes.push({ ...newNode }); this.currentTempEdges.push({ ...edge }); this.currentDrawingLastNodeId = newNodeId; needsCanvasRedraw = true; } else if(newNode && !edge) { console.warn("Edge creation failed during freehand draw."); this.currentDrawingLastNodeId = newNodeId; needsCanvasRedraw = true; } } }
                 // --- End Freehand ---

                 // --- Dragged BBox Update ---
                 if (this.isDraggingNodes || this.isDraggingItems) { const startState = this.dragStartStates[0]; if (startState?.startCenter && startState?.startBBox && this.scaleRotateCenter && this.initialBBox) { const initialDragCenter = startState.startCenter; this.scaleRotateCenter.x = initialDragCenter.x + dx; this.scaleRotateCenter.y = initialDragCenter.y + dy; this.initialBBox.centerX = this.scaleRotateCenter.x; this.initialBBox.centerY = this.scaleRotateCenter.y; this.initialBBox.minX = this.scaleRotateCenter.x - this.initialBBox.width / 2; this.initialBBox.maxX = this.scaleRotateCenter.x + this.initialBBox.width / 2; this.initialBBox.minY = this.scaleRotateCenter.y - this.initialBBox.height / 2; this.initialBBox.maxY = this.scaleRotateCenter.y + this.initialBBox.height / 2; } }
                 // --- End BBox Update ---
            }
            if (previewNeedsRedraw || needsCanvasRedraw) { this.redrawCanvas(); }
            if (needsHandleUpdate) { this.updateNodeHandles(); this.updateTransformHandles(); }
        }
        handleMouseUp(event) {
            const releasedButton = event.button; const screenX = event.clientX; const screenY = event.clientY; const dragOccurred = Math.abs(screenX - this.dragStartMousePos.x) > this.DRAG_THRESHOLD || Math.abs(screenY - this.dragStartMousePos.y) > this.DRAG_THRESHOLD; const wasDrawingFreehand = this.isDrawing && this.drawingMode === 'freehand'; const wasDraggingNodes = this.isDraggingNodes; const wasDraggingItems = this.isDraggingItems; const wasRotating = this.isRotating; const wasScaling = this.isScaling; const wasSelecting = this.isSelecting; const clickTargetInfo = this.clickedElementInfo;
            const finalDeltaAngle = this.currentRotationAngle;
            const finalScaleFactor = this.currentScaleFactor;
            let startPersistentStateForHistory = null; if ((wasRotating || wasScaling) && this.dragStartStates.length > 0 && this.dragStartStates[0].startCenter && this.dragStartStates[0].startBBox) { startPersistentStateForHistory = { angle: this.dragStartStates[0].startGroupRotation ?? 0, center: { ...this.dragStartStates[0].startCenter }, box: { ...this.dragStartStates[0].startBBox } }; } else { startPersistentStateForHistory = { angle: this.selectionRotationAngle, center: this.scaleRotateCenter ? { ...this.scaleRotateCenter } : { x: 0, y: 0 }, box: this.initialBBox ? { ...this.initialBBox } : null }; }
            this.potentialNodeHandleClick = false; this.potentialGraphElementClick = false; this.potentialTransformHandleClick = null;
            if (releasedButton === 2 && wasSelecting) { event.preventDefault(); const wasSelectingRect = !this.potentialRightClick; let rectBounds = null; if (wasSelectingRect && this.selectionRectElem.style.display !== 'none') { rectBounds = this.selectionRectElem.getBoundingClientRect(); } this.selectionRectElem.style.display = 'none'; this.isSelecting = false; this.potentialRightClick = false; if (wasSelectingRect && rectBounds && rectBounds.width > 0 && rectBounds.height > 0) { let newlySelectedTextBoxesInRect = new Set(); let newlySelectedComponentsInRect = new Map(); this.textBoxRegistry.forEach(boxData => { const el = boxData.element; if (!el || !el.offsetParent) return; const b = el.getBoundingClientRect(); const intersects = b.left < rectBounds.right && b.right > rectBounds.left && b.top < rectBounds.bottom && b.bottom > rectBounds.top; if (intersects) { newlySelectedTextBoxesInRect.add(el); } }); this.selectionLevel = 'component'; this.elementSelectionActiveForComponentId = null; this.selectedNodes.clear(); this.selectedEdges.clear(); const processedNodesRect = new Set(); this.nodeRegistry.forEach(node => { const nodeInBounds = node.x >= rectBounds.left && node.x <= rectBounds.right && node.y >= rectBounds.top && node.y <= rectBounds.bottom; if (nodeInBounds && !processedNodesRect.has(node.id)) { const { componentNodes, componentEdges, representativeId } = this.findConnectedComponent(node.id, 'node'); if (representativeId && (componentNodes.size > 0 || componentEdges.size > 0)) { if (!newlySelectedComponentsInRect.has(representativeId)) { newlySelectedComponentsInRect.set(representativeId, { componentNodes, componentEdges }); } componentNodes.forEach(nid => processedNodesRect.add(nid)); } } }); const previouslySelectedTextBoxes = new Set(this.selectedTextBoxes); const previouslyActiveComponentData = new Map(this.activeComponentData); let finalSelectedTextBoxes = new Set(previouslySelectedTextBoxes); let finalActiveComponentData = new Map(previouslyActiveComponentData); if (this.isCtrlDown) { newlySelectedTextBoxesInRect.forEach(box => { if (previouslySelectedTextBoxes.has(box)) finalSelectedTextBoxes.delete(box); else finalSelectedTextBoxes.add(box); }); newlySelectedComponentsInRect.forEach((compData, compId) => { if (previouslyActiveComponentData.has(compId)) finalActiveComponentData.delete(compId); else finalActiveComponentData.set(compId, compData); }); } else if (this.isShiftDown) { newlySelectedTextBoxesInRect.forEach(box => finalSelectedTextBoxes.add(box)); newlySelectedComponentsInRect.forEach((compData, compId) => finalActiveComponentData.set(compId, compData)); } else { finalSelectedTextBoxes = newlySelectedTextBoxesInRect; finalActiveComponentData = newlySelectedComponentsInRect; } this.selectedTextBoxes = finalSelectedTextBoxes; this.activeComponentData = finalActiveComponentData; this.resetPersistentTransformState(); this.redrawCanvas(); this.updateNodeHandles(); this.updateTransformHandles(); } }
            else if (releasedButton === 0) { if (wasDrawingFreehand) { this.finalizeCurrentDrawing(); } else if ((wasRotating || wasScaling) && startPersistentStateForHistory?.center && startPersistentStateForHistory?.box) { const transformType = wasRotating ? 'rotate' : 'scale'; const transformHistory = { type: 'transform_items', transformType: transformType, center: { ...startPersistentStateForHistory.center }, items: [], startAngle: startPersistentStateForHistory.angle, startCenter: startPersistentStateForHistory.center, startBBox: startPersistentStateForHistory.box }; let transformApplied = false;
                const rotationCenter = startPersistentStateForHistory.center;

                this.dragStartStates.forEach(itemState => {
                    let endX, endY, startRotation, endRotation, startFontSize, endFontSize;
                    const startX = itemState.startX; const startY = itemState.startY;
                    const startRelX = startX - rotationCenter.x; const startRelY = startY - rotationCenter.y;
                    startFontSize = itemState.startFontSize; endFontSize = itemState.startFontSize;
                    startRotation = itemState.type === 'text' ? (itemState.startRotation ?? 0) : (itemState.startGroupRotation ?? 0);

                    if (wasRotating) {
                        const cosDelta = Math.cos(finalDeltaAngle); const sinDelta = Math.sin(finalDeltaAngle);
                        const rotatedRelX = startRelX * cosDelta - startRelY * sinDelta; const rotatedRelY = startRelX * sinDelta + startRelY * cosDelta;
                        endX = rotationCenter.x + rotatedRelX; endY = rotationCenter.y + rotatedRelY;
                        endRotation = startRotation + finalDeltaAngle;
                    } else { // wasScaling
                        const scaledRelX = startRelX * finalScaleFactor; const scaledRelY = startRelY * finalScaleFactor;
                        endX = rotationCenter.x + scaledRelX; endY = rotationCenter.y + scaledRelY;
                        endRotation = startRotation;
                        endFontSize = Math.round(startFontSize * Math.abs(finalScaleFactor));
                        endFontSize = Math.max(this.MIN_FONT_SIZE, Math.min(this.MAX_FONT_SIZE, endFontSize));
                    }

                    let moved = false;
                    if(itemState.type === 'node') {
                        moved = Math.abs(endX - startX) > 0.1 || Math.abs(endY - startY) > 0.1;
                    } else if (itemState.type === 'text') {
                        moved = Math.abs(endX - startX) > 0.1 || Math.abs(endY - startY) > 0.1 || Math.abs(endRotation - startRotation) > 0.01 || Math.abs(endFontSize - startFontSize) > 0.1;
                    }

                    if (moved) { transformHistory.items.push({ id: itemState.id, type: itemState.type, startX: startX, startY: startY, endX: endX, endY: endY, startRotation: startRotation, endRotation: endRotation, startFontSize: startFontSize, endFontSize: endFontSize }); transformApplied = true; }
                });

                if (transformApplied) {
                    this.applyTransform(transformHistory.items, false);
                    this.addHistory(transformHistory);
                }

                const startGroupRotation_mu = startPersistentStateForHistory.angle;
                const finalDeltaAngle_mu = finalDeltaAngle;
                const newPersistentAngle = startGroupRotation_mu + (wasRotating ? finalDeltaAngle_mu : 0);
                const finalAbsScaleFactor = wasScaling ? Math.abs(finalScaleFactor) : 1;
                const newPersistentWidth = startPersistentStateForHistory.box.width * finalAbsScaleFactor;
                const newPersistentHeight = startPersistentStateForHistory.box.height * finalAbsScaleFactor;

                this.selectionRotationAngle = newPersistentAngle;
                this.scaleRotateCenter = startPersistentStateForHistory.center;
                this.initialBBox = { centerX: this.scaleRotateCenter.x, centerY: this.scaleRotateCenter.y, width: newPersistentWidth, height: newPersistentHeight, minX: this.scaleRotateCenter.x - newPersistentWidth / 2, maxX: this.scaleRotateCenter.x + newPersistentWidth / 2, minY: this.scaleRotateCenter.y - newPersistentHeight / 2, maxY: this.scaleRotateCenter.y + newPersistentHeight / 2 };

                if (wasRotating) {
                    console.log(`[Rotate End] Time: ${Date.now()}`);
                    console.log(`  Start Group Angle (deg): ${(startGroupRotation_mu * 180 / Math.PI).toFixed(2)}`);
                    console.log(`  Final Delta Angle (deg): ${(finalDeltaAngle_mu * 180 / Math.PI).toFixed(2)}`);
                    console.log(`  New Persistent Angle (deg): ${(newPersistentAngle * 180 / Math.PI).toFixed(2)}`);
                    console.log(`  Set this.selectionRotationAngle (rad): ${this.selectionRotationAngle.toFixed(4)}`);
                }

                this.isRotating = false; this.isScaling = false; }
            else if (wasDraggingNodes) { const dx = screenX - this.dragStartMousePos.x; const dy = screenY - this.dragStartMousePos.y; const moves = []; this.dragStartStates.forEach(itemState => { if (itemState.type === 'node') { const node = this.nodeRegistry.get(itemState.id); if (node) { const finalX = node.x; const finalY = node.y; if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) { moves.push({ id: itemState.id, startX: itemState.startX, startY: itemState.startY, endX: finalX, endY: finalY }); } } } }); if (moves.length > 0) { this.addHistory({ type: 'move_nodes', moves: moves }); }
                const startState = this.dragStartStates[0];
                if (startState?.startCenter && this.scaleRotateCenter && this.initialBBox) {
                    this.scaleRotateCenter.x = startState.startCenter.x + dx; this.scaleRotateCenter.y = startState.startCenter.y + dy;
                    this.initialBBox.centerX = this.scaleRotateCenter.x; this.initialBBox.centerY = this.scaleRotateCenter.y;
                    this.initialBBox.minX = this.scaleRotateCenter.x - this.initialBBox.width / 2; this.initialBBox.maxX = this.scaleRotateCenter.x + this.initialBBox.width / 2;
                    this.initialBBox.minY = this.scaleRotateCenter.y - this.initialBBox.height / 2; this.initialBBox.maxY = this.scaleRotateCenter.y + this.initialBBox.height / 2;
                } else { if (!startState?.startCenter) { this.resetPersistentTransformState(); } }
                this.isDraggingNodes = false; }
            else if (wasDraggingItems) { this.body.style.userSelect = 'auto'; this.body.style.webkitUserSelect = 'auto'; const dx = screenX - this.dragStartMousePos.x; const dy = screenY - this.dragStartMousePos.y; const moves = []; this.dragStartStates.forEach(itemState => { if (itemState.type === 'text') { const finalX = itemState.startX + dx; const finalY = itemState.startY + dy; const boxData = this.textBoxRegistry.get(itemState.id); if (boxData) { boxData.x = finalX; boxData.y = finalY; itemState.element.style.left = `${finalX}px`; itemState.element.style.top = `${finalY}px`; if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) { moves.push({ id: itemState.id, type: 'text', startX: itemState.startX, startY: itemState.startY, endX: finalX, endY: finalY, startRotation: itemState.startRotation, endRotation: itemState.startRotation, startFontSize: itemState.startFontSize, endFontSize: itemState.startFontSize }); } } } }); if (moves.length > 0) { this.addHistory({ type: 'move_text', moves: moves }); }
                const startState = this.dragStartStates[0];
                if (startState?.startCenter && this.scaleRotateCenter && this.initialBBox) {
                    this.scaleRotateCenter.x = startState.startCenter.x + dx; this.scaleRotateCenter.y = startState.startCenter.y + dy;
                    this.initialBBox.centerX = this.scaleRotateCenter.x; this.initialBBox.centerY = this.scaleRotateCenter.y;
                    this.initialBBox.minX = this.scaleRotateCenter.x - this.initialBBox.width / 2; this.initialBBox.maxX = this.scaleRotateCenter.x + this.initialBBox.width / 2;
                    this.initialBBox.minY = this.scaleRotateCenter.y - this.initialBBox.height / 2; this.initialBBox.maxY = this.scaleRotateCenter.y + this.initialBBox.height / 2;
                } else { if (!startState?.startCenter) { this.resetPersistentTransformState(); } }
                this.isDraggingItems = false; }
            else if (!dragOccurred && !wasDrawingFreehand && !this.isAltDown) {
                 // Handle simple click if necessary (e.g., activate text box on single click without drag)
                 if (clickTargetInfo && clickTargetInfo.type === 'text') {
                    const targetBox = this.textBoxRegistry.get(clickTargetInfo.id)?.element;
                    if (targetBox && this.selectedTextBoxes.has(targetBox) && this.selectedTextBoxes.size === 1 && this.activeComponentData.size === 0) {
                         // If it was a single click on an already solely selected text box, maybe activate it?
                         // Or maybe double-click is the only way to activate. Current logic requires dblclick.
                    }
                 }
            } }
            this.mouseDownButton = -1; this.isDraggingNodes = false; this.isDraggingItems = false; this.isRotating = false; this.isScaling = false; this.isSelecting = false; this.dragStartStates = []; this.snapTargetNode = null; this.potentialDragTarget = null; this.clickedElementInfo = null; this.potentialRightClick = false; this.currentRotationAngle = 0; this.currentScaleFactor = 1; if (this.isAltDrawing && !this.isAltDown) { this.isAltDrawing = false; this.altDrawingSourceNodeId = null; }
            this.updateCursorBasedOnContext(); this.redrawCanvas(); this.updateNodeHandles(); this.updateTransformHandles();
        }
        finalizeCurrentDrawing() {
            if (!this.isDrawing && !this.isAltDrawing) return;
            if (this.isDrawing && this.drawingMode === 'freehand') { const historyType = 'create_graph_elements'; const wasSimpleClick = this.currentTempNodes.length === 1 && this.currentTempEdges.length === 0; const startNode = this.currentTempNodes.length > 0 ? this.nodeRegistry.get(this.currentTempNodes[0]?.id) : null; const movedNegligibly = startNode && this.dragStartMousePos && this.sqrDist(this.dragStartMousePos, startNode) < (this.DRAG_THRESHOLD * this.DRAG_THRESHOLD); if ((wasSimpleClick || this.currentTempEdges.length === 0) && movedNegligibly) { const nodeIdToDelete = this.currentTempNodes[0]?.id; if (nodeIdToDelete && this.nodeRegistry.has(nodeIdToDelete)) { this._deleteNodeInternal(nodeIdToDelete); } } else if (this.currentTempNodes.length > 0 || this.currentTempEdges.length > 0) { this.addHistory({ type: historyType, nodes: JSON.parse(JSON.stringify(this.currentTempNodes)), edges: JSON.parse(JSON.stringify(this.currentTempEdges)) }); if(this.currentDrawingStartNodeId) { this.deselectAll(); this.selectComponent(this.currentDrawingStartNodeId, 'node'); } } this.setDrawingState(false, 'freehand'); this.currentDrawingStartNodeId = null; this.currentDrawingLastNodeId = null; this.currentTempNodes = []; this.currentTempEdges = []; }
            else if (this.isAltDrawing) { const lastNodeId = this.altDrawingSourceNodeId; this.isAltDrawing = false; this.altDrawingSourceNodeId = null; if (lastNodeId && this.nodeRegistry.has(lastNodeId)) { this.deselectAll(); this.selectComponent(lastNodeId, 'node'); } }
            this.snapTargetNode = null; this.redrawCanvas(); this.updateNodeHandles(); this.updateTransformHandles(); this.updateCursorBasedOnContext();
        }
        handleDoubleClick(event) {
             const target = event.target; if (target.closest('#toolbar') || target.classList.contains('transform-handle') || target.classList.contains('node-handle')) return; if (this.isDrawing || this.isAltDrawing || this.isSelecting || this.isRotating || this.isScaling || this.isDraggingItems || this.isDraggingNodes) return; const screenX = event.clientX; const screenY = event.clientY; const clickPoint = { x: screenX, y: screenY };

             if (target.classList.contains('textBox')) {
                 const box = target;
                 if (!this.textBoxRegistry.has(box.dataset.id)) return;
                 event.stopPropagation();
                 event.preventDefault();

                 this.deselectAllGraphElements();
                 this.selectedTextBoxes.forEach(selectedBox => {
                     if (selectedBox !== box) {
                         this.selectedTextBoxes.delete(selectedBox);
                     }
                 });
                 if (!this.selectedTextBoxes.has(box)) { // Ensure it's selected if clicking to edit
                    this.selectedTextBoxes.add(box);
                 }

                 this.resetPersistentTransformState();
                 this.setActiveTextBox(box);

                 return;
             }

             const hitNode = this.getNodeAtPoint(clickPoint); const hitEdge = hitNode ? null : this.getEdgeAtPoint(clickPoint); const hitElementId = hitNode?.id || hitEdge?.id; const hitElementType = hitNode ? 'node' : (hitEdge ? 'edge' : null);
             if (hitElementId) { event.stopPropagation(); event.preventDefault(); const componentId = this.getComponentIdForElement(hitElementId, hitElementType); if (!componentId) return; this.deselectAll(false); this.selectionLevel = 'element'; this.elementSelectionActiveForComponentId = componentId; const { componentNodes, componentEdges } = this.findConnectedComponent(hitElementId, hitElementType); if (componentNodes.size > 0 || componentEdges.size > 0) { this.activeComponentData.set(componentId, { componentNodes, componentEdges }); } this.selectElement(hitElementId, hitElementType, false); this.resetPersistentTransformState(); this.redrawCanvas(); this.updateNodeHandles(); this.updateTransformHandles(); return; }
             if (target === this.canvas && this.selectionLevel === 'element') { event.stopPropagation(); event.preventDefault(); this.deselectAll(); return; }
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
                 if (this.isRotating || this.isScaling) { this.applyTransform(this.dragStartStates, true); const startState = this.dragStartStates[0]; if (startState) { this.selectionRotationAngle = startState.startGroupRotation ?? 0; this.initialBBox = startState.startBBox ? { ...startState.startBBox } : null; this.scaleRotateCenter = startState.startCenter ? { ...startState.startCenter } : {x:0,y:0}; } else { this.resetPersistentTransformState(); } this.isRotating = false; this.isScaling = false; this.dragStartStates = []; this.currentRotationAngle = 0; this.currentScaleFactor = 1; this.redrawCanvas(); this.updateNodeHandles(); this.updateTransformHandles(); this.updateCursorBasedOnContext(); }
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
        handleFontSizeChange(event) { let newFontSizeVal = parseInt(event.target.value, 10); if (isNaN(newFontSizeVal)) return; newFontSizeVal = Math.max(this.MIN_FONT_SIZE, Math.min(this.MAX_FONT_SIZE, newFontSizeVal)); this.fontSizeInput.value = newFontSizeVal; const newFontSize = `${newFontSizeVal}px`; this.currentFontSize = newFontSize; const changes = []; this.selectedTextBoxes.forEach(box => { const id = box.dataset.id; if (!this.textBoxRegistry.has(id)) return; const d = this.textBoxRegistry.get(id); const oldFontSize = d.fontSize || '16px'; if (oldFontSize !== newFontSize) { d.fontSize = newFontSize; d.element.style.fontSize = newFontSize; changes.push({ id, oldFontSize, newFontSize }); } }); if (changes.length > 0) { this.addHistory({ type: 'change_fontsize', changes }); this.resetPersistentTransformState(); this.redrawCanvas(); this.updateTransformHandles(); } }

        setActiveTextBox(textBoxElement) {
              if (!textBoxElement || !this.textBoxRegistry.has(textBoxElement.dataset.id)) return;
              if (this.activeTextBox && this.activeTextBox !== textBoxElement) {
                  this.deactivateTextBox(this.activeTextBox);
              }
              this.activeTextBox = textBoxElement;
              this.activeTextBox.contentEditable = true;
              this.activeTextBox.classList.add('writing-mode');

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
                      if (data.text !== newText) {
                          // TODO: Add history entry for text change
                          data.text = newText;
                          this.resetPersistentTransformState(); // Reset bbox if text changes
                      }
                  }

                  textBoxElement.contentEditable = false;
                  textBoxElement.classList.remove('writing-mode');
                  this.activeTextBox = null;

                  this.redrawCanvas();
                  this.updateTransformHandles();
                  this.updateCursorBasedOnContext();
              }
           }

           applyTransform(itemStates, applyStart = false) {
              itemStates.forEach(itemState => {
                  const targetX = applyStart ? itemState.startX : itemState.endX;
                  const targetY = applyStart ? itemState.startY : itemState.endY;
                  const targetRotation = applyStart ? itemState.startRotation : itemState.endRotation;
                  const targetFontSize = applyStart ? itemState.startFontSize : itemState.endFontSize;

                  if (itemState.type === 'node') {
                      const node = this.nodeRegistry.get(itemState.id);
                      if (node) { node.x = targetX; node.y = targetY; }
                  } else if (itemState.type === 'text') {
                      const textData = this.textBoxRegistry.get(itemState.id);
                      if (textData?.element) {
                          textData.x = targetX; textData.y = targetY; textData.rotation = targetRotation; textData.fontSize = `${targetFontSize}px`;
                          textData.element.style.left = `${targetX}px`; textData.element.style.top = `${targetY}px`;
                          textData.element.style.fontSize = textData.fontSize;
                          textData.element.style.transform = `rotate(${targetRotation}rad)`;
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
                     case 'create_text': const currentText = this.textBoxRegistry.get(action.boxInfo.id)?.element?.textContent; redo = { type: 'create_text', boxInfo: { ...action.boxInfo, text: currentText ?? action.boxInfo.text } }; if(this.deleteTextBox(action.boxInfo.id)) {} break;
                     case 'create_graph_elements': const redoNodes_c = []; const redoEdges_c = []; action.edges?.slice().reverse().forEach(ei => { if(this.edgeRegistry.has(ei.id)) { const { edge:de } = this.deleteEdgeSmart(ei.id); if(de) redoEdges_c.unshift(de); } }); action.nodes?.slice().reverse().forEach(ni => { if (this.nodeRegistry.has(ni.id)) { const { node:dn, edges: de_c } = this.deleteNodeSmart(ni.id); if(dn) redoNodes_c.unshift(dn); de_c.forEach(e=>redoEdges_c.unshift(e)); } }); redo = { type: 'create_graph_elements', nodes: redoNodes_c.filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i), edges: redoEdges_c.filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i) }; this.deselectAll(); break;
                     case 'delete_selected': action.deletedInfo.nodes.forEach(n => { this.createNode(n.id, n.x, n.y); }); action.deletedInfo.edges.forEach(e => { this.createEdge(e.id, e.node1Id, e.node2Id, e.color, e.lineWidth); }); action.deletedInfo.texts.forEach(t => { this.createTextBoxElement(t.id, t.text, t.x, t.y, t.color, t.fontSize, t.rotation ?? 0); }); action.deletedInfo.createdEdges?.forEach(ce => { if (this.edgeRegistry.has(ce.id)) this.deleteEdgeSmart(ce.id); }); redo = { type: 'delete_selected', deletedInfo: { texts: action.deletedInfo.texts.map(t => ({...t})), nodes: action.deletedInfo.nodes.map(n => ({...n})), edges: action.deletedInfo.edges.map(e => ({...e})), createdEdges: action.deletedInfo.createdEdges?.map(ce => ({...ce})) || [] }}; this.deselectAll(); break;
                     case 'move_nodes': const rNodeMoves = []; action.moves.forEach(m => { const n = this.nodeRegistry.get(m.id); if (n) { n.x = m.startX; n.y = m.startY; rNodeMoves.push({ ...m, startX: m.endX, startY: m.endY, endX: m.startX, endY: m.startY }); } }); redo = { type: 'move_nodes', moves: rNodeMoves }; this.resetPersistentTransformState(); break;
                     case 'move_text': const rTextMoves = []; action.moves.forEach(m => { const d = this.textBoxRegistry.get(m.id); if (d) { d.x = m.startX; d.y = m.startY; d.rotation = m.startRotation ?? 0; d.element.style.left = `${m.startX}px`; d.element.style.top = `${m.startY}px`; d.element.style.transform = `rotate(${d.rotation}rad)`; rTextMoves.push({ ...m, startX: m.endX, startY: m.endY, endX: m.startX, endY: m.startY, startRotation: m.endRotation, endRotation: m.startRotation }); } }); redo = { type: 'move_text', moves: rTextMoves }; this.resetPersistentTransformState(); break;
                      case 'transform_items': this.applyTransform(action.items, true); this.selectionRotationAngle = action.startAngle ?? 0; this.scaleRotateCenter = action.startCenter ? { ...action.startCenter } : { x: 0, y: 0 }; this.initialBBox = action.startBBox ? { ...action.startBBox } : null; redo = { ...action, prevPersistent: oldPersistent }; break;
                      case 'change_color': const rColChanges = { texts: [], edges: [] }; action.changes.texts.forEach(c => { const d = this.textBoxRegistry.get(c.id); if(d){ d.color = c.oldColor; d.element.style.color = c.oldColor; rColChanges.texts.push({ id: c.id, oldColor: c.newColor, newColor: c.oldColor }); } }); action.changes.edges.forEach(c => { const d = this.edgeRegistry.get(c.id); if(d){ d.color = c.oldColor; rColChanges.edges.push({ id: c.id, oldColor: c.newColor, newColor: c.oldColor }); } }); redo = { type: 'change_color', changes: rColChanges }; break;
                      case 'change_linewidth': const rLwChanges = []; action.changes.forEach(c => { const d = this.edgeRegistry.get(c.id); if(d){ d.lineWidth = c.oldLineWidth; rLwChanges.push({ id: c.id, oldLineWidth: c.newLineWidth, newLineWidth: c.oldLineWidth }); } }); redo = { type: 'change_linewidth', changes: rLwChanges }; break;
                      case 'change_fontsize': const rFsChanges = []; action.changes.forEach(c => { const d = this.textBoxRegistry.get(c.id); if(d){ d.fontSize = c.oldFontSize; d.element.style.fontSize = c.oldFontSize; rFsChanges.push({ id: c.id, oldFontSize: c.newFontSize, newFontSize: c.oldFontSize }); } }); redo = { type: 'change_fontsize', changes: rFsChanges }; this.resetPersistentTransformState(); break;
                 }
                 if (redo) this.redoStack.push(redo);
            } catch (e) { console.error("Undo err:", e, action); this.redoStack = []; }
               this.redrawCanvas(); this.updateNodeHandles(); this.updateTransformHandles(); this.updateCursorBasedOnContext();
           }
           redo() {
                if (this.redoStack.length === 0) return;
                const action = this.redoStack.pop(); let undo = null;
                const oldPersistent = { angle: this.selectionRotationAngle, box: this.initialBBox ? {...this.initialBBox} : null, center: this.scaleRotateCenter ? {...this.scaleRotateCenter} : null };
                try {
                     switch (action.type) {
                          case 'create_text': const { id: tid_r, text: tt_r, x: tx_r, y: ty_r, color: tc_r, fontSize: tf_r, rotation: tr_r } = action.boxInfo; this.createTextBoxElement(tid_r, tt_r, tx_r, ty_r, tc_r, tf_r, tr_r ?? 0); undo = { type: 'create_text', boxInfo: { ...action.boxInfo } }; this.deselectAll(); this.selectTextBox(this.textBoxRegistry.get(tid_r).element); break;
                          case 'create_graph_elements': const undoNodes_c = []; const undoEdges_c = []; action.nodes?.forEach(n => { const cn = this.createNode(n.id, n.x, n.y); if(cn) undoNodes_c.push({...cn}); }); action.edges?.forEach(e => { const ce = this.createEdge(e.id, e.node1Id, e.node2Id, e.color, e.lineWidth); if(ce) undoEdges_c.push({...ce}); }); undo = { type: 'create_graph_elements', nodes: undoNodes_c, edges: undoEdges_c }; const firstNodeId_r = action.nodes?.[0]?.id || action.edges?.[0]?.node1Id; this.deselectAll(); if (firstNodeId_r) this.selectComponent(firstNodeId_r, 'node'); break;
                         case 'delete_selected': const deleted_ds_r = { texts: [], nodes: [], edges: [], createdEdges: [] }; action.deletedInfo.texts.slice().reverse().forEach(t => { const currentText = this.textBoxRegistry.get(t.id)?.element?.textContent; if(this.deleteTextBox(t.id)) { deleted_ds_r.texts.push({ ...t, text: currentText ?? t.text }); } }); action.deletedInfo.edges.slice().reverse().forEach(e => { if(this.edgeRegistry.has(e.id)) { const { edge:de } = this.deleteEdgeSmart(e.id); if(de) deleted_ds_r.edges.push(de); } }); action.deletedInfo.nodes.slice().reverse().forEach(n => { if(this.nodeRegistry.has(n.id)) { const { node:dn, edges:de, createdEdge:ce } = this.deleteNodeSmart(n.id); if(dn) deleted_ds_r.nodes.push(dn); de.forEach(e2 => deleted_ds_r.edges.push(e2)); if(ce) deleted_ds_r.createdEdges.push(ce); } }); deleted_ds_r.nodes = deleted_ds_r.nodes.filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i); deleted_ds_r.edges = deleted_ds_r.edges.filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i); deleted_ds_r.createdEdges = deleted_ds_r.createdEdges.filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i); if (deleted_ds_r.texts.length > 0 || deleted_ds_r.nodes.length > 0 || deleted_ds_r.edges.length > 0 || deleted_ds_r.createdEdges.length > 0) { undo = { type: 'delete_selected', deletedInfo: deleted_ds_r }; } this.deselectAll(); break;
                         case 'move_nodes': const uNodeMoves = []; action.moves.forEach(m => { const n = this.nodeRegistry.get(m.id); if (n) { n.x = m.endX; n.y = m.endY; uNodeMoves.push({ ...m, startX: m.endX, startY: m.endY, endX: m.startX, endY: m.startY }); } }); undo = { type: 'move_nodes', moves: uNodeMoves }; this.resetPersistentTransformState(); break;
                         case 'move_text': const uTextMoves = []; action.moves.forEach(m => { const d = this.textBoxRegistry.get(m.id); if (d) { d.x = m.endX; d.y = m.endY; d.rotation = m.endRotation ?? 0; d.element.style.left = `${m.endX}px`; d.element.style.top = `${m.endY}px`; d.element.style.transform = `rotate(${d.rotation}rad)`; uTextMoves.push({ ...m, startX: m.endX, startY: m.endY, endX: m.startX, endY: m.startY, startRotation: m.endRotation, endRotation: m.startRotation }); } }); undo = { type: 'move_text', moves: uTextMoves }; this.resetPersistentTransformState(); break;
                         case 'transform_items': this.applyTransform(action.items, false); if (action.prevPersistent) { this.selectionRotationAngle = action.prevPersistent.angle; this.initialBBox = action.prevPersistent.box; this.scaleRotateCenter = action.prevPersistent.center; } else { this.resetPersistentTransformState(); } undo = { ...action, prevPersistent: oldPersistent }; break;
                         case 'change_color': const uColChanges = { texts: [], edges: [] }; action.changes.texts.forEach(c => { const d = this.textBoxRegistry.get(c.id); if(d){ d.color = c.newColor; d.element.style.color = c.newColor; uColChanges.texts.push({ id: c.id, oldColor: c.newColor, newColor: c.oldColor }); } }); action.changes.edges.forEach(c => { const d = this.edgeRegistry.get(c.id); if(d){ d.color = c.newColor; uColChanges.edges.push({ id: c.id, oldColor: c.newColor, newColor: c.oldColor }); } }); undo = { type: 'change_color', changes: uColChanges }; break;
                         case 'change_linewidth': const uLwChanges = []; action.changes.forEach(c => { const d = this.edgeRegistry.get(c.id); if(d){ d.lineWidth = c.newLineWidth; uLwChanges.push({ id: c.id, oldLineWidth: c.newLineWidth, newLineWidth: c.oldLineWidth }); } }); undo = { type: 'change_linewidth', changes: uLwChanges }; break;
                          case 'change_fontsize': const uFsChanges = []; action.changes.forEach(c => { const d = this.textBoxRegistry.get(c.id); if(d){ d.fontSize = c.newFontSize; d.element.style.fontSize = c.newFontSize; uFsChanges.push({ id: c.id, oldFontSize: c.newFontSize, newFontSize: c.oldFontSize }); } }); undo = { type: 'change_fontsize', changes: uFsChanges }; this.resetPersistentTransformState(); break;
                     }
                     if (undo) this.undoStack.push(undo);
                } catch (e) { console.error("Redo err:", e, action); this.undoStack = []; }
               this.redrawCanvas(); this.updateNodeHandles(); this.updateTransformHandles(); this.updateCursorBasedOnContext();
              }

        init() {
            this.lineWidthPicker.value = this.currentLineWidth; this.fontSizeInput.value = parseInt(this.currentFontSize, 10); this.colorPicker.value = this.currentColor;
            this.resizeCanvas();
            window.addEventListener('resize', this.resizeCanvas.bind(this));
            document.addEventListener('mousedown', this.handleMouseDown.bind(this));
            document.addEventListener('mousemove', this.handleMouseMove.bind(this));
            document.addEventListener('mouseup', this.handleMouseUp.bind(this));
            document.addEventListener('contextmenu', (e) => e.preventDefault());
            document.addEventListener('keydown', this.handleKeyDown.bind(this));
            document.addEventListener('keyup', this.handleKeyUp.bind(this));
            document.addEventListener('dblclick', this.handleDoubleClick.bind(this));

            // --- Event listeners for input value changes ---
            this.colorPicker.addEventListener('input', this.handleColorChange.bind(this));
            this.colorPicker.addEventListener('change', this.handleColorChange.bind(this));
            this.lineWidthPicker.addEventListener('input', this.handleLineWidthChange.bind(this));
            this.lineWidthPicker.addEventListener('change', this.handleLineWidthChange.bind(this));
            this.fontSizeInput.addEventListener('change', this.handleFontSizeChange.bind(this));
            this.fontSizeInput.addEventListener('input', this.handleFontSizeChange.bind(this));
            // --- End of listeners for input value changes ---

            // --- New Canvas Enter Focus Logic ---
            const handleCanvasMouseEnter = () => {
                const activeElement = document.activeElement;
                if (activeElement === this.colorPicker ||
                    activeElement === this.lineWidthPicker ||
                    activeElement === this.fontSizeInput) {

                    activeElement.blur();
                    setTimeout(() => {
                        this.body.focus({ preventScroll: true });
                    }, 0);
                }
            };

            if (this.canvas) {
                 this.canvas.addEventListener('mouseenter', handleCanvasMouseEnter);
            }
            // --- End of New Canvas Enter Focus Logic ---


            this.body.focus({ preventScroll: true }); this.updateCursorBasedOnContext(); this.updateTransformHandles();
        }
    }

    new GraphEditor();
});
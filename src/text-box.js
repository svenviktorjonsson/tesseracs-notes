// File: ./text-box.js
import { formatStringToMathDisplay, renderStringToElement } from './utils/katex.js';
import { rotatePoint } from './utils/math.js';

export class TextBox {
    constructor(id, initialData, containerElement, utils) {
        this.id = id;
        this.text = initialData.text || '';
        this.x = initialData.x || 0;
        this.y = initialData.y || 0;
        this.color = initialData.color || '#000000';
        this.fontSize = initialData.fontSize || '16px';
        this.rotation = initialData.rotation || 0;
        this.width = initialData.width || 0;
        this.height = initialData.height || 0;

        this.containerElement = containerElement;
        this.utils = {
             formatStringToMathDisplay: utils?.formatStringToMathDisplay || ((text) => text),
             renderStringToElement: utils?.renderStringToElement || ((el, text) => { el.textContent = `KaTeX Error: render util missing. Text: ${text}`; }),
             rotatePoint: utils?.rotatePoint || ((point, center, angle) => point),
             moveCaretToEnd: utils?.moveCaretToEnd || (() => {})
        };
        this.element = null;
        this.isEditing = false;
        this._isScaling = false;
        this._initialStateOnScaleStart = null;

        this._createElement();
        this._measureRenderedSize();

        if (this.element && this.width > 0 && this.height > 0) {
            this.element.style.width = `${this.width}px`;
            this.element.style.height = `${this.height}px`;
        } else if (this.element) {
             console.warn(`[${this.id}] Initial measurement zero dimensions. Setting fallback style size.`);
             this.element.style.width = '10px';
             this.element.style.height = '16px';
             this.width = 10;
             this.height = 16;
        }

        let initialTargetCenterX, initialTargetCenterY;
        const hasXY = initialData.x != null && initialData.y != null;
        const hasWH = initialData.width != null && initialData.height != null;

        if (hasXY && !hasWH) {
             initialTargetCenterX = initialData.x;
             initialTargetCenterY = initialData.y;
        } else if (hasXY) {
             this.x = initialData.x;
             this.y = initialData.y;
             if (this.element) {
                 this.element.style.left = `${this.x}px`;
                 this.element.style.top = `${this.y}px`;
             }
             initialTargetCenterX = this.x + this.width / 2;
             initialTargetCenterY = this.y + this.height / 2;
        } else {
             initialTargetCenterX = 0;
             initialTargetCenterY = 0;
        }

        if (this.width > 0 && this.height > 0 && !isNaN(initialTargetCenterX) && !isNaN(initialTargetCenterY)) {
             this._updatePositionAndSize(initialTargetCenterX, initialTargetCenterY);
        } else if (this.element){
            this.x = parseFloat(this.element.style.left) || 0;
            this.y = parseFloat(this.element.style.top) || 0;
        }
        this._updateTransform();
     }

    _createElement() {
        const div = document.createElement('div');
        div.className = 'textBox';
        div.dataset.id = this.id;
        div.style.position = 'absolute';
        div.style.color = this.color;
        div.style.fontSize = this.fontSize;
        div.style.transformOrigin = 'center center';
        div.style.whiteSpace = 'nowrap';
        div.style.outline = 'none';
        div.style.border = 'none';
        div.style.padding = '0';
        div.style.overflow = 'visible';
        div.style.display = 'flex';
        div.style.justifyContent = 'center';
        div.style.alignItems = 'center';
        div.style.userSelect = 'none';
        div.style.webkitUserSelect = 'none';
        div.style.cursor = 'pointer';
        div.style.boxSizing = 'border-box';
        div.addEventListener('dragstart', (e) => e.preventDefault());
        this.element = div;
        this.containerElement.appendChild(this.element);
     }

    _measureRenderedSize() {
        if (!this.element) return { width: 0, height: 0 };
        this.element.style.fontSize = this.fontSize;
        this.element.style.color = this.color;
        const prevWidth = this.element.style.width;
        const prevHeight = this.element.style.height;
        const prevTransform = this.element.style.transform;
        this.element.style.width = '';
        this.element.style.height = '';
        this.element.style.transform = '';
        let measuredWidth = 0;
        let measuredHeight = 0;
        const minHeightFromFontSize = Math.max(1, parseFloat(this.fontSize) || 16);

        if (this.isEditing) {
            this.element.innerHTML = '';
            this.element.textContent = this.text || '\u00A0';
            this.element.style.whiteSpace = 'pre-wrap';
            this.element.style.textAlign = 'left';
            measuredWidth = this.element.scrollWidth;
            measuredHeight = this.element.scrollHeight;
            if (!this.text || this.text.trim() === '') {
                measuredWidth = Math.max(measuredWidth, 10);
            }
        } else {
            this.element.style.whiteSpace = 'nowrap';
            this.element.style.textAlign = 'center';
            const { formatStringToMathDisplay, renderStringToElement } = this.utils;
            let katexInputString;
            let renderSuccess = false;
            try {
                katexInputString = formatStringToMathDisplay(this.text || '\\phantom{}');
            } catch (error) {
                console.error(`[${this.id}] Error formatting text:`, error);
                this.element.textContent = `Format Err!`;
                katexInputString = undefined;
            }
            if (katexInputString !== undefined) {
                this.element.innerHTML = '';
                try {
                    renderStringToElement(this.element, katexInputString);
                    renderSuccess = true;
                } catch (error) {
                    console.error(`[${this.id}] Error rendering KaTeX:`, error);
                    this.element.textContent = `Render Err!`;
                    renderSuccess = false;
                }
            }
            measuredWidth = this.element.scrollWidth;
            if (renderSuccess) {
                const katexHtmlElement = this.element.querySelector('.katex-html');
                if (katexHtmlElement instanceof HTMLElement) {
                    measuredHeight = katexHtmlElement.offsetHeight;
                    if (measuredHeight <= 0) {
                        measuredHeight = this.element.scrollHeight;
                    }
                } else {
                    measuredHeight = this.element.scrollHeight;
                }
            } else {
                measuredHeight = this.element.scrollHeight;
            }
            if (measuredWidth <= 0) measuredWidth = 10;
        }
        this.element.style.width = prevWidth;
        this.element.style.height = prevHeight;
        this.element.style.transform = prevTransform;
        this.width = Math.max(1, measuredWidth);
        this.height = Math.max(1, minHeightFromFontSize, measuredHeight);
        return { width: this.width, height: this.height };
    }

    _updatePositionAndSize(targetCenterX, targetCenterY) {
        if (!this.element || typeof this.width !== 'number' || typeof this.height !== 'number' || this.width <= 0 || this.height <= 0 || typeof targetCenterX !== 'number' || typeof targetCenterY !== 'number' || isNaN(this.width) || isNaN(this.height) || isNaN(targetCenterX) || isNaN(targetCenterY)) {
             console.warn(`[${this.id}] Skipping position update:`, { w: this.width, h: this.height, cx: targetCenterX, cy: targetCenterY });
             return undefined;
        }
        const adjustedX = targetCenterX - this.width / 2;
        const adjustedY = targetCenterY - this.height / 2;
        this.element.style.left = `${adjustedX}px`;
        this.element.style.top = `${adjustedY}px`;
        this.x = adjustedX;
        this.y = adjustedY;
        return { x: this.x, y: this.y, width: this.width, height: this.height };
    }

     _updateTransform() {
         if (!this.element) return;
         const scaleX = this._isScaling && this._initialStateOnScaleStart ? (Math.sign(this._currentScaleX || 1) !== this._initialStateOnScaleStart.initialScaleXSign ? -1 : 1) : 1;
         const scaleY = this._isScaling && this._initialStateOnScaleStart ? (Math.sign(this._currentScaleY || 1) !== this._initialStateOnScaleStart.initialScaleYSign ? -1 : 1) : 1;
         let transform = `rotate(${this.rotation}rad)`;
         if (scaleX !== 1 || scaleY !== 1) {
             transform += ` scale(${scaleX}, ${scaleY})`;
         }
         this.element.style.transform = transform;
     }

    _updateTransformDuringScale(currentScaleX, currentScaleY) {
        if (!this.element || !this._isScaling || !this._initialStateOnScaleStart) return;
        this._currentScaleX = currentScaleX;
        this._currentScaleY = currentScaleY;
        this._updateTransform();
        delete this._currentScaleX;
        delete this._currentScaleY;
    }

    applyScale(scaleX, scaleY, isFirst = false) {
        if (isFirst || !this._isScaling) {
            const initialFontSizeNum = parseFloat(this.fontSize) || 16;
             if (!this.width || this.width <= 0 || !this.height || this.height <= 0) {
                console.warn(`[${this.id}] Attempting to measure before scaling start.`);
                this._measureRenderedSize();
                 if (!this.width || this.width <= 0 || !this.height || this.height <= 0) {
                     console.error(`[${this.id}] Cannot start scaling, failed to get valid initial dimensions.`);
                     this._isScaling = false; return;
                 }
            }
            const initialWidth = this.width;
            const initialHeight = this.height;
            const initialCenterX = this.x + initialWidth / 2;
            const initialCenterY = this.y + initialHeight / 2;

            if (isNaN(initialFontSizeNum) || initialFontSizeNum <= 0 || isNaN(initialCenterX) || isNaN(initialCenterY) || initialWidth <= 0 || initialHeight <= 0) {
                console.error(`[${this.id}] Cannot start scaling due to invalid initial state.`);
                this._isScaling = false; return;
            }

            this._isScaling = true;
            this._initialStateOnScaleStart = {
                width: initialWidth,
                height: initialHeight,
                fontSizeNumber: initialFontSizeNum,
                centerX: initialCenterX,
                centerY: initialCenterY,
                initialScaleXSign: Math.sign(scaleX || 1),
                initialScaleYSign: Math.sign(scaleY || 1),
            };
            this.element?.classList.add('scaling');
        }

        if (!this._isScaling || !this._initialStateOnScaleStart) {
            console.warn(`[${this.id}] applyScale called without proper initialization.`); return;
        }

        const targetFontSize = Math.max(1, this._initialStateOnScaleStart.fontSizeNumber * Math.abs(scaleY));
        const newFontSize = `${targetFontSize}px`;

        const targetW = Math.max(1, this._initialStateOnScaleStart.width * Math.abs(scaleX));
        const targetH = Math.max(1, this._initialStateOnScaleStart.height * Math.abs(scaleY));

        if (this.fontSize !== newFontSize) {
            this.fontSize = newFontSize;
            if(this.element) this.element.style.fontSize = this.fontSize;
        }

        if (this.width !== targetW || this.height !== targetH ) {
             this.width = targetW;
             this.height = targetH;
            if(this.element) {
                 this.element.style.width = `${this.width}px`;
                 this.element.style.height = `${this.height}px`;
             }
         }

        this._updateTransformDuringScale(scaleX, scaleY);

        this._updatePositionAndSize(
            this._initialStateOnScaleStart.centerX,
            this._initialStateOnScaleStart.centerY
        );
    }

    finalizeScale() {
        if (!this._isScaling) {
            return;
        }
        this._isScaling = false;
        this._initialStateOnScaleStart = null;
        this.element?.classList.remove('scaling');
        this._updateTransform();
    }

    renderContent(rawText = this.text) {
        if (!this.element) return;
        const textChanged = this.text !== rawText;
        this.text = rawText;
        const currentW = typeof this.width === 'number' && this.width > 0 ? this.width : 0;
        const currentH = typeof this.height === 'number' && this.height > 0 ? this.height : 0;
        const currentX = typeof this.x === 'number' && !isNaN(this.x) ? this.x : 0;
        const currentY = typeof this.y === 'number' && !isNaN(this.y) ? this.y : 0;
        const currentCenterX = currentX + currentW / 2;
        const currentCenterY = currentY + currentH / 2;
        const hasValidCenter = currentW > 0 && currentH > 0 && !isNaN(currentCenterX) && !isNaN(currentCenterY);

        this._measureRenderedSize();

        if (this.width > 0 && this.height > 0) {
            this.element.style.width = `${this.width}px`;
            this.element.style.height = `${this.height}px`;
        } else {
             console.warn(`[${this.id}] Measurement in renderContent zero dimensions.`);
        }

        if (hasValidCenter) {
            this._updatePositionAndSize(currentCenterX, currentCenterY);
        } else {
            const fallbackCenterX = (typeof this.x === 'number' ? this.x : 0) + this.width / 2;
            const fallbackCenterY = (typeof this.y === 'number' ? this.y : 0) + this.height / 2;
            if (!isNaN(fallbackCenterX) && !isNaN(fallbackCenterY) && this.width > 0 && this.height > 0) {
                 this._updatePositionAndSize(fallbackCenterX, fallbackCenterY);
            }
        }
        this._updateTransform();
     }

    updateStyle() {
        if (!this.element) return;
        this.element.style.color = this.color;
    }

    setText(newText) {
        if (this.text === newText && !this.isEditing) return false;
        this.renderContent(newText);
        return true;
    }

    setPosition(newX, newY, isCenter = false) {
        let targetCenterX = newX;
        let targetCenterY = newY;
        const currentW = typeof this.width === 'number' && this.width > 0 ? this.width : 0;
        const currentH = typeof this.height === 'number' && this.height > 0 ? this.height : 0;
        if (!isCenter) {
            if(currentW <= 0 || currentH <= 0) {
                 console.warn(`[${this.id}] Cannot calculate center from top-left`);
                 this.x = newX;
                 this.y = newY;
                 if (this.element) {
                     this.element.style.left = `${newX}px`;
                     this.element.style.top = `${newY}px`;
                 }
                 return;
            }
            targetCenterX = newX + currentW / 2;
            targetCenterY = newY + currentH / 2;
        }
        this._updatePositionAndSize(targetCenterX, targetCenterY);
        this._updateTransform();
    }

    setRotation(newRotation) {
        this.rotation = newRotation;
        this._updateTransform();
    }

    setStyle(newColor, newFontSize) {
        let changed = false;
        let rerenderNeeded = false;
        if (newColor && this.color !== newColor) {
            this.color = newColor;
            this.updateStyle();
            changed = true;
        }
        if (newFontSize && this.fontSize !== newFontSize) {
            const parsedFontSize = parseFloat(newFontSize);
            if (!isNaN(parsedFontSize) && parsedFontSize > 0 && newFontSize.endsWith('px')) {
                 this.fontSize = newFontSize;
                 changed = true;
                 rerenderNeeded = true;
            } else {
                 console.warn(`[${this.id}] Invalid font size format`);
            }
        }
        if (rerenderNeeded) {
            this.renderContent();
        }
        return changed;
    }

    enterEditMode() {
        if (!this.element || this.isEditing) return;
        if (this._isScaling) this.finalizeScale();
        this.isEditing = true;
        const currentCenterX = this.x + this.width / 2;
        const currentCenterY = this.y + this.height / 2;
        const hasValidCenter = !isNaN(currentCenterX) && !isNaN(currentCenterY) && this.width > 0 && this.height > 0;

        this._measureRenderedSize();

        if (this.width > 0 && this.height > 0) {
            this.element.style.width = `${this.width}px`;
            this.element.style.height = `${this.height}px`;
        }

        if (hasValidCenter) {
            this._updatePositionAndSize(currentCenterX, currentCenterY);
        } else {
            this._updatePositionAndSize(this.x + this.width / 2, this.y + this.height / 2);
        }

        this.element.contentEditable = 'true';
        this.element.classList.add('writing-mode');
        this.element.style.cursor = 'text';
        this.element.style.outline = '1px dashed #888';
        this.element.style.webkitUserSelect = 'text';
        this.element.style.userSelect = 'text';
        this.element.style.overflow = 'visible';
        this.element.style.transform = ''; // Remove rotation/scale during edit

        this.element.focus({ preventScroll: true });
        this.utils.moveCaretToEnd(this.element);
    }

    exitEditMode() {
        if (!this.element || !this.isEditing) return { textChanged: false };
        const newText = this.element.textContent || '';
        const textChanged = this.text !== newText;
        this.isEditing = false;

        const currentW = typeof this.width === 'number' && this.width > 0 ? this.width : 0;
        const currentH = typeof this.height === 'number' && this.height > 0 ? this.height : 0;
        const currentX = typeof this.x === 'number' && !isNaN(this.x) ? this.x : 0;
        const currentY = typeof this.y === 'number' && !isNaN(this.y) ? this.y : 0;
        const currentCenterX = currentX + currentW / 2;
        const currentCenterY = currentY + currentH / 2;
        const hasValidCenter = currentW > 0 && currentH > 0 && !isNaN(currentCenterX) && !isNaN(currentCenterY);

        this.element.contentEditable = 'false';
        this.element.classList.remove('writing-mode');
        this.element.style.cursor = 'pointer';
        this.element.style.outline = 'none';
        this.element.style.webkitUserSelect = 'none';
        this.element.style.userSelect = 'none';
        this.element.style.overflow = 'visible';

        this.text = newText;
        this.renderContent(this.text); // This handles measure, style set, position, transform

        // Ensure final position uses the center *before* edit mode started
        if (hasValidCenter) {
            this._updatePositionAndSize(currentCenterX, currentCenterY);
             this._updateTransform(); // Reapply transform after positioning
        } else {
            // Fallback if center wasn't valid before edit
             this._updatePositionAndSize(this.x + this.width / 2, this.y + this.height / 2);
             this._updateTransform();
        }

        return { textChanged };
    }

    getCenter() {
         const currentW = typeof this.width === 'number' && this.width > 0 ? this.width : 0;
         const currentH = typeof this.height === 'number' && this.height > 0 ? this.height : 0;
         const currentX = typeof this.x === 'number' && !isNaN(this.x) ? this.x : 0;
         const currentY = typeof this.y === 'number' && !isNaN(this.y) ? this.y : 0;
         return { x: currentX + currentW / 2, y: currentY + currentH / 2 };
    }

    getDOMRect() {
        return this.element?.getBoundingClientRect() ?? null;
    }

    getRotatedCorners() {
        if (!this.element || typeof this.x !== 'number' || typeof this.y !== 'number' || typeof this.width !== 'number' || typeof this.height !== 'number' || this.width <= 0 || this.height <= 0 || isNaN(this.x) || isNaN(this.y) ) {
             return null;
        }
        const { rotatePoint } = this.utils;
        if (typeof rotatePoint !== 'function') {
             console.error("rotatePoint utility missing");
             return null;
        }
        const cx = this.x + this.width / 2;
        const cy = this.y + this.height / 2;
        if (isNaN(cx) || isNaN(cy)) return null;
        const center = { x: cx, y: cy };
        const halfW = this.width / 2;
        const halfH = this.height / 2;
        const corners = {
            tl: { x: center.x - halfW, y: center.y - halfH },
            tr: { x: center.x + halfW, y: center.y - halfH },
            br: { x: center.x + halfW, y: center.y + halfH },
            bl: { x: center.x - halfW, y: center.y + halfH }
        };
        try {
            let finalRotation = this.rotation;
            // Incorporate flip from transform if scaling active
            let scaleX = 1, scaleY = 1;
             if (this._isScaling && this._initialStateOnScaleStart && this.element) {
                const currentTransform = this.element.style.transform || '';
                const scaleMatch = currentTransform.match(/scale\(([^,]+),([^)]+)\)/);
                if(scaleMatch) {
                    scaleX = parseFloat(scaleMatch[1]);
                    scaleY = parseFloat(scaleMatch[2]);
                }
             }

            const finalCorners = {
                 tl: rotatePoint(corners.tl, center, finalRotation),
                 tr: rotatePoint(corners.tr, center, finalRotation),
                 br: rotatePoint(corners.br, center, finalRotation),
                 bl: rotatePoint(corners.bl, center, finalRotation)
            };

            // Apply scale transformation relative to center AFTER rotation
            if(scaleX !== 1 || scaleY !== 1) {
                const applyScale = (p) => ({
                    x: center.x + (p.x - center.x) * scaleX,
                    y: center.y + (p.y - center.y) * scaleY
                });
                finalCorners.tl = applyScale(finalCorners.tl);
                finalCorners.tr = applyScale(finalCorners.tr);
                finalCorners.br = applyScale(finalCorners.br);
                finalCorners.bl = applyScale(finalCorners.bl);
            }


            return {
                tl: finalCorners.tl,
                tr: finalCorners.tr,
                br: finalCorners.br,
                bl: finalCorners.bl,
                center: center
            };
        } catch (e) {
            console.error("Error during point rotation:", e);
            return null;
        }
    }

    getDataForHistory() {
        return {
            id: this.id,
            text: this.text,
            x: this.x,
            y: this.y,
            color: this.color,
            fontSize: this.fontSize,
            rotation: this.rotation,
            width: this.width,
            height: this.height
        };
    }

    destroy() {
        this._isScaling = false;
        this._initialStateOnScaleStart = null;
        this.element?.remove();
        this.element = null;
    }
}
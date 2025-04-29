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

        if (this.element) {
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
    
        // Store current inline styles to restore them later
        const prevWidth = this.element.style.width;
        const prevHeight = this.element.style.height;
        const prevTransform = this.element.style.transform;
        const prevWhiteSpace = this.element.style.whiteSpace;
        const prevDisplay = this.element.style.display;
        const prevTextAlign = this.element.style.textAlign;
        const prevJustifyContent = this.element.style.justifyContent;
        const prevAlignItems = this.element.style.alignItems;
    
        // Temporarily reset styles that affect measurement
        this.element.style.fontSize = this.fontSize; // Ensure correct font size for measurement
        this.element.style.color = this.color;       // Ensure correct color (though less likely to affect size)
        this.element.style.width = 'auto';
        this.element.style.height = 'auto';
        this.element.style.transform = ''; // Remove transform for accurate measurement
    
        let measuredWidth = 0;
        let measuredHeight = 0;
        const minHeightFromFontSize = Math.max(1, parseFloat(this.fontSize) || 16);
    
        if (this.isEditing) {
            // Measurement during editing (plain text)
            this.element.style.display = 'block'; // Use block for measurement
            this.element.style.whiteSpace = 'pre'; // Use pre for measurement
            this.element.style.textAlign = 'left'; // Use left align for measurement
    
            measuredWidth = this.element.scrollWidth;
            measuredHeight = this.element.scrollHeight;
    
            // Add minimum width for empty editable box
            if (!this.text || this.text.trim() === '') {
                measuredWidth = Math.max(measuredWidth, 10);
            }
            // Ensure minimum height in edit mode too
             measuredHeight = Math.max(measuredHeight, minHeightFromFontSize);
    
        } else {
            // Measurement during display (KaTeX)
            // Apply temporary styles suitable for KaTeX measurement
            this.element.style.display = 'inline-block';
            this.element.style.whiteSpace = 'normal'; // Allow internal KaTeX wrapping
            this.element.style.textAlign = 'center'; // Or 'left', depending on desired alignment within the box
    
            const { formatStringToMathDisplay, renderStringToElement } = this.utils;
            let katexInputString;
            let renderSuccess = false;
    
            try {
                katexInputString = formatStringToMathDisplay(this.text || '\\phantom{}'); // Use phantom for empty
            } catch (error) {
                console.error(`[${this.id}] Error formatting text:`, error);
                this.element.textContent = `Format Err!`;
                katexInputString = undefined;
            }
    
            if (katexInputString !== undefined) {
                this.element.innerHTML = ''; // Clear before rendering
                try {
                    renderStringToElement(this.element, katexInputString);
                    renderSuccess = true;
                } catch (error) {
                    console.error(`[${this.id}] Error rendering KaTeX:`, error);
                    this.element.textContent = `Render Err!`;
                    renderSuccess = false;
                }
            }
    
            // --- Measure the core KaTeX content ---
            const katexHtmlElement = this.element.querySelector('.katex-html');
    
            if (renderSuccess && katexHtmlElement instanceof HTMLElement) {
                // Use getBoundingClientRect on the inner katex-html element.
                // This usually excludes outer margins (like from .katex-display)
                // but includes padding/border of the measured element itself.
                const rect = katexHtmlElement.getBoundingClientRect();
                measuredWidth = rect.width;
                measuredHeight = rect.height;
                 // console.log(`[${this.id}] Measured .katex-html rect:`, rect.width, rect.height); // Optional debug log
            } else {
                // Fallback: If rendering failed or .katex-html not found, measure the container.
                console.warn(`[${this.id}] Fallback measurement: Using scrollWidth/scrollHeight.`);
                measuredWidth = this.element.scrollWidth;
                measuredHeight = this.element.scrollHeight;
            }
    
            // Ensure minimum dimensions if measurement somehow resulted in zero or less
            if (measuredWidth <= 0) measuredWidth = 10; // Ensure minimum width
            if (measuredHeight <= 0) measuredHeight = minHeightFromFontSize; // Ensure minimum height based on font
        }
    
        // Restore previous inline styles
        this.element.style.width = prevWidth;
        this.element.style.height = prevHeight;
        this.element.style.transform = prevTransform;
        this.element.style.whiteSpace = prevWhiteSpace;
        this.element.style.display = prevDisplay;
        this.element.style.textAlign = prevTextAlign;
        this.element.style.justifyContent = prevJustifyContent;
        this.element.style.alignItems = prevAlignItems;
    
        // Update internal dimensions, ensuring minimums based on font size and measurement
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
        if (!this.element || this.isEditing) return; // Exit if no element or already editing
        if (this._isScaling) this.finalizeScale(); // Ensure scaling is finished if it was active

        this.isEditing = true;

        // --- Prepare element content and size for editing ---
        this.element.innerHTML = ''; // **NEW:** Clear previous KaTeX/HTML structure
        this.element.textContent = this.text; // **NEW:** Set raw text content for editing
        this.element.style.width = 'auto';   // **NEW:** Let width be determined by content/CSS, clearing previous fixed/fallback width
        this.element.style.height = 'auto';  // **NEW:** Let height be determined by content/CSS, clearing previous fixed/fallback height

        // --- REMOVED --- measurement, explicit size setting, and position update logic ---
    
        // --- Apply styles specifically for editing ---
        this.element.style.display = 'block';    // **NEW:** Use block display for predictable text flow
        this.element.style.whiteSpace = 'pre';     // **NEW:** Prevent auto-wrapping, respect user spaces/newlines
        this.element.style.overflowX = 'auto';   // **NEW:** Add horizontal scroll if content exceeds container
        this.element.style.overflowY = 'visible';// **NEW:** Allow vertical overflow (or use 'auto' if vertical scroll is desired)
        this.element.style.textAlign = 'left';     // **NEW:** Align text to the left for standard editing
        this.element.style.transform = ''; // Remove rotation/scale transform during edit (Keep this)

        // --- Set editing attributes and classes ---
        this.element.contentEditable = 'true'; // Keep this
        this.element.classList.add('writing-mode'); // Keep this

        // --- Set interactive styles for editing ---
        this.element.style.cursor = 'text'; // Keep this
        this.element.style.userSelect = 'text'; // Keep this (standard)
        this.element.style.webkitUserSelect = 'text'; // **NEW:** Add for Safari/Chrome text selection consistency

        // --- Focus and caret ---
        this.element.focus({ preventScroll: true }); // Keep this
        // Use setTimeout for robustness, ensuring focus is set before moving caret
        setTimeout(() => {
                if(this.element && this.utils.moveCaretToEnd) { // Check element still exists
                    this.utils.moveCaretToEnd(this.element);
                }
        }, 0); // Keep this
    }

    exitEditMode() {
        if (!this.element || !this.isEditing) return { textChanged: false }; // Exit if not editing

        // Get the final text content from the editable element
        const newText = this.element.textContent || '';
        const textChanged = this.text !== newText;
        this.text = newText; // Update internal text state

        // Mark as not editing anymore
        this.isEditing = false;

        // --- Render content (this measures, sets width/height inline, positions) --- 
        this.renderContent(this.text); // Re-render with KaTeX, updates size and position

        // --- Restore display attributes and styles ---
        this.element.contentEditable = 'false'; // Turn off editing
        this.element.classList.remove('writing-mode'); // Remove editing class

        // --- Clear inline styles that were specific to edit mode ---
        // This allows the CSS rules for the base .textBox class to take effect
        this.element.style.display = ''; // Resets to CSS rule (e.g., inline-block)
        this.element.style.whiteSpace = ''; // Resets to CSS rule (e.g., nowrap)
        this.element.style.textAlign = ''; // Resets to CSS rule (e.g., center)
        this.element.style.overflowX = ''; // Resets to default (visible)
        this.element.style.overflowY = ''; // Resets to default (visible)
        this.element.style.lineHeight = ''; // Resets to CSS rule (e.g., normal)
        this.element.style.cursor = ''; // Resets to CSS rule (e.g., pointer)
        this.element.style.userSelect = ''; // Resets to CSS rule (e.g., none)
        this.element.style.webkitUserSelect = ''; // Resets to CSS rule (e.g., none)
        // Note: width and height are intentionally NOT reset here,
        // as they were just set by renderContent() based on the final KaTeX size.

        // Re-apply the final transform (rotation) if any
        this._updateTransform();

        return { textChanged }; // Return whether the text content changed
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
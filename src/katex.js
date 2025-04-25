import katex from 'katex';

const epsilon = 1e-9;
function isClose(a, b) { return Math.abs(a - b) < epsilon; }

function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return unsafe;
    return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function parseKatexSegments(inputString) {
    if (inputString === null || inputString === undefined) {
        return [{ type: 'text', content: '' }];
    }
    const str = String(inputString);
    if (str === '') {
        return [{ type: 'text', content: '' }];
    }

    const katexRegex = /(\$\$([\s\S]+?)\$\$|\$([^$\\]*(?:\\.[^$\\]*)*)\$|\\\$)/g;
    const segments = [];
    let lastIndex = 0;
    let result;

    while ((result = katexRegex.exec(str)) !== null) {
        const match = result[0];
        const index = result.index;

        if (index > lastIndex) {
            segments.push({ type: 'text', content: str.substring(lastIndex, index) });
        }

        if (match === '\\$') {
            segments.push({ type: 'text', content: '$' });
        } else {
            segments.push({ type: 'math', content: match });
        }
        lastIndex = index + match.length;
    }

    if (lastIndex < str.length) {
        segments.push({ type: 'text', content: str.substring(lastIndex) });
    }

    const combinedSegments = [];
    let currentTextSegment = null;
    for (const segment of segments) {
        if (segment.type === 'text') {
            if (currentTextSegment === null) { currentTextSegment = { type: 'text', content: segment.content }; }
            else { currentTextSegment.content += segment.content; }
        } else {
            if (currentTextSegment !== null) { combinedSegments.push(currentTextSegment); currentTextSegment = null; }
            combinedSegments.push(segment);
        }
    }
    if (currentTextSegment !== null) { combinedSegments.push(currentTextSegment); }

    if (combinedSegments.length === 0 && segments.length === 1 && segments[0].type === 'text') {
       return segments;
    }

    return combinedSegments;
}

function renderMathSegment(mathSegment) {
    const displayMatch = mathSegment.match(/^\$\$([\s\S]+)\$\$$/);
    const inlineMatch = mathSegment.match(/^\$([^$]+)\$$/);
    let mathContent = null; let displayMode = false;

    if (displayMatch && displayMatch[1]?.trim()) {
        mathContent = displayMatch[1].trim();
        displayMode = true;
    } else if (inlineMatch && inlineMatch[1]?.trim()) {
        mathContent = inlineMatch[1].trim();
        displayMode = false;
    }

    if (mathContent === null) {
        return `<span class="text-segment">${escapeHtml(mathSegment)}</span>`;
    }

    try {
        return katex.renderToString(mathContent, {
            throwOnError: false,
            displayMode: displayMode,
            output: "html",
            strict: 'warn'
        });
    } catch (error) {
        console.error("KaTeX renderToString unexpected error:", error);
        return `<span class="katex-error" title="${escapeHtml(error.message || 'Unknown KaTeX error')}">${escapeHtml(mathSegment)}</span>`;
    }
}

const sciNotationRegex = /^(-?\d+(?:\.\d+)?)[eE]([-+]?\d+)$/;

function formatTickLabelString(labelString, options = {}) {
    const { axis = null } = options;
    let formattedString = String(labelString ?? '').trim();
    const sciMatch = formattedString.match(sciNotationRegex);

    if (sciMatch) {
        let coefficient = parseFloat(sciMatch[1]);
        let exponent = parseInt(sciMatch[2], 10);
        let exponentStr = String(exponent).startsWith('+') ? String(exponent).substring(1) : String(exponent);
        const absCoeff = Math.abs(coefficient);

        if (isClose(absCoeff, 1.0)) {
            if (coefficient < 0) {
                formattedString = `-10^{${exponentStr}}`;
            } else {
                formattedString = `10^{${exponentStr}}`;
            }
        } else {
            let coefficientStr = Number.isInteger(coefficient) ? coefficient.toFixed(0) : String(coefficient);
            formattedString = `${coefficientStr} \\cdot 10^{${exponentStr}}`;
        }
    } else {
        const isVerticalAxis = axis === 'left' || axis === 'right';
        const isPlainNumber = /^-?\d+(\.\d+)?$/.test(formattedString);
        const isPositiveOrZero = isPlainNumber && !formattedString.startsWith('-')

        if (isVerticalAxis && isPositiveOrZero) {
            formattedString = `\\phantom{-}${formattedString}`;
        }
    }
    return formattedString;
}

function formatStringToMathDisplay(originalString) {
    if (typeof originalString !== 'string' || originalString.trim() === '') {
        return '';
    }

    // --- No changes to this regex ---
    const tokenRegex = /(\\[a-zA-Z]_\[a-zA-Z])|(\\[a-zA-Z](?=\W|$))|(\\[a-zA-Z]{2,})|([a-zA-Z][a-zA-Z0-9]+)|(\$)|( )|([\s\S])/g;
    let lastIndex = 0;
    let match;

    // --- No changes to tokenization logic ---
    const tokens = [];
    tokenRegex.lastIndex = 0;
    while ((match = tokenRegex.exec(originalString)) !== null) {
        const backslashSubscript = match[1];
        const backslashLetter = match[2];
        const command = match[3];
        const word = match[4];
        const dollar = match[5];
        const space = match[6];
        const other = match[7];

        if (match.index > lastIndex) {
            tokens.push({ type: 'other', value: originalString.slice(lastIndex, match.index) });
        }

        if (backslashSubscript) {
            const [letter1, letter2] = backslashSubscript.split('_').map(part => part.slice(1));
            tokens.push({ type: 'backslashSubscript', value: `\\mathrm{${letter1}}_\\mathrm{${letter2}}`, isWord: true });
        } else if (backslashLetter) {
            tokens.push({ type: 'backslashLetter', value: backslashLetter.slice(1), isWord: true });
        } else if (command) {
            tokens.push({ type: 'command', value: command });
        } else if (word) {
            tokens.push({ type: 'word', value: word, isWord: true });
        } else if (dollar) {
            tokens.push({ type: 'dollar', value: dollar });
        } else if (space) {
            tokens.push({ type: 'space', value: space });
        } else if (other) {
            // Crucially, { } [ ] etc. fall into 'other'
            tokens.push({ type: 'other', value: other });
        }
        lastIndex = match.index + match[0].length;
    }
     // Add any remaining text
     if (lastIndex < originalString.length) {
         tokens.push({ type: 'other', value: originalString.slice(lastIndex) });
     }


    // --- Processing loop ---
    let processedText = '';
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];

        if (token.type === 'command') {
            processedText += token.value;
        } else if (token.type === 'backslashSubscript') {
            processedText += token.value;
        } else if (token.type === 'backslashLetter') {
            processedText += `\\mathrm{${token.value}}`;
        } else if (token.type === 'word') {
            // --- START: Added logic to check if word is an argument ---
            let isLikelyArgument = false;
            let prevIndex = i - 1;

            // Look backwards over spaces
            while (prevIndex >= 0 && tokens[prevIndex].type === 'space') {
                prevIndex--;
            }

            // Check if the preceding non-space token is '{'
            if (prevIndex >= 0 && tokens[prevIndex].type === 'other' && tokens[prevIndex].value === '{') {
                let cmdIndex = prevIndex - 1;
                // Look backwards over spaces before the '{'
                while (cmdIndex >= 0 && tokens[cmdIndex].type === 'space') {
                    cmdIndex--;
                }
                // Check if the token before that is a command
                if (cmdIndex >= 0 && tokens[cmdIndex].type === 'command') {
                    // Found the pattern: \command { word...
                    // Or \command space { word...
                    isLikelyArgument = true;
                }
            }
            // --- END: Added logic ---

            // --- Modified output based on the check ---
            if (isLikelyArgument) {
                processedText += token.value; // Output argument word literally
            } else {
                processedText += `\\mathrm{${token.value}}`; // Original logic for other words
            }
        } else if (token.type === 'dollar') {
            processedText += '\\$';
        } else if (token.type === 'space') {
            // --- No changes to space handling logic ---
            let escapeSpace = false;
            const prevToken = i > 0 ? tokens[i - 1] : null;
            const nextToken = i < tokens.length - 1 ? tokens[i + 1] : null;

            if (prevToken && (prevToken.isWord /* Check original isWord flag */ )) {
                 // Check if preceded by ^ or _ (using original logic structure)
                 let charBeforePrevWord = '';
                 let idx = i - 2;
                 while (idx >= 0 && tokens[idx].type === 'space') { idx--; } // Skip spaces before the word
                 if (idx >=0 && tokens[idx].type === 'other') {
                     charBeforePrevWord = tokens[idx].value;
                 }
                 if (charBeforePrevWord !== '^' && charBeforePrevWord !== '_') {
                     escapeSpace = true;
                 }
            }

             if (nextToken && (nextToken.isWord /* Check original isWord flag */ ) && !escapeSpace) {
                 // Space before a word needs escape only if not already escaped by preceding logic
                 escapeSpace = true;
             }

            processedText += escapeSpace ? '\\ ' : ' ';

        } else if (token.type === 'other') {
            processedText += token.value; // Pass other characters (like { } [ ] ^ _ etc.) through
        }
    }

    return `$$${processedText}$$`;
}


function renderStringToElement(container, rawString, options = {}) {
    if (!container) { return; }
    const effectiveString = (rawString === null || rawString === undefined) ? '' : String(rawString);

    let htmlContent = '';
    try {
        const segments = parseKatexSegments(effectiveString);
        htmlContent = segments.map(segment => {
            if (segment.type === 'text') {
                return `<span class="text-segment">${escapeHtml(segment.content)}</span>`;
            } else if (segment.type === 'math') {
                return renderMathSegment(segment.content);
            }
            return '';
        }).join('');
    } catch (error) {
        console.error("Error processing string segments for rendering:", error, effectiveString);
        htmlContent = `<span class="katex-error" title="${escapeHtml(String(error.message || 'Unknown error'))}">Error</span>`;
    }
    container.innerHTML = htmlContent;
}

export {
    escapeHtml,
    parseKatexSegments,
    renderMathSegment,
    renderStringToElement,
    formatTickLabelString,
    formatStringToMathDisplay
};
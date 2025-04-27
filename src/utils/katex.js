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

/**
 * Converts a raw string containing text and custom math notation into
 * a KaTeX-compatible math string wrapped in $$.
 *
 * Rules:
 * - \SingleLetter (e.g., \a, \x, \P) becomes \mathrm{SingleLetter}.
 * - Multi-character Word (e.g., Text, word) becomes \mathrm{Word}.
 * - Single letters (e.g., a, x, P) remain as variables.
 * - LaTeX commands (e.g., \alpha, \int) are preserved.
 * - Matrix syntax (&, \\) is preserved.
 * - Newlines (\n, \r\n) become \\.
 * - $ becomes \$.
 * - Spaces between text/mathrm blocks are escaped (\ ).
 *
 * @param {string} originalString The raw input string.
 * @returns {string} The processed string wrapped in $$, ready for KaTeX.
 */
function formatStringToMathDisplay(originalString) {
    console.log('[formatStringToMathDisplay FINAL] Input:', originalString);
    if (typeof originalString !== 'string' || originalString.trim() === '') {
        return '';
    }

    // Regex prioritizing specific tokens, including \letter, before catch-all
    // Group 1: \a_b style backslash subscript
    // Group 2: \\ (double backslash for matrix/newline)
    // Group 3: \alpha style multi-letter commands
    // Group 4: \a style single backslash letter (CRITICAL: Matched before single chars)
    // Group 5: word style words
    // Group 6: numbers
    // Group 7: $
    // Group 8: &
    // Group 9: space
    // Group 10: \n or \r\n newline
    // Group 11: Any other single character (catch-all)
    const tokenRegex = /(\\[a-zA-ZåäöÅÄÖ]_\[a-zA-ZåäöÅÄÖ])|(\\\\) |(\\[a-zA-ZåäöÅÄÖ]{2,})|(\\[a-zA-ZåäöÅÄÖ])|([a-zA-ZåäöÅÄÖ][a-zA-Z0-9åäöÅÄÖ]*)|([0-9]+(?:\.[0-9]+)?)|(\$)|(&)|( )|(\r?\n)|([\s\S])/g;

    let match;
    const tokens = [];
    let currentCommandForArgCheck = null;

    tokenRegex.lastIndex = 0;

    // --- Tokenization Phase ---
    while ((match = tokenRegex.exec(originalString)) !== null) {
        const backslashSubscript = match[1], doubleBackslash = match[2], command = match[3], backslashLetter = match[4], word = match[5], number = match[6], dollar = match[7], ampersand = match[8], space = match[9], newline = match[10], other = match[11];
        let tokenInfo = {};

        // Check groups in order of priority
        if (backslashSubscript) { tokenInfo = { type: 'backslashSubscript', value: `\\mathrm{${match[1].split('_').map(part => part.slice(1))[0]}}_\\mathrm{${match[1].split('_').map(part => part.slice(1))[1]}}` }; }
        else if (doubleBackslash) { tokenInfo = { type: 'doubleBackslash', value: '\\\\' }; }
        else if (command) { tokenInfo = { type: 'command', value: command }; currentCommandForArgCheck = tokenInfo; }
        else if (backslashLetter) { tokenInfo = { type: 'backslashLetter', value: backslashLetter.slice(1) }; } // \a, \P etc.
        else if (word) { tokenInfo = { type: 'word', value: word }; const lt = tokens[tokens.length - 1]; const slt = tokens[tokens.length - 2]; let iA = false; if (lt?.type === 'other' && lt.value === '{' && slt?.type === 'command') { iA = true; } tokenInfo.isArgument = iA; if (!iA) currentCommandForArgCheck = null; }
        else if (number) { tokenInfo = { type: 'number', value: number }; currentCommandForArgCheck = null; }
        else if (dollar) { tokenInfo = { type: 'dollar', value: '\\$' }; currentCommandForArgCheck = null; }
        else if (ampersand) { tokenInfo = { type: 'ampersand', value: '&' }; currentCommandForArgCheck = null; }
        else if (space) { tokenInfo = { type: 'space', value: ' ' }; }
        else if (newline) { tokenInfo = { type: 'newline', value: '\\\\' }; currentCommandForArgCheck = null; }
        else if (other) { tokenInfo = { type: 'other', value: other }; if (!(other === '{' && currentCommandForArgCheck)) { currentCommandForArgCheck = null; } }

        // Ensure a token was actually created before pushing
        if (tokenInfo.type) {
             tokens.push(tokenInfo);
        } else if (match[0]){ // Log if something matched but didn't create a token (shouldn't happen)
             console.warn("Tokenization anomaly: Matched content did not produce token:", match[0]);
        }
    }
     console.log('[formatStringToMathDisplay FINAL] Tokens:', JSON.stringify(tokens.map(t => ({t:t.type, v:t.value}))));


    // --- Processing Phase ---
    let processedText = '';

    // Helper: Checks if token renders as text (\mathrm).
    // Now correctly includes backslashLetter and non-arg multi-char words.
    const willRenderAsMathrm = (token) => {
        if (!token) return false;
        if (token.type === 'backslashLetter' || token.type === 'backslashSubscript') {
             return true;
         }
        if (token.type === 'word' && !token.isArgument && token.value.length > 1) {
             return true; // Multi-char non-arg words are always \mathrm now
        }
        return false;
    };


    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        console.log(`[Processing Loop FINAL] Index: ${i}, Type: ${token.type}, Value: "${token.value}"`);

        switch (token.type) {
            case 'command': // \alpha etc.
            case 'number':
            case 'ampersand': // &
            case 'doubleBackslash': // \\
            case 'newline': // \\ (from \n)
            case 'backslashSubscript': // Already \mathrm{a}_\mathrm{b}
            case 'dollar': // Already \$
                 console.log(`  -> Outputting literal value: "${token.value}"`);
                 processedText += token.value; break;

             case 'other': // _, ^, {, }, +, -, etc.
                 console.log(`  -> Outputting literal 'other': "${token.value}"`);
                 const esc = ['#', '%']; // Only escape these
                 if(esc.includes(token.value)){
                     processedText+='\\'+token.value;
                 } else {
                     processedText+=token.value;
                 }
                 break;

            case 'backslashLetter': { // \a, \P etc.
                console.log("  -> Hit 'backslashLetter' case");
                // *** Rule: ALWAYS output \mathrm{...} ***
                processedText += `\\mathrm{${token.value}}`;
                console.log(`    -> Appended \\mathrm{${token.value}}`);
                break;
            }

            case 'word': { // a, P, Text, word etc.
                console.log("  -> Hit 'word' case");
                if (token.isArgument) {
                    console.log("    -> Is argument, outputting literally");
                    processedText += token.value;
                } else if (token.value.length === 1) {
                    console.log("    -> Is single letter, outputting literally (variable)");
                    processedText += token.value;
                } else {
                    console.log("    -> Is multi-char non-arg, outputting \\mathrm{}");
                    // *** Rule: Multi-char non-argument words ALWAYS output \mathrm{...} ***
                    processedText += `\\mathrm{${token.value}}`;
                }
                break;
            }

            case 'space': { // Handle spacing between \mathrm blocks
                console.log("  -> Hit 'space' case");
                let escapeSpace = false;
                let prevNIS={token:null, index: -1}, nextNIS={token:null, index: -1};
                for(let k=i-1;k>=0;k--){if(tokens[k].type!=='space'){prevNIS={token:tokens[k],index:k};break;}}
                for(let k=i+1;k<tokens.length;k++){if(tokens[k].type!=='space'){nextNIS={token:tokens[k],index:k};break;}}
                // Use the simplified helper function
                const prevIsWordLike = willRenderAsMathrm(prevNIS.token);
                const nextIsWordLike = willRenderAsMathrm(nextNIS.token);
                 console.log(`    -> Prev is word-like: ${prevIsWordLike}, Next is word-like: ${nextIsWordLike}`);
                if(prevIsWordLike||nextIsWordLike){
                    escapeSpace=true;
                    if(prevIsWordLike&&!nextIsWordLike){
                        let charBeforePrev='';
                        let idx=prevNIS.index-1;
                        while(idx>=0&&tokens[idx].type==='space'){idx--;}
                        if(idx>=0&&tokens[idx].type==='other'){charBeforePrev=tokens[idx].value;}
                        console.log(`    -> Char before prev word-like: "${charBeforePrev}"`);
                        if(charBeforePrev==='^'||charBeforePrev==='_'){
                            escapeSpace=false;
                             console.log("    -> Deviation applies, not escaping space.");
                        }
                    }
                }
                processedText += escapeSpace ? '\\ ' : ' ';
                console.log(`    -> Appended ${escapeSpace ? "'\\ '" : "' '"} `);
                break;
            }
             default:
                console.warn("[formatStringToMathDisplay FINAL] Unknown token type:", token.type, token.value);
                processedText += token.value; break;
        }
    }

    processedText = processedText.trim();
    console.log('[formatStringToMathDisplay FINAL] Final Output Text:', processedText);
    if (processedText === '') { return ''; }
    return `$$${processedText}$$`; // Wrap in $$
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
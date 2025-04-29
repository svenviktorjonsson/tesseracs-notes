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
    console.log('[formatStringToMathDisplay FINAL] Input:', originalString);
    // Handle null/undefined/empty string input
    if (typeof originalString !== 'string' || originalString.trim() === '') {
        // Return an empty align environment or just empty string?
        // Let's return empty string for simplicity, KaTeX might handle empty align gracefully anyway.
        return '';
    }

    // Trim the input string *before* tokenization to handle leading/trailing spaces easily.
    const trimmedOriginalString = originalString.trim();
    // If trimming resulted in an empty string, return empty.
    if (trimmedOriginalString === '') {
        return '';
    }


    // Regex prioritizing specific tokens, including \letter, before catch-all
    // Group 1: \a_b style backslash subscript
    // Group 2: \\ (double backslash for matrix/newline - keep this!)
    // Group 3: \alpha style multi-letter commands
    // Group 4: \a style single backslash letter (CRITICAL: Matched before single chars)
    // Group 5: word style words
    // Group 6: numbers
    // Group 7: $
    // Group 8: & (important for align environment)
    // Group 9: space
    // Group 10: \n or \r\n newline
    // Group 11: Any other single character (catch-all)
    // Added ÅÄÖ characters to relevant groups
    const tokenRegex = /(\\[a-zA-ZåäöÅÄÖ]_\{[a-zA-ZåäöÅÄÖ0-9 ]+\})|(\\\\) |(\\[a-zA-ZåäöÅÄÖ]{2,})|(\\[a-zA-ZåäöÅÄÖ])|([a-zA-ZåäöÅÄÖ][a-zA-Z0-9åäöÅÄÖ]*)|([0-9]+(?:\.[0-9]+)?)|(\$)|(&)|( )|(\r?\n)|([\s\S])/g;


    let match;
    const tokens = [];
    let currentCommandForArgCheck = null;

    tokenRegex.lastIndex = 0; // Reset regex state

    // --- Tokenization Phase ---
    while ((match = tokenRegex.exec(trimmedOriginalString)) !== null) { // Use trimmed string
        // Extract matched groups
        const backslashSubscript = match[1],
              doubleBackslash = match[2],
              command = match[3],
              backslashLetter = match[4],
              word = match[5],
              number = match[6],
              dollar = match[7],
              ampersand = match[8],
              space = match[9],
              newline = match[10],
              other = match[11];
        let tokenInfo = {};

        // Determine token type based on which group matched
        if (backslashSubscript) {
            // Extract parts carefully, assuming format \Letter_{Argument}
            const parts = backslashSubscript.match(/^\\([a-zA-ZåäöÅÄÖ])_\{(.*)\}$/);
            if (parts && parts[1] && parts[2]) {
                 tokenInfo = { type: 'backslashSubscript', value: `\\mathrm{${parts[1]}}_\\mathrm{${parts[2]}}` };
            } else {
                 // Fallback or error handling if format is unexpected
                 console.warn("Unexpected backslash subscript format:", backslashSubscript);
                 tokenInfo = { type: 'other', value: backslashSubscript }; // Treat as literal if parse fails
            }
        } else if (doubleBackslash) { tokenInfo = { type: 'doubleBackslash', value: '\\\\' }; } // Literal \\
        else if (command) { tokenInfo = { type: 'command', value: command }; currentCommandForArgCheck = tokenInfo; } // e.g., \alpha
        else if (backslashLetter) { tokenInfo = { type: 'backslashLetter', value: backslashLetter.slice(1) }; } // e.g., \a -> a
        else if (word) { // e.g., Text, word1
            tokenInfo = { type: 'word', value: word };
            // Basic check if it follows a command expecting an argument wrapped in {}
            const lt = tokens[tokens.length - 1]; // last token
            const slt = tokens[tokens.length - 2]; // second last token
            tokenInfo.isArgument = (lt?.type === 'other' && lt.value === '{' && slt?.type === 'command');
            if (!tokenInfo.isArgument) currentCommandForArgCheck = null; // Reset if not part of an argument
        }
        else if (number) { tokenInfo = { type: 'number', value: number }; currentCommandForArgCheck = null; }
        else if (dollar) { tokenInfo = { type: 'dollar', value: '\\$' }; currentCommandForArgCheck = null; } // Escape dollar sign
        else if (ampersand) { tokenInfo = { type: 'ampersand', value: '&' }; currentCommandForArgCheck = null; } // Keep & for align
        else if (space) { tokenInfo = { type: 'space', value: ' ' }; } // Keep space
        else if (newline) { tokenInfo = { type: 'newline', value: '\\\\' }; currentCommandForArgCheck = null; } // *** Convert \n to \\ ***
        else if (other) { // Any other single character like +, -, {, }, ^, _ etc.
            tokenInfo = { type: 'other', value: other };
            // Reset argument check unless it's the opening brace right after a command
            if (!(other === '{' && currentCommandForArgCheck)) {
                currentCommandForArgCheck = null;
            }
        }

        // Push the token if one was successfully identified
        if (tokenInfo.type) {
            tokens.push(tokenInfo);
        } else if (match[0]) {
            console.warn("Tokenization anomaly: Matched content did not produce token:", match[0]);
        }
    }
    console.log('[formatStringToMathDisplay FINAL] Tokens:', JSON.stringify(tokens.map(t => ({ t: t.type, v: t.value }))));

    // --- Processing Phase ---
    let processedText = '';

    // Helper function to determine if a token should be wrapped in \mathrm
    const willRenderAsMathrm = (token) => {
        if (!token) return false;
        // Single letters preceded by \ are treated as text blocks
        if (token.type === 'backslashLetter' || token.type === 'backslashSubscript') {
            return true;
        }
        // Multi-character words that are NOT arguments to commands are treated as text blocks
        if (token.type === 'word' && !token.isArgument && token.value.length > 1) {
            return true;
        }
        return false;
    };

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        console.log(`[Processing Loop FINAL] Index: ${i}, Type: ${token.type}, Value: "${token.value}"`);

        switch (token.type) {
            // These types are output directly
            case 'command':
            case 'number':
            case 'ampersand': // Keep & for align
            case 'doubleBackslash': // Keep \\
            case 'newline': // Keep \\ (converted from \n)
            case 'backslashSubscript': // Already formatted
            case 'dollar': // Already escaped \$
                console.log(`  -> Outputting literal value: "${token.value}"`);
                processedText += token.value;
                break;

            case 'other': // Single characters like +, -, {, }, ^, _ etc.
                console.log(`  -> Outputting literal 'other': "${token.value}"`);
                // Escape specific characters if needed for LaTeX
                const charsToEscape = ['#', '%']; // Add others like & if not handled separately
                if (charsToEscape.includes(token.value)) {
                    processedText += '\\' + token.value;
                } else {
                    processedText += token.value;
                }
                break;

            case 'backslashLetter': // \a, \P treated as text
                console.log("  -> Hit 'backslashLetter' case");
                processedText += `\\mathrm{${token.value}}`;
                console.log(`    -> Appended \\mathrm{${token.value}}`);
                break;

            case 'word': // a, P, Text, word1 treated based on context/length
                console.log("  -> Hit 'word' case");
                if (token.isArgument) { // Inside {} after a command
                    console.log("    -> Is argument, outputting literally");
                    processedText += token.value;
                } else if (token.value.length === 1) { // Single letter, treat as variable
                    console.log("    -> Is single letter, outputting literally (variable)");
                    processedText += token.value;
                } else { // Multi-character word, not argument, treat as text
                    console.log("    -> Is multi-char non-arg, outputting \\mathrm{}");
                    processedText += `\\mathrm{${token.value}}`;
                }
                break;

            case 'space': // Handle space, potentially escaping if between text blocks
                console.log("  -> Hit 'space' case");
                let escapeSpace = false;
                // Find previous non-space token
                let prevNIS = { token: null, index: -1 };
                for (let k = i - 1; k >= 0; k--) { if (tokens[k].type !== 'space') { prevNIS = { token: tokens[k], index: k }; break; } }
                // Find next non-space token
                let nextNIS = { token: null, index: -1 };
                for (let k = i + 1; k < tokens.length; k++) { if (tokens[k].type !== 'space') { nextNIS = { token: tokens[k], index: k }; break; } }

                const prevIsWordLike = willRenderAsMathrm(prevNIS.token);
                const nextIsWordLike = willRenderAsMathrm(nextNIS.token);
                console.log(`    -> Prev is word-like: ${prevIsWordLike}, Next is word-like: ${nextIsWordLike}`);

                // Escape space if it's between two things that render as text blocks (\mathrm)
                // Or if it's adjacent to just one text block (to ensure spacing)
                if (prevIsWordLike || nextIsWordLike) {
                    escapeSpace = true;
                    // Exception: Don't escape if previous text block was part of a subscript/superscript
                    if (prevIsWordLike && !nextIsWordLike) {
                       let charBeforePrev = '';
                       let idx = prevNIS.index - 1;
                       while(idx >= 0 && tokens[idx].type === 'space'){ idx--; } // Skip spaces before the previous token
                       if(idx >= 0 && tokens[idx].type === 'other' && (tokens[idx].value === '^' || tokens[idx].value === '_')){
                           charBeforePrev = tokens[idx].value;
                       }
                       console.log(`    -> Char before prev word-like: "${charBeforePrev}"`);
                       if (charBeforePrev === '^' || charBeforePrev === '_') {
                           escapeSpace = false; // Don't escape space after sup/sub content
                           console.log("    -> Deviation applies, not escaping space.");
                       }
                    }
                }
                processedText += escapeSpace ? '\\ ' : ' '; // Append escaped or regular space
                console.log(`    -> Appended ${escapeSpace ? "'\\ '" : "' '"}`);
                break;

            default: // Should not happen if regex is comprehensive
                console.warn("[formatStringToMathDisplay FINAL] Unknown token type:", token.type, token.value);
                processedText += token.value; // Append raw value as fallback
                break;
        }
    }

    // No need to trim again as we trimmed the input and spaces are handled in the loop.
    console.log('[formatStringToMathDisplay FINAL] Final Processed Text:', processedText);

    // Check if the result is effectively empty after processing
    if (processedText.trim() === '') { return ''; }

    // *** UPDATED: Wrap in align* environment instead of $$ ***
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
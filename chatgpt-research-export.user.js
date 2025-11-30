// ==UserScript==
// @name         ChatGPT Deep Research Markdown Exporter
// @namespace    https://github.com/ckep1/chatgpt-research-export
// @version      1.5.0
// @description  Export ChatGPT deep research content with proper markdown formatting, numbered citations, and table support
// @author       Chris Kephart
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    // Function to get the base URL without fragments or query parameters.
    function getBaseUrl(url) {
        if (!deduplicateCitations) {
            return url;
        }

        try {
            const urlObj = new URL(url);
            return `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
        } catch (e) {
            return url;
        }
    }

    // Function to escape special characters in content
    function escapeContent(text) {
        return text.replace(/\$/g, '\\$');
    }

    // Function to convert HTML content to markdown
    function convertToMarkdown(element) {
        let sourceCounter = 1;
        const sourceMap = new Map(); // Track unique sources
        const headingSanitization = [
            '**',
            '*',
            '_',
        ]

        // Helper function to sanitize cell content for markdown tables
        function sanitizeCellContent(content) {
            return content
                .replace(/\|/g, '\\|')      // Escape pipe characters
                .replace(/\n/g, ' ')         // Replace newlines with spaces
                .trim();                     // Trim whitespace
        }

        // Helper function to sanitize header content for markdown tables
        function sanitizeHeadingContent(content) {
            let cleanContent = sanitizeCellContent(content);
            for (const sanitization of headingSanitization) {
                if (!cleanContent.startsWith(sanitization) || !cleanContent.endsWith(sanitization)) {
                    continue;
                }

                // Remove styling from headings, let the markdown renderer handle it gracefully
                cleanContent = cleanContent.slice(sanitization.length, -sanitization.length);
            }
            return cleanContent;
        }

        // Helper function to process tables while preserving structure
        function processTable(tableNode) {
            let headerRow = null;
            const bodyRows = [];

            // Try to get header from thead
            const thead = tableNode.querySelector('thead');
            if (thead) {
                const headerTrs = thead.querySelectorAll('tr');
                if (headerTrs.length > 1) {
                    console.warn('Table has multiple <tr> in <thead>, using only first row');
                }
                if (headerTrs.length > 0) {
                    headerRow = headerTrs[0];
                }
            }

            // Get body rows from tbody or direct tr children
            const tbody = tableNode.querySelector('tbody');
            if (tbody) {
                bodyRows.push(...tbody.querySelectorAll('tr'));
            } else {
                // No tbody, get tr elements directly from table
                const directTrs = Array.from(tableNode.children).filter(child =>
                    child.tagName.toLowerCase() === 'tr'
                );
                bodyRows.push(...directTrs);
            }

            // If no header row found in thead, use first body row as header
            if (!headerRow && bodyRows.length > 0) {
                headerRow = bodyRows.shift();
            }

            // If still no rows, return empty string
            if (!headerRow && bodyRows.length === 0) {
                console.warn('Table has no rows, skipping');
                return '';
            }

            // Process header row
            const headerCells = [];
            if (headerRow) {
                const cells = headerRow.querySelectorAll('th, td');
                for (const cell of cells) {
                    const cellContent = processNode(cell, true);
                    headerCells.push(sanitizeHeadingContent(cellContent));
                }
            }

            // If no header cells, return empty string
            if (headerCells.length === 0) {
                console.warn('Table has no header cells, skipping');
                return '';
            }

            const columnCount = headerCells.length;

            // Build markdown table
            let markdown = '';

            // Header row
            markdown += '| ' + headerCells.join(' | ') + ' |\n';

            // Separator row
            markdown += '| ' + headerCells.map(() => '---').join(' | ') + ' |\n';

            // Body rows
            for (const row of bodyRows) {
                const cells = row.querySelectorAll('th, td');
                const rowCells = [];

                for (const cell of cells) {
                    const cellContent = processNode(cell, true);
                    rowCells.push(sanitizeCellContent(cellContent));
                }

                // Handle column count mismatches
                if (rowCells.length < columnCount) {
                    const missing = columnCount - rowCells.length;
                    rowCells.push(...Array(missing).fill(''));
                    console.warn(`Table row has fewer cells than header (${rowCells.length} vs ${columnCount}), padding with empty cells`);
                } else if (rowCells.length > columnCount) {
                    console.warn(`Table row has more cells than header (${rowCells.length} vs ${columnCount}), truncating`);
                    rowCells.splice(columnCount);
                }

                markdown += '| ' + rowCells.join(' | ') + ' |\n';
            }

            return markdown + '\n';
        }

        function renderCitationLink(href, sourceNumber) {
            return ` [\[${sourceNumber}\]](${href})`;
        }
        
        function processNode(node, inTable = false) {
            if (node.nodeType === Node.TEXT_NODE) {
                return escapeContent(node.textContent);
            }

            if (node.nodeType !== Node.ELEMENT_NODE) {
                return '';
            }

            const tagName = node.tagName.toLowerCase();

            // Handle tables specially - need structure, not flattened content
            if (tagName === 'table') {
                if (inTable) {
                    console.warn('Nested table detected, skipping');
                    return '';
                }
                return processTable(node);
            }

            let content = '';

            // Process child nodes
            for (const child of node.childNodes) {
                content += processNode(child, inTable);
            }

            switch (tagName) {
                case 'h1':
                    return `# ${content.trim()}\n\n`;
                case 'h2':
                    return `## ${content.trim()}\n\n`;
                case 'h3':
                    return `### ${content.trim()}\n\n`;
                case 'h4':
                    return `#### ${content.trim()}\n\n`;
                case 'h5':
                    return `##### ${content.trim()}\n\n`;
                case 'h6':
                    return `###### ${content.trim()}\n\n`;
                case 'p':
                    return `${content.trim()}\n\n`;
                case 'strong':
                case 'b':
                    return `**${content}**`;
                case 'em':
                case 'i':
                    return `*${content}*`;
                case 'ul':
                    return `${content}\n`;
                case 'ol':
                    return `${content}\n`;
                case 'li':
                    return `- ${content.trim()}\n`;
                case 'blockquote':
                    return `> ${content.trim()}\n\n`;
                case 'code':
                    return `\`${content}\``;
                case 'pre':
                    return `\`\`\`\n${content}\n\`\`\`\n\n`;
                case 'a': {
                    const href = node.getAttribute('href');
                    if (!href) {
                        return content;
                    }

                    // Skip if this link is inside a citation span (already handled)
                    if (node.closest('span[data-state="closed"]')) {
                        return '';
                    }

                    const baseUrl = getBaseUrl(href);

                    // Check if we've seen this base URL before
                    if (!sourceMap.has(baseUrl)) {
                        sourceMap.set(baseUrl, sourceCounter);
                        sourceCounter++;
                    }

                    const sourceNumber = sourceMap.get(baseUrl);
                    return renderCitationLink(href, sourceNumber);
                }
                case 'br':
                    return '\n';
                case 'span': {
                    // Handle citation spans with data-state="closed"
                    if (node.getAttribute('data-state') !== 'closed') {
                        return content;
                    }

                    // Find the nested link
                    const link = node.querySelector('a[href]');
                    if (!link) {
                        return '';
                    }

                    const href = link.getAttribute('href');
                    const baseUrl = getBaseUrl(href);

                    // Check if we've seen this base URL before
                    if (!sourceMap.has(baseUrl)) {
                        sourceMap.set(baseUrl, sourceCounter);
                        sourceCounter++;
                    }

                    const sourceNumber = sourceMap.get(baseUrl);
                    return renderCitationLink(href, sourceNumber);
                }
                case 'thead':
                case 'tbody':
                case 'tr':
                case 'th':
                case 'td':
                    return content; // Pass through content for nested processing
                default:
                    return content;
            }
        }

        return processNode(element, false);
    }

    // Function to get today's date in YYYY-MM-DD format
    function getTodayDate() {
        const today = new Date();
        return today.toISOString().split('T')[0];
    }

    // Function to extract title from h1
    function extractTitle(researchContainer) {
        const h1 = researchContainer.querySelector('h1');
        return h1 ? h1.textContent.trim() : 'ChatGPT Research';
    }

    // Function to sanitize title for YAML frontmatter
    function sanitizeTitle(title) {
        return title
            .replace(/:/g, '-') // Replace colons with dashes
            .replace(/"/g, '\\"') // Escape double quotes
            .replace(/\\/g, '\\\\') // Escape backslashes
            .replace(/\n/g, ' ') // Replace newlines with spaces
            .replace(/\r/g, ' ') // Replace carriage returns with spaces
            .replace(/\t/g, ' ') // Replace tabs with spaces
            .replace(/\s+/g, ' ') // Collapse multiple spaces
            .trim(); // Remove leading/trailing whitespace
    }

    // Function to sanitize title for use as filename
    function sanitizeTitleForFilename(title) {
        return title
            .replace(/[<>:"/\\|?*]/g, '-') // Replace invalid filename characters
            .replace(/\s+/g, '-') // Replace spaces with dashes
            .replace(/-+/g, '-') // Collapse multiple dashes
            .replace(/^-|-$/g, '') // Remove leading/trailing dashes
            .substring(0, 100) // Limit length
            .trim() || 'chatgpt-research-export'; // Fallback if empty
    }

    // Function to get all deep research containers
    function getDeepResearchContainers() {
        return Array.from(document.querySelectorAll('.deep-research-result'));
    }

    // Function to generate frontmatter
    function generateFrontmatter(title, url) {
        const sanitizedTitle = sanitizeTitle(title);
        return `---
title: "${sanitizedTitle}"
url: ${url}
date: ${getTodayDate()}
---

`;
    }

    // Toggle frontmatter setting
    let includeFrontmatter = GM_getValue('includeFrontmatter', false);

    function toggleFrontmatter() {
        includeFrontmatter = !includeFrontmatter;
        GM_setValue('includeFrontmatter', includeFrontmatter);
        alert(`Frontmatter ${includeFrontmatter ? 'enabled' : 'disabled'}`);
        updateMenuCommand();
    }

    function updateMenuCommand() {
        // Define a "namespace" for the menu command IDs
        const namespace = 'chatgptResearchExport';
        if (!window[namespace]) {
            window[namespace] = {};
        }
        // Remove existing frontmatter menu command if it exists
        if (window[namespace].menuFrontmatterCommandId) {
            GM_unregisterMenuCommand(window[namespace].menuFrontmatterCommandId);
        }

        // Register new frontmatter menu command
        window[namespace].menuFrontmatterCommandId = GM_registerMenuCommand(
            `${includeFrontmatter ? '☑' : '☐'} Include Frontmatter`,
            toggleFrontmatter
        );

        // Remove existing deduplication menu command if it exists
        if (window[namespace].menuDeduplicateCitationsCommandId) {
            GM_unregisterMenuCommand(window[namespace].menuDeduplicateCitationsCommandId);
        }

        // Register new deduplication menu command
        window[namespace].menuDeduplicateCitationsCommandId = GM_registerMenuCommand(
            `${deduplicateCitations ? '☑' : '☐'} Deduplicate Citations`,
            toggleDeduplicateCitations
        );
    }

    // Toggle citation deduplication strategy setting
    let deduplicateCitations = GM_getValue('deduplicateCitations', true);
    function toggleDeduplicateCitations() {
        deduplicateCitations = !deduplicateCitations;
        GM_setValue('deduplicateCitations', deduplicateCitations);
        alert(`Citation deduplication ${deduplicateCitations ? 'enabled' : 'disabled'}`);
        updateMenuCommand();
    }

    // Function to export deep research content
    function exportDeepResearch(researchContainer) {
        if (!researchContainer) {
            alert('No deep research content found.');
            return;
        }

        // Convert to markdown
        let markdown = convertToMarkdown(researchContainer);

        // Clean up extra whitespace
        markdown = markdown
            .replace(/\n\s*\n\s*\n/g, '\n\n') // Remove extra blank lines
            .replace(/^\s+|\s+$/g, '') // Trim start and end
            .replace(/\n{3,}/g, '\n\n'); // Limit to maximum 2 consecutive newlines

        // Extract title for filename
        const title = extractTitle(researchContainer);

        // Add frontmatter if enabled
        if (includeFrontmatter) {
            const currentUrl = window.location.href;
            const frontmatter = generateFrontmatter(title, currentUrl);
            markdown = frontmatter + markdown;
        }

        // Create and download the file
        const blob = new Blob([markdown], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${sanitizeTitleForFilename(title)}.md`;

        // Trigger download
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        console.log(`Deep research content exported: ${link.download}`);
    }

    // Function to copy to clipboard
    function copyDeepResearchToClipboard(researchContainer) {
        if (!researchContainer) {
            alert('No deep research content found.');
            return;
        }

        let markdown = convertToMarkdown(researchContainer);

        // Clean up extra whitespace
        markdown = markdown
            .replace(/\n\s*\n\s*\n/g, '\n\n')
            .replace(/^\s+|\s+$/g, '')
            .replace(/\n{3,}/g, '\n\n');

        // Add frontmatter if enabled
        if (includeFrontmatter) {
            const title = extractTitle(researchContainer);
            const currentUrl = window.location.href;
            const frontmatter = generateFrontmatter(title, currentUrl);
            markdown = frontmatter + markdown;
        }

        navigator.clipboard.writeText(markdown).then(() => {
            alert('Deep research content copied to clipboard!');
        }).catch(() => {
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = markdown;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            alert('Deep research content copied to clipboard!');
        });
    }

    // Create a button group for export/copy actions
    function createButtonGroup(researchContainer, position) {
        const buttonGroup = document.createElement('div');
        buttonGroup.className = 'deep-research-export-buttons';
        buttonGroup.style.cssText = `
            display: flex;
            gap: 10px;
            flex-direction: row;
            justify-content: flex-start;
            ${position === 'top' ? 'margin-bottom: 16px;' : 'margin-top: 16px;'}
        `;

        // Create download button
        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'deep-research-export-btn';
        downloadBtn.textContent = 'Export Research (MD)';
        downloadBtn.style.cssText = `
            background: #10a37f;
            color: white;
            border: none;
            padding: 10px 15px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
        `;
        downloadBtn.addEventListener('click', () => exportDeepResearch(researchContainer));

        // Create copy button
        const copyBtn = document.createElement('button');
        copyBtn.className = 'deep-research-copy-btn';
        copyBtn.textContent = 'Copy Research (MD)';
        copyBtn.style.cssText = `
            background: #6366f1;
            color: white;
            border: none;
            padding: 10px 15px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
        `;
        copyBtn.addEventListener('click', () => copyDeepResearchToClipboard(researchContainer));

        buttonGroup.appendChild(downloadBtn);
        buttonGroup.appendChild(copyBtn);

        return buttonGroup;
    }

    // Add export buttons to all deep research containers
    function addExportButtonsToContainers() {
        const containers = getDeepResearchContainers();

        for (const container of containers) {
            // Skip if buttons already added (witness flag)
            if (container.dataset.exportButtonsAdded) {
                continue;
            }

            // Create and insert button group at top
            const topButtons = createButtonGroup(container, 'top');
            container.parentNode.insertBefore(topButtons, container.parentNode.firstChild);

            // Create and insert button group at bottom
            const bottomButtons = createButtonGroup(container, 'bottom');
            container.parentNode.appendChild(bottomButtons);

            // Mark container as processed
            container.dataset.exportButtonsAdded = 'true';
        }
    }

    // Watch for deep research content to appear
    function watchForResearchContent() {
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    // Check if there are any containers without buttons
                    const containers = getDeepResearchContainers();
                    const hasUnprocessedContainers = containers.some(
                        container => !container.dataset.exportButtonsAdded
                    );
                    if (hasUnprocessedContainers) {
                        addExportButtonsToContainers();
                        break;
                    }
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // Initialize
    setTimeout(() => {
        // Register menu command
        updateMenuCommand();

        addExportButtonsToContainers();
        watchForResearchContent();
    }, 2000);

})();
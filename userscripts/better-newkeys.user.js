/** @format */

// ==UserScript==
// @name         better-newkeys
// @namespace    https://github.com/Lumikeiju/openstreetmap
// @version      1.4.1
// @description  Choose the Overpass server used by editor links on OSM Latest Keys.
// @match        https://osm.janmichel.eu/taginfo/newkeys.htm
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

(function () {
    "use strict";

    const DEFAULT_SERVER = "https://overpass-api.de";
    const STORAGE_KEY = "overpass-server";
    const ORIGINAL_HREF_ATTRIBUTE = "data-better-newkeys-original-href";
    const ORIGINAL_OVERPASS_HOST = "overpass-api.de";
    const CONTROL_ID = "better-newkeys-overpass-server";
    const CREDITS_ID = "better-newkeys-credits";
    const LEVEL0_HOST = "level0.osmz.ru";
    const LEVEL0_SUPPORTED_ENDPOINTS = [
        /^overpass\.osm\.rambler\.ru\/cgi\/interpreter$/i,
        /^overpass-api\.de\/api\/interpreter$/i,
        /^api\.openstreetmap\.fr\/oapi\/interpreter$/i,
        /^overpass\.openstreetmap\.ie\/api\/interpreter$/i,
        /^dev\.overpass-api\.de\/[a-z0-9_]+\/interpreter$/i,
        /^overpass\.private\.coffee\/api\/interpreter$/i,
        /^overpass\.osm\.jp\/api\/interpreter$/i,
        /^maps\.mail\.ru\/osm\/tools\/overpass\/api\/interpreter$/i,
    ];

    function normalizeServer(value) {
        const server = value.trim();
        new URL(server);
        return server;
    }

    function joinSearchParameters(serverSearch, endpointSearch) {
        if (!serverSearch) {
            return endpointSearch;
        }

        if (!endpointSearch) {
            return serverSearch;
        }

        return `${serverSearch}&${endpointSearch.substring(1)}`;
    }

    function createServerEndpoint(server, originalEndpoint) {
        const serverUrl = new URL(server);
        const endpointUrl = new URL(originalEndpoint);
        const serverPath = serverUrl.pathname.replace(/\/+$/, "");
        const endpointPath = endpointUrl.pathname.replace(
            /^\/api(?=\/|$)/i,
            ""
        );
        const serverIncludesApi = /\/api$/i.test(serverPath);

        serverUrl.pathname = serverIncludesApi
            ? `${serverPath}${endpointPath}`
            : `${serverPath}${endpointUrl.pathname}`;
        serverUrl.search = joinSearchParameters(
            serverUrl.search,
            endpointUrl.search
        );
        serverUrl.hash = serverUrl.hash || endpointUrl.hash;

        return serverUrl.href;
    }

    function isOriginalOverpassEndpoint(url) {
        return url.hostname.toLowerCase() === ORIGINAL_OVERPASS_HOST;
    }

    function getEmbeddedOverpassEndpoint(originalHref) {
        const linkUrl = new URL(originalHref, document.baseURI);
        const embeddedEndpoint = linkUrl.searchParams.get("url");

        if (!embeddedEndpoint) {
            return null;
        }

        const endpointUrl = new URL(embeddedEndpoint);

        return isOriginalOverpassEndpoint(endpointUrl) ? endpointUrl : null;
    }

    function isJosmImportLink(linkUrl) {
        return (
            linkUrl.port === "8111" &&
            linkUrl.pathname === "/import" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(linkUrl.hostname)
        );
    }

    function isLevel0Link(linkUrl) {
        return linkUrl.hostname === LEVEL0_HOST;
    }

    function isLevel0CompatibleEndpoint(endpointUrl) {
        const hostAndPath = `${endpointUrl.hostname}${endpointUrl.pathname}`;

        return LEVEL0_SUPPORTED_ENDPOINTS.some((pattern) =>
            pattern.test(hostAndPath)
        );
    }

    function createJosmImportHref(endpointUrl) {
        return `http://localhost:8111/import?url=${endpointUrl.href}`;
    }

    function getRewrittenHref(originalHref, server) {
        const linkUrl = new URL(originalHref, document.baseURI);
        const embeddedEndpoint = getEmbeddedOverpassEndpoint(originalHref);

        if (embeddedEndpoint) {
            linkUrl.searchParams.set(
                "url",
                createServerEndpoint(server, embeddedEndpoint.href)
            );
            return linkUrl.href;
        }

        if (!isOriginalOverpassEndpoint(linkUrl)) {
            return null;
        }

        return createServerEndpoint(server, linkUrl.href);
    }

    function getJosmImportHref(editorCell, server) {
        for (const link of editorCell.querySelectorAll("a")) {
            const originalHref =
                link.getAttribute(ORIGINAL_HREF_ATTRIBUTE) ??
                link.getAttribute("href");

            if (!originalHref) {
                continue;
            }

            try {
                const endpointUrl = getEmbeddedOverpassEndpoint(originalHref);

                if (endpointUrl) {
                    return createJosmImportHref(
                        new URL(createServerEndpoint(server, endpointUrl.href))
                    );
                }
            } catch {
                continue;
            }
        }

        return null;
    }

    function getEditorColumnIndex(table) {
        const headerRow = table.querySelector("tr");

        if (!headerRow) {
            return -1;
        }

        return Array.from(headerRow.cells).findIndex(
            (cell) => cell.textContent.trim() === "Editor"
        );
    }

    function rewriteEditorLinks(editorSurface, server) {
        const editorColumnIndex = getEditorColumnIndex(editorSurface);

        if (editorColumnIndex === -1) {
            return { rewrittenLinkCount: 0, skippedLevel0LinkCount: 0 };
        }

        let rewrittenLinkCount = 0;
        let skippedLevel0LinkCount = 0;

        editorSurface.querySelectorAll("tr").forEach((row) => {
            const editorCell = row.cells[editorColumnIndex];

            if (!editorCell) {
                return;
            }

            editorCell.querySelectorAll("a").forEach((link) => {
                const editorOption = link.textContent.trim();
                const editorOptionMatch = editorOption.match(/^\(([^()]+)\)$/);
                const originalHref =
                    link.getAttribute(ORIGINAL_HREF_ATTRIBUTE) ??
                    link.getAttribute("href");

                if (editorOptionMatch) {
                    link.textContent = editorOptionMatch[1];
                }

                if (!originalHref) {
                    return;
                }

                try {
                    const linkUrl = new URL(originalHref, document.baseURI);
                    const embeddedEndpoint =
                        getEmbeddedOverpassEndpoint(originalHref);

                    if (
                        isLevel0Link(linkUrl) &&
                        embeddedEndpoint &&
                        !isLevel0CompatibleEndpoint(
                            new URL(
                                createServerEndpoint(
                                    server,
                                    embeddedEndpoint.href
                                )
                            )
                        )
                    ) {
                        link.setAttribute(
                            ORIGINAL_HREF_ATTRIBUTE,
                            originalHref
                        );
                        link.setAttribute("href", originalHref);
                        skippedLevel0LinkCount += 1;
                        return;
                    }

                    const rewrittenHref = isJosmImportLink(linkUrl)
                        ? getJosmImportHref(editorCell, server)
                        : getRewrittenHref(originalHref, server);

                    if (!rewrittenHref) {
                        return;
                    }

                    link.setAttribute(ORIGINAL_HREF_ATTRIBUTE, originalHref);
                    link.setAttribute("href", rewrittenHref);
                    rewrittenLinkCount += 1;
                } catch {
                    return;
                }
            });
        });

        return { rewrittenLinkCount, skippedLevel0LinkCount };
    }

    function addServerControl(editorSurface, savedServer, insertionPoint) {
        const form = document.createElement("form");
        const label = document.createElement("label");
        const input = document.createElement("input");
        const saveButton = document.createElement("button");
        const status = document.createElement("output");

        form.id = CONTROL_ID;

        label.htmlFor = "better-newkeys-overpass-server-input";
        label.textContent = "Overpass Server";

        input.id = "better-newkeys-overpass-server-input";
        input.type = "text";
        input.value = savedServer;
        input.autocomplete = "url";
        input.inputMode = "url";
        input.placeholder = "https://overpass.example/api/";
        input.spellcheck = false;

        saveButton.type = "submit";
        saveButton.textContent = "Save";

        status.className = "better-newkeys-status";
        status.setAttribute("aria-live", "polite");

        form.append(label, input, saveButton, status);
        insertionPoint.parentNode.insertBefore(form, insertionPoint);

        input.addEventListener("input", () => {
            input.setCustomValidity("");
            status.textContent = "";
        });

        form.addEventListener("submit", (event) => {
            event.preventDefault();

            try {
                const server = normalizeServer(input.value);
                input.setCustomValidity("");
                input.value = server;
                GM_setValue(STORAGE_KEY, server);
                const { rewrittenLinkCount, skippedLevel0LinkCount } =
                    rewriteEditorLinks(editorSurface, server);
                status.textContent = `Saved. ${rewrittenLinkCount} editor links updated.${skippedLevel0LinkCount ? ` Level0 keeps its original server because it cannot load this endpoint.` : ""}`;
            } catch {
                input.setCustomValidity("Enter a valid URL.");
                input.reportValidity();
            }
        });
    }

    function getSavedServer() {
        try {
            return normalizeServer(GM_getValue(STORAGE_KEY, DEFAULT_SERVER));
        } catch {
            return DEFAULT_SERVER;
        }
    }

    function findNewKeysTable() {
        return Array.from(document.querySelectorAll("table")).find(
            (table) => getEditorColumnIndex(table) !== -1
        );
    }

    function splitTableIntoColumns(table) {
        const tableBody = table.tBodies[0];

        if (!table.tHead || !tableBody || tableBody.rows.length < 2) {
            return table;
        }

        const rows = Array.from(tableBody.rows);
        const secondTable = table.cloneNode(false);
        const secondTableBody = tableBody.cloneNode(false);
        const columns = document.createElement("div");

        secondTable.append(table.tHead.cloneNode(true), secondTableBody);
        rows.slice(Math.ceil(rows.length / 2)).forEach((row) => {
            secondTableBody.append(row);
        });

        columns.className = "better-newkeys-table-columns";
        table.parentNode.insertBefore(columns, table);
        columns.append(table, secondTable);

        return columns;
    }

    function addTableScrollContainer(content) {
        const container = document.createElement("div");

        container.className = "better-newkeys-table-scroll";
        content.parentNode.insertBefore(container, content);
        container.append(content);

        return container;
    }

    function compareRowsByColumn(leftRow, rightRow, columnIndex) {
        const leftValue = leftRow.cells[columnIndex]?.textContent.trim() ?? "";
        const rightValue =
            rightRow.cells[columnIndex]?.textContent.trim() ?? "";

        if (leftValue === rightValue) {
            return 0;
        }

        if (!leftValue) {
            return 1;
        }

        if (!rightValue) {
            return -1;
        }

        const leftNumber = Number(leftValue);
        const rightNumber = Number(rightValue);

        if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
            return leftNumber - rightNumber;
        }

        return leftValue.localeCompare(rightValue, undefined, {
            numeric: true,
            sensitivity: "base",
        });
    }

    function addTableSorting(tableColumns) {
        const tables = Array.from(
            tableColumns.querySelectorAll(":scope > table")
        );

        if (tables.length !== 2) {
            return;
        }

        const tableBodies = tables.map((table) => table.tBodies[0]);
        let sortedColumnIndex = -1;
        let sortDirection = 1;

        tables.forEach((table) => {
            Array.from(table.tHead.rows[0].cells).forEach((headerCell) => {
                headerCell.tabIndex = 0;
                headerCell.setAttribute("aria-sort", "none");
                headerCell.title = `Sort by ${headerCell.textContent.trim()}`;
            });
        });

        function sortRows(headerCell) {
            const columnIndex = Array.from(
                headerCell.parentElement.cells
            ).indexOf(headerCell);

            sortDirection =
                columnIndex === sortedColumnIndex ? -sortDirection : 1;
            sortedColumnIndex = columnIndex;

            const rows = tables.flatMap((table) =>
                Array.from(table.tBodies[0].rows)
            );
            rows.sort(
                (leftRow, rightRow) =>
                    sortDirection *
                    compareRowsByColumn(leftRow, rightRow, columnIndex)
            );

            const firstColumnRowCount = Math.ceil(rows.length / 2);
            rows.forEach((row, index) => {
                tableBodies[index < firstColumnRowCount ? 0 : 1].append(row);
            });

            tables.forEach((table) => {
                Array.from(table.tHead.rows[0].cells).forEach(
                    (tableHeaderCell, index) => {
                        tableHeaderCell.setAttribute(
                            "aria-sort",
                            index === sortedColumnIndex
                                ? sortDirection === 1
                                    ? "ascending"
                                    : "descending"
                                : "none"
                        );
                    }
                );
            });
        }

        tableColumns.addEventListener(
            "click",
            (event) => {
                const headerCell = event.target.closest("thead th, thead td");

                if (!headerCell || !tableColumns.contains(headerCell)) {
                    return;
                }

                event.preventDefault();
                event.stopImmediatePropagation();
                sortRows(headerCell);
            },
            true
        );

        tableColumns.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== " ") {
                return;
            }

            const headerCell = event.target.closest("thead th, thead td");

            if (!headerCell || !tableColumns.contains(headerCell)) {
                return;
            }

            event.preventDefault();
            sortRows(headerCell);
        });
    }

    function addCredits(insertionPoint) {
        const credits = document.createElement("footer");
        const originalSite = document.createElement("a");
        const updateSite = document.createElement("a");

        credits.id = CREDITS_ID;

        originalSite.href = "https://osm.janmichel.eu/";
        originalSite.textContent = "osm.janmichel.eu";
        originalSite.target = "_blank";
        originalSite.rel = "noopener noreferrer";

        updateSite.href = "https://lumikeiju.dev/";
        updateSite.textContent = "lumikeiju.dev";
        updateSite.target = "_blank";
        updateSite.rel = "noopener noreferrer";

        credits.append(
            "Created by: Jan Michel - ",
            originalSite,
            " • BetterNewTags: Lumikeiju - ",
            updateSite
        );
        insertionPoint.after(credits);
    }

    function addStyles() {
        GM_addStyle(`
            :root {
                color-scheme: light;
                --better-newkeys-ink: #18332b;
                --better-newkeys-muted: #536862;
                --better-newkeys-line: #cbd8d2;
                --better-newkeys-surface: #ffffff;
                --better-newkeys-surface-alt: #f2f7f4;
                --better-newkeys-accent: #1c7655;
                --better-newkeys-accent-strong: #14583f;
                --better-newkeys-focus: #186f94;
            }

            html {
                box-sizing: border-box;
                background: #eaf1ee;
            }

            *,
            *::before,
            *::after {
                box-sizing: inherit;
            }

            body {
                min-width: 0;
                max-width: 1440px;
                margin: 0 auto;
                padding: 2.5rem 1rem 4rem;
                color: var(--better-newkeys-ink);
                background: #f7faf8;
                font: 0.9375rem/1.5 "Segoe UI", "Helvetica Neue", sans-serif;
            }

            h1 {
                margin: 0 0 1.25rem;
                color: #123c2d;
                font-size: 1.875rem;
                font-weight: 700;
                letter-spacing: 0;
                line-height: 1.15;
            }

            p {
                max-width: 74rem;
                margin: 0.625rem 0;
            }

            body > p:nth-of-type(2) {
                padding: 0.875rem 1rem;
                border-left: 3px solid #70a88f;
                background: #edf6f0;
                color: #304c41;
                font-size: 0.875rem;
            }

            a {
                color: #176b8d;
                text-decoration-color: #8ab4c4;
                text-underline-offset: 0.15em;
            }

            a:hover {
                color: #0e5270;
                text-decoration-thickness: 2px;
            }

            a:focus-visible,
            input:focus-visible,
            button:focus-visible {
                outline: 3px solid var(--better-newkeys-focus);
                outline-offset: 2px;
            }

            .better-newkeys-table-scroll {
                max-width: 100%;
                margin-top: 1rem;
                overflow-x: auto;
                scrollbar-color: #8caaa0 transparent;
            }

            .better-newkeys-table-columns {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 1rem;
                min-width: 85rem;
            }

            table {
                width: 100%;
                min-width: 42rem;
                margin: 0;
                border: 1px solid var(--better-newkeys-line);
                border-collapse: separate;
                border-spacing: 0;
                background: var(--better-newkeys-surface);
                box-shadow: 0 1px 2px rgb(21 59 44 / 8%);
                font-size: 0.875rem;
            }

            table thead tr {
                position: sticky;
                top: 0;
                z-index: 1;
                background: #dcebe3;
                color: #173d2e;
                font-size: 0.75rem;
                letter-spacing: 0;
                text-transform: uppercase;
            }

            table thead tr > * {
                border-bottom: 1px solid #afc9bb;
            }

            .better-newkeys-table-columns table thead th,
            .better-newkeys-table-columns table thead td {
                cursor: pointer;
            }

            .better-newkeys-table-columns table thead th:focus-visible,
            .better-newkeys-table-columns table thead td:focus-visible {
                outline: 3px solid var(--better-newkeys-focus);
                outline-offset: -3px;
            }

            table th,
            table td {
                padding: 0.45rem 0.625rem;
                border-right: 1px solid #e1eae5;
                text-align: left;
                vertical-align: top;
            }

            table th:last-child,
            table td:last-child {
                border-right: 0;
            }

            table td {
                border-bottom: 1px solid #e7eeea;
            }

            table tr:nth-child(even) td {
                background: var(--better-newkeys-surface-alt);
            }

            table tbody tr:hover td {
                background: #e2f1e9;
            }

            table tr:last-child td {
                border-bottom: 0;
            }

            table td:first-child {
                width: 62%;
                font-weight: 600;
                overflow-wrap: anywhere;
            }

            table td:nth-child(2),
            table td:nth-child(3),
            table td:nth-child(4) {
                font-variant-numeric: tabular-nums;
                white-space: nowrap;
            }

            table td:last-child {
                white-space: nowrap;
            }

            table td:last-child a {
                display: inline-block;
                margin-right: 0.25rem;
                padding: 0.1rem 0.2rem;
                border-radius: 3px;
                color: #195c45;
                font-weight: 700;
                text-decoration: none;
            }

            table td:last-child a:hover,
            table td:last-child a:focus-visible {
                background: #cae5d6;
            }

            #${CONTROL_ID} {
                display: grid;
                grid-template-columns: auto minmax(18rem, 1fr) auto;
                align-items: center;
                gap: 0.625rem;
                margin: 1.5rem 0 0;
                padding: 1rem;
                border: 1px solid #b9d2c4;
                border-radius: 6px;
                background: #e8f3ed;
                box-shadow: 0 1px 2px rgb(21 59 44 / 6%);
            }

            #${CONTROL_ID} input,
            #${CONTROL_ID} button {
                box-sizing: border-box;
                font: inherit;
            }

            #${CONTROL_ID} input {
                min-width: 0;
                min-height: 2.5rem;
                padding: 0.5rem 0.625rem;
                border: 1px solid #9bbcaf;
                border-radius: 4px;
                color: var(--better-newkeys-ink);
                background: var(--better-newkeys-surface);
            }

            #${CONTROL_ID} button {
                min-height: 2.5rem;
                padding: 0.5rem 0.875rem;
                border: 1px solid var(--better-newkeys-accent-strong);
                border-radius: 4px;
                color: #ffffff;
                background: var(--better-newkeys-accent);
                font-weight: 700;
                cursor: pointer;
            }

            #${CONTROL_ID} button:hover {
                background: var(--better-newkeys-accent-strong);
            }

            #${CONTROL_ID} label {
                color: #234738;
                font-size: 0.8125rem;
                font-weight: 700;
                letter-spacing: 0;
                text-transform: uppercase;
            }

            #${CONTROL_ID} .better-newkeys-status {
                grid-column: 2 / -1;
                color: var(--better-newkeys-muted);
                font-size: 0.8125rem;
            }

            #${CREDITS_ID} {
                margin-top: 1.25rem;
                padding-top: 0.875rem;
                border-top: 1px solid var(--better-newkeys-line);
                color: var(--better-newkeys-muted);
                font-size: 0.8125rem;
            }

            @media (max-width: 560px) {
                body {
                    max-width: none;
                    padding-right: 0.5rem;
                    padding-left: 0.5rem;
                    padding-top: 1.5rem;
                }

                h1 {
                    font-size: 1.5rem;
                }

                table {
                    font-size: 0.8125rem;
                    min-width: 42rem;
                }

                table th,
                table td {
                    padding: 0.4rem;
                }

                table td:first-child {
                    width: auto;
                }

                #${CONTROL_ID} {
                    grid-template-columns: minmax(0, 1fr) auto;
                }

                #${CONTROL_ID} label {
                    grid-column: 1 / -1;
                }

                #${CONTROL_ID} .better-newkeys-status {
                    grid-column: 1 / -1;
                }
            }

            @media (max-width: 86rem) {
                .better-newkeys-table-columns {
                    grid-template-columns: minmax(0, 1fr);
                    min-width: 42rem;
                }
            }
        `);
    }

    const table = findNewKeysTable();

    if (!table || document.getElementById(CONTROL_ID)) {
        return;
    }

    const savedServer = getSavedServer();
    addStyles();
    const tableColumns = splitTableIntoColumns(table);
    const tableContainer = addTableScrollContainer(tableColumns);
    addTableSorting(tableColumns);
    addServerControl(tableContainer, savedServer, tableContainer);
    rewriteEditorLinks(tableContainer, savedServer);
    addCredits(tableContainer);
})();

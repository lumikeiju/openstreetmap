/** @format */

// ==UserScript==
// @name         better-newkeys
// @namespace    https://github.com/Lumikeiju/openstreetmap
// @version      1.7.3
// @description  Choose the Overpass server, theme, table font, and addressed keys on OSM Latest Keys.
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
  const THEME_STORAGE_KEY = "theme";
  const MONOSPACE_STORAGE_KEY = "monospace";
  const ADDRESSED_KEYS_STORAGE_KEY = "addressed-keys";
  const LIGHT_THEME = "light";
  const DARK_THEME = "dark";
  const DEFAULT_MONOSPACE = true;
  const NEXT_FONT = "atkinson-hyperlegible-next";
  const MONOSPACE_FONT = "atkinson-hyperlegible-mono";
  const ORIGINAL_HREF_ATTRIBUTE = "data-better-newkeys-original-href";
  const ORIGINAL_OVERPASS_HOST = "overpass-api.de";
  const CONTROL_ID = "better-newkeys-overpass-server";
  const THEME_TOGGLE_ID = "better-newkeys-theme-toggle";
  const MONOSPACE_TOGGLE_ID = "better-newkeys-monospace-toggle";
  const ADDRESSED_COLUMN_CLASS = "better-newkeys-addressed-column";
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

  function isHttpUrl(url) {
    return url.protocol === "http:" || url.protocol === "https:";
  }

  function normalizeServer(value) {
    const server = value.trim();
    const serverUrl = new URL(server);

    if (!isHttpUrl(serverUrl)) {
      throw new TypeError("The Overpass server must use HTTP or HTTPS.");
    }

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
    const endpointPath = endpointUrl.pathname.replace(/^\/api(?=\/|$)/i, "");
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
    return (
      isHttpUrl(url) && url.hostname.toLowerCase() === ORIGINAL_OVERPASS_HOST
    );
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
      isHttpUrl(linkUrl) &&
      linkUrl.port === "8111" &&
      linkUrl.pathname === "/import" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(linkUrl.hostname)
    );
  }

  function isLevel0Link(linkUrl) {
    return isHttpUrl(linkUrl) && linkUrl.hostname === LEVEL0_HOST;
  }

  function isLevel0CompatibleEndpoint(endpointUrl) {
    const hostAndPath = `${endpointUrl.hostname}${endpointUrl.pathname}`;

    return LEVEL0_SUPPORTED_ENDPOINTS.some((pattern) =>
      pattern.test(hostAndPath)
    );
  }

  function createJosmImportHref(endpointUrl) {
    const josmUrl = new URL("http://localhost:8111/import");

    josmUrl.searchParams.set("url", endpointUrl.href);

    return josmUrl.href;
  }

  function getRewrittenHref(originalHref, server) {
    const linkUrl = new URL(originalHref, document.baseURI);
    const embeddedEndpoint = getEmbeddedOverpassEndpoint(originalHref);

    if (embeddedEndpoint && isHttpUrl(linkUrl)) {
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
        link.getAttribute(ORIGINAL_HREF_ATTRIBUTE) ?? link.getAttribute("href");

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
          const embeddedEndpoint = getEmbeddedOverpassEndpoint(originalHref);

          if (
            isLevel0Link(linkUrl) &&
            embeddedEndpoint &&
            !isLevel0CompatibleEndpoint(
              new URL(createServerEndpoint(server, embeddedEndpoint.href))
            )
          ) {
            link.setAttribute(ORIGINAL_HREF_ATTRIBUTE, originalHref);
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

  function addServerControl(
    editorSurface,
    savedServer,
    savedTheme,
    savedMonospace,
    insertionPoint
  ) {
    const form = document.createElement("form");
    const label = document.createElement("label");
    const input = document.createElement("input");
    const saveButton = document.createElement("button");
    const appearanceToggles = document.createElement("div");
    const themeLabel = document.createElement("label");
    const themeToggle = document.createElement("input");
    const themeText = document.createElement("span");
    const monospaceLabel = document.createElement("label");
    const monospaceToggle = document.createElement("input");
    const monospaceText = document.createElement("span");
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

    appearanceToggles.className = "better-newkeys-appearance-toggles";

    themeLabel.className = "better-newkeys-appearance-toggle";
    themeLabel.htmlFor = THEME_TOGGLE_ID;

    themeToggle.id = THEME_TOGGLE_ID;
    themeToggle.type = "checkbox";
    themeToggle.checked = savedTheme === DARK_THEME;
    themeToggle.setAttribute("role", "switch");
    themeToggle.setAttribute("aria-checked", String(themeToggle.checked));

    themeText.textContent = "Dark mode";
    themeLabel.append(themeToggle, themeText);

    monospaceLabel.className = "better-newkeys-appearance-toggle";
    monospaceLabel.htmlFor = MONOSPACE_TOGGLE_ID;

    monospaceToggle.id = MONOSPACE_TOGGLE_ID;
    monospaceToggle.type = "checkbox";
    monospaceToggle.checked = savedMonospace;
    monospaceToggle.setAttribute("role", "switch");
    monospaceToggle.setAttribute(
      "aria-checked",
      String(monospaceToggle.checked)
    );

    monospaceText.textContent = "Monospace";
    monospaceLabel.append(monospaceToggle, monospaceText);

    appearanceToggles.append(themeLabel, monospaceLabel);

    status.className = "better-newkeys-status";
    status.setAttribute("aria-live", "polite");

    form.append(label, input, saveButton, appearanceToggles, status);
    insertionPoint.parentNode.insertBefore(form, insertionPoint);

    input.addEventListener("input", () => {
      input.setCustomValidity("");
      status.textContent = "";
    });

    themeToggle.addEventListener("change", () => {
      const theme = themeToggle.checked ? DARK_THEME : LIGHT_THEME;

      applyTheme(theme);
      themeToggle.setAttribute("aria-checked", String(themeToggle.checked));
      GM_setValue(THEME_STORAGE_KEY, theme);
    });

    monospaceToggle.addEventListener("change", () => {
      const monospace = monospaceToggle.checked;

      applyTableFont(monospace);
      monospaceToggle.setAttribute(
        "aria-checked",
        String(monospaceToggle.checked)
      );
      GM_setValue(MONOSPACE_STORAGE_KEY, monospace);
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();

      let server;

      try {
        server = normalizeServer(input.value);
      } catch {
        input.setCustomValidity("Enter a valid HTTP or HTTPS URL.");
        input.reportValidity();
        return;
      }

      input.setCustomValidity("");
      input.value = server;
      GM_setValue(STORAGE_KEY, server);
      const { rewrittenLinkCount, skippedLevel0LinkCount } = rewriteEditorLinks(
        editorSurface,
        server
      );
      status.textContent = `Saved. ${rewrittenLinkCount} editor links updated.${skippedLevel0LinkCount ? ` Level0 keeps its original server because it cannot load this endpoint.` : ""}`;
    });
  }

  function getSavedServer() {
    try {
      return normalizeServer(GM_getValue(STORAGE_KEY, DEFAULT_SERVER));
    } catch {
      return DEFAULT_SERVER;
    }
  }

  function getSavedTheme() {
    try {
      return GM_getValue(THEME_STORAGE_KEY, DARK_THEME) === DARK_THEME
        ? DARK_THEME
        : LIGHT_THEME;
    } catch {
      return DARK_THEME;
    }
  }

  function getSavedMonospace() {
    try {
      return GM_getValue(MONOSPACE_STORAGE_KEY, DEFAULT_MONOSPACE) === true;
    } catch {
      return DEFAULT_MONOSPACE;
    }
  }

  function applyTheme(theme) {
    document.documentElement.dataset.betterNewkeysTheme = theme;
  }

  function applyTableFont(monospace) {
    document.documentElement.dataset.betterNewkeysTableFont = monospace
      ? MONOSPACE_FONT
      : NEXT_FONT;
  }

  function getAddressedKeys() {
    try {
      const addressedKeys = GM_getValue(ADDRESSED_KEYS_STORAGE_KEY, []);

      return new Set(
        Array.isArray(addressedKeys)
          ? addressedKeys.filter(
              (addressedKey) => typeof addressedKey === "string"
            )
          : []
      );
    } catch {
      return new Set();
    }
  }

  function saveAddressedKeys(addressedKeys) {
    GM_setValue(ADDRESSED_KEYS_STORAGE_KEY, Array.from(addressedKeys).sort());
  }

  function addAddressedCheckboxes(table, addressedKeys) {
    const headerRow = table.tHead?.rows[0];
    const tableBody = table.tBodies[0];

    if (!headerRow || !tableBody) {
      return;
    }

    const headerCell = document.createElement("th");

    headerCell.className = ADDRESSED_COLUMN_CLASS;
    headerCell.scope = "col";
    headerCell.title = "Addressed";
    headerCell.setAttribute("aria-label", "Addressed");
    headerRow.insertBefore(headerCell, headerRow.firstChild);

    Array.from(tableBody.rows).forEach((row) => {
      const keyCell = row.cells[0];
      const key = keyCell?.textContent.trim();

      if (!key) {
        return;
      }

      const cell = document.createElement("td");
      const checkbox = document.createElement("input");

      cell.className = ADDRESSED_COLUMN_CLASS;
      checkbox.type = "checkbox";
      checkbox.checked = addressedKeys.has(key);
      checkbox.setAttribute("aria-label", `Mark ${key} as addressed`);

      if (!keyCell.title) {
        keyCell.title = key;
      }

      cell.append(checkbox);
      row.insertBefore(cell, row.firstChild);

      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          addressedKeys.add(key);
        } else {
          addressedKeys.delete(key);
        }

        saveAddressedKeys(addressedKeys);
      });
    });
  }

  function fixTableHeaders(table) {
    const headerRow = table.tHead?.rows[0];

    if (!headerRow) {
      return;
    }

    const expandedLabels = new Map([
      ["FirstSeen", "First Seen"],
      ["LastSeen", "Last Seen"],
    ]);

    Array.from(headerRow.cells).forEach((headerCell) => {
      const expandedLabel = expandedLabels.get(headerCell.textContent.trim());

      if (expandedLabel) {
        headerCell.textContent = expandedLabel;
      }
    });
  }

  function findNewKeysTable() {
    return Array.from(document.querySelectorAll("table")).find(
      (table) => getEditorColumnIndex(table) !== -1
    );
  }

  function splitTableIntoColumns(table) {
    const headerRow = table.tHead?.rows[0];
    const tableBody = table.tBodies[0];

    if (!headerRow || !tableBody || tableBody.rows.length < 2) {
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

  function compareRowsByColumn(leftRow, rightRow, columnIndex, sortDirection) {
    const leftValue = leftRow.cells[columnIndex]?.textContent.trim() ?? "";
    const rightValue = rightRow.cells[columnIndex]?.textContent.trim() ?? "";

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
      return sortDirection * (leftNumber - rightNumber);
    }

    return (
      sortDirection *
      leftValue.localeCompare(rightValue, undefined, {
        numeric: true,
        sensitivity: "base",
      })
    );
  }

  function addTableSorting(tableColumns) {
    const tables = Array.from(tableColumns.querySelectorAll(":scope > table"));
    const headers = tables.map((table) => table.tHead?.rows[0]);
    const tableBodies = tables.map((table) => table.tBodies[0]);

    if (
      tables.length !== 2 ||
      headers.some((header) => !header) ||
      tableBodies.some((tableBody) => !tableBody)
    ) {
      return;
    }

    let sortedColumnIndex = -1;
    let sortDirection = 1;

    headers.forEach((headerRow) => {
      Array.from(headerRow.cells).forEach((headerCell) => {
        if (headerCell.classList.contains(ADDRESSED_COLUMN_CLASS)) {
          return;
        }

        headerCell.tabIndex = 0;
        headerCell.setAttribute("aria-sort", "none");
        headerCell.title = `Sort by ${headerCell.textContent.trim()}`;
      });
    });

    function sortRows(headerCell) {
      const columnIndex = Array.from(headerCell.parentElement.cells).indexOf(
        headerCell
      );

      sortDirection = columnIndex === sortedColumnIndex ? -sortDirection : 1;
      sortedColumnIndex = columnIndex;

      const rows = tables.flatMap((table) => Array.from(table.tBodies[0].rows));
      rows.sort((leftRow, rightRow) =>
        compareRowsByColumn(leftRow, rightRow, columnIndex, sortDirection)
      );

      const firstColumnRowCount = Math.ceil(rows.length / 2);
      rows.forEach((row, index) => {
        tableBodies[index < firstColumnRowCount ? 0 : 1].append(row);
      });

      headers.forEach((headerRow) => {
        Array.from(headerRow.cells).forEach((tableHeaderCell, index) => {
          if (tableHeaderCell.classList.contains(ADDRESSED_COLUMN_CLASS)) {
            return;
          }

          tableHeaderCell.setAttribute(
            "aria-sort",
            index === sortedColumnIndex
              ? sortDirection === 1
                ? "ascending"
                : "descending"
              : "none"
          );
        });
      });
    }

    tableColumns.addEventListener(
      "click",
      (event) => {
        const headerCell = event.target.closest("thead th, thead td");

        if (
          !headerCell ||
          !tableColumns.contains(headerCell) ||
          headerCell.classList.contains(ADDRESSED_COLUMN_CLASS)
        ) {
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

      if (
        !headerCell ||
        !tableColumns.contains(headerCell) ||
        headerCell.classList.contains(ADDRESSED_COLUMN_CLASS)
      ) {
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
            @import url("https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible+Mono:wght@400;500;600;700&family=Atkinson+Hyperlegible+Next:wght@400;500;600;700&display=swap");

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
                --better-newkeys-page-edge: #eaf1ee;
                --better-newkeys-page: #f7faf8;
                --better-newkeys-heading: #123c2d;
                --better-newkeys-notice-border: #70a88f;
                --better-newkeys-notice-surface: #edf6f0;
                --better-newkeys-notice-ink: #304c41;
                --better-newkeys-link: #176b8d;
                --better-newkeys-link-hover: #0e5270;
                --better-newkeys-link-decoration: #8ab4c4;
                --better-newkeys-scrollbar: #8caaa0;
                --better-newkeys-table-head-surface: #dcebe3;
                --better-newkeys-table-head-ink: #173d2e;
                --better-newkeys-table-head-line: #afc9bb;
                --better-newkeys-cell-line: #e1eae5;
                --better-newkeys-cell-bottom-line: #e7eeea;
                --better-newkeys-row-hover: #e2f1e9;
                --better-newkeys-editor-link: #195c45;
                --better-newkeys-editor-link-hover: #cae5d6;
                --better-newkeys-control-line: #b9d2c4;
                --better-newkeys-control-surface: #e8f3ed;
                --better-newkeys-input-line: #9bbcaf;
                --better-newkeys-label: #234738;
                --better-newkeys-on-accent: #ffffff;
                --better-newkeys-shadow: rgb(21 59 44 / 8%);
                --better-newkeys-control-shadow: rgb(21 59 44 / 6%);
                --better-newkeys-row-height: 2.75rem;
            }

            :root[data-better-newkeys-theme="dark"] {
                color-scheme: dark;
                --better-newkeys-ink: #e3eee7;
                --better-newkeys-muted: #a8bbb1;
                --better-newkeys-line: #3f564b;
                --better-newkeys-surface: #1b2b24;
                --better-newkeys-surface-alt: #21352d;
                --better-newkeys-row-ink: #ffffff;
                --better-newkeys-accent: #319b6d;
                --better-newkeys-accent-strong: #58c793;
                --better-newkeys-focus: #70d2f4;
                --better-newkeys-page-edge: #0d1512;
                --better-newkeys-page: #14201b;
                --better-newkeys-heading: #e6f4eb;
                --better-newkeys-notice-border: #5aa77f;
                --better-newkeys-notice-surface: #213b2e;
                --better-newkeys-notice-ink: #c7ded2;
                --better-newkeys-link: #78c7e8;
                --better-newkeys-link-hover: #a5ddf3;
                --better-newkeys-link-decoration: #5a96aa;
                --better-newkeys-scrollbar: #678b7e;
                --better-newkeys-table-head-surface: #2a4338;
                --better-newkeys-table-head-ink: #d8ebe0;
                --better-newkeys-table-head-line: #537362;
                --better-newkeys-cell-line: #334b40;
                --better-newkeys-cell-bottom-line: #2e4339;
                --better-newkeys-row-hover: #294b3d;
                --better-newkeys-editor-link: #9bd7b9;
                --better-newkeys-editor-link-hover: #315d48;
                --better-newkeys-control-line: #4c6b5b;
                --better-newkeys-control-surface: #1d3429;
                --better-newkeys-input-line: #59796a;
                --better-newkeys-label: #d4e8dc;
                --better-newkeys-on-accent: #0e2419;
                --better-newkeys-shadow: rgb(0 0 0 / 30%);
                --better-newkeys-control-shadow: rgb(0 0 0 / 25%);
            }

            html {
                box-sizing: border-box;
                background: var(--better-newkeys-page-edge);
            }

            *,
            *::before,
            *::after {
                box-sizing: inherit;
            }

            body {
                min-width: 0;
                max-width: 1920px;
                margin: 0 auto;
                padding: 2.5rem 1rem 4rem;
                color: var(--better-newkeys-ink);
                background: var(--better-newkeys-page);
                font: 0.9375rem/1.5 "Atkinson Hyperlegible Next", sans-serif;
            }

            h1 {
                margin: 0 0 1.25rem;
                color: var(--better-newkeys-heading);
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
                border-left: 3px solid var(--better-newkeys-notice-border);
                background: var(--better-newkeys-notice-surface);
                color: var(--better-newkeys-notice-ink);
                font-size: 0.875rem;
            }

            a {
                color: var(--better-newkeys-link);
                text-decoration-color: var(--better-newkeys-link-decoration);
                text-underline-offset: 0.15em;
            }

            a:hover {
                color: var(--better-newkeys-link-hover);
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
                scrollbar-color: var(--better-newkeys-scrollbar) transparent;
            }

            .better-newkeys-table-columns {
                display: grid;
                align-items: start;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 1rem;
                width: 100%;
                min-width: 0;
            }

            table {
                width: 100%;
                min-width: 0;
                margin: 0;
                border: 1px solid var(--better-newkeys-line);
                border-collapse: separate;
                border-spacing: 0;
                background: var(--better-newkeys-surface);
                box-shadow: 0 1px 2px var(--better-newkeys-shadow);
                font-family: "Atkinson Hyperlegible Next", sans-serif;
                font-size: 0.875rem;
                table-layout: fixed;
            }

            :root[data-better-newkeys-table-font="atkinson-hyperlegible-mono"] table {
                font-family: "Atkinson Hyperlegible Mono", monospace;
            }

            table thead tr,
            table td:last-child,
            table td:last-child a {
                font-family: "Atkinson Hyperlegible Next", sans-serif !important;
            }

            table tbody td:nth-child(3),
            table tbody td:nth-child(4),
            table tbody td:nth-child(5) {
                font-family: "Atkinson Hyperlegible Mono", monospace !important;
            }

            table thead tr {
                position: sticky;
                top: 0;
                z-index: 1;
                background: var(--better-newkeys-table-head-surface);
                color: var(--better-newkeys-table-head-ink);
                font-size: 0.75rem;
                letter-spacing: 0;
                text-transform: uppercase;
                white-space: nowrap;
            }

            table thead tr > * {
                border-bottom: 1px solid var(--better-newkeys-table-head-line);
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
                height: var(--better-newkeys-row-height);
                padding: 0.45rem 0.625rem;
                border-right: 1px solid var(--better-newkeys-cell-line);
                text-align: left;
                vertical-align: middle;
            }

            table th:last-child,
            table td:last-child {
                border-right: 0;
            }

            table td {
                border-bottom: 1px solid var(--better-newkeys-cell-bottom-line);
            }

            table tr:nth-child(even) td {
                background: var(--better-newkeys-surface-alt);
            }

            table tbody tr:hover td {
                background: var(--better-newkeys-row-hover);
            }

            table tr:last-child td {
                border-bottom: 0;
            }

            table th.better-newkeys-addressed-column,
            table td.better-newkeys-addressed-column {
                width: 2.5rem;
                min-width: 2.5rem;
                padding-right: 0.375rem;
                padding-left: 0.375rem;
                text-align: center;
                vertical-align: middle;
            }

            .better-newkeys-table-columns table th.better-newkeys-addressed-column {
                cursor: default;
            }

            table td.better-newkeys-addressed-column input[type="checkbox"] {
                width: 1.125rem;
                height: 1.125rem;
                margin: 0;
                accent-color: var(--better-newkeys-accent);
                cursor: pointer;
            }

            table th:nth-child(2),
            table td:nth-child(2) {
                width: auto;
            }

            table th:nth-child(3),
            table td:nth-child(3) {
                width: 4.5rem;
            }

            table th:nth-child(4),
            table td:nth-child(4),
            table th:nth-child(5),
            table td:nth-child(5) {
                width: 7rem;
            }

            table th:nth-child(6),
            table td:nth-child(6) {
                width: 6rem;
                min-width: 6rem;
            }

            table td:nth-child(2) {
                font-weight: 700 !important;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            table td:nth-child(2) a {
                font-weight: 700 !important;
            }

            table td:nth-child(3),
            table td:nth-child(4),
            table td:nth-child(5) {
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
                color: var(--better-newkeys-editor-link);
                font-weight: 700;
                text-decoration: none;
            }

            table td:last-child a:hover,
            table td:last-child a:focus-visible {
                background: var(--better-newkeys-editor-link-hover);
            }

            :root[data-better-newkeys-theme="dark"] table tbody tr,
            :root[data-better-newkeys-theme="dark"] table tbody tr td {
                background: var(--better-newkeys-surface) !important;
                color: var(--better-newkeys-row-ink) !important;
            }

            :root[data-better-newkeys-theme="dark"] table tbody tr:nth-child(even),
            :root[data-better-newkeys-theme="dark"] table tbody tr:nth-child(even) td {
                background: var(--better-newkeys-surface-alt) !important;
            }

            :root[data-better-newkeys-theme="dark"] table tbody tr:hover,
            :root[data-better-newkeys-theme="dark"] table tbody tr:hover td {
                background: var(--better-newkeys-row-hover) !important;
            }

            :root[data-better-newkeys-theme="dark"] table thead tr,
            :root[data-better-newkeys-theme="dark"] table thead tr > * {
                background: var(--better-newkeys-table-head-surface) !important;
                color: var(--better-newkeys-row-ink) !important;
            }

            :root[data-better-newkeys-theme="dark"] table tbody tr td a,
            :root[data-better-newkeys-theme="dark"] table tbody tr td a:hover,
            :root[data-better-newkeys-theme="dark"] table tbody tr td a:focus-visible {
                color: var(--better-newkeys-row-ink) !important;
            }

            #${CONTROL_ID} {
                display: grid;
                grid-template-columns: auto minmax(18rem, 1fr) auto auto;
                align-items: center;
                gap: 0.75rem 1rem;
                margin: 1.5rem 0 0;
                padding: 1.25rem 1.5rem;
                border: 1px solid var(--better-newkeys-control-line);
                border-radius: 6px;
                background: var(--better-newkeys-control-surface);
                box-shadow: 0 1px 2px var(--better-newkeys-control-shadow);
            }

            #${CONTROL_ID} > input,
            #${CONTROL_ID} > button {
                box-sizing: border-box;
                font: inherit;
            }

            #${CONTROL_ID} > input {
                min-width: 0;
                min-height: 2.5rem;
                padding: 0.5rem 0.625rem;
                border: 1px solid var(--better-newkeys-input-line);
                border-radius: 4px;
                color: var(--better-newkeys-ink);
                background: var(--better-newkeys-surface);
            }

            #${CONTROL_ID} button {
                min-height: 2.5rem;
                padding: 0.5rem 0.875rem;
                border: 1px solid var(--better-newkeys-accent-strong);
                border-radius: 4px;
                color: var(--better-newkeys-on-accent);
                background: var(--better-newkeys-accent);
                font-weight: 700;
                cursor: pointer;
            }

            #${CONTROL_ID} button:hover {
                background: var(--better-newkeys-accent-strong);
            }

            #${CONTROL_ID} label {
                color: var(--better-newkeys-label);
                font-size: 0.8125rem;
                font-weight: 700;
                letter-spacing: 0;
                text-transform: uppercase;
            }

            #${CONTROL_ID} .better-newkeys-appearance-toggles {
                display: inline-flex;
                flex-direction: column;
                align-items: flex-start;
                gap: 0.5rem;
            }

            #${CONTROL_ID} .better-newkeys-appearance-toggle {
                display: inline-flex;
                align-items: center;
                gap: 0.5rem;
                cursor: pointer;
                text-transform: none;
                white-space: nowrap;
            }

            #${CONTROL_ID} .better-newkeys-appearance-toggle input {
                appearance: none;
                width: 2.5rem;
                height: 1.375rem;
                margin: 0;
                border: 1px solid var(--better-newkeys-input-line);
                border-radius: 999px;
                background: var(--better-newkeys-surface);
                cursor: pointer;
                position: relative;
            }

            #${CONTROL_ID} .better-newkeys-appearance-toggle input::before {
                content: "";
                position: absolute;
                top: 0.125rem;
                left: 0.125rem;
                width: 0.875rem;
                height: 0.875rem;
                border-radius: 50%;
                background: var(--better-newkeys-muted);
                transition: transform 150ms ease, background 150ms ease;
            }

            #${CONTROL_ID} .better-newkeys-appearance-toggle input:checked {
                border-color: var(--better-newkeys-accent-strong);
                background: var(--better-newkeys-accent);
            }

            #${CONTROL_ID} .better-newkeys-appearance-toggle input:checked::before {
                background: var(--better-newkeys-on-accent);
                transform: translateX(1.125rem);
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
                    min-width: 44rem;
                }

                table th,
                table td {
                    padding: 0.4rem;
                }

                table td:nth-child(2) {
                    width: auto;
                }

                #${CONTROL_ID} {
                    grid-template-columns: minmax(0, 1fr) auto;
                    gap: 0.75rem;
                    padding: 1.125rem 1rem;
                }

                #${CONTROL_ID} label {
                    grid-column: 1 / -1;
                }

                #${CONTROL_ID} .better-newkeys-appearance-toggles {
                    grid-column: 1 / -1;
                    justify-self: end;
                }

                #${CONTROL_ID} .better-newkeys-status {
                    grid-column: 1 / -1;
                }
            }

            @media (max-width: 86rem) {
                .better-newkeys-table-columns {
                    grid-template-columns: minmax(0, 1fr);
                    min-width: 0;
                }
            }
        `);
  }

  const table = findNewKeysTable();

  if (!table || document.getElementById(CONTROL_ID)) {
    return;
  }

  const savedServer = getSavedServer();
  const savedTheme = getSavedTheme();
  const savedMonospace = getSavedMonospace();
  const addressedKeys = getAddressedKeys();
  applyTheme(savedTheme);
  applyTableFont(savedMonospace);
  addStyles();
  fixTableHeaders(table);
  addAddressedCheckboxes(table, addressedKeys);
  const tableColumns = splitTableIntoColumns(table);
  const tableContainer = addTableScrollContainer(tableColumns);
  addTableSorting(tableColumns);
  addServerControl(
    tableContainer,
    savedServer,
    savedTheme,
    savedMonospace,
    tableContainer
  );
  rewriteEditorLinks(tableContainer, savedServer);
  addCredits(tableContainer);
})();

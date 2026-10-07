export const MANAGER_STATE_SCRIPT = `mw:() => {
  const manager = window.docManager;
  const requiredManager = ["pageCount"];
  const requiredPage = ["load", "display", "loadFonts", "turnOnImages"];
  const missing = [];
  if (!manager) return {title: document.title, pageCount: 0, sizes: [], missing: ["window.docManager"]};
  for (const name of requiredManager) {
    if (typeof manager[name] !== "function") missing.push(\`docManager.\${name}\`);
  }
  const pages = Object.values(manager.pages || {}).filter(Boolean).sort((a, b) => a.pageNum - b.pageNum);
  const sample = pages[0];
  for (const name of requiredPage) {
    if (!sample || typeof sample[name] !== "function") missing.push(\`page.\${name}\`);
  }
  for (const page of pages) {
    if (!page.containerElem || typeof page.origWidth !== "number" || typeof page.origHeight !== "number") {
      missing.push(\`page.\${page.pageNum}.shape\`);
    }
  }
  return {
    title: document.title.replace(/\\s*[|\\-]\\s*Scribd.*$/i, "").trim(),
    pageCount: typeof manager.pageCount === "function" ? manager.pageCount() : 0,
    sizes: pages.map((page) => [page.origWidth, page.origHeight]),
    missing: Array.from(new Set(missing)),
  };
}`;

export const LOAD_BATCH_SCRIPT = `mw:async ({start, end}) => {
  const manager = window.docManager;
  manager._removeUnusedPages = () => {};
  const pages = Object.values(manager.pages || {}).filter(Boolean).sort((a, b) => a.pageNum - b.pageNum);
  const batch = pages.slice(start, end);
  await Promise.all(batch.map(async (page) => {
    const fontResult = page.loadFonts();
    if (fontResult && typeof fontResult.then === "function") await fontResult;
    if (!page.innerPageElem && !page.loadHasStarted) {
      const loadResult = page.load();
      if (loadResult && typeof loadResult.then === "function") await loadResult;
    }
  }));
  const deadline = Date.now() + 45000;
  while (batch.some((page) => !page.innerPageElem || !page.innerPageElem.isConnected)) {
    if (Date.now() >= deadline) throw new Error(\`pages \${start + 1}-\${end} did not finish loading\`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  for (const page of batch) {
    page.display();
    page.turnOnImages();
  }
  return batch.map((page) => page.pageNum);
}`;

export const BATCH_READY_SCRIPT = `mw:({start, end}) => {
  const pages = Object.values(window.docManager.pages || {}).filter(Boolean).sort((a, b) => a.pageNum - b.pageNum);
  return pages.slice(start, end).every((page) => {
    const inner = page.innerPageElem;
    if (!inner || !inner.isConnected || inner.childElementCount === 0) return false;
    return Array.from(inner.querySelectorAll("img")).every(
      (image) => image.complete && image.naturalWidth > 0
    );
  });
}`;

export const LOAD_DOCUMENT_FONTS_SCRIPT = `mw:async () => {
  const manifest = window.docManager._fontLoader?.fonts;
  if (!manifest || typeof manifest !== "object") throw new Error("font manifest is unavailable");
  const fonts = Object.values(manifest);
  let timer;
  try {
    await Promise.race([
      Promise.all(fonts.map(async (font) => {
        const url = new URL(font.url);
        if (url.protocol !== "https:" ||
            !(url.hostname === "scribdassets.com" || url.hostname.endsWith(".scribdassets.com"))) {
          throw new Error("unsupported document font source");
        }
        const face = new FontFace(font.family, "url(" + JSON.stringify(url.href) + ")", {
          weight: font.weight || "normal",
          style: font.style || "normal",
        });
        try {
          await face.load();
        } catch {
          throw new Error("document font failed: " + font.family);
        }
        document.fonts.add(face);
      })),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("document fonts timed out")), 45000);
      }),
    ]);
    await document.fonts.ready;
    return {loaded: fonts.length};
  } finally {
    clearTimeout(timer);
  }
}`;

export const PREPARE_EXPORT_SCRIPT = `mw:({pageCount}) => {
  const manager = window.docManager;
  const pages = Object.values(manager.pages || {}).filter(Boolean).sort((a, b) => a.pageNum - b.pageNum);
  if (pages.length !== pageCount) throw new Error(\`expected \${pageCount} pages, got \${pages.length}\`);
  const layouts = pages.map((page) => {
    const rect = page.containerElem.getBoundingClientRect();
    // Some Scribd pages already overflow their nominal paper before exporting.
    // Include those pixels instead of cropping content or ignoring the final layout check.
    const borderWidth = Math.max(0, rect.width - page.containerElem.clientWidth);
    const borderHeight = Math.max(0, rect.height - page.containerElem.clientHeight);
    return {
      page,
      width: Math.max(rect.width, page.containerElem.scrollWidth + borderWidth),
      height: Math.max(rect.height, page.containerElem.scrollHeight + borderHeight),
    };
  });
  const width = Math.max(...layouts.map((layout) => layout.width));
  const height = Math.max(...layouts.map((layout) => layout.height));

  const root = document.createElement("main");
  root.id = "scribddock-pages";
  for (const {page, width: pageWidth, height: pageHeight} of layouts) {
    const element = page.containerElem;
    element.style.setProperty("box-sizing", "border-box", "important");
    element.style.setProperty("width", \`\${pageWidth}px\`, "important");
    element.style.setProperty("height", \`\${pageHeight}px\`, "important");
    element.style.setProperty("min-width", \`\${pageWidth}px\`, "important");
    element.style.setProperty("min-height", \`\${pageHeight}px\`, "important");
    root.appendChild(element);
  }
  document.body.replaceChildren(root);

  const style = document.createElement("style");
  style.id = "scribddock-export-style";
  style.textContent = \`
    @page { size: \${width}px \${height}px; margin: 0; }
    html, body, #scribddock-pages {
      margin: 0 !important; padding: 0 !important; width: \${width}px !important;
      height: auto !important; overflow: visible !important; background: white !important;
    }
    #scribddock-pages > * {
      display: block !important; position: relative !important;
      margin: 0 !important;
      break-after: page; page-break-after: always;
      overflow: visible !important; box-shadow: none !important;
    }
    #scribddock-pages > *:last-child {
      break-after: auto; page-break-after: auto;
    }
  \`;
  document.head.appendChild(style);
  void root.offsetHeight;

  const layoutFailures = [];
  const format = (value) => Number.isInteger(value) ? String(value) : value.toFixed(2);
  for (const {page, width: pageWidth, height: pageHeight} of layouts) {
    const element = page.containerElem;
    const rect = element.getBoundingClientRect();
    if (Math.abs(rect.width - pageWidth) > 0.5 || Math.abs(rect.height - pageHeight) > 0.5) {
      layoutFailures.push(
        \`page \${page.pageNum} border box changed from \${format(pageWidth)}x\${format(pageHeight)} \` +
        \`to \${format(rect.width)}x\${format(rect.height)}\`
      );
    }
    if (element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight) {
      layoutFailures.push(
        \`page \${page.pageNum} content \${element.scrollWidth}x\${element.scrollHeight} exceeds visible box \` +
        \`\${element.clientWidth}x\${element.clientHeight}\`
      );
    }
  }
  return {renderedPages: root.children.length, width, height, layoutFailures};
}`;

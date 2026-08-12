<script>

__CHROM_BLOCK_MAP__

document.addEventListener("DOMContentLoaded", function() {
  setTimeout(function() {
    const container = document.querySelector("div.girafe_container_std");
    if (!container) { console.warn("container not found"); return; }
    const svg = container.querySelector("svg");
    if (!svg) { console.warn("svg not found"); return; }

    const bgRect = svg.querySelector("rect.ggiraph-svg-bg");
    if (bgRect) bgRect.style.pointerEvents = "none";

    // Let the browser's native SVG hit testing identify ribbons and
    // chromosomes. The chromosome segments are later in the SVG, so they
    // retain priority wherever they overlap a ribbon.
    const ribbonPolys = Array.from(svg.querySelectorAll("polygon[data-id]"));
    const ribbonsById = new Map();
    ribbonPolys.forEach(function(poly) {
      const blockId = poly.getAttribute("data-id");
      poly.classList.add("ntsynt-ribbon-hit");
      if (!ribbonsById.has(blockId)) ribbonsById.set(blockId, []);
      ribbonsById.get(blockId).push(poly);
    });

    let chromSegs = Array.from(svg.querySelectorAll("line[data-id], [data-id].chromosome"));
    chromSegs.forEach(function(seg) {
      seg.classList.add("ntsynt-chromosome-hit");
    });

    // Retain the original five-pixel chromosome priority area. There are
    // comparatively few chromosomes, so this small scan is inexpensive.
    function refreshChromosomeRects() {
      chromSegs = chromSegs.map(function(item) {
        const element = item.element || item;
        return { element: element, rect: element.getBoundingClientRect() };
      });
    }
    refreshChromosomeRects();

    let resizeTimer = null;
    function scheduleChromosomeRectRefresh() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(refreshChromosomeRects, 150);
    }
    window.addEventListener("resize", scheduleChromosomeRectRefresh, true);
    window.addEventListener("scroll", scheduleChromosomeRectRefresh, true);

    const interactionStyles = document.createElement("style");
    interactionStyles.textContent = [
      ".ntsynt-ribbon-hit { pointer-events: fill !important; cursor:default !important; }",
      ".ntsynt-chromosome-hit { pointer-events: stroke !important; cursor:default !important; }",
      ".ntsynt-ribbon-hit.ntsynt-legend-selected { opacity:0.9 !important; fill-opacity:0.9 !important; }",
      ".ntsynt-ribbon-hit.ntsynt-legend-inactive { opacity:0.6 !important; fill:white !important; fill-opacity:0.6 !important; }",
      ".ntsynt-ribbon-hit.ntsynt-hovered { stroke:black !important; stroke-width:1 !important; opacity:1 !important; fill:darkgrey !important; fill-opacity:0.3 !important; }"
    ].join("\n");
    document.head.appendChild(interactionStyles);

    // --- Manual ribbon tooltip ---
    // We need our own tooltip div since we bypassed ggiraph for ribbons
    let pinnedRibbonId = null;

    const ribbonTip = document.createElement("div");
    ribbonTip.style.cssText = [
      "position:fixed",
      "left:0",
      "top:0",
      "display:none",
      "background:rgba(255,255,255,0.9)",
      "padding:10px",
      "border:1px solid black",
      "border-radius:4px",
      "font-family:monospace",
      "font-size:16px",
      "pointer-events:none",
      "z-index:9999",
      "max-width:900px",
      "white-space:pre-wrap"
    ].join(";");

    const contentDiv = document.createElement("div");
    contentDiv.className = "ribbon-tip-content";

    const controlsDiv = document.createElement("div");
    controlsDiv.className = "ribbon-tip-controls";
    controlsDiv.style.cssText = "display:none;margin-top:6px;text-align:right;";
    controlsDiv.innerHTML =
      '<button class="ribbon-tip-copy" style="font-size:14px;margin-right:4px;">Copy</button>' +
      '<button class="ribbon-tip-close" style="font-size:14px;">✕</button>';

    ribbonTip.appendChild(contentDiv);
    ribbonTip.appendChild(controlsDiv);
    document.body.appendChild(ribbonTip);

    controlsDiv.querySelector(".ribbon-tip-copy").addEventListener("click", function(e) {
      e.stopPropagation();
      navigator.clipboard.writeText(contentDiv.innerText).then(function() {
        const btn = controlsDiv.querySelector(".ribbon-tip-copy");
        const old = btn.textContent;
        btn.textContent = "Copied!";
        setTimeout(function() { btn.textContent = old; }, 1200);
      });
    });

    controlsDiv.querySelector(".ribbon-tip-close").addEventListener("click", function(e) {
      e.stopPropagation();
      unpinTooltip();
    });

    function closestSvgElement(event, selector) {
      if (!event.target || !event.target.closest) return null;
      const element = event.target.closest(selector);
      return element && svg.contains(element) ? element : null;
    }

    function getChromosomeUnderCursor(event) {
      const nativeTarget = closestSvgElement(event, "line[data-id], [data-id].chromosome");
      if (nativeTarget) return nativeTarget;

      const padding = 5;
      for (let i = 0; i < chromSegs.length; i++) {
        const item = chromSegs[i];
        const rect = item.rect;
        if (
          event.clientX >= rect.left - padding && event.clientX <= rect.right + padding &&
          event.clientY >= rect.top  - padding && event.clientY <= rect.bottom + padding
        ) {
          return item.element;
        }
      }
      return null;
    }

    function getRibbonUnderCursor(event) {
      return closestSvgElement(event, "polygon.ntsynt-ribbon-hit[data-id]");
    }

    let hoveredRibbonId = null;

    // Hover changes normally affect only the previous and current block,
    // rather than every ribbon in the plot.
    function setHoveredRibbon(blockId) {
      const nextId = blockId === null || blockId === undefined ? null : String(blockId);
      if (nextId === hoveredRibbonId) return false;

      if (hoveredRibbonId !== null) {
        (ribbonsById.get(hoveredRibbonId) || []).forEach(function(poly) {
          poly.classList.remove("ntsynt-hovered");
        });
      }
      if (nextId !== null) {
        (ribbonsById.get(nextId) || []).forEach(function(poly) {
          poly.classList.add("ntsynt-hovered");
        });
      }
      hoveredRibbonId = nextId;
      return true;
    }

    function positionRibbonTooltip(event) {
      // Keep the tooltip in the viewport half opposite the cursor. Percentage
      // translations are relative to the tooltip itself, so this requires no
      // geometry read (and therefore no forced layout) while the mouse moves.
      const x = event.clientX <= window.innerWidth / 2
        ? `calc(${event.clientX}px + 14px)`
        : `calc(${event.clientX}px - 100% - 14px)`;
      const y = event.clientY <= window.innerHeight / 2
        ? `calc(${event.clientY}px + 14px)`
        : `calc(${event.clientY}px - 100% - 14px)`;

      ribbonTip.style.transform = `translate3d(${x}, ${y}, 0)`;
    }

    function hideRibbonTooltip() {
      ribbonTip.style.display = "none";
    }

    function getElementTooltip(element) {
      const id = element.getAttribute("data-id");
      if (element.matches("polygon.ntsynt-ribbon-hit")) {
        return blockTooltipMap[id] || null;
      }

      const titleElement = element.querySelector ? element.querySelector("title") : null;
      const rawText = (titleElement ? titleElement.innerHTML : null)
        || element.getAttribute("title")
        || element.getAttribute("data-original-title");
      if (!rawText) return null;

      const decoder = document.createElement("textarea");
      decoder.innerHTML = rawText;
      return decoder.value.replace(/<br\s*\/?\s*>/gi, "\n");
    }

    // ---------------------------------------------------------------
    // PERF: throttle mousemove handling to once per animation frame.
    // Native mousemove can fire far more often than the screen repaints;
    // without this, the full hit-testing pipeline below runs many times
    // per rendered frame for no visible benefit.
    // ---------------------------------------------------------------
    let pendingMoveEvent = null;
    let moveRafScheduled = false;

    function onMouseMove(e) {
      if (pinnedRibbonId) return; // frozen while pinned

      if (getChromosomeUnderCursor(e)) {
        hideRibbonTooltip();
        setHoveredRibbon(null);
        return;
      }

      const poly = getRibbonUnderCursor(e);
      if (poly) {
        const hoveredId = poly.getAttribute("data-id");
        const hoverChanged = setHoveredRibbon(hoveredId);
        const tooltipText = blockTooltipMap[hoveredId];
        if (tooltipText) {
          if (hoverChanged) contentDiv.textContent = tooltipText;
          controlsDiv.style.display = "none";
          ribbonTip.style.display = "block";
          positionRibbonTooltip(e);
        } else {
          hideRibbonTooltip();
        }
      } else {
        hideRibbonTooltip();
        setHoveredRibbon(null);
      }
    }

    function scheduleMouseMove(e) {
      pendingMoveEvent = e;
      if (!moveRafScheduled) {
        moveRafScheduled = true;
        requestAnimationFrame(function() {
          moveRafScheduled = false;
          onMouseMove(pendingMoveEvent);
        });
      }
    }

    container.addEventListener("mousemove", scheduleMouseMove, true);

    container.addEventListener("mouseleave", function() {
      if (pinnedRibbonId) return;
      hideRibbonTooltip();
      setHoveredRibbon(null);
    }, true);

    // ---- Legend click / chromosome filtering ----
    const legendChromMap = {};
    const legendEntries = [];
    svg.querySelectorAll("text").forEach(function(t) {
      const chrom = t.textContent.trim();
      if (chromBlockMap[chrom]) {
        legendChromMap[chrom] = chromBlockMap[chrom];
        t.classList.add("ntsynt-legend-label");
        t.dataset.chrom = chrom;
        t.style.setProperty("pointer-events", "all", "important");
        t.style.cursor = "pointer";
        legendEntries.push({ chrom: chrom, element: t });
      }
    });

    const activeChromosomes = new Set();

    // Legend changes are infrequent, so updating the transparent interactive
    // ribbon layer here does not affect ordinary hover performance.
    function applyLegendState() {
        const activeBlockIds = new Set();

        activeChromosomes.forEach(function(c) {
            legendChromMap[c].forEach(function(bid) {
              activeBlockIds.add(String(bid));
            });
        });

        ribbonPolys.forEach(function(poly) {
          const bid = poly.getAttribute("data-id");

          if (activeChromosomes.size === 0) {
            poly.classList.remove("ntsynt-legend-selected", "ntsynt-legend-inactive");
          } else if (activeBlockIds.has(bid)) {
            poly.classList.add("ntsynt-legend-selected");
            poly.classList.remove("ntsynt-legend-inactive");
          } else {
            poly.classList.add("ntsynt-legend-inactive");
            poly.classList.remove("ntsynt-legend-selected");
          }
        });
    }

    function pinTooltip(el, e) {
      const tooltipText = getElementTooltip(el);
      if (!tooltipText) return;

      pinnedRibbonId = el.getAttribute("data-id");
      contentDiv.textContent = tooltipText;
      controlsDiv.style.display = "block";
      ribbonTip.style.pointerEvents = "auto";
      ribbonTip.style.userSelect = "text";
      ribbonTip.style.display = "block";
      positionRibbonTooltip(e);

      if (el.tagName && el.tagName.toLowerCase() === "polygon") {
        setHoveredRibbon(pinnedRibbonId);
      } else {
        setHoveredRibbon(null);
      }
    }

    function unpinTooltip() {
      pinnedRibbonId = null;
      ribbonTip.style.display = "none";
      ribbonTip.style.pointerEvents = "none";
      controlsDiv.style.display = "none";
      setHoveredRibbon(null);
    }

    function inBBox(el, e, padding = 5) {
      const bbox = el.getBoundingClientRect();
      return e.clientX >= bbox.left - padding && e.clientX <= bbox.right  + padding &&
             e.clientY >= bbox.top  - padding && e.clientY <= bbox.bottom + padding;
    }

    function findLegendChrom(e) {
      const label = closestSvgElement(e, "text.ntsynt-legend-label");
      if (label) return label.dataset.chrom;

      // Do not rely solely on SVG pointer-event rules: ggiraph normally
      // disables pointer events on non-interactive text. This inexpensive
      // fallback only scans the small number of chromosome legend labels.
      for (let i = 0; i < legendEntries.length; i++) {
        const entry = legendEntries[i];
        if (inBBox(entry.element, e)) return entry.chrom;
      }

      // Preserve support for clicks on a legend key rectangle.
      const els = document.elementsFromPoint(e.clientX, e.clientY);
      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        if (el === container || el.tagName === "DIV") break;
        if (el.tagName && el.tagName.toLowerCase() === "text") {
          const chrom = el.textContent.trim();
          if (legendChromMap[chrom] && inBBox(el, e)) return chrom;
        }
        if (el.tagName && el.tagName.toLowerCase() === "rect") {
          const parentG = el.closest("g");
          if (parentG) {
            const directTexts = Array.from(parentG.childNodes)
              .filter(n => n.tagName && n.tagName.toLowerCase() === "text");
            for (let t of directTexts) {
              const chrom = t.textContent.trim();
              if (legendChromMap[chrom] && inBBox(t, e)) return chrom;
            }
          }
        }
      }
      return null;
    }

    function handleChromClick(chrom) {
      if (activeChromosomes.has(chrom)) {
        activeChromosomes.delete(chrom);
      } else {
        activeChromosomes.add(chrom);
      }

      legendEntries.forEach(function(entry) {
        const t = entry.element;
        const c = entry.chrom;
        if (activeChromosomes.has(c)) {
          t.style.fontWeight = "bold";
          t.style.textDecoration = "underline";
          t.style.fill = "black";
        } else if (activeChromosomes.size > 0) {
          t.style.fontWeight = "normal";
          t.style.textDecoration = "none";
          t.style.fill = "#888888";
        } else {
          t.style.fontWeight = "normal";
          t.style.textDecoration = "none";
          t.style.fill = "";
        }
      });

      applyLegendState();
    }

    container.addEventListener("click", function(e) {
      const chrom = findLegendChrom(e);
      if (chrom) { handleChromClick(chrom); return; }

      if (pinnedRibbonId && ribbonTip.contains(e.target)) return; // let buttons work

      const chromSeg = getChromosomeUnderCursor(e);
      if (chromSeg) {
        pinTooltip(chromSeg, e);
        return;
      }

      const poly = getRibbonUnderCursor(e);
      if (poly) {
        pinTooltip(poly, e);
      } else if (pinnedRibbonId) {
        unpinTooltip();
      }
    }, true);



  }, 500);
});
</script>

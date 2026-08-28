<script>

__CHROM_BLOCK_MAP__

document.addEventListener("DOMContentLoaded", function() {
  setTimeout(function() {
    const container = document.querySelector("div.girafe_container_std");
    if (!container) { console.warn("container not found"); return; }
    const svg = container.querySelector("svg");
    if (!svg) { console.warn("svg not found"); return; }
    const webglPickingMode = window.ntsyntWebGLPickingMode === true;

    const bgRect = svg.querySelector("rect.ggiraph-svg-bg");
    if (bgRect) bgRect.style.pointerEvents = "none";

    // Let the browser's native SVG hit testing identify ribbons and
    // chromosomes. The chromosome segments are later in the SVG, so they
    // retain priority wherever they overlap a ribbon.
    const ribbonPolys = webglPickingMode
      ? []
      : Array.from(svg.querySelectorAll("polygon[data-id]"));
    const ribbonsById = new Map();
    ribbonPolys.forEach(function(poly, index) {
      const blockId = poly.getAttribute("data-id");
      if (blockId === null || blockId === undefined || blockId === "undefined") return;
      // ggiraph uses data-id to activate its own hover handler. Ribbons are
      // handled entirely below, so move their IDs to a private attribute to
      // prevent both hover systems from processing the same pointer events.
      if (!webglPickingMode) {
        poly.setAttribute("data-ntsynt-id", blockId);
        poly.removeAttribute("data-id");
        poly.classList.add("ntsynt-ribbon-hit");
      }
      poly._ntsyntBlockId = blockId;
      poly._ntsyntTooltip = blockTooltipMap[blockId] || null;
      if (!ribbonsById.has(blockId)) ribbonsById.set(blockId, []);
      ribbonsById.get(blockId).push(poly);
    });

    svg.querySelectorAll("line[data-id], [data-id].chromosome").forEach(function(seg) {
      seg.classList.add("ntsynt-chromosome-hit");
    });

    // Render hover feedback in a separate, lightweight SVG so changing the
    // highlight does not invalidate the very large ggiraph SVG underneath.
    const svgNS = "http://www.w3.org/2000/svg";
    const hoverOverlay = document.createElementNS(svgNS, "svg");
    hoverOverlay.setAttribute("viewBox", svg.getAttribute("viewBox"));
    hoverOverlay.setAttribute("preserveAspectRatio",
      svg.getAttribute("preserveAspectRatio") || "xMidYMid meet");
    hoverOverlay.setAttribute("aria-hidden", "true");
    hoverOverlay.style.cssText = [
      "position:absolute",
      "inset:0",
      "width:100%",
      "height:100%",
      "pointer-events:none",
      "overflow:hidden",
      "z-index:2",
      "contain:layout style paint"
    ].join(";");

    if (window.getComputedStyle(container).position === "static") {
      container.style.position = "relative";
    }

    const hoverOverlayRoot = document.createElementNS(svgNS, "g");
    hoverOverlay.appendChild(hoverOverlayRoot);

    // Reproduce the ribbon panel's clip in the overlay, using a unique ID.
    let hoverPathParent = hoverOverlayRoot;
    if (ribbonPolys.length > 0) {
      const ribbonLayer = ribbonPolys[0].parentNode;
      const clipReference = ribbonLayer.getAttribute("clip-path") || "";
      const clipMatch = clipReference.match(/^url\(#(.+)\)$/);
      if (clipMatch) {
        const originalClip = document.getElementById(clipMatch[1]);
        if (originalClip) {
          const overlayDefs = document.createElementNS(svgNS, "defs");
          const overlayClip = originalClip.cloneNode(true);
          const overlayClipId = "ntsynt-hover-clip";
          overlayClip.setAttribute("id", overlayClipId);
          overlayDefs.appendChild(overlayClip);
          hoverOverlay.insertBefore(overlayDefs, hoverOverlayRoot);

          hoverPathParent = document.createElementNS(svgNS, "g");
          hoverPathParent.setAttribute("clip-path", `url(#${overlayClipId})`);
          hoverOverlayRoot.appendChild(hoverPathParent);
        }
      }
    }

    const ribbonHoverPath = document.createElementNS(svgNS, "path");
    ribbonHoverPath.setAttribute("fill", "darkgrey");
    ribbonHoverPath.setAttribute("fill-opacity", "0.3");
    ribbonHoverPath.setAttribute("stroke", "black");
    ribbonHoverPath.setAttribute("stroke-width", "1");
    ribbonHoverPath.setAttribute("stroke-linejoin", "round");
    ribbonHoverPath.setAttribute("stroke-linecap", "butt");
    ribbonHoverPath.setAttribute("pointer-events", "none");
    ribbonHoverPath.setAttribute("d", "");
    hoverPathParent.appendChild(ribbonHoverPath);
    container.appendChild(hoverOverlay);

    // ggiraph applies zooming to its root group. Mirror that transform on the
    // lightweight overlay without modifying the main SVG.
    const mainSvgRoot = svg.querySelector("g.ggiraph-svg-rootg");
    function syncHoverOverlayTransform() {
      const transform = mainSvgRoot ? mainSvgRoot.getAttribute("transform") : null;
      if (transform) {
        hoverOverlayRoot.setAttribute("transform", transform);
      } else {
        hoverOverlayRoot.removeAttribute("transform");
      }
    }
    syncHoverOverlayTransform();
    if (mainSvgRoot) {
      new MutationObserver(syncHoverOverlayTransform).observe(mainSvgRoot, {
        attributes: true,
        attributeFilter: ["transform"]
      });
    }
    const ribbonHoverPathCache = new Map();

    const interactionStyles = document.createElement("style");
    interactionStyles.textContent = [
      ".ntsynt-ribbon-hit { pointer-events: fill !important; cursor:default !important; }",
      ".ntsynt-chromosome-hit { pointer-events: stroke !important; cursor:default !important; stroke-width:14px !important; vector-effect:non-scaling-stroke; }",
      ".ntsynt-ribbon-hit.ntsynt-legend-selected { opacity:0.9 !important; fill-opacity:0.9 !important; }",
      ".ntsynt-ribbon-hit.ntsynt-legend-inactive { opacity:0.6 !important; fill:white !important; fill-opacity:0.6 !important; }",
      ".ntsynt-ribbon-visual.ntsynt-legend-selected { opacity:0.9 !important; fill-opacity:0.9 !important; }",
      ".ntsynt-ribbon-visual.ntsynt-legend-inactive { opacity:0.6 !important; fill:white !important; fill-opacity:0.6 !important; }",
      ".ntsynt-ggiraph-tooltip-suppressed { opacity:0 !important; }"
    ].join("\n");
    document.head.appendChild(interactionStyles);

    // --- Manual ribbon tooltip ---
    // We need our own tooltip div since we bypassed ggiraph for ribbons
    let pinnedRibbonId = null;
    let plotInteractionFrozen = false;

    // ggiraph owns chromosome hover tooltips independently of the ribbon
    // tooltip below. Freeze its pointer handlers and tooltip while a custom
    // tooltip is pinned so the rest of the plot remains inert.
    const ggiraphTooltip = document.getElementsByClassName("tooltip_" + svg.id)[0] || null;
    // In WebGL mode chromosome hover uses the same deterministic custom
    // tooltip as ribbons. Keeping ggiraph's tooltip suppressed avoids its
    // delayed transition and stale-position state showing through at (0, 0).
    if (webglPickingMode && ggiraphTooltip) {
      ggiraphTooltip.classList.add("ntsynt-ggiraph-tooltip-suppressed");
    }

    function setPlotInteractionFrozen(frozen) {
      if (frozen === plotInteractionFrozen) return;

      if (frozen) {
        // Clear ggiraph's current hover target before pointer events are
        // suppressed, then keep its tooltip hidden during any fade-out.
        svg.dispatchEvent(new Event("pointerout", { bubbles: true }));
        plotInteractionFrozen = true;
        if (ggiraphTooltip) {
          ggiraphTooltip.classList.add("ntsynt-ggiraph-tooltip-suppressed");
        }
      } else {
        plotInteractionFrozen = false;
        if (ggiraphTooltip && !webglPickingMode) {
          ggiraphTooltip.classList.remove("ntsynt-ggiraph-tooltip-suppressed");
          ggiraphTooltip.style.opacity = "0";
        }
      }
    }

    function suppressPlotHoverWhilePinned(event) {
      if (plotInteractionFrozen) event.stopImmediatePropagation();
    }

    ["pointerover", "pointermove", "pointerout"].forEach(function(eventType) {
      container.addEventListener(eventType, suppressPlotHoverWhilePinned, true);
    });

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
      "white-space:pre-wrap",
      "contain:layout style paint",
      "will-change:transform"
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
      const target = event.target;
      return target && target.classList && target.classList.contains("ntsynt-chromosome-hit")
        ? target
        : null;
    }

    function getRibbonUnderCursor(event) {
      const target = event.target;
      return target && target.classList && target.classList.contains("ntsynt-ribbon-hit")
        ? target
        : null;
    }

    let hoveredRibbonId = null;
    let tooltipRibbonId = null;
    let hoveredChromosomeElement = null;

    // Update one overlay path rather than mutating the previous and current
    // block's individual ribbon polygons.
    function setHoveredRibbon(blockId) {
      const nextId = blockId === null || blockId === undefined ? null : String(blockId);
      if (nextId === hoveredRibbonId) return false;

      if (nextId === null) {
        ribbonHoverPath.setAttribute("d", "");
      } else {
        let pathData = ribbonHoverPathCache.get(nextId);
        if (pathData === undefined) {
          pathData = (ribbonsById.get(nextId) || []).map(function(poly) {
            return "M" + poly.getAttribute("points") + "Z";
          }).join(" ");
          ribbonHoverPathCache.set(nextId, pathData);
        }
        ribbonHoverPath.setAttribute("d", pathData);
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

    let ribbonTooltipVisible = false;

    function showRibbonTooltip() {
      if (ribbonTooltipVisible) return;
      controlsDiv.style.display = "none";
      ribbonTip.style.display = "block";
      ribbonTooltipVisible = true;
    }

    function hideRibbonTooltip() {
      if (!ribbonTooltipVisible) return;
      ribbonTip.style.display = "none";
      ribbonTooltipVisible = false;
    }

    function getElementTooltip(element) {
      if (element.matches("polygon.ntsynt-ribbon-hit")) {
        return element._ntsyntTooltip;
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

    // Require the pointer to remain on a new ribbon briefly before changing
    // the tooltip or highlight. With densely packed ribbons this prevents a
    // quick mouse movement from repainting every ribbon crossed along the way.
    const ribbonHoverDwellMs = 50;
    let hoverCandidateId = null;
    let hoverCandidatePoly = null;
    let hoverCandidatePosition = null;
    let hoverDwellTimer = null;

    function cancelPendingRibbonHover() {
      if (hoverDwellTimer !== null) {
        clearTimeout(hoverDwellTimer);
        hoverDwellTimer = null;
      }
      hoverCandidateId = null;
      hoverCandidatePoly = null;
      hoverCandidatePosition = null;
    }

    function commitRibbonHover() {
      hoverDwellTimer = null;

      const candidateId = hoverCandidateId;
      const candidatePoly = hoverCandidatePoly;
      const candidatePosition = hoverCandidatePosition;
      hoverCandidateId = null;
      hoverCandidatePoly = null;
      hoverCandidatePosition = null;

      if (pinnedRibbonId || candidateId === null || !candidatePoly) return;

      const tooltipText = candidatePoly._ntsyntTooltip;
      if (!tooltipText) {
        hideRibbonTooltip();
        setHoveredRibbon(null);
        return;
      }

      const hoverChanged = setHoveredRibbon(candidateId);
      if (hoverChanged) contentDiv.textContent = tooltipText;
      showRibbonTooltip();
      positionRibbonTooltip(candidatePosition);
    }

    function scheduleRibbonHover(poly, e) {
      const candidateId = poly._ntsyntBlockId;
      const candidatePosition = { clientX: e.clientX, clientY: e.clientY };

      // Once a ribbon has been committed, moving within it remains immediate.
      if (candidateId === hoveredRibbonId) {
        cancelPendingRibbonHover();
        if (poly._ntsyntTooltip) {
          showRibbonTooltip();
          positionRibbonTooltip(candidatePosition);
        }
        return;
      }

      hoverCandidatePoly = poly;
      hoverCandidatePosition = candidatePosition;

      // Keep updating the eventual tooltip position without restarting the
      // dwell timer while the pointer remains on the same candidate ribbon.
      if (candidateId === hoverCandidateId) return;

      if (hoverDwellTimer !== null) clearTimeout(hoverDwellTimer);
      hoverCandidateId = candidateId;
      hideRibbonTooltip();
      hoverDwellTimer = setTimeout(commitRibbonHover, ribbonHoverDwellMs);
    }

    function onMouseMove(e) {
      if (pinnedRibbonId) return; // frozen while pinned

      const chromosome = getChromosomeUnderCursor(e);
      if (chromosome) {
        cancelPendingRibbonHover();
        setHoveredRibbon(null);
        const tooltipText = getElementTooltip(chromosome);
        if (tooltipText) {
          if (hoveredChromosomeElement !== chromosome) {
            contentDiv.textContent = tooltipText;
            hoveredChromosomeElement = chromosome;
          }
          showRibbonTooltip();
          positionRibbonTooltip(e);
        } else {
          hoveredChromosomeElement = null;
          hideRibbonTooltip();
        }
        return;
      }

      if (hoveredChromosomeElement !== null) {
        hoveredChromosomeElement = null;
        hideRibbonTooltip();
      }

      // In picking mode, the off-screen WebGL renderer owns ribbon hover.
      if (webglPickingMode) return;

      const poly = getRibbonUnderCursor(e);
      if (poly) {
        scheduleRibbonHover(poly, e);
      } else {
        cancelPendingRibbonHover();
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
      cancelPendingRibbonHover();
      hoveredChromosomeElement = null;
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

    // WebGL mode changes one ribbon-group opacity and a small set of chromosome
    // overlay paths. SVG mode retains the original per-polygon fallback.
    function applyLegendState() {
        if (webglPickingMode && window.ntsyntWebGLLegendController) {
          window.ntsyntWebGLLegendController.apply(Array.from(activeChromosomes));
          return;
        }
        const activeBlockIds = new Set();

        activeChromosomes.forEach(function(c) {
            legendChromMap[c].forEach(function(bid) {
              activeBlockIds.add(String(bid));
            });
        });

        ribbonPolys.forEach(function(poly) {
          const bid = poly.getAttribute("data-ntsynt-id");

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
      // Clicking commits immediately; it should not wait for, or be replaced
      // by, a pending hover candidate.
      cancelPendingRibbonHover();
      const tooltipText = getElementTooltip(el);
      if (!tooltipText) return;

      if (webglPickingMode) {
        window.dispatchEvent(new CustomEvent("ntsynt:ribbon-unpinned"));
      }

      setPlotInteractionFrozen(true);
      pinnedRibbonId = el.matches("polygon.ntsynt-ribbon-hit")
        ? el._ntsyntBlockId
        : el.getAttribute("data-id");
      contentDiv.textContent = tooltipText;
      controlsDiv.style.display = "block";
      ribbonTip.style.pointerEvents = "auto";
      ribbonTip.style.userSelect = "text";
      ribbonTip.style.display = "block";
      ribbonTooltipVisible = true;
      positionRibbonTooltip(e);

      if (el.tagName && el.tagName.toLowerCase() === "polygon") {
        setHoveredRibbon(pinnedRibbonId);
      } else {
        setHoveredRibbon(null);
      }
    }

    function unpinTooltip() {
      cancelPendingRibbonHover();
      pinnedRibbonId = null;
      setPlotInteractionFrozen(false);
      ribbonTip.style.display = "none";
      ribbonTooltipVisible = false;
      ribbonTip.style.pointerEvents = "none";
      controlsDiv.style.display = "none";
      setHoveredRibbon(null);
      window.dispatchEvent(new CustomEvent("ntsynt:ribbon-unpinned"));
    }

    window.ntsyntRibbonTooltipController = {
      showHover: function(blockId, tooltipText, position) {
        if (pinnedRibbonId || !tooltipText) return;
        const nextId = String(blockId);
        if (nextId !== tooltipRibbonId) {
          tooltipRibbonId = nextId;
          contentDiv.textContent = tooltipText;
        }
        controlsDiv.style.display = "none";
        showRibbonTooltip();
        positionRibbonTooltip(position);
      },
      hideHover: function() {
        if (pinnedRibbonId) return;
        hideRibbonTooltip();
        tooltipRibbonId = null;
      },
      setHighlight: setHoveredRibbon,
      setHighlightPath: function(pathData) {
        const nextPath = pathData || "";
        if (ribbonHoverPath.getAttribute("d") !== nextPath) {
          ribbonHoverPath.setAttribute("d", nextPath);
        }
      },
      pin: function(blockId, tooltipText, position) {
        if (!tooltipText) return;
        cancelPendingRibbonHover();
        setPlotInteractionFrozen(true);
        pinnedRibbonId = String(blockId);
        tooltipRibbonId = pinnedRibbonId;
        contentDiv.textContent = tooltipText;
        controlsDiv.style.display = "block";
        ribbonTip.style.pointerEvents = "auto";
        ribbonTip.style.userSelect = "text";
        ribbonTip.style.display = "block";
        ribbonTooltipVisible = true;
        positionRibbonTooltip(position);
      },
      unpin: unpinTooltip,
      isPinned: function() {
        return pinnedRibbonId !== null;
      }
    };

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

      // The WebGL picker owns ribbon and background clicks in this mode.
      if (webglPickingMode) return;

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

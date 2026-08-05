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

    // --- disable pointer events on all ribbon polygons ---
    // Chromosomes (segments) will be the sole hit targets for ggiraph.
    // We handle ribbon tooltips manually via JS geometry check below.
    svg.querySelectorAll("polygon[data-id]").forEach(function(poly) {
      poly.style.pointerEvents = "none";
    });

    svg.querySelectorAll("*").forEach(function(el) {
      el.style.pointerEvents = "auto";
    });
    // Re-disable polygons after the above (order matters)
    svg.querySelectorAll("polygon[data-id]").forEach(function(poly) {
      poly.style.pointerEvents = "none";
    });

    // ---------------------------------------------------------------
    // PERF: cache static geometry once instead of re-querying/
    // re-measuring the DOM on every mousemove. None of these elements
    // move after render (aside from resize/scroll), so we build the
    // lookup tables up front and reuse them.
    // ---------------------------------------------------------------
    const ribbonPolys = Array.from(svg.querySelectorAll("polygon[data-id]"));
    // Local-space bbox per polygon, used as a cheap pre-filter before
    // the expensive isPointInFill hit test.
    ribbonPolys.forEach(function(poly) {
      try { poly._bbox = poly.getBBox(); } catch (err) { poly._bbox = null; }
    });

    let chromSegs = []; // { el, rect } - rect refreshed on resize/scroll
    function refreshChromSegRects() {
      const segEls = svg.querySelectorAll("line[data-id], [data-id].chromosome");
      chromSegs = Array.from(segEls).map(function(el) {
        return { el: el, rect: el.getBoundingClientRect() };
      });
    }
    refreshChromSegRects();

    // Debounced re-measure on resize/scroll, since layout can shift then.
    let resizeTimer = null;
    function scheduleRectRefresh() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(refreshChromSegRects, 150);
    }
    window.addEventListener("resize", scheduleRectRefresh, true);
    window.addEventListener("scroll", scheduleRectRefresh, true);

    // --- Manual ribbon tooltip ---
    // We need our own tooltip div since we bypassed ggiraph for ribbons
    let pinnedRibbonId = null;

    const ribbonTip = document.createElement("div");
    ribbonTip.style.cssText = [
      "position:fixed",
      "display:none",
      "background:rgba(255,255,255,0.9)",
      "padding:10px",
      "border:1px solid black",
      "border-radius:4px",
      "font-family:monospace",
      "font-size:16px",
      "pointer-events:none",
      "z-index:9999",
      "max-width:900px"
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

    // Check if cursor is near any chromosome segment (invisible hit area)
    // Returns the matched <line> element, or null.
    // PERF: uses the cached chromSegs array (no querySelectorAll or
    // getBoundingClientRect on every call) instead of two separate
    // near-duplicate functions.
    const CHROM_PRIORITY_PX = 5;

    function getChromosomeUnderCursor(e) {
      for (let i = 0; i < chromSegs.length; i++) {
        const b = chromSegs[i].rect;
        if (
          e.clientX >= b.left  - CHROM_PRIORITY_PX &&
          e.clientX <= b.right + CHROM_PRIORITY_PX &&
          e.clientY >= b.top   - CHROM_PRIORITY_PX &&
          e.clientY <= b.bottom + CHROM_PRIORITY_PX
        ) {
          return chromSegs[i].el;
        }
      }
      return null;
    }

    function isNearChromosome(e) {
      return getChromosomeUnderCursor(e) !== null;
    }

    // Find which ribbon polygon (if any) the cursor is geometrically inside.
    // PERF: the screen->SVG matrix is identical for every polygon in this
    // plot (they share the SVG's coordinate space), so it's computed once
    // per call instead of once per polygon. A cheap local-space bbox check
    // skips isPointInFill for the vast majority of polygons.
    function getRibbonUnderCursor(e) {
      const ctm = svg.getScreenCTM();
      if (ctm) {
        const inv = ctm.inverse();
        const svgPt = svg.createSVGPoint();
        svgPt.x = e.clientX;
        svgPt.y = e.clientY;
        const localPt = svgPt.matrixTransform(inv);

        for (let i = 0; i < ribbonPolys.length; i++) {
          const poly = ribbonPolys[i];
          const b = poly._bbox;
          if (b) {
            if (
              localPt.x < b.x || localPt.x > b.x + b.width ||
              localPt.y < b.y || localPt.y > b.y + b.height
            ) {
              continue; // cheap rejection, skip the expensive hit test
            }
          }
          try {
            if (poly.isPointInFill && poly.isPointInFill(localPt)) return poly;
          } catch (err) { /* skip */ }
        }
      }
      // Fallback: elementsFromPoint but skip if near a chromosome
      if (!isNearChromosome(e)) {
        const els = document.elementsFromPoint(e.clientX, e.clientY);
        for (let el of els) {
          if (el.tagName === "polygon" && el.getAttribute("data-id")) {
            return el;
          }
        }
      }
      return null;
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

      if (isNearChromosome(e)) {
        ribbonTip.style.display = "none";
        applyLegendState();
        return;
      }

      const poly = getRibbonUnderCursor(e);
      if (poly) {
        const hoveredId = poly.getAttribute("data-id");

        // Highlight matching ribbons, dim others
        ribbonPolys.forEach(function(p) {
          if (p.getAttribute("data-id") === hoveredId) {
            p.style.stroke = "black";
            p.style.strokeWidth = "1";
            p.style.opacity = "1";
            p.style.fill = "darkgrey";
            p.style.fillOpacity = "0.3";
          }
        });
        applyLegendState(hoveredId);

        // Show tooltip
        const titleEl = poly.querySelector("title");
        const tooltipText = (titleEl ? titleEl.innerHTML : null)
          || poly.getAttribute("title")
          || poly.getAttribute("data-original-title");
        if (tooltipText) {
          const tooltipHtml = tooltipText
            .replaceAll("&lt;br/&gt;", "<br/>")
            .replaceAll("&lt;br&gt;", "<br>");

          contentDiv.innerHTML = tooltipHtml;
          ribbonTip.style.display = "block";
          ribbonTip.style.left = (e.clientX + 14) + "px";
          ribbonTip.style.top  = (e.clientY + 14) + "px";
          const r = ribbonTip.getBoundingClientRect();
          if (r.right  > window.innerWidth)  ribbonTip.style.left = (e.clientX - r.width  - 14) + "px";
          if (r.bottom > window.innerHeight) ribbonTip.style.top  = (e.clientY - r.height - 14) + "px";
        } else {
          ribbonTip.style.display = "none";
        }
      } else {
        // Not over any ribbon — clear everything
        ribbonTip.style.display = "none";
        applyLegendState();
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
      ribbonTip.style.display = "none";
      applyLegendState();
    }, true);

    // ---- Legend click / chromosome filtering ----
    const legendChromMap = {};
    svg.querySelectorAll("text").forEach(function(t) {
      const chrom = t.textContent.trim();
      if (chromBlockMap[chrom]) legendChromMap[chrom] = chromBlockMap[chrom];
    });

    const activeChromosomes = new Set();

    // PERF: iterates the cached ribbonPolys array instead of re-querying
    // the DOM for polygons on every call.
    function applyLegendState(omit_poly_id = null) {
        const activeBlockIds = new Set();

        activeChromosomes.forEach(function(c) {
            legendChromMap[c].forEach(function(bid) {
            activeBlockIds.add(bid);
            });
        });

        ribbonPolys.forEach(function(poly) {
            const bid = poly.getAttribute("data-id");

            if (omit_poly_id && omit_poly_id == bid) {
                return;
            }

            if (activeChromosomes.size === 0) {
            poly.style.opacity = "";
            poly.style.fill = "";
            poly.style.fillOpacity = "";
            poly.style.stroke = "";
            poly.style.strokeWidth = "";
            } else if (activeBlockIds.has(bid)) {
            poly.style.opacity = "0.9";
            poly.style.fill = "";
            poly.style.fillOpacity = "0.9";
            poly.style.stroke = "";
            poly.style.strokeWidth = "";
            } else {
            poly.style.opacity = "0.6";
            poly.style.fill = "white";
            poly.style.fillOpacity = "0.6";
            poly.style.stroke = "";
            poly.style.strokeWidth = "";            }
        });
    }

    function pinTooltip(el, e) {
      const titleEl = el.querySelector ? el.querySelector("title") : null;
      const tooltipText = (titleEl ? titleEl.innerHTML : null)
        || el.getAttribute("title")
        || el.getAttribute("data-original-title");
      if (!tooltipText) return;

      pinnedRibbonId = el.getAttribute("data-id");

      const tooltipHtml = tooltipText
        .replaceAll("&lt;br/&gt;", "<br/>")
        .replaceAll("&lt;br&gt;", "<br>");

      contentDiv.innerHTML = tooltipHtml;
      controlsDiv.style.display = "block";
      ribbonTip.style.pointerEvents = "auto";
      ribbonTip.style.userSelect = "text";
      ribbonTip.style.display = "block";
      ribbonTip.style.left = (e.clientX + 14) + "px";
      ribbonTip.style.top  = (e.clientY + 14) + "px";
      const r = ribbonTip.getBoundingClientRect();
      if (r.right  > window.innerWidth)  ribbonTip.style.left = (e.clientX - r.width  - 14) + "px";
      if (r.bottom > window.innerHeight) ribbonTip.style.top  = (e.clientY - r.height - 14) + "px";

      if (el.tagName && el.tagName.toLowerCase() === "polygon") {
        ribbonPolys.forEach(function(p) {
          if (p.getAttribute("data-id") === pinnedRibbonId) {
            p.style.stroke = "black";
            p.style.strokeWidth = "1";
            p.style.opacity = "1";
            p.style.fill = "darkgrey";
            p.style.fillOpacity = "0.3";
          }
        });
        applyLegendState(pinnedRibbonId);
      }
    }

    function unpinTooltip() {
      pinnedRibbonId = null;
      ribbonTip.style.display = "none";
      ribbonTip.style.pointerEvents = "none";
      controlsDiv.style.display = "none";
      applyLegendState();
    }

    function inBBox(el, e, padding = 5) {
      const bbox = el.getBoundingClientRect();
      return e.clientX >= bbox.left - padding && e.clientX <= bbox.right  + padding &&
             e.clientY >= bbox.top  - padding && e.clientY <= bbox.bottom + padding;
    }

    function findLegendChrom(e) {
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

      svg.querySelectorAll("text").forEach(function(t) {
        const c = t.textContent.trim();
        if (!legendChromMap[c]) return;
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
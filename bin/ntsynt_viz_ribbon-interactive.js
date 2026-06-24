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

    // --- FIX: disable pointer events on all ribbon polygons ---
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

    // --- Manual ribbon tooltip ---
    // We need our own tooltip div since we bypassed ggiraph for ribbons
    const ribbonTip = document.createElement("div");
    ribbonTip.style.cssText = [
      "position:fixed",
      "display:none",
      "background:rgba(255,255,255,0.9)",
      "padding:10px",
      "border:1px solid black",
      "border-radius:4px",
      "font-family:monospace",
      "font-size:10px",
      "pointer-events:none",
      "z-index:9999",
      "max-width:400px"
    ].join(";");
    document.body.appendChild(ribbonTip);

    // Check if cursor is near any chromosome segment (invisible hit area)
    // Returns true if within CHROM_PRIORITY_PX pixels of a segment element
    const CHROM_PRIORITY_PX = 8;

    function isNearChromosome(e) {
      // ggiraph chromosome segments are <line> elements with data-id
      const segs = svg.querySelectorAll("line[data-id], [data-id].chromosome");
      for (let seg of segs) {
        const bbox = seg.getBoundingClientRect();
        // Expand bbox by priority zone
        if (
          e.clientX >= bbox.left  - CHROM_PRIORITY_PX &&
          e.clientX <= bbox.right + CHROM_PRIORITY_PX &&
          e.clientY >= bbox.top   - CHROM_PRIORITY_PX &&
          e.clientY <= bbox.bottom + CHROM_PRIORITY_PX
        ) {
          return true;
        }
      }
      return false;
    }


    // Find which ribbon polygon (if any) the cursor is geometrically inside
    function getRibbonUnderCursor(e) {
      const polys = svg.querySelectorAll("polygon[data-id]");
      for (let poly of polys) {
        // Use SVG geometry: check if point is inside polygon
        const svgPt = svg.createSVGPoint();
        svgPt.x = e.clientX;
        svgPt.y = e.clientY;
        try {
          const localPt = svgPt.matrixTransform(poly.getScreenCTM().inverse());
          if (poly.isPointInFill ? poly.isPointInFill(localPt) : false) {
            return poly;
          }
        } catch(err) { /* skip */ }
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

container.addEventListener("mousemove", function(e) {
      if (isNearChromosome(e)) {
        ribbonTip.style.display = "none";
        applyLegendState();
        return;
      }

      const poly = getRibbonUnderCursor(e);
      if (poly) {
        const hoveredId = poly.getAttribute("data-id");

        // Highlight matching ribbons, dim others
        svg.querySelectorAll("polygon[data-id]").forEach(function(p) {
          if (p.getAttribute("data-id") === hoveredId) {
            p.style.stroke = "black";
            p.style.strokeWidth = "1";
            p.style.opacity = "1";
            p.style.fill = "darkgrey";
            p.style.fillOpacity = "0.3";
          }
        //   } else {
        //     p.style.stroke = "";
        //     p.style.strokeWidth = "";
        //     p.style.opacity = "0.2";
        //     p.style.fill = "";
        //     p.style.fillOpacity = "";
        //   }
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

          ribbonTip.innerHTML = tooltipHtml;
          ribbonTip.innerHTML = tooltipHtml;
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
    }, true);

    container.addEventListener("mouseleave", function() {
      ribbonTip.style.display = "none";
      applyLegendState();
    }, true);

    // ---- Legend click / chromosome filtering (unchanged from original) ----
    const legendChromMap = {};
    svg.querySelectorAll("text").forEach(function(t) {
      const chrom = t.textContent.trim();
      if (chromBlockMap[chrom]) legendChromMap[chrom] = chromBlockMap[chrom];
    });

    const activeChromosomes = new Set();

    function applyLegendState(omit_poly_id = null) {
        const activeBlockIds = new Set();

        activeChromosomes.forEach(function(c) {
            legendChromMap[c].forEach(function(bid) {
            activeBlockIds.add(bid);
            });
        });

        svg.querySelectorAll("polygon[data-id]").forEach(function(poly) {
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
            poly.style.opacity = "1";
            poly.style.fill = "darkgrey";
            poly.style.fillOpacity = "0.5";
            poly.style.stroke = "darkgrey";
            poly.style.strokeWidth = "0.2px";
            } else {
            poly.style.opacity = "";
            poly.style.fill = "";
            poly.style.fillOpacity = "";
            poly.style.stroke = "";
            poly.style.strokeWidth = "";            }
        });
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
      if (chrom) handleChromClick(chrom);
    }, true);



  }, 500);
});
</script>
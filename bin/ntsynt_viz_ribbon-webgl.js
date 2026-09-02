<script>
(function() {
  "use strict";

  // Visible ribbons remain SVG for exact quality; WebGL only performs picking.
  const pickingBuild = "svg-presentation-webgl-picking-v16";
  const plotData = __WEBGL_RIBBON_DATA__;
  window.ntsyntWebGLPlotData = plotData;
  window.ntsyntWebGLPickingMode = true;

  function whenGirafeReady(callback) {
    let scheduled = false;
    function findPlot() {
      const container = document.querySelector("div.girafe_container_std");
      const svg = container && container.querySelector("svg.ggiraph-svg");
      const chromosome = svg && svg.querySelector("line[data-id]");
      if (!container || !svg || !chromosome || scheduled) return false;
      scheduled = true;
      requestAnimationFrame(function() {
        requestAnimationFrame(function() {
          if (container.isConnected && svg.isConnected) callback(container);
        });
      });
      return true;
    }

    if (findPlot()) return;
    const observer = new MutationObserver(function() {
      if (findPlot()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error("WebGL picking shader compilation failed: " + message);
    }
    return shader;
  }

  function createProgram(gl) {
    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, [
      "attribute vec2 a_position;",
      "attribute vec3 a_pick_colour;",
      "uniform vec4 u_view;",
      "varying vec3 v_pick_colour;",
      "void main() {",
      "  vec2 position = a_position * u_view.xy + u_view.zw;",
      "  gl_Position = vec4(position.x * 2.0 - 1.0,",
      "                     1.0 - position.y * 2.0, 0.0, 1.0);",
      "  v_pick_colour = a_pick_colour;",
      "}"
    ].join("\n"));
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, [
      "precision highp float;",
      "varying vec3 v_pick_colour;",
      "void main() { gl_FragColor = vec4(v_pick_colour, 1.0); }"
    ].join("\n"));

    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error("WebGL picking program linking failed: " + message);
    }
    return program;
  }

  function buildPickingArrays(data) {
    const links = data.links;
    const count = links.x1.length;
    if (count >= 16777215) {
      throw new Error("WebGL picking supports fewer than 16,777,215 ribbons");
    }

    const positions = new Float32Array(count * 6 * 2);
    const pickColours = new Uint8Array(count * 6 * 3);
    const xMin = data.x_range[0];
    const xSpan = data.x_range[1] - xMin;
    const yMin = data.y_range[0];
    const ySpan = data.y_range[1] - yMin;
    const triangleOrder = [0, 1, 2, 0, 2, 3];
    const ribbonsByBlock = new Map();

    for (let ribbon = 0; ribbon < count; ribbon++) {
      const xs = [links.x1[ribbon], links.x2[ribbon],
                  links.x3[ribbon], links.x4[ribbon]];
      const ys = [links.y1[ribbon], links.y1[ribbon],
                  links.y2[ribbon], links.y2[ribbon]];
      const encodedId = ribbon + 1;
      const rgb = [encodedId & 255, (encodedId >> 8) & 255,
                   (encodedId >> 16) & 255];

      for (let vertex = 0; vertex < 6; vertex++) {
        const corner = triangleOrder[vertex];
        const offset = (ribbon * 6 + vertex) * 2;
        positions[offset] = (xs[corner] - xMin) / xSpan;
        positions[offset + 1] = 1 - ((ys[corner] - yMin) / ySpan);
        pickColours.set(rgb, (ribbon * 6 + vertex) * 3);
      }

      const blockId = String(links.block_id[ribbon]);
      if (!ribbonsByBlock.has(blockId)) ribbonsByBlock.set(blockId, []);
      ribbonsByBlock.get(blockId).push(ribbon);
    }

    return {
      positions: positions,
      pickColours: pickColours,
      vertexCount: count * 6,
      ribbonsByBlock: ribbonsByBlock
    };
  }

  function buildCpuPickingIndex(data) {
    const links = data.links;
    const xMin = data.x_range[0];
    const xSpan = data.x_range[1] - xMin;
    const yMin = data.y_range[0];
    const ySpan = data.y_range[1] - yMin;
    const binCount = 256;
    const bandsByKey = new Map();

    for (let ribbon = 0; ribbon < links.x1.length; ribbon++) {
      const top = 1 - ((links.y1[ribbon] - yMin) / ySpan);
      const bottom = 1 - ((links.y2[ribbon] - yMin) / ySpan);
      const key = top + ":" + bottom;
      let band = bandsByKey.get(key);
      if (!band) {
        band = {
          top: top,
          bottom: bottom,
          minY: Math.min(top, bottom),
          maxY: Math.max(top, bottom),
          bins: Array.from({ length: binCount }, function() { return []; })
        };
        bandsByKey.set(key, band);
      }

      const xs = [links.x1[ribbon], links.x2[ribbon],
                  links.x3[ribbon], links.x4[ribbon]].map(function(x) {
        return (x - xMin) / xSpan;
      });
      const minX = Math.max(0, Math.min.apply(null, xs));
      const maxX = Math.min(1, Math.max.apply(null, xs));
      const firstBin = Math.max(0, Math.min(binCount - 1,
        Math.floor(minX * binCount)));
      const lastBin = Math.max(0, Math.min(binCount - 1,
        Math.floor(maxX * binCount)));
      for (let bin = firstBin; bin <= lastBin; bin++) {
        band.bins[bin].push(ribbon);
      }
    }

    return { bands: Array.from(bandsByKey.values()), binCount: binCount };
  }

  function buildRibbonsByBlock(data) {
    const ribbonsByBlock = new Map();
    data.links.block_id.forEach(function(blockId, ribbon) {
      const key = String(blockId);
      if (!ribbonsByBlock.has(key)) ribbonsByBlock.set(key, []);
      ribbonsByBlock.get(key).push(ribbon);
    });
    return ribbonsByBlock;
  }

  function pickCpuIndexedRibbon(index, data, x, y) {
    const links = data.links;
    const xMin = data.x_range[0];
    const xSpan = data.x_range[1] - xMin;
    let picked = -1;

    index.bands.forEach(function(band) {
      if (y < band.minY || y > band.maxY) return;
      const bin = Math.max(0, Math.min(index.binCount - 1,
        Math.floor(x * index.binCount)));
      const candidates = band.bins[bin];
      const denominator = band.bottom - band.top;
      const t = denominator === 0 ? 0 : (y - band.top) / denominator;

      // Later polygons win in the WebGL ID buffer, so inspect candidates in
      // reverse draw order and retain the largest matching ribbon index.
      for (let candidate = candidates.length - 1; candidate >= 0; candidate--) {
        const ribbon = candidates[candidate];
        if (ribbon <= picked) break;
        const x1 = (links.x1[ribbon] - xMin) / xSpan;
        const x2 = (links.x2[ribbon] - xMin) / xSpan;
        const x3 = (links.x3[ribbon] - xMin) / xSpan;
        const x4 = (links.x4[ribbon] - xMin) / xSpan;
        const edgeA = x1 + t * (x4 - x1);
        const edgeB = x2 + t * (x3 - x2);
        if (x >= Math.min(edgeA, edgeB) && x <= Math.max(edgeA, edgeB)) {
          picked = ribbon;
          break;
        }
      }
    });

    return picked;
  }

  function panelBounds(container, svg, chromosome) {
    let clippedGroup = chromosome.parentElement;
    while (clippedGroup && clippedGroup !== svg && !clippedGroup.hasAttribute("clip-path")) {
      clippedGroup = clippedGroup.parentElement;
    }
    if (!clippedGroup || clippedGroup === svg) return null;

    const reference = clippedGroup.getAttribute("clip-path") || "";
    const match = reference.match(/^url\(#(.+)\)$/);
    const clip = match && svg.querySelector("#" + CSS.escape(match[1]));
    const rect = clip && clip.querySelector("rect");
    const matrix = svg.getScreenCTM();
    if (!rect || !matrix) return null;

    const topLeft = svg.createSVGPoint();
    topLeft.x = rect.x.baseVal.value;
    topLeft.y = rect.y.baseVal.value;
    const bottomRight = svg.createSVGPoint();
    bottomRight.x = rect.x.baseVal.value + rect.width.baseVal.value;
    bottomRight.y = rect.y.baseVal.value + rect.height.baseVal.value;
    const screenTopLeft = topLeft.matrixTransform(matrix);
    const screenBottomRight = bottomRight.matrixTransform(matrix);
    const containerBox = container.getBoundingClientRect();

    return {
      left: screenTopLeft.x - containerBox.left,
      top: screenTopLeft.y - containerBox.top,
      width: screenBottomRight.x - screenTopLeft.x,
      height: screenBottomRight.y - screenTopLeft.y,
      svgX: rect.x.baseVal.value,
      svgY: rect.y.baseVal.value,
      svgWidth: rect.width.baseVal.value,
      svgHeight: rect.height.baseVal.value,
      containerLeft: containerBox.left,
      containerTop: containerBox.top,
      clippedGroup: clippedGroup
    };
  }

  function currentZoomView(svg, panel) {
    const root = svg.querySelector("g.ggiraph-svg-rootg");
    const consolidated = root && root.transform
      ? root.transform.baseVal.consolidate()
      : null;
    if (!consolidated) return [1, 1, 0, 0];
    const matrix = consolidated.matrix;
    return [
      matrix.a,
      matrix.d,
      ((matrix.a - 1) * panel.svgX + matrix.e) / panel.svgWidth,
      ((matrix.d - 1) * panel.svgY + matrix.f) / panel.svgHeight
    ];
  }

  function screenToPlotMatrix(svg) {
    const root = svg.querySelector("g.ggiraph-svg-rootg");
    const matrix = root && root.getScreenCTM ? root.getScreenCTM() : null;
    if (!matrix) return null;
    try {
      return matrix.inverse();
    } catch (error) {
      console.warn("ntSynt-viz: could not invert the SVG screen transform.", error);
      return null;
    }
  }

  function start(container) {
    const initializationStarted = performance.now();
    const svg = container.querySelector("svg.ggiraph-svg");
    const presentationPaths = [];
    const chromMap = window.ntsyntChromBlockMap || {};
    const blockChromMap = new Map();
    Object.keys(chromMap).forEach(function(chrom) {
      chromMap[chrom].forEach(function(blockId) {
        blockChromMap.set(String(blockId), chrom);
      });
    });

    // Reduce the presentation DOM while preserving the original order of
    // differently styled ribbons. Each consecutive run with identical SVG
    // attributes becomes one compound path whose subpaths retain their borders.
    function consolidateRibbonPresentation() {
      const visibleRibbons = svg ? Array.from(svg.querySelectorAll(
        "polygon[fill-opacity='0.5'][stroke='#C1CDC1']"
      )) : [];
      if (visibleRibbons.length !== plotData.links.block_id.length) {
        console.warn(
          "ntSynt-viz: expected " + plotData.links.block_id.length +
          " visible SVG ribbons but found " + visibleRibbons.length +
          "; ribbon consolidation may be incomplete."
        );
      }
      const attributes = ["fill", "fill-opacity", "stroke", "stroke-opacity",
        "stroke-width", "stroke-linejoin", "stroke-linecap"];
      let runParent = null;
      let runFirst = null;
      let runSignature = null;
      let runChrom = null;
      let runAttributes = null;
      let runPaths = [];

      function flushRun() {
        if (!runFirst || runPaths.length === 0) return;
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.classList.add("ntsynt-ribbon-presentation-path");
        path.setAttribute("d", runPaths.join(""));
        attributes.forEach(function(attribute, index) {
          if (runAttributes[index] !== null) {
            path.setAttribute(attribute, runAttributes[index]);
          }
        });
        path.dataset.ntsyntBaseStroke = path.getAttribute("stroke") || "none";
        if (runChrom) path.setAttribute("data-ntsynt-chrom", runChrom);
        path.style.pointerEvents = "none";
        runParent.insertBefore(path, runFirst);
        presentationPaths.push(path);
      }

      visibleRibbons.slice(0, plotData.links.block_id.length).forEach(function(poly, index) {
        const values = attributes.map(function(attribute) {
          return poly.getAttribute(attribute);
        });
        const chrom = blockChromMap.get(String(plotData.links.block_id[index])) || "";
        const signature = values.join("|") + "|" + chrom;
        if (poly.parentNode !== runParent || signature !== runSignature) {
          flushRun();
          runParent = poly.parentNode;
          runFirst = poly;
          runSignature = signature;
          runChrom = chrom;
          runAttributes = values;
          runPaths = [];
        }
        runPaths.push("M" + poly.getAttribute("points") + "Z");
      });
      flushRun();
      visibleRibbons.forEach(function(poly) { poly.remove(); });
      container.dataset.ntsyntPresentationPaths = String(presentationPaths.length);
    }

    consolidateRibbonPresentation();

    window.ntsyntWebGLLegendController = {
      apply: function(activeChromosomes) {
        const active = new Set(activeChromosomes || []);
        presentationPaths.forEach(function(path) {
          const selected = active.has(path.getAttribute("data-ntsynt-chrom"));
          path.style.opacity = active.size === 0 || selected ? "" : "0.6";
          path.setAttribute("fill-opacity",
            active.size > 0 && selected ? "0.75" : "0.5");
          path.setAttribute("stroke",
            active.size > 0 && selected
              ? (path.getAttribute("fill") || path.dataset.ntsyntBaseStroke)
              : path.dataset.ntsyntBaseStroke);
        });
      }
    };

    const interactionStyles = document.createElement("style");
    interactionStyles.textContent = [
      ".ggiraph-svg .ntsynt-ribbon-visual,",
      ".ggiraph-svg polygon[fill-opacity='0.5'][stroke='#C1CDC1'] {",
      "  pointer-events:none !important;",
      "}",
      ".ntsynt-webgl-highlight { pointer-events:none !important; }"
    ].join("\n");
    document.head.appendChild(interactionStyles);

    let useCpuIndexedPicking = plotData.links.block_id.length >= 20000;
    const pickingCanvas = document.createElement("canvas");
    let gl = null;
    if (!useCpuIndexedPicking) {
      try {
        gl = pickingCanvas.getContext("webgl", {
          alpha: false,
          antialias: false,
          depth: false,
          stencil: false,
          premultipliedAlpha: false,
          preserveDrawingBuffer: true,
          powerPreference: "high-performance"
        });
      } catch (error) {
        console.warn("ntSynt-viz: WebGL context creation failed; using CPU picking.", error);
      }
      if (!gl) {
        console.warn("ntSynt-viz: WebGL picking is unavailable; using CPU picking.");
        useCpuIndexedPicking = true;
      }
    }

    let arrays = useCpuIndexedPicking
      ? { ribbonsByBlock: buildRibbonsByBlock(plotData) }
      : buildPickingArrays(plotData);
    let cpuPickingIndex = useCpuIndexedPicking
      ? buildCpuPickingIndex(plotData)
      : null;
    let program;
    let positionBuffer;
    let colourBuffer;
    let state = null;
    let highlightedBlockId = null;
    let deliveredHighlightId;
    let pinnedBlockId = null;
    let lastPickedBlockId = null;

    function initializeGraphics() {
      program = createProgram(gl);
      positionBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, arrays.positions, gl.STATIC_DRAW);
      colourBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, colourBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, arrays.pickColours, gl.STATIC_DRAW);
    }

    function switchToCpuPicking(message, error) {
      if (useCpuIndexedPicking) return;
      useCpuIndexedPicking = true;
      arrays = { ribbonsByBlock: buildRibbonsByBlock(plotData) };
      cpuPickingIndex = buildCpuPickingIndex(plotData);
      state = null;
      console.warn(message, error || "");
    }

    if (!useCpuIndexedPicking) {
      try {
        initializeGraphics();
      } catch (error) {
        switchToCpuPicking(
          "ntSynt-viz: WebGL picking initialization failed; using CPU picking.",
          error
        );
      }
    }

    function highlightPathData(blockId, panel) {
      const indices = arrays.ribbonsByBlock.get(String(blockId)) || [];
      const links = plotData.links;
      const xMin = plotData.x_range[0];
      const xSpan = plotData.x_range[1] - xMin;
      const yMin = plotData.y_range[0];
      const ySpan = plotData.y_range[1] - yMin;
      return indices.map(function(ribbon) {
        const xs = [links.x1[ribbon], links.x2[ribbon],
                    links.x3[ribbon], links.x4[ribbon]];
        const ys = [links.y1[ribbon], links.y1[ribbon],
                    links.y2[ribbon], links.y2[ribbon]];
        const points = xs.map(function(x, corner) {
          const svgX = panel.svgX + ((x - xMin) / xSpan) * panel.svgWidth;
          const svgY = panel.svgY +
            (1 - ((ys[corner] - yMin) / ySpan)) * panel.svgHeight;
          return svgX.toFixed(2) + "," + svgY.toFixed(2);
        });
        return "M" + points[0] + "L" + points[1] + "L" +
          points[2] + "L" + points[3] + "Z";
      }).join("");
    }

    function setHighlightedBlock(blockId) {
      const nextId = blockId === null ? null : String(blockId);
      highlightedBlockId = nextId;
      const controller = window.ntsyntRibbonTooltipController;
      if (controller && controller.setHighlightPath && nextId !== deliveredHighlightId) {
        controller.setHighlightPath(
          nextId === null || !state ? "" : highlightPathData(nextId, state.bounds)
        );
        deliveredHighlightId = nextId;
      }
    }

    function drawPickingBuffer() {
      const svg = container.querySelector("svg.ggiraph-svg");
      const chromosome = svg && svg.querySelector("line[data-id]");
      if (!svg || !chromosome) return;
      const bounds = panelBounds(container, svg, chromosome);
      if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;
      const zoomView = currentZoomView(svg, bounds);

      if (useCpuIndexedPicking) {
        const screenToPlot = screenToPlotMatrix(svg);
        if (!screenToPlot) return;
        state = {
          bounds: bounds,
          ratio: 1,
          zoomView: zoomView,
          screenToPlot: screenToPlot
        };
        container.dataset.ntsyntRenderer = "svg-with-indexed-picking";
        container.dataset.ntsyntPickingBuild = pickingBuild;
        container.dataset.ntsyntPickingMethod = "cpu-indexed";
        if (!container.dataset.ntsyntInteractionInitMs) {
          container.dataset.ntsyntInteractionInitMs = String(Math.round(
            performance.now() - initializationStarted
          ));
        }
        return;
      }

      const maxSize = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
      const ratio = Math.max(1, Math.min(
        window.devicePixelRatio || 1,
        maxSize / bounds.width,
        maxSize / bounds.height
      ));
      const width = Math.max(1, Math.round(bounds.width * ratio));
      const height = Math.max(1, Math.round(bounds.height * ratio));
      if (pickingCanvas.width !== width || pickingCanvas.height !== height) {
        pickingCanvas.width = width;
        pickingCanvas.height = height;
      }

      gl.viewport(0, 0, width, height);
      gl.disable(gl.BLEND);
      gl.disable(gl.DITHER);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.uniform4fv(gl.getUniformLocation(program, "u_view"), zoomView);

      const positionLocation = gl.getAttribLocation(program, "a_position");
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
      const colourLocation = gl.getAttribLocation(program, "a_pick_colour");
      gl.bindBuffer(gl.ARRAY_BUFFER, colourBuffer);
      gl.enableVertexAttribArray(colourLocation);
      gl.vertexAttribPointer(colourLocation, 3, gl.UNSIGNED_BYTE, true, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, arrays.vertexCount);

      state = { bounds: bounds, ratio: ratio, zoomView: zoomView };
      container.dataset.ntsyntRenderer = "svg-with-webgl-picking";
      container.dataset.ntsyntPickingBuild = pickingBuild;
      container.dataset.ntsyntPickingMethod = useCpuIndexedPicking
        ? "cpu-indexed"
        : "webgl-readpixels";
      if (!container.dataset.ntsyntInteractionInitMs) {
        container.dataset.ntsyntInteractionInitMs = String(Math.round(
          performance.now() - initializationStarted
        ));
      }
    }

    function clearRibbonHighlight() {
      if (pinnedBlockId !== null) return;
      cancelHoverCandidate();
      setHighlightedBlock(null);
      lastPickedBlockId = null;
    }

    function hideRibbonHover() {
      clearRibbonHighlight();
      const controller = window.ntsyntRibbonTooltipController;
      if (controller) controller.hideHover();
    }

    function isChromosomePointerEvent(event) {
      const target = event.target;
      return !!(target && target.closest &&
        target.closest(".ntsynt-chromosome-hit, line[data-id]"));
    }

    const ribbonHoverDwellMs = 75;
    let hoverCandidateBlockId = null;
    let hoverCandidateEvent = null;
    let hoverCandidateTimer = null;

    function cancelHoverCandidate() {
      if (hoverCandidateTimer !== null) {
        clearTimeout(hoverCandidateTimer);
        hoverCandidateTimer = null;
      }
      hoverCandidateBlockId = null;
      hoverCandidateEvent = null;
    }

    function commitRibbonHover(blockId, event) {
      lastPickedBlockId = blockId;
      setHighlightedBlock(blockId);
      const tooltipMap = window.ntsyntBlockTooltipMap || {};
      const controller = window.ntsyntRibbonTooltipController;
      if (controller && tooltipMap[blockId]) {
        controller.showHover(blockId, tooltipMap[blockId], event);
      }
    }

    function scheduleRibbonHover(blockId, event) {
      const pointerPosition = { clientX: event.clientX, clientY: event.clientY };
      if (blockId === lastPickedBlockId) {
        cancelHoverCandidate();
        commitRibbonHover(blockId, pointerPosition);
        return;
      }
      hoverCandidateEvent = pointerPosition;
      if (blockId === hoverCandidateBlockId) return;

      if (hoverCandidateTimer !== null) clearTimeout(hoverCandidateTimer);
      hoverCandidateBlockId = blockId;
      hoverCandidateTimer = setTimeout(function() {
        const candidateId = hoverCandidateBlockId;
        const candidateEvent = hoverCandidateEvent;
        hoverCandidateTimer = null;
        hoverCandidateBlockId = null;
        hoverCandidateEvent = null;
        if (candidateId !== null && candidateEvent) {
          commitRibbonHover(candidateId, candidateEvent);
        }
      }, ribbonHoverDwellMs);
    }

    const pickedPixel = new Uint8Array(4);
    function pickRibbon(event, commitImmediately) {
      if (!state) return;
      const tooltipController = window.ntsyntRibbonTooltipController;
      if (pinnedBlockId !== null && tooltipController && !tooltipController.isPinned()) {
        pinnedBlockId = null;
      }
      if (tooltipController && tooltipController.isPinned()) {
        cancelHoverCandidate();
        if (pinnedBlockId === null) {
          setHighlightedBlock(null);
          lastPickedBlockId = null;
        }
        return pinnedBlockId;
      }
      if (pinnedBlockId !== null) return pinnedBlockId;
      if (isChromosomePointerEvent(event)) {
        clearRibbonHighlight();
        return;
      }

      const x = event.clientX - state.bounds.containerLeft - state.bounds.left;
      const y = event.clientY - state.bounds.containerTop - state.bounds.top;
      if (x < 0 || y < 0 || x >= state.bounds.width || y >= state.bounds.height) {
        hideRibbonHover();
        return;
      }

      let encodedId;
      if (useCpuIndexedPicking) {
        // Convert through the root's actual screen CTM.  Reconstructing this
        // from the ggiraph zoom transform alone misses browser SVG scaling and
        // can shift hits horizontally from the visible ribbon.
        const screenPoint = new DOMPoint(event.clientX, event.clientY);
        const plotPoint = screenPoint.matrixTransform(state.screenToPlot);
        const dataX = (plotPoint.x - state.bounds.svgX) /
          state.bounds.svgWidth;
        const dataY = (plotPoint.y - state.bounds.svgY) /
          state.bounds.svgHeight;
        encodedId = pickCpuIndexedRibbon(cpuPickingIndex, plotData, dataX, dataY) + 1;
      } else {
        const pixelX = Math.min(pickingCanvas.width - 1,
          Math.max(0, Math.floor(x * state.ratio)));
        const pixelY = Math.min(pickingCanvas.height - 1,
          Math.max(0, pickingCanvas.height - 1 - Math.floor(y * state.ratio)));
        gl.readPixels(pixelX, pixelY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pickedPixel);
        encodedId = pickedPixel[0] + (pickedPixel[1] << 8) +
          (pickedPixel[2] << 16);
      }
      if (encodedId === 0 || encodedId > plotData.links.block_id.length) {
        cancelHoverCandidate();
        hideRibbonHover();
        return;
      }

      const blockId = String(plotData.links.block_id[encodedId - 1]);
      if (commitImmediately) {
        cancelHoverCandidate();
        commitRibbonHover(blockId, event);
      } else {
        scheduleRibbonHover(blockId, event);
      }
      return blockId;
    }

    let pendingPointerEvent = null;
    let pickScheduled = false;
    function schedulePick(event) {
      if (isChromosomePointerEvent(event)) {
        // Replace any ribbon event already queued for this frame so it cannot
        // commit after the pointer has reached the chromosome.
        pendingPointerEvent = event;
        clearRibbonHighlight();
        return;
      }
      pendingPointerEvent = event;
      if (pickScheduled) return;
      pickScheduled = true;
      requestAnimationFrame(function() {
        pickScheduled = false;
        pickRibbon(pendingPointerEvent);
      });
    }

    let drawScheduled = false;
    let zoomRoot = null;
    let zoomObserver = null;
    function scheduleDraw() {
      if (drawScheduled) return;
      drawScheduled = true;
      requestAnimationFrame(function() {
        drawScheduled = false;
        observeZoomRoot();
        drawPickingBuffer();
      });
    }

    function observeZoomRoot() {
      const svg = container.querySelector("svg.ggiraph-svg");
      const currentRoot = svg && svg.querySelector("g.ggiraph-svg-rootg");
      if (currentRoot === zoomRoot) return;
      if (zoomObserver) zoomObserver.disconnect();
      zoomRoot = currentRoot;
      if (currentRoot) {
        zoomObserver = new MutationObserver(scheduleDraw);
        zoomObserver.observe(currentRoot, {
          attributes: true,
          attributeFilter: ["transform"]
        });
      }
    }

    if (gl) {
      pickingCanvas.addEventListener("webglcontextlost", function(event) {
        event.preventDefault();
        switchToCpuPicking(
          "ntSynt-viz: WebGL context was lost; using CPU picking."
        );
        scheduleDraw();
      });
      pickingCanvas.addEventListener("webglcontextrestored", function() {
        if (!useCpuIndexedPicking) {
          initializeGraphics();
          scheduleDraw();
        }
      });
    }
    container.addEventListener("mousemove", schedulePick, true);
    container.addEventListener("mouseover", function(event) {
      if (isChromosomePointerEvent(event)) clearRibbonHighlight();
    }, true);
    container.addEventListener("mouseleave", hideRibbonHover, true);
    container.addEventListener("click", function(event) {
      if ((event.target && event.target.closest &&
           event.target.closest(".ntsynt-legend-label")) ||
          isChromosomePointerEvent(event)) return;
      const controller = window.ntsyntRibbonTooltipController;
      if (!controller) return;
      if (pinnedBlockId !== null) {
        controller.unpin();
        pinnedBlockId = null;
        setHighlightedBlock(null);
        return;
      }
      const blockId = pickRibbon(event, true) || lastPickedBlockId;
      const tooltipMap = window.ntsyntBlockTooltipMap || {};
      if (blockId !== null && blockId !== undefined && tooltipMap[blockId]) {
        pinnedBlockId = String(blockId);
        setHighlightedBlock(pinnedBlockId);
        controller.pin(pinnedBlockId, tooltipMap[pinnedBlockId], event);
      }
    }, true);
    window.addEventListener("ntsynt:ribbon-unpinned", function() {
      pinnedBlockId = null;
      setHighlightedBlock(null);
    });
    new ResizeObserver(scheduleDraw).observe(container);
    new MutationObserver(scheduleDraw).observe(container, {
      childList: true,
      subtree: true
    });
    window.addEventListener("resize", scheduleDraw);
    // getScreenCTM() and getBoundingClientRect() are viewport-relative. A page
    // or nested-container scroll changes both without triggering resize or an
    // SVG mutation, so refresh the cached pointer conversion on every scroll.
    window.addEventListener("scroll", scheduleDraw, {
      capture: true,
      passive: true
    });

    observeZoomRoot();
    drawPickingBuffer();
  }

  whenGirafeReady(start);
})();
</script>

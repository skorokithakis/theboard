(function () {
  "use strict";

  if (typeof d3 === "undefined") {
    return;
  }

  var dataElement = document.getElementById("sitemap-data");
  var stage = document.querySelector("[data-sitemap-stage]");
  var svgRoot = d3.select("#sitemap-orbit");

  if (!dataElement || !stage || svgRoot.empty()) {
    return;
  }

  var destinations;
  try {
    destinations = JSON.parse(dataElement.textContent || "[]");
  } catch (_error) {
    destinations = [];
  }

  if (!Array.isArray(destinations) || !destinations.length) {
    return;
  }

  var detail = {
    title: document.querySelector("[data-sitemap-title]"),
    summary: document.querySelector("[data-sitemap-summary]"),
    kind: document.querySelector("[data-sitemap-kind]"),
    distance: document.querySelector("[data-sitemap-distance]"),
    link: document.querySelector("[data-sitemap-link]"),
  };

  var view = {
    width: Math.max(stage.clientWidth || 960, 760),
    height: Math.max(stage.clientHeight || 640, 520),
  };

  var radius = 1;
  var camera = 1;
  var yaw = -0.6;
  var pitch = -0.12;
  var drift = 0.0018;
  var dragging = false;
  var lastX = 0;
  var lastY = 0;

  var nodes = buildNodes(destinations);
  var links = buildLinks(nodes);
  var currentNodeId = nodes.length ? nodes[0].id : null;

  var linkLayer = svgRoot.append("g").attr("class", "sitemap-links");
  var nodeLayer = svgRoot.append("g").attr("class", "sitemap-nodes");

  recalcDimensions();
  render();
  updateDetail(nodes[0]);

  var autoTimer = d3.timer(step);

  stage.addEventListener("pointerdown", handlePointerDown);
  stage.addEventListener("keydown", handleKeyTilt);
  window.addEventListener("resize", debounce(recalcDimensions, 150));

  function buildNodes(data) {
    var orbitByKind = {
      capital: 0.38,
      fortress: 0.48,
      grove: 0.42,
      outpost: 0.46,
      ruins: 0.34,
      village: 0.52,
      library: 0.44,
      tower: 0.56,
      hamlet: 0.5,
    };
    var altitudeByKind = {
      capital: 0.06,
      fortress: 0.16,
      grove: -0.06,
      outpost: 0.12,
      ruins: -0.12,
      village: 0.14,
      library: 0.08,
      tower: 0.2,
      hamlet: -0.02,
    };

    var angleStride = (Math.PI * 2) / Math.max(data.length, 1);

    return data.map(function (destination, index) {
      var theta = index * angleStride + (index % 2 === 0 ? 0.4 : -0.2);
      var orbit = orbitByKind[destination.kind] || 0.46;
      var altitude = altitudeByKind[destination.kind] || 0;
      return {
        id: destination.name,
        name: destination.name,
        url: destination.url,
        summary: destination.summary,
        kind: destination.kind,
        orbit: orbit,
        altitude: altitude,
        theta: theta,
        base: { x: 0, y: 0, z: 0 },
      };
    });
  }

  function buildLinks(nodeList) {
    if (!nodeList.length) {
      return [];
    }

    var primary =
      nodeList.find(function (node) {
        return node.kind === "capital";
      }) || nodeList[0];

    var built = nodeList
      .filter(function (node) {
        return node.id !== primary.id;
      })
      .map(function (node) {
        return { source: primary.id, target: node.id, strength: 0.9 };
      });

    var grouped = d3.group(nodeList, function (node) {
      return node.kind;
    });
    grouped.forEach(function (groupNodes) {
      if (groupNodes.length < 2) {
        return;
      }
      for (var i = 0; i < groupNodes.length - 1; i += 1) {
        built.push({
          source: groupNodes[i].id,
          target: groupNodes[i + 1].id,
          strength: 0.4,
        });
      }
    });

    return built;
  }

  function recalcDimensions() {
    view.width = Math.max(stage.clientWidth || view.width, 760);
    view.height = Math.max(stage.clientHeight || view.height, 520);
    radius = Math.min(view.width, view.height) * 0.36;
    camera = radius * 3.2;
    svgRoot.attr("viewBox", "0 0 " + view.width + " " + view.height);
    recomputeBasePositions();
    render();
  }

  function recomputeBasePositions() {
    nodes.forEach(function (node, index) {
      var theta = node.theta;
      var orbitRadius = radius * node.orbit;
      node.base.x = Math.cos(theta) * orbitRadius;
      node.base.z = Math.sin(theta) * orbitRadius;
      node.base.y = node.altitude * radius;
      node.altitudeLabel = getAltitudeLabel(node.altitude);
      node.displayKind = formatKind(node.kind);
      node.index = index;
    });
  }

  function formatKind(kind) {
    return (kind || "destination").replace(/-/g, " ").replace(/\b\w/g, function (letter) {
      return letter.toUpperCase();
    });
  }

  function getAltitudeLabel(value) {
    if (value > 0.15) {
      return "High orbit";
    }
    if (value < -0.08) {
      return "Trench layer";
    }
    return "Stable orbit";
  }

  function rotate(point) {
    var cosYaw = Math.cos(yaw);
    var sinYaw = Math.sin(yaw);
    var cosPitch = Math.cos(pitch);
    var sinPitch = Math.sin(pitch);

    var xz = cosYaw * point.x + sinYaw * point.z;
    var zz = -sinYaw * point.x + cosYaw * point.z;

    var yx = cosPitch * point.y - sinPitch * zz;
    var zx = sinPitch * point.y + cosPitch * zz;

    return { x: xz, y: yx, z: zx };
  }

  function project(point) {
    var depth = camera - point.z;
    var scale = Math.max(0.35, camera / depth);
    return {
      x: view.width / 2 + point.x * scale,
      y: view.height / 2 + point.y * scale,
      depth: point.z,
      scale: scale,
    };
  }

  function render() {
    var projected = nodes.map(function (node) {
      var rotated = rotate(node.base);
      var projection = project(rotated);
      return Object.assign({}, node, rotated, {
        screenX: projection.x,
        screenY: projection.y,
        scale: projection.scale,
        depth: rotated.z,
      });
    });

    var nodeLookup = new Map();
    projected.forEach(function (node) {
      nodeLookup.set(node.id, node);
    });

    var linkSelection = linkLayer.selectAll("line").data(links, function (link) {
      return link.source + "-" + link.target;
    });

    linkSelection
      .join(function (enter) {
        return enter.append("line").attr("class", "orbit-link orbit-link--faint");
      })
      .attr("x1", function (link) {
        var source = nodeLookup.get(link.source);
        return source ? source.screenX : 0;
      })
      .attr("y1", function (link) {
        var source = nodeLookup.get(link.source);
        return source ? source.screenY : 0;
      })
      .attr("x2", function (link) {
        var target = nodeLookup.get(link.target);
        return target ? target.screenX : 0;
      })
      .attr("y2", function (link) {
        var target = nodeLookup.get(link.target);
        return target ? target.screenY : 0;
      })
      .attr("stroke-width", function (link) {
        var target = nodeLookup.get(link.target);
        var scale = target ? target.scale : 1;
        return (1 + (link.strength || 0.6)) * Math.min(scale, 1.4);
      })
      .attr("opacity", function (link) {
        var target = nodeLookup.get(link.target);
        return target && target.depth > 0 ? 0.45 : 0.65;
      });

    var nodeSelection = nodeLayer.selectAll("g.sitemap-node").data(projected, function (node) {
      return node.id;
    });

    var entered = nodeSelection
      .enter()
      .append("g")
      .attr("class", function (node) {
        return "sitemap-node sitemap-node--" + node.kind;
      })
      .attr("tabindex", 0)
      .attr("role", "link")
      .attr("aria-label", function (node) {
        return node.name + ": " + node.summary;
      })
      .on("pointerenter", function (_event, node) {
        updateDetail(node);
      })
      .on("focus", function (_event, node) {
        updateDetail(node);
      })
      .on("click", function (event, node) {
        event.preventDefault();
        updateDetail(node);
        if (node.url) {
          window.location.assign(node.url);
        }
      })
      .on("keydown", function (event, node) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          updateDetail(node);
          if (node.url) {
            window.location.assign(node.url);
          }
        }
      });

    entered.append("circle").attr("class", "sitemap-node__halo").attr("r", 26);
    entered.append("circle").attr("class", "sitemap-node__ring").attr("r", 18);
    entered.append("circle").attr("class", "sitemap-node__core").attr("r", 10);
    entered
      .append("text")
      .attr("class", "sitemap-node__label")
      .attr("text-anchor", "middle")
      .attr("dy", "0.35em")
      .text(function (node) {
        return node.name;
      });

    nodeSelection = entered.merge(nodeSelection);

    nodeSelection
      .attr("class", function (node) {
        var activeClass = node.id === currentNodeId ? " is-active" : "";
        return "sitemap-node sitemap-node--" + node.kind + activeClass;
      })
      .attr("transform", function (node) {
        return "translate(" + node.screenX + "," + node.screenY + ") scale(" + node.scale + ")";
      });

    nodeSelection.select(".sitemap-node__halo").attr("opacity", function (node) {
      return 0.6 + Math.max(0, node.depth / (radius * 0.8));
    });

    nodeSelection.select(".sitemap-node__core").attr("r", function (node) {
      var base = node.kind === "capital" ? 12 : 10;
      return base + node.scale * 2.2;
    });

    nodeSelection.select(".sitemap-node__ring").attr("r", function (node) {
      return 18 + node.scale * 3;
    });

    nodeSelection
      .select(".sitemap-node__label")
      .attr("font-size", function (node) {
        return Math.max(10, 12 - node.scale * 0.5);
      })
      .attr("opacity", function (node) {
        return 0.9 + Math.min(0.1, node.scale * 0.1);
      });

    nodeSelection.order().sort(function (a, b) {
      return a.depth - b.depth;
    });
  }

  function handlePointerDown(event) {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    stage.setPointerCapture(event.pointerId);
    stage.addEventListener("pointermove", handlePointerMove);
    stage.addEventListener("pointerup", handlePointerUp);
  }

  function handlePointerMove(event) {
    if (!dragging) {
      return;
    }
    var dx = event.clientX - lastX;
    var dy = event.clientY - lastY;
    yaw += dx * 0.003;
    pitch += dy * 0.003;
    pitch = Math.max(-1.1, Math.min(1.1, pitch));
    lastX = event.clientX;
    lastY = event.clientY;
    render();
  }

  function handlePointerUp(event) {
    dragging = false;
    stage.releasePointerCapture(event.pointerId);
    stage.removeEventListener("pointermove", handlePointerMove);
    stage.removeEventListener("pointerup", handlePointerUp);
  }

  function handleKeyTilt(event) {
    var handled = true;
    var delta = 0.08;
    if (event.key === "ArrowLeft") {
      yaw -= delta;
    } else if (event.key === "ArrowRight") {
      yaw += delta;
    } else if (event.key === "ArrowUp") {
      pitch -= delta;
    } else if (event.key === "ArrowDown") {
      pitch += delta;
    } else {
      handled = false;
    }

    if (handled) {
      event.preventDefault();
      pitch = Math.max(-1.2, Math.min(1.2, pitch));
      render();
    }
  }

  function updateDetail(node) {
    if (!node) {
      return;
    }
    currentNodeId = node.id;
    if (detail.title) {
      detail.title.textContent = node.name;
    }
    if (detail.summary) {
      detail.summary.textContent = node.summary || "";
    }
    if (detail.kind) {
      detail.kind.textContent = node.displayKind;
    }
    if (detail.distance) {
      detail.distance.textContent = node.altitudeLabel;
    }
    if (detail.link && node.url) {
      detail.link.setAttribute("href", node.url);
    }
    nodeLayer
      .selectAll("g.sitemap-node")
      .classed("is-active", function (candidate) {
        return candidate.id === node.id;
      });
  }

  function step() {
    if (!dragging) {
      yaw += drift;
    }
    render();
  }

  function debounce(callback, delay) {
    var timeout;
    return function () {
      window.clearTimeout(timeout);
      var args = arguments;
      timeout = window.setTimeout(function () {
        callback.apply(null, args);
      }, delay);
    };
  }
})();

;(function(){
// PolyTrack TAS - hitbox overlay.
//
// Draws real geometry into the game's own scene so the volumes are depth
// tested: a gate behind a wall is hidden, and one that is half behind a pillar
// is half drawn. An earlier version projected the boxes onto a 2D canvas over
// the game, which always drew on top and read as floating.
//
// What is drawn, as a bright outline with a light shade of the same colour:
//   yellow        every checkpoint gate on the track
//   red           every finish gate
//   own colour    each custom bruteforce trigger, with an abbreviated name
//                 billboarded at its centre
//
// The checkpoint and finish volumes are the detectors the game itself carries
// on each track part: world centre = part.xyz * partSize, rotated by the part's
// own rotation, with `size` as a full extent. That is the same box the physics
// module tests the car against, so what is drawn is what the game detects. The
// detector definitions come from the physics init payload the game builds for
// its own simulation worker, so no part lookup can go stale.
//
// "Show through scenery" drops the depth test for a volume so it stays visible
// behind the track. To stop that filling the screen, those volumes fade with
// distance from the camera down to a floor that keeps far ones readable.
//
// three.js classes are taken from objects already in the scene, or identified
// by behaviour, rather than constructed by name. This build is tree-shaken and
// has no Sprite, so labels are billboarded textured quads.

var CHECKPOINT_COLOR = 0xffd21e;
var FINISH_COLOR = 0xff3b30;
var FALLBACK_TRIGGER_COLOR = 0x33ccff;

// Distance fade for "show through scenery" volumes.
var STS_NEAR = 20;      // no fade closer than this
var STS_FAR = 420;      // fully faded past this
var STS_FLOOR = 0.28;   // never fade below this fraction of the base opacity

var BOX_CORNERS = [
    [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5],
    [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]
];
var BOX_FACES = [
    [0, 1, 2], [0, 2, 3], [5, 4, 7], [5, 7, 6], [4, 0, 3], [4, 3, 7],
    [1, 5, 6], [1, 6, 2], [4, 5, 1], [4, 1, 0], [3, 2, 6], [3, 6, 7]
];
var BOX_EDGES = [
    [0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6],
    [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]
];

function boxFillVertices() {
    var out = [];
    for (var i = 0; i < BOX_FACES.length; i++)
        for (var k = 0; k < 3; k++) {
            var v = BOX_CORNERS[BOX_FACES[i][k]];
            out.push(v[0], v[1], v[2]);
        }
    return new Float32Array(out);
}

/** The twelve real edges of the cube, with no face diagonals. */
function boxEdgeVertices() {
    var out = [];
    for (var i = 0; i < BOX_EDGES.length; i++) {
        var a = BOX_CORNERS[BOX_EDGES[i][0]], b = BOX_CORNERS[BOX_EDGES[i][1]];
        out.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    }
    return new Float32Array(out);
}

function spherePoint(u, v) {
    var theta = u * Math.PI * 2, phi = v * Math.PI;
    return [Math.sin(phi) * Math.cos(theta) * 0.5, Math.cos(phi) * 0.5, Math.sin(phi) * Math.sin(theta) * 0.5];
}

function sphereFillVertices(segments, rings) {
    var out = [];
    for (var i = 0; i < segments; i++)
        for (var j = 0; j < rings; j++) {
            var a = spherePoint(i / segments, j / rings), b = spherePoint((i + 1) / segments, j / rings);
            var c = spherePoint((i + 1) / segments, (j + 1) / rings), d = spherePoint(i / segments, (j + 1) / rings);
            out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
            out.push(a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]);
        }
    return new Float32Array(out);
}

/** Three orthogonal rings, which read as a sphere from any angle. */
function sphereEdgeVertices(steps) {
    var out = [];
    var planes = [[0, 1], [1, 2], [2, 0]];
    for (var p = 0; p < planes.length; p++)
        for (var i = 0; i < steps; i++) {
            var a = [0, 0, 0], b = [0, 0, 0];
            var t0 = i / steps * Math.PI * 2, t1 = (i + 1) / steps * Math.PI * 2;
            a[planes[p][0]] = Math.cos(t0) * 0.5; a[planes[p][1]] = Math.sin(t0) * 0.5;
            b[planes[p][0]] = Math.cos(t1) * 0.5; b[planes[p][1]] = Math.sin(t1) * 0.5;
            out.push(a[0], a[1], a[2], b[0], b[1], b[2]);
        }
    return new Float32Array(out);
}

var QUAD_POSITIONS = new Float32Array([
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0,
    -0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0
]);
var QUAD_UVS = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);

/**
 * "Trigger 2" -> "T2", "Wallride entry" -> "We". The first letter of each word,
 * the first capitalised and the rest lowered. A single word keeps two letters
 * so it is not reduced to one.
 */
function abbreviate(name) {
    var parts = String(name == null ? "" : name).trim().split(/\s+/);
    var words = [];
    for (var i = 0; i < parts.length; i++) if (parts[i]) words.push(parts[i]);
    if (!words.length) return "?";
    if (words.length === 1) {
        var word = words[0];
        return word.charAt(0).toUpperCase() + (word.length > 1 ? word.charAt(1).toLowerCase() : "");
    }
    var out = "";
    for (var w = 0; w < words.length && out.length < 5; w++) {
        // A number keeps all of its digits, so "Trigger 12" is T12 and not T1.
        if (/^\d+$/.test(words[w])) { out += words[w]; continue; }
        var ch = words[w].charAt(0);
        out += w === 0 ? ch.toUpperCase() : ch.toLowerCase();
    }
    return out;
}

function parseColor(value, fallback) {
    if (typeof value === "number" && isFinite(value)) return value >>> 0;
    if (typeof value === "string") {
        var text = value.charAt(0) === "#" ? value.slice(1) : value;
        if (text.length === 6) {
            var parsed = parseInt(text, 16);
            if (isFinite(parsed)) return parsed >>> 0;
        }
    }
    return fallback;
}

function findMesh(object) {
    if (!object) return null;
    if (object.isMesh && object.geometry && object.geometry.attributes &&
        object.geometry.attributes.position && object.material) return object;
    var children = object.children || [];
    for (var i = 0; i < children.length; i++) {
        var found = findMesh(children[i]);
        if (found) return found;
    }
    return null;
}

/**
 * LineSegments, a line material, an unlit mesh material and a texture class.
 *
 * All are identified by behaviour rather than by name or by a type flag.
 * Several three.js helpers (Box3Helper and friends) extend LineSegments and so
 * carry the same isLineSegments flag, but they build their own geometry and
 * ignore the arguments passed to them - picking one of those silently drew an
 * eight-vertex white box instead of the outline. Requiring the constructor to
 * actually keep the geometry it is handed rules them out.
 */
function findExtraClasses(probeGeometry, probeMaterial) {
    var T = globalThis.__polyTasTrackHelpers && globalThis.__polyTasTrackHelpers.three;
    if (!T || !probeGeometry) return null;
    var Segments = null, LineMaterial = null, BasicMaterial = null, Texture = null;
    var canvas = null;
    try {
        canvas = document.createElement("canvas");
        canvas.width = canvas.height = 4;
    } catch (e) { canvas = null; }

    for (var key in T) {
        var v;
        try { v = T[key]; } catch (e) { continue; }
        if (typeof v !== "function" || !v.prototype) continue;
        var proto = v.prototype;
        // Only ever construct scene-graph, material and texture classes; leave
        // anything that could touch a GL context alone.
        if (typeof proto.render === "function" || typeof proto.setSize === "function") continue;

        if (!Segments && typeof proto.computeLineDistances === "function" &&
            typeof proto.raycast === "function") {
            var line;
            try { line = new v(probeGeometry, probeMaterial); } catch (e) { line = null; }
            if (line && line.isLineSegments === true && line.geometry === probeGeometry) Segments = v;
        }
        // onBeforeCompile lives on Material.prototype and nowhere else, so it
        // is a reliable gate that keeps this branch inside the material classes.
        if ((!LineMaterial || !BasicMaterial) && typeof proto.onBeforeCompile === "function" &&
            typeof proto.dispose === "function" && typeof proto.copy === "function") {
            var mat;
            // Construct with no parameters: passing a colour to a material that
            // has none makes three log a warning for every candidate tried.
            try { mat = new v({}); } catch (e) { mat = null; }
            if (mat && mat.color) {
                if (!LineMaterial && mat.isLineBasicMaterial === true && mat.isLineDashedMaterial !== true) {
                    try { mat.color.setHex(0x123456); } catch (e) {}
                    if (mat.color.getHex() === 0x123456) LineMaterial = v;
                }
                if (!BasicMaterial && mat.isMeshBasicMaterial === true) BasicMaterial = v;
            }
        }
        if (!Texture && canvas && typeof proto.updateMatrix === "function" &&
            typeof proto.dispose === "function" && typeof proto.clone === "function" &&
            typeof proto.raycast !== "function") {
            var tex;
            try { tex = new v(canvas); } catch (e) { tex = null; }
            if (tex && tex.isTexture === true) Texture = v;
        }
        if (Segments && LineMaterial && BasicMaterial && Texture) break;
    }
    return { Segments: Segments, LineMaterial: LineMaterial, BasicMaterial: BasicMaterial, Texture: Texture };
}

function buildGeometry(kit, vertices, uvs) {
    // BufferAttribute requires a typed array. The game's collision triangle
    // data can arrive here as an ordinary Array, which made only the car hull
    // fail while the generated trigger geometry continued to render.
    if (!(vertices && ArrayBuffer.isView(vertices))) vertices = new Float32Array(vertices || []);
    if (uvs && !ArrayBuffer.isView(uvs)) uvs = new Float32Array(uvs);
    var geometry = new kit.Geometry();
    try { geometry.setIndex(null); } catch (e) {}
    for (var name in (geometry.attributes || {})) {
        try { geometry.deleteAttribute(name); } catch (e) {}
    }
    geometry.setAttribute("position", new kit.Attribute(vertices, 3));
    if (uvs) geometry.setAttribute("uv", new kit.Attribute(uvs, 2));
    try { geometry.computeVertexNormals(); } catch (e) {}
    return geometry;
}

var COLLISION_PALETTE = [
    0xff4d6d, 0xffa62b, 0xffe66d, 0x6cff7d, 0x35d7ff,
    0x6c8cff, 0xb878ff, 0xff70d2, 0x58e1c1, 0xffffff
];

/** Builds non-indexed collision triangles with one stable colour per face. */
function buildCollisionGeometry(kit, vertices, asEdges) {
    var source = ArrayBuffer.isView(vertices) ? vertices : new Float32Array(vertices || []);
    var positions = [], colors = [];
    for (var i = 0, face = 0; i + 8 < source.length; i += 9, face++) {
        var color = COLLISION_PALETTE[face % COLLISION_PALETTE.length];
        var cr = ((color >> 16) & 255) / 255, cg = ((color >> 8) & 255) / 255, cb = (color & 255) / 255;
        var order = asEdges ? [0,1, 1,2, 2,0] : [0,1,2];
        for (var j = 0; j < order.length; j++) {
            var k = i + order[j] * 3;
            positions.push(source[k], source[k+1], source[k+2]);
            colors.push(cr, cg, cb);
        }
    }
    var geometry = buildGeometry(kit, new Float32Array(positions));
    geometry.setAttribute("color", new kit.Attribute(new Float32Array(colors), 3));
    return geometry;
}

function buildVertexColorMaterial(kit, opacity, throughScenery, lines) {
    var material = lines ? buildLineMaterial(kit, 0xffffff, opacity, throughScenery)
        : buildFillMaterial(kit, 0xffffff, opacity, throughScenery);
    material.vertexColors = true;
    material.wireframe = lines && !kit.Segments;
    material.needsUpdate = true;
    return material;
}

function makeToolkit(scene) {
    var sample = findMesh(scene);
    if (!sample) return null;
    var material = Array.isArray(sample.material) ? sample.material[0] : sample.material;
    if (!material || typeof material.clone !== "function") return null;
    var kit = {
        Mesh: sample.constructor,
        Geometry: sample.geometry.constructor,
        Attribute: sample.geometry.attributes.position.constructor,
        material: material,
        Segments: null, LineMaterial: null, BasicMaterial: null, Texture: null
    };
    var probe = null;
    try { probe = buildGeometry(kit, new Float32Array([0, 0, 0, 1, 0, 0])); } catch (e) { probe = null; }
    var extra = findExtraClasses(probe, material) || {};
    kit.Segments = extra.Segments || null;
    kit.LineMaterial = extra.LineMaterial || null;
    kit.BasicMaterial = extra.BasicMaterial || null;
    kit.Texture = extra.Texture || null;
    // The renderer's normal depth comparison, read off a freshly built material
    // rather than hardcoded.
    kit.depthFunc = null;
    try {
        var reference = kit.LineMaterial ? new kit.LineMaterial({})
            : (kit.BasicMaterial ? new kit.BasicMaterial({}) : null);
        if (reference) kit.depthFunc = reference.depthFunc;
    } catch (e) {}
    return kit;
}

function applyCommon(kit, m, color, opacity, throughScenery) {
    m.transparent = true;
    m.opacity = opacity;
    // "Show through scenery" is exactly this: skip the depth comparison so the
    // volume draws over whatever is in front of it.
    m.depthTest = !throughScenery;
    m.depthWrite = false;            // translucent, so do not block what is behind
    // A borrowed material can carry an unusual depth comparison - a sky or
    // background mesh may draw with the depth test effectively disabled - which
    // let the shaded interior show straight through scenery while the outline
    // was correctly hidden. Pin the comparison to the renderer's normal one.
    if (kit && kit.depthFunc != null) m.depthFunc = kit.depthFunc;
    m.polygonOffset = false;
    m.fog = false;
    m.toneMapped = false;
    // The game runs cascaded shadow maps, which patch the materials they manage.
    // Dropping any own shader hook falls back to the prototype no-op so the
    // clone compiles as a plain material.
    try { delete m.onBeforeCompile; } catch (e) {}
    try { delete m.customProgramCacheKey; } catch (e) {}
    try { m.color.setHex(color); } catch (e) {}
    m.needsUpdate = true;
    return m;
}

/**
 * The shaded interior: the same colour as the outline, only translucent, so a
 * yellow checkpoint reads as light yellow and a blue trigger as light blue.
 * An unlit material is used so the colour comes out exactly as asked rather
 * than being shaded by the sun, and so nothing is inherited from whichever mesh
 * the constructors were borrowed from.
 */
function buildFillMaterial(kit, color, opacity, throughScenery) {
    var m;
    if (kit.BasicMaterial) {
        m = new kit.BasicMaterial({});
    } else {
        m = kit.material.clone();
        try { m.map = null; m.normalMap = null; m.roughnessMap = null; m.metalnessMap = null; } catch (e) {}
        try { m.metalness = 0; m.roughness = 1; } catch (e) {}
        try { m.emissive.setHex(color); m.emissiveIntensity = 1; } catch (e) {}
    }
    m.vertexColors = false;
    m.wireframe = false;
    m.side = 2;                      // DoubleSide, visible from inside the volume
    applyCommon(kit, m, color, opacity, throughScenery);
    return m;
}

function buildLineMaterial(kit, color, opacity, throughScenery) {
    if (kit.LineMaterial) {
        return applyCommon(kit, new kit.LineMaterial({}), color, opacity, throughScenery);
    }
    var m = kit.material.clone();
    m.vertexColors = false;
    m.wireframe = true;
    m.side = 2;
    applyCommon(kit, m, color, opacity, throughScenery);
    try { m.emissive.setHex(color); m.emissiveIntensity = 1; } catch (e) {}
    return m;
}

/** Draws the abbreviation into a canvas, ready to be used as a texture. */
function makeLabelCanvas(text, color) {
    var canvas = document.createElement("canvas");
    var fontSize = 96;
    var font = "bold " + fontSize + "px ForcedSquare, Consolas, monospace";
    var measure = canvas.getContext("2d");
    measure.font = font;
    canvas.width = Math.max(fontSize, Math.ceil(measure.measureText(text).width) + 48);
    canvas.height = Math.ceil(fontSize * 1.5);
    var context = canvas.getContext("2d");
    context.font = font;
    context.textAlign = "center";
    context.textBaseline = "middle";
    // A dark halo keeps the label readable against bright scenery.
    context.lineWidth = 12;
    context.lineJoin = "round";
    context.strokeStyle = "rgba(0,0,0,0.85)";
    context.strokeText(text, canvas.width / 2, canvas.height / 2);
    context.fillStyle = "#" + ("000000" + color.toString(16)).slice(-6);
    context.fillText(text, canvas.width / 2, canvas.height / 2);
    return canvas;
}

// The game builds a new race viewer for every run, but the renderer it is
// handed - and so the scene these volumes are added to - outlives it. Holding
// the overlay on the viewer therefore orphaned every mesh it had drawn: the
// boxes of the previous run stayed in the scene with nothing left to clear
// them, so moving a trigger left its old box standing beside the new one and
// loading another track kept the gates of the one before it. The state is a
// singleton instead, so one set of meshes is reused and cleared however often
// the viewer is rebuilt.
globalThis.__polyTasSetupTriggerOverlay = function (view) {
    // The HUD already receives the selected car every frame. Wrap that public hook once
    // so the collision overlay can follow the same car without reaching through any of
    // the bundle's private WeakMap fields.
    if (!view._polyTasSelectedCarHooked && typeof view._updateFrameStateHud === "function") {
        var oldFrameHud = view._updateFrameStateHud;
        view._updateFrameStateHud = function (car, frame) {
            view._polyTasSelectedCar = car || null;
            var result = oldFrameHud(car, frame);
            try {
                var state = car && car.getCarState && car.getCarState();
                if (view._frameStateHudText && state && Number.isFinite(Number(state.frames))) {
                    var lines = view._frameStateHudText.textContent.split("\n");
                    lines.splice(2, 0, "Absolute physics frame: " + Math.floor(Number(state.frames)));
                    view._frameStateHudText.textContent = lines.join("\n");
                }
            } catch (e) {}
            return result;
        };
        view._polyTasSelectedCarHooked = true;
    }
    var overlay = globalThis.__polyTasOverlayState;
    var first = !overlay;
    if (first) {
        overlay = {
            items: [], signature: null, scene: null, kit: null, kitScene: null,
            boxFill: null, boxEdge: null, sphereFill: null, sphereEdge: null, quad: null,
            config: null, view: null, generation: 0, trackSource: null, trackSerial: 0
        };
        globalThis.__polyTasOverlayState = overlay;
    }
    // A second call for the same viewer is a no-op; a new viewer still needs
    // its own draw and free-cam entry points, sharing the one state.
    if (view._polyTasOverlay === overlay && view._polyTasDrawTrigger) return;
    view._polyTasOverlay = overlay;
    overlay.view = view;
    view._polyTasDispose = function () {
        if (overlay.view !== view) return;
        clear();
        if (overlay.targetHud) overlay.targetHud.style.display = 'none';
        overlay.view = null;
        overlay.signature = null;
    };

    if (first) {
        try {
            var ipc = window.electron;
            if (ipc) {
                if (ipc.tasToolTriggerRequest) {
                    try { overlay.config = ipc.tasToolTriggerRequest() || null; } catch (e) {}
                }
                if (ipc.onTasToolTriggerUpdate) {
                    ipc.onTasToolTriggerUpdate(function (cfg) { overlay.config = cfg || null; });
                }
                // Routed through whichever viewer set up last, which is the one
                // the renderer is drawing with.
                if (ipc.onTasToolToggleFreeCam) {
                    ipc.onTasToolToggleFreeCam(function () {
                        var current = overlay.view;
                        try { current && current._polyTasToggleFreeCam && current._polyTasToggleFreeCam(); } catch (e) {}
                    });
                }
            }
        } catch (e) {}
        // Shift is the spectator speed modifier. If a user binding also maps it to
        // ghost visibility, the game's later listener can hide the car. Restore the
        // previously visible selected car after dispatch without blocking freecam.
        window.addEventListener("keydown", function (event) {
            if (event.code !== "ShiftLeft" && event.code !== "ShiftRight") return;
            var current = overlay.view, car = current && current._polyTasSelectedCar;
            if (!car || overlay.selectedCarWasVisible === false || (overlay.config && (overlay.config.showCarHitbox || overlay.config.highlightCollisionPolys))) return;
            setTimeout(function(){ try { car.setVisible(true); } catch (e) {} }, 0);
        });
    }

    function clear() {
        for (var i = 0; i < overlay.items.length; i++) {
            var object = overlay.items[i].object;
            try { if (object.parent) object.parent.remove(object); } catch (e) {}
            try { object.material && object.material.map && object.material.map.dispose(); } catch (e) {}
            try { object.material && object.material.dispose(); } catch (e) {}
        }
        overlay.items.length = 0;
    }

    /**
     * Removes anything this overlay has left in the scene that the item list no
     * longer accounts for. Volumes are added to the scene root, so a shallow
     * pass covers them, and it only runs when they are rebuilt.
     */
    function sweep(scene) {
        if (!scene || !scene.children) return;
        for (var i = scene.children.length - 1; i >= 0; i--) {
            var child = scene.children[i];
            var data = child && child.userData;
            if (!data || data.__polyTasOverlay !== true) continue;
            if (data.__polyTasGeneration === overlay.generation) continue;
            try { scene.remove(child); } catch (e) {}
            try { child.material && child.material.map && child.material.map.dispose(); } catch (e) {}
            try { child.material && child.material.dispose(); } catch (e) {}
        }
    }

    function place(obj, centre, halfExtents, quaternion) {
        obj.position.set(centre[0], centre[1], centre[2]);
        if (quaternion) obj.quaternion.set(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
        obj.scale.set(halfExtents[0] * 2, halfExtents[1] * 2, halfExtents[2] * 2);
        obj.castShadow = false;
        obj.receiveShadow = false;
        obj.frustumCulled = false;
    }

    function track(object, baseOpacity, throughScenery, billboard) {
        object.renderOrder = throughScenery ? 12 : 10;
        // Stamped so a mesh the item list has lost can still be found and
        // removed from the scene it was added to.
        try {
            object.userData = object.userData || {};
            object.userData.__polyTasOverlay = true;
            object.userData.__polyTasGeneration = overlay.generation;
        } catch (e) {}
        overlay.items.push({
            object: object, baseOpacity: baseOpacity,
            throughScenery: !!throughScenery, billboard: !!billboard
        });
    }

    function addVolume(scene, kit, shape, centre, halfExtents, quaternion, color, emphasis, sts, label) {
        var sphere = shape === "sphere";
        var fillOpacity = emphasis ? 0.22 : 0.14;
        var lineOpacity = emphasis ? 1 : 0.9;

        var fill = new kit.Mesh(sphere ? overlay.sphereFill : overlay.boxFill,
            buildFillMaterial(kit, color, fillOpacity, sts));
        place(fill, centre, halfExtents, quaternion);
        scene.add(fill);
        track(fill, fillOpacity, sts, false);

        var edgeGeometry = sphere ? overlay.sphereEdge : overlay.boxEdge;
        var outline;
        if (kit.Segments) {
            outline = new kit.Segments(edgeGeometry, buildLineMaterial(kit, color, lineOpacity, sts));
        } else {
            outline = new kit.Mesh(sphere ? overlay.sphereFill : overlay.boxFill,
                buildLineMaterial(kit, color, lineOpacity, sts));
        }
        place(outline, centre, halfExtents, quaternion);
        scene.add(outline);
        track(outline, lineOpacity, sts, false);

        var made = [fill, outline];
        if (label && kit.Texture && kit.BasicMaterial && overlay.quad) {
            try {
                var canvas = makeLabelCanvas(label, color);
                var texture = new kit.Texture(canvas);
                texture.needsUpdate = true;
                var material = new kit.BasicMaterial({});
                material.map = texture;
                material.side = 2;
                // White base colour so the texture's own colours come through.
                applyCommon(kit, material, 0xffffff, 1, sts);
                var text = new kit.Mesh(overlay.quad, material);
                // Sized in world units so it shrinks naturally with distance,
                // and kept in proportion to the volume it belongs to.
                var height = Math.max(0.9, Math.min(3.5, Math.min(halfExtents[0], halfExtents[1]) * 1.2));
                text.position.set(centre[0], centre[1], centre[2]);
                text.scale.set(height * (canvas.width / canvas.height), height, 1);
                text.castShadow = false;
                text.receiveShadow = false;
                scene.add(text);
                track(text, 1, sts, true);
                made.push(text);
            } catch (e) { /* labels are optional */ }
        }
        return made;
    }

    /** Detector definitions by part id, from the game's own physics init payload. */
    function detectorTable() {
        var init = globalThis.__polyTasPhysicsInit;
        if (!init || !init.trackParts) return null;
        if (overlay.detectorTable && overlay.detectorSource === init) return overlay.detectorTable;
        var table = {};
        for (var i = 0; i < init.trackParts.length; i++) {
            var part = init.trackParts[i];
            if (part && part.detector) table[part.id] = part.detector;
        }
        overlay.detectorTable = table;
        overlay.detectorSource = init;
        return table;
    }

    /** The viewer holds the track and its layout in two fields; take whichever iterates. */
    function resolveTrackData() {
        for (var i = 0; i < arguments.length; i++) {
            var candidate = arguments[i];
            if (!candidate) continue;
            if (typeof candidate.forEachPart === "function") return candidate;
            if (typeof candidate.getTrackData === "function") {
                try {
                    var inner = candidate.getTrackData();
                    if (inner && typeof inner.forEachPart === "function") return inner;
                } catch (e) {}
            }
        }
        return null;
    }

    function trackDetectors(trackData) {
        var helpers = globalThis.__polyTasTrackHelpers;
        var table = detectorTable();
        var found = [];
        if (!helpers || !table || !trackData) return found;
        var partSize = helpers.partSize;
        trackData.forEachPart(function (x, y, z, partId, rotation, rotationAxis) {
            var detector = table[partId];
            if (!detector) return;
            var q;
            try { q = helpers.rotationQuat(rotation, rotationAxis); } catch (e) { return; }
            var c = detector.center;
            var vx = c[0], vy = c[1], vz = c[2];
            var ix = q.w * vx + q.y * vz - q.z * vy;
            var iy = q.w * vy + q.z * vx - q.x * vz;
            var iz = q.w * vz + q.x * vy - q.y * vx;
            var iw = -q.x * vx - q.y * vy - q.z * vz;
            var rx = ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y;
            var ry = iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z;
            var rz = iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x;
            found.push({
                type: detector.type,
                centre: [x * partSize + rx, y * partSize + ry, z * partSize + rz],
                half: [Math.abs(detector.size[0]) / 2, Math.abs(detector.size[1]) / 2, Math.abs(detector.size[2]) / 2],
                quaternion: [q.x, q.y, q.z, q.w]
            });
        });
        return found;
    }

    /** Draws the exact collision triangle soup for every placed track part. */
    function addTrackCollisionPolys(scene, kit, trackData) {
        var init = globalThis.__polyTasPhysicsInit;
        var helpers = globalThis.__polyTasTrackHelpers;
        if (!init || !Array.isArray(init.trackParts) || !helpers || !trackData) return;
        var byId = {};
        for (var i=0; i<init.trackParts.length; i++) {
            var part = init.trackParts[i];
            if (part && part.vertices && part.vertices.length >= 9) byId[part.id] = part.vertices;
        }
        if (overlay.collisionGeometrySource !== init) {
            overlay.collisionGeometrySource = init;
            overlay.collisionGeometryCache = {};
        }
        var geometryCache = overlay.collisionGeometryCache || (overlay.collisionGeometryCache = {});
        trackData.forEachPart(function(x, y, z, partId, rotation, rotationAxis) {
            var vertices = byId[partId];
            if (!vertices) return;
            var key = String(partId);
            var cached = geometryCache[key];
            if (!cached) cached = geometryCache[key] = {
                fill: buildCollisionGeometry(kit, vertices, false),
                edge: buildCollisionGeometry(kit, vertices, true)
            };
            var q;
            try { q = helpers.rotationQuat(rotation, rotationAxis); } catch (e) { return; }
            var centre = [x * helpers.partSize, y * helpers.partSize, z * helpers.partSize];
            var quat = [q.x, q.y, q.z, q.w];
            var fill = new kit.Mesh(cached.fill, buildVertexColorMaterial(kit, 0.12, false, false));
            fill.position.set(centre[0], centre[1], centre[2]);
            fill.quaternion.set(quat[0], quat[1], quat[2], quat[3]);
            fill.castShadow=false; fill.receiveShadow=false; fill.frustumCulled=false;
            scene.add(fill); track(fill, 0.12, false, false);
            var outline = kit.Segments
                ? new kit.Segments(cached.edge, buildVertexColorMaterial(kit, 0.82, false, true))
                : new kit.Mesh(cached.fill, buildVertexColorMaterial(kit, 0.82, false, true));
            outline.position.copy(fill.position); outline.quaternion.copy(fill.quaternion);
            outline.castShadow=false; outline.receiveShadow=false; outline.frustumCulled=false;
            scene.add(outline); track(outline, 0.82, false, false);
        });
    }

    var WHEEL_CONNECTIONS = [
        [ 0.627909, 0.27,  1.3478], [-0.627909, 0.27,  1.3478],
        [ 0.720832, 0.27, -1.52686],[-0.720832, 0.27, -1.52686]
    ];
    var WHEEL_COLORS = [0x35d7ff, 0xff70d2, 0xffa62b, 0xb878ff];

    function tagCarParts(objects, data) {
        for (var i=0; objects && i<objects.length; i++) {
            objects[i].userData = objects[i].userData || {};
            objects[i].userData.__polyTasCarPart = data;
        }
    }

    function rotateLocal(q, x, y, z) {
        var ix=q.w*x+q.y*z-q.z*y, iy=q.w*y+q.z*x-q.x*z, iz=q.w*z+q.x*y-q.y*x;
        var iw=-q.x*x-q.y*y-q.z*z;
        return [ix*q.w+iw*-q.x+iy*-q.z-iz*-q.y,
                iy*q.w+iw*-q.y+iz*-q.x-ix*-q.z,
                iz*q.w+iw*-q.z+ix*-q.y-iy*-q.x];
    }

    function updateCarPart(object, car) {
        var data = object.userData && object.userData.__polyTasCarPart;
        if (!data || !car) return;
        var pos=car.getPosition(), q=car.getQuaternion(), state=null, local;
        try { state=car.getCarState(); } catch (e) {}
        var suspension = state && state.wheelSuspensionLength || [0.078095,0.078095,0.078129,0.078129];
        if (data.kind === "body") local=[0, Number(data.massOffset)||0.6, 0];
        else if (data.kind === "wheel") {
            var wc=WHEEL_CONNECTIONS[data.index], sl=Number(suspension[data.index]);
            if (!isFinite(sl)) sl=data.index<2?0.078095:0.078129;
            local=[wc[0], wc[1]-sl, wc[2]];
        } else if (data.kind === "axle") {
            var a=WHEEL_CONNECTIONS[data.left], b=WHEEL_CONNECTIONS[data.right];
            var sa=Number(suspension[data.left]), sb=Number(suspension[data.right]);
            if (!isFinite(sa)) sa=0.078; if (!isFinite(sb)) sb=0.078;
            local=[(a[0]+b[0])/2, (a[1]-sa+b[1]-sb)/2, (a[2]+b[2])/2];
        } else if (data.kind === "suspension") {
            var c=WHEEL_CONNECTIONS[data.index], s=Number(suspension[data.index]);
            if (!isFinite(s)) s=0.078;
            local=[c[0], c[1]-s/2, c[2]];
            object.scale.y=Math.max(0.01,s);
        } else return;
        var world=rotateLocal(q,local[0],local[1],local[2]);
        object.position.set(pos.x+world[0],pos.y+world[1],pos.z+world[2]);
        object.quaternion.set(q.x,q.y,q.z,q.w);
    }

    function euler(xd, yd, zd) {
        var hx = xd * Math.PI / 360, hy = yd * Math.PI / 360, hz = zd * Math.PI / 360;
        var cx = Math.cos(hx), sx = Math.sin(hx), cy = Math.cos(hy), sy = Math.sin(hy), cz = Math.cos(hz), sz = Math.sin(hz);
        return [sx * cy * cz + cx * sy * sz, cx * sy * cz - sx * cy * sz, cx * cy * sz + sx * sy * cz, cx * cy * cz - sx * sy * sz];
    }

    // A DOM marker is kept in addition to the scene geometry.  It uses the
    // active camera's own Vector3 implementation for projection, so it remains
    // available even if this particular three.js build does not expose enough
    // constructors for the optional 3D label/material discovery above.
    function targetHud() {
        if (overlay.targetHud && overlay.targetHud.isConnected) return overlay.targetHud;
        try {
            var root = document.body;
            var marker = document.createElement("div");
            marker.id = "poly-tas-distance-target";
            marker.style.cssText = "position:fixed;left:0;top:0;z-index:2147483645;display:none;transform:translate(-50%,-50%);pointer-events:none;font:700 13px/1 ForcedSquare,Consolas,monospace;text-align:center;text-shadow:0 0 3px #000,0 0 7px #000;";
            root.appendChild(marker);
            overlay.targetHud = marker;
            return marker;
        } catch (e) { return null; }
    }

    function updateTargetHud(camera, point, enabled, config) {
        var marker = enabled ? targetHud() : overlay.targetHud;
        if (!marker) return;
        if (!enabled || !camera || !camera.position || typeof camera.position.clone !== "function") {
            marker.style.display = "none";
            return;
        }
        try {
            config = config || {};
            var style = ["crosshair", "ring", "cube", "diamond"].indexOf(config.style) >= 0 ? config.style : "crosshair";
            var colorNumber = parseColor(config.color, 0x35d7ff);
            var color = "#" + ("000000" + colorNumber.toString(16)).slice(-6);
            var worldSize = Math.max(0.1, Math.min(20, Number(config.size) || 1.15));
            var pixels = Math.max(14, Math.min(96, Math.round(28 * worldSize / 1.15)));
            var hudSignature = style + ":" + color + ":" + pixels;
            if (marker.getAttribute("data-marker-style") !== hudSignature) {
                var radius = style === "ring" || style === "crosshair" ? "50%" : "2px";
                var rotate = style === "diamond" ? "transform:rotate(45deg);" : "";
                var axes = style === "crosshair"
                    ? '<i style="position:absolute;left:50%;top:-30%;width:2px;height:160%;background:'+color+';transform:translateX(-50%)"></i><i style="position:absolute;top:50%;left:-30%;height:2px;width:160%;background:'+color+';transform:translateY(-50%)"></i>'
                    : "";
                marker.innerHTML = '<div style="width:'+pixels+'px;height:'+pixels+'px;border:3px solid '+color+';border-radius:'+radius+';box-sizing:border-box;position:relative;margin:auto;'+rotate+'">'+axes+'</div><div style="margin-top:7px;color:'+color+'">TARGET</div>';
                marker.style.filter = "drop-shadow(0 0 4px " + color + ")";
                marker.setAttribute("data-marker-style", hudSignature);
            }
            var projected = camera.position.clone();
            projected.set(Number(point[0]) || 0, Number(point[1]) || 0, Number(point[2]) || 0);
            projected.project(camera);
            if (!isFinite(projected.x) || !isFinite(projected.y) || !isFinite(projected.z) || projected.z < -1 || projected.z > 1) {
                marker.style.display = "none";
                return;
            }
            var canvas = document.getElementById("screen") || document.querySelector("canvas");
            var rect = canvas && canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { left:0, top:0, width:innerWidth, height:innerHeight };
            marker.style.left = (rect.left + (projected.x + 1) * rect.width / 2) + "px";
            marker.style.top = (rect.top + (1 - projected.y) * rect.height / 2) + "px";
            marker.style.display = "block";
        } catch (e) { marker.style.display = "none"; }
    }

    /**
     * Turns the game's own free camera on or off, exactly as its own shortcut
     * does: the free camera is first placed where the active camera is looking,
     * then the toggle listener the game already installed swaps which camera
     * the renderer draws with.
     */
    view._polyTasToggleFreeCam = function () {
        var freeCam = view._polyTasFreeCam;
        var renderer = view._polyTasRenderer;
        if (!freeCam || typeof freeCam.toggle !== "function") return false;
        if (!freeCam.isEnabled && renderer && renderer.camera && freeCam.camera) {
            try {
                freeCam.camera.position.copy(renderer.camera.position);
                // Copying the quaternion uses only public three.js state. The older
                // Euler helper was borrowed from another bundle class and could trip
                // its transpiled private-field guard on some builds/macOS runtimes.
                freeCam.camera.quaternion.copy(renderer.camera.quaternion);
            } catch (e) {}
        }
        freeCam.isEnabled = !freeCam.isEnabled;
        return true;
    };

    /**
     * Runs every frame: turns the labels to face the camera, and fades the
     * show-through-scenery volumes with distance so nearby ones read at their
     * normal strength while distant ones do not clutter the view.
     */
    function updateDynamic(camera) {
        if (!camera || !camera.position || !overlay.items.length) return;
        var cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
        for (var i = 0; i < overlay.items.length; i++) {
            var entry = overlay.items[i];
            var object = entry.object;
            if (object.userData && object.userData.__polyTasCarPart && overlay.view && overlay.view._polyTasSelectedCar) {
                try { updateCarPart(object, overlay.view._polyTasSelectedCar); } catch (e) {}
            }
            if (entry.billboard) {
                try { object.quaternion.copy(camera.quaternion); } catch (e) {}
            }
            if (!entry.throughScenery) continue;
            var dx = object.position.x - cx, dy = object.position.y - cy, dz = object.position.z - cz;
            var distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
            var t = (distance - STS_NEAR) / (STS_FAR - STS_NEAR);
            if (t < 0) t = 0; else if (t > 1) t = 1;
            object.material.opacity = entry.baseOpacity * (1 - (1 - STS_FLOOR) * t);
        }
    }

    view._polyTasDrawTrigger = function (renderer, trackA, trackB, freeCam) {
        // The first setup call happens during viewer construction, before the
        // frame HUD callback exists.  Re-enter setup here once; its early-return
        // path installs the now-available selected-car hook without rebuilding
        // the overlay.
        if (!view._polyTasSelectedCarHooked) {
            try { globalThis.__polyTasSetupTriggerOverlay(view); } catch (e) {}
        }
        view._polyTasRenderer = renderer || null;
        if (freeCam) view._polyTasFreeCam = freeCam;
        overlay.view = view;
        var cfg = overlay.config;
        var scene = renderer && renderer.scene;
        if (!scene) return;

        // Triggers are drawn only while the Trigger objective is the selected
        // one, which is when the TAS tool shows the panel that manages them.
        // They used to be drawn from the moment the tool opened, which put a
        // box on the track before any trigger had been asked for.
        var triggersEnabled = !!(cfg && cfg.triggersEnabled);
        var triggers = (triggersEnabled && cfg && Array.isArray(cfg.triggers)) ? cfg.triggers : [];
        var showCheckpoints = !!(cfg && cfg.showCheckpoints);
        var showFinish = !!(cfg && cfg.showFinish);
        var gatesThroughScenery = !!(cfg && cfg.gatesThroughScenery);
        var distanceTargetEnabled = !!(cfg && (cfg.distanceTargetEnabled || cfg.objective === "distance_speed"));
        var distanceTarget = cfg && Array.isArray(cfg.distanceTarget) ? cfg.distanceTarget : [0, 0, 0];
        var distanceMarker = cfg && cfg.distanceMarker && typeof cfg.distanceMarker === "object" ? cfg.distanceMarker : {};
        var markerStyle = ["crosshair", "ring", "cube", "diamond"].indexOf(distanceMarker.style) >= 0 ? distanceMarker.style : "crosshair";
        var markerColor = parseColor(distanceMarker.color, 0x35d7ff);
        var markerSize = Math.max(0.1, Math.min(20, Number(distanceMarker.size) || 1.15));
        var showCarHitbox = !!(cfg && cfg.showCarHitbox);
        var highlightCollisionPolys = !!(cfg && cfg.highlightCollisionPolys);
        var showCarGeometry = showCarHitbox || highlightCollisionPolys;
        var selectedCar = view._polyTasSelectedCar;
        updateTargetHud(renderer.camera, distanceTarget, distanceTargetEnabled, { style:markerStyle, color:markerColor, size:markerSize });
        if (overlay.hitboxSelectedCar !== selectedCar) {
            overlay.hitboxSelectedCar = selectedCar;
            overlay.hitboxCarSerial = (overlay.hitboxCarSerial || 0) + 1;
        }
        try {
            // Only touch normal car visibility when entering/leaving hitbox mode.
            // Forcing it true every frame broke the game's own ghost visibility
            // controls; forcing it false lost the original state on viewer changes.
            if (showCarGeometry && selectedCar && overlay.hitboxDrawn && (!overlay.carHitboxMode || overlay.carHitboxCar !== selectedCar)) {
                if (overlay.carHitboxMode && overlay.carHitboxCar && overlay.carHitboxCar !== selectedCar) {
                    overlay.carHitboxCar.setVisible(overlay.carHitboxWasVisible !== false);
                }
                overlay.carHitboxCar = selectedCar;
                overlay.carHitboxWasVisible = !selectedCar || selectedCar.isVisible !== false;
                if (selectedCar) selectedCar.setVisible(false);
            } else if (!showCarGeometry && overlay.carHitboxMode) {
                if (overlay.carHitboxCar) overlay.carHitboxCar.setVisible(overlay.carHitboxWasVisible !== false);
                overlay.carHitboxCar = null;
            }
            overlay.carHitboxMode = showCarGeometry && !!selectedCar && !!overlay.hitboxDrawn;
            if (!showCarGeometry && selectedCar) overlay.selectedCarWasVisible = selectedCar.isVisible !== false;
        } catch (e) {}
        var visibleTriggers = [];
        for (var v = 0; v < triggers.length; v++) if (triggers[v] && triggers[v].visible) visibleTriggers.push(triggers[v]);

        // The gate boxes come from the track's own parts, so a different track
        // must rebuild them. Part count alone did not tell two tracks apart, so
        // switching between two of the same size kept the previous track's
        // gates - boxes standing where the new track has no gate at all.
        var trackData = resolveTrackData(trackB, trackA);
        if (overlay.trackSource !== trackData) {
            overlay.trackSource = trackData;
            overlay.trackSerial++;
        }
        var partCount = 0;
        try { partCount = (trackData && trackData.numberOfParts) || 0; } catch (e) {}

        var hitboxDataReady = !!(globalThis.__polyTasPhysicsInit && globalThis.__polyTasPhysicsInit.carCollisionShapeVertices);
        var signature = JSON.stringify([visibleTriggers, showCheckpoints, showFinish, distanceTargetEnabled, distanceTarget,
            markerStyle, markerColor, markerSize, showCarHitbox, highlightCollisionPolys,
            gatesThroughScenery, partCount, overlay.trackSerial,
            triggersEnabled ? (cfg && cfg.selectedIndex) : null, overlay.scene === scene,
            showCarGeometry ? overlay.hitboxCarSerial : 0, hitboxDataReady]);
        var detached = overlay.items.length > 0 && overlay.items[0].object.parent !== scene;
        if (signature === overlay.signature && !detached) {
            updateDynamic(renderer.camera);
            return;
        }

        clear();
        overlay.hitboxDrawn = false;
        // Everything still carrying an older stamp is left over from a viewer
        // that has since been replaced, so it goes with them.
        overlay.generation++;
        sweep(scene);
        overlay.signature = signature;
        overlay.scene = scene;

        if (!visibleTriggers.length && !showCheckpoints && !showFinish && !distanceTargetEnabled && !showCarGeometry && !highlightCollisionPolys) return;

        if (!overlay.kit || overlay.kitScene !== scene) {
            overlay.kit = makeToolkit(scene);
            overlay.kitScene = scene;
            overlay.boxFill = overlay.boxEdge = overlay.sphereFill = overlay.sphereEdge = overlay.quad = null;
        }
        var kit = overlay.kit;
        if (!kit) { overlay.signature = null; return; }   // nothing to borrow from yet; retry next frame
        if (!overlay.boxFill) {
            overlay.boxFill = buildGeometry(kit, boxFillVertices());
            overlay.boxEdge = buildGeometry(kit, boxEdgeVertices());
            overlay.sphereFill = buildGeometry(kit, sphereFillVertices(18, 12));
            overlay.sphereEdge = buildGeometry(kit, sphereEdgeVertices(40));
            overlay.quad = buildGeometry(kit, QUAD_POSITIONS, QUAD_UVS);
        }

        if (showCheckpoints || showFinish) {
            var detectors = trackDetectors(trackData);
            for (var i = 0; i < detectors.length; i++) {
                var d = detectors[i];
                var isFinish = d.type === 1;
                if (isFinish ? !showFinish : !showCheckpoints) continue;
                addVolume(scene, kit, "box", d.centre, d.half, d.quaternion,
                    isFinish ? FINISH_COLOR : CHECKPOINT_COLOR, false, gatesThroughScenery, null);
            }
        }

        if (highlightCollisionPolys) addTrackCollisionPolys(scene, kit, trackData);

        if (distanceTargetEnabled) {
            if (markerStyle === "cube") {
                addVolume(scene, kit, "box", distanceTarget, [markerSize, markerSize, markerSize], null,
                    markerColor, true, true, "TARGET");
            } else if (markerStyle === "diamond") {
                addVolume(scene, kit, "box", distanceTarget, [markerSize, markerSize, markerSize], euler(45, 45, 0),
                    markerColor, true, true, "TARGET");
            } else {
                addVolume(scene, kit, "sphere", distanceTarget, [markerSize, markerSize, markerSize], null,
                    markerColor, true, true, "TARGET");
                if (markerStyle === "crosshair") {
                    var axisLength = markerSize * 1.95;
                    var axisWidth = Math.max(0.025, markerSize * 0.03);
                    addVolume(scene, kit, "box", distanceTarget, [axisLength, axisWidth, axisWidth], null,
                        markerColor, true, true, null);
                    addVolume(scene, kit, "box", distanceTarget, [axisWidth, axisLength, axisWidth], null,
                        markerColor, true, true, null);
                    addVolume(scene, kit, "box", distanceTarget, [axisWidth, axisWidth, axisLength], null,
                        markerColor, true, true, null);
                }
            }
        }

        if (showCarGeometry && view._polyTasSelectedCar) {
            try {
                var init = globalThis.__polyTasPhysicsInit;
                var verts = init && init.carCollisionShapeVertices;
                if (verts && verts.length >= 9) {
                    var exactVerts = new Float32Array(verts);
                    var hullGeometry = highlightCollisionPolys
                        ? buildCollisionGeometry(kit, exactVerts, false) : buildGeometry(kit, exactVerts);
                    var hull = new kit.Mesh(hullGeometry, highlightCollisionPolys
                        ? buildVertexColorMaterial(kit, 0.24, true, false)
                        : buildFillMaterial(kit, 0x6cff7d, 0.24, true));
                    hull.material.wireframe = !kit.Segments;
                    hull.userData = hull.userData || {}; hull.userData.__polyTasCarPart = {kind:"body",massOffset:Number(init.carMassOffset||0.6)};
                    var car = view._polyTasSelectedCar;
                    updateCarPart(hull, car);
                    scene.add(hull); track(hull, 0.34, true, false);
                    if (kit.Segments) {
                        var edgeGeometry = buildCollisionGeometry(kit, exactVerts, true);
                        var hullEdges = new kit.Segments(edgeGeometry, highlightCollisionPolys
                            ? buildVertexColorMaterial(kit, 1, true, true)
                            : buildLineMaterial(kit, 0x6cff7d, 1, true));
                        hullEdges.userData = hullEdges.userData || {}; hullEdges.userData.__polyTasCarPart = {kind:"body",massOffset:Number(init.carMassOffset||0.6)};
                        hullEdges.position.copy(hull.position); hullEdges.quaternion.copy(hull.quaternion);
                        scene.add(hullEdges); track(hullEdges, 1, true, false);
                    }

                    // PolyTrack uses Bullet's raycast vehicle: these wheels and
                    // axles are query/suspension geometry, not separate rigid-body
                    // collision shapes. The spheres show the swept wheel envelope;
                    // the bars show the live axle and suspension rays.
                    for (var wi=0; wi<4; wi++) {
                        var wheelObjects = addVolume(scene, kit, "sphere", [0,0,0], [0.331,0.331,0.331], null,
                            WHEEL_COLORS[wi], false, true, "W"+(wi+1));
                        tagCarParts(wheelObjects, {kind:"wheel",index:wi});
                        for (var wo=0; wo<wheelObjects.length; wo++) updateCarPart(wheelObjects[wo], car);
                        var suspensionObjects = addVolume(scene, kit, "box", [0,0,0], [0.025,0.04,0.025], null,
                            WHEEL_COLORS[wi], false, true, null);
                        tagCarParts(suspensionObjects, {kind:"suspension",index:wi});
                        for (var so=0; so<suspensionObjects.length; so++) updateCarPart(suspensionObjects[so], car);
                    }
                    for (var ai=0; ai<2; ai++) {
                        var left=ai*2, right=left+1;
                        var axleHalf=Math.abs(WHEEL_CONNECTIONS[left][0]-WHEEL_CONNECTIONS[right][0])/2;
                        var axleObjects=addVolume(scene, kit, "box", [0,0,0], [axleHalf,0.035,0.035], null,
                            0xffe66d, false, true, ai===0?"FRONT AXLE":"REAR AXLE");
                        tagCarParts(axleObjects, {kind:"axle",left:left,right:right});
                        for (var ao=0; ao<axleObjects.length; ao++) updateCarPart(axleObjects[ao], car);
                    }
                    overlay.hitboxDrawn = true;
                    try {
                        if (!overlay.carHitboxMode || overlay.carHitboxCar !== car) {
                            overlay.carHitboxWasVisible = car.isVisible !== false;
                            overlay.carHitboxCar = car;
                        }
                        car.setVisible(false);
                        overlay.carHitboxMode = true;
                    } catch (e) {}
                }
            } catch (e) {}
        }

        for (var t = 0; t < triggers.length; t++) {
            var trigger = triggers[t];
            if (!trigger || !trigger.visible) continue;
            var active = cfg && cfg.selectedIndex === t;
            var centre = trigger.center || [0, 0, 0];
            var invalidating = !!(cfg && cfg.invalidationTriggersEnabled && trigger.invalidating);
            var color = invalidating ? 0xff3355 : parseColor(trigger.color, FALLBACK_TRIGGER_COLOR);
            var sts = !!trigger.throughScenery;
            var label = (invalidating ? "X" : "") + abbreviate(trigger.name);
            if (trigger.shape === "sphere") {
                var r = Math.max(0.01, Number(trigger.radius) || 1);
                addVolume(scene, kit, "sphere", centre, [r, r, r], null, color, active, sts, label);
            } else {
                var size = trigger.size || [1, 1, 1];
                var rot = trigger.rotation || [0, 0, 0];
                addVolume(scene, kit, "box", centre, [
                    Math.max(0.005, Math.abs(Number(size[0]) || 0) / 2),
                    Math.max(0.005, Math.abs(Number(size[1]) || 0) / 2),
                    Math.max(0.005, Math.abs(Number(size[2]) || 0) / 2)
                ], euler(Number(rot[0]) || 0, Number(rot[1]) || 0, Number(rot[2]) || 0),
                    color, active, sts, label);
            }
        }
        updateDynamic(renderer.camera);
    };
};
})();
;(function(){
// The objective and geometry code, shared verbatim with the other
// backends so the vanilla path scores candidates identically.
var __sources = {"car-state": "\"use strict\";\n// Decoder for the packed car state that updateCarModel() writes.\n//\n// The layout is the game's own: simulation_worker allocates 227 bytes, the wasm\n// writes a 4-byte car id followed by the variable-length CarState record, and\n// the renderer decodes it with the reader in main.bundle.js (module 3899). This\n// is a faithful port of that reader so the engine sees exactly what the game\n// sees.\n//\n//   u24  frames\n//   f32  speedKmh\n//   u8   flags: 1 started, 2 finished, 4 hasCheckpointToRespawnAt,\n//               8/16/32/64 wheel 0..3 has ground contact\n//   u24  finishFrames          (only when the finished bit is set)\n//   u16  nextCheckpointIndex\n//   3xf32 position\n//   4xf32 quaternion\n//   u8   collision impulse count, then that many f32\n//   per contacting wheel: 3xf32 contact position, 3xf32 contact normal\n//   4xf32 suspension length / suspension velocity / wheel rotation / skid info\n//   f32  steering\n//   u8   control bits + brake light\n\nconst CAR_ID_BYTES = 4;\n\n/** Cheap accessors that avoid building an object for the common hot paths. */\nfunction readFlags(raw) { return raw[CAR_ID_BYTES + 7]; }\nfunction hasFinished(raw) { return (readFlags(raw) & 2) !== 0; }\nfunction hasStarted(raw) { return (readFlags(raw) & 1) !== 0; }\nfunction readFrames(raw) {\n    return raw[CAR_ID_BYTES] | (raw[CAR_ID_BYTES + 1] << 8) | (raw[CAR_ID_BYTES + 2] << 16);\n}\n\n/**\n * Reads position and quaternion only. This is what the objectives need every\n * frame, so it skips the allocation-heavy full decode.\n * `out` is reused across calls: {px,py,pz,qx,qy,qz,qw}.\n */\n// The raw state view is stable across frames, so the DataView over it is cached\n// rather than rebuilt on every one of the millions of frames a search simulates.\nlet cachedSource = null;\nlet cachedView = null;\nfunction viewFor(raw) {\n    if (cachedSource !== raw || cachedView.buffer !== raw.buffer) {\n        cachedSource = raw;\n        cachedView = new DataView(raw.buffer, raw.byteOffset + CAR_ID_BYTES, raw.byteLength - CAR_ID_BYTES);\n    }\n    return cachedView;\n}\n\nfunction readTransform(raw, out) {\n    const view = viewFor(raw);\n    const flags = raw[CAR_ID_BYTES + 7];\n    let i = 8;                       // u24 frames + f32 speed + u8 flags\n    if (flags & 2) i += 3;           // finishFrames\n    i += 2;                          // nextCheckpointIndex\n    out.px = view.getFloat32(i, true);\n    out.py = view.getFloat32(i + 4, true);\n    out.pz = view.getFloat32(i + 8, true);\n    i += 12;\n    out.qx = view.getFloat32(i, true);\n    out.qy = view.getFloat32(i + 4, true);\n    out.qz = view.getFloat32(i + 8, true);\n    out.qw = view.getFloat32(i + 12, true);\n    return out;\n}\n\nfunction readSpeedKmh(raw) { return viewFor(raw).getFloat32(3, true); }\n\nfunction readNextCheckpointIndex(raw) {\n    const view = viewFor(raw);\n    const flags = raw[CAR_ID_BYTES + 7];\n    return view.getUint16((flags & 2) ? 11 : 8, true);\n}\n\n/**\n * The slice of the record that holds everything an objective can see.\n *\n * The three bytes before it are the frame counter, which ticks on every frame whatever\n * the car does, and everything past the quaternion is telemetry - contact points,\n * suspension, steering - that no objective reads. What lies between is exactly the set\n * of values a score can be built from: the speed, the started/finished flags, the finish\n * time, the checkpoint index, the position and the quaternion. Two frames whose slices\n * are byte-for-byte equal are indistinguishable to every objective in the registry,\n * which is what lets a motionless candidate be abandoned without changing its score.\n */\nconst OBSERVED_FROM = CAR_ID_BYTES + 3;\nfunction observedEnd(raw) {\n    const flags = raw[CAR_ID_BYTES + 7];\n    let i = 8;                                   // frames + speed + flags\n    if (flags & 2) i += 3;                       // finishFrames\n    return CAR_ID_BYTES + i + 2 + 12 + 16;       // checkpoint index, position, quaternion\n}\n\n/** True when `raw`'s observed slice is the `length` bytes already held in `saved`. */\nfunction sameObservedState(raw, saved, length) {\n    for (let i = 0; i < length; i++) if (raw[OBSERVED_FROM + i] !== saved[i]) return false;\n    return true;\n}\n\n/**\n * Copies `raw`'s observed slice into `saved`. A plain loop rather than set(subarray()):\n * this runs on every frame of every candidate, and the view subarray() would build is a\n * per-frame allocation for the sake of copying under forty bytes.\n */\nfunction copyObservedState(raw, saved, length) {\n    for (let i = 0; i < length; i++) saved[i] = raw[OBSERVED_FROM + i];\n}\n\n/**\n * Length of the meaningful part of the record. The wasm writes into a fixed\n * 227-byte scratch buffer but the record itself is variable length, so anything\n * past this point is whatever the previous frame left behind and must not be\n * compared or copied.\n */\nfunction stateLength(raw) {\n    const flags = raw[CAR_ID_BYTES + 7];\n    let i = 8;                                   // frames + speed + flags\n    if (flags & 2) i += 3;                       // finishFrames\n    i += 2 + 12 + 16;                            // checkpoint index, position, quaternion\n    i += 1 + 4 * raw[CAR_ID_BYTES + i];          // collision impulses\n    for (let w = 0; w < 4; w++) if (flags & (8 << w)) i += 24;\n    i += 64 + 4 + 1;                             // suspension/rotation/skid, steering, controls\n    return CAR_ID_BYTES + i;\n}\n\nfunction readFinishFrames(raw) {\n    if (!hasFinished(raw)) return null;\n    const b = CAR_ID_BYTES + 8;\n    return raw[b] | (raw[b + 1] << 8) | (raw[b + 2] << 16);\n}\n\n/** Full decode, used for reporting rather than for the inner loop. */\nfunction decodeCarState(raw) {\n    const view = new DataView(raw.buffer, raw.byteOffset + CAR_ID_BYTES, raw.byteLength - CAR_ID_BYTES);\n    const bytes = raw.subarray(CAR_ID_BYTES);\n    let i = 0;\n    const frames = bytes[0] | (bytes[1] << 8) | (bytes[2] << 16); i += 3;\n    const speedKmh = view.getFloat32(i, true); i += 4;\n    const flags = bytes[i];\n    const started = (flags & 1) !== 0;\n    const finished = (flags & 2) !== 0;\n    const hasCheckpointToRespawnAt = (flags & 4) !== 0;\n    const wheelHasContact = [(flags & 8) !== 0, (flags & 16) !== 0, (flags & 32) !== 0, (flags & 64) !== 0];\n    i += 1;\n    let finishFrames = null;\n    if (finished) { finishFrames = bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16); i += 3; }\n    const nextCheckpointIndex = view.getUint16(i, true); i += 2;\n    const position = { x: view.getFloat32(i, true), y: view.getFloat32(i + 4, true), z: view.getFloat32(i + 8, true) }; i += 12;\n    const quaternion = {\n        x: view.getFloat32(i, true), y: view.getFloat32(i + 4, true),\n        z: view.getFloat32(i + 8, true), w: view.getFloat32(i + 12, true),\n    }; i += 16;\n    const impulseCount = bytes[i]; i += 1;\n    const collisionImpulses = [];\n    for (let k = 0; k < impulseCount; k++) { collisionImpulses.push(view.getFloat32(i, true)); i += 4; }\n    const wheelContact = [null, null, null, null];\n    for (let k = 0; k < 4; k++) {\n        if (!wheelHasContact[k]) continue;\n        wheelContact[k] = {\n            position: { x: view.getFloat32(i, true), y: view.getFloat32(i + 4, true), z: view.getFloat32(i + 8, true) },\n            normal: { x: view.getFloat32(i + 12, true), y: view.getFloat32(i + 16, true), z: view.getFloat32(i + 20, true) },\n        };\n        i += 24;\n    }\n    const quad = () => { const a = [0, 0, 0, 0]; for (let k = 0; k < 4; k++) { a[k] = view.getFloat32(i, true); i += 4; } return a; };\n    const wheelSuspensionLength = quad();\n    const wheelSuspensionVelocity = quad();\n    const wheelDeltaRotation = quad();\n    const wheelSkidInfo = quad();\n    const steering = view.getFloat32(i, true); i += 4;\n    const controlBits = bytes[i];\n    return {\n        frames, speedKmh, hasStarted: started, finishFrames, nextCheckpointIndex,\n        hasCheckpointToRespawnAt, position, quaternion, collisionImpulses, wheelContact,\n        wheelSuspensionLength, wheelSuspensionVelocity, wheelDeltaRotation, wheelSkidInfo,\n        steering,\n        brakeLightEnabled: (controlBits & 32) !== 0,\n        controls: {\n            up: (controlBits & 1) !== 0, right: (controlBits & 2) !== 0,\n            down: (controlBits & 4) !== 0, left: (controlBits & 8) !== 0,\n            reset: (controlBits & 16) !== 0,\n        },\n    };\n}\n\nmodule.exports = {\n    decodeCarState, readTransform, readSpeedKmh, readFrames, stateLength,\n    readNextCheckpointIndex, readFinishFrames, hasFinished, hasStarted,\n    OBSERVED_FROM, observedEnd, sameObservedState, copyObservedState,\n};\n", "geometry": "\"use strict\";\n// Trigger volumes and the car's real collision geometry.\n//\n// The game already models \"has the car reached this region\" as an oriented\n// bounding box test: every checkpoint and finish part carries a detector\n// { type, center, size } in part-local space, and physics/obb.cpp intersects it\n// with a box attached to the car. The car's box is declared next to the rest of\n// the car constants in the renderer:\n//\n//     massOffset               = 0.6\n//     detectorBoxCenter        = (0, 0.48, -0.15)\n//     detectorBoxSize          = (0.89, 0.22, 1.8)\n//\n// The two sets of numbers use different conventions, which was settled by\n// experiment rather than assumption. A track part's detector `size` is a full\n// extent: a checkpoint gate is 10.5 wide over a 10-unit road, and the wide\n// variant is exactly four 5-unit tiles wider at 30.6. The car's\n// detectorBoxSize is a HALF extent, so the box really is 1.78 x 0.44 x 3.6,\n// which is about the size of the car itself.\n//\n// The check: drive the real car through a real checkpoint and a real finish\n// gate and compare the frame the physics module reports with the frame each\n// candidate hitbox would report. Reading the car box as a half extent matches\n// the game on every gate at every speed - 0 frames difference, including a\n// slow pass where one frame covers only 3.5 mm. Reading it as a full extent is\n// 148 frames late, the full collision hull is 3 to 6 frames early, and the bare\n// origin point misses the gates entirely.\n//\n// The frames were pinned down the same way: dropping the car onto a plane at\n// y = 0 leaves the reported body origin at y = 0.15097 with wheel contacts at\n// exactly the documented connection points (+-0.627909, 1.347) and suspension\n// length 0.0881, putting the wheel radius at 0.3328 against a wheel mesh radius\n// of 0.3307. So the reported position/quaternion is the body frame, the wheel\n// connection points are given in it directly, and the collision hull - authored\n// around the model origin - sits massOffset above it (otherwise the hull would\n// be 0.195 deep in the ground at rest and Bullet would have pushed the car out).\n\nconst CAR_MASS_OFFSET_DEFAULT = 0.6;\nconst CAR_DETECTOR_CENTER = [0, 0.48, -0.15];\nconst CAR_DETECTOR_HALF_EXTENTS = [0.89, 0.22, 1.8];\n\nconst EPS = 1e-6;\n\n/** Rotates a vector by a quaternion. */\nfunction quatRotate(q, x, y, z, out) {\n    const { x: qx, y: qy, z: qz, w: qw } = q;\n    const ix = qw * x + qy * z - qz * y;\n    const iy = qw * y + qz * x - qx * z;\n    const iz = qw * z + qx * y - qy * x;\n    const iw = -qx * x - qy * y - qz * z;\n    out[0] = ix * qw + iw * -qx + iy * -qz - iz * -qy;\n    out[1] = iy * qw + iw * -qy + iz * -qx - ix * -qz;\n    out[2] = iz * qw + iw * -qz + ix * -qy - iy * -qx;\n    return out;\n}\n\n/** Column-major-ish 3x3 basis (rows are the local axes) from a quaternion. */\nfunction quatToBasis(q, out) {\n    const { x, y, z, w } = q;\n    const x2 = x + x, y2 = y + y, z2 = z + z;\n    const xx = x * x2, xy = x * y2, xz = x * z2;\n    const yy = y * y2, yz = y * z2, zz = z * z2;\n    const wx = w * x2, wy = w * y2, wz = w * z2;\n    out[0] = 1 - (yy + zz); out[1] = xy + wz; out[2] = xz - wy;       // local X in world\n    out[3] = xy - wz; out[4] = 1 - (xx + zz); out[5] = yz + wx;       // local Y in world\n    out[6] = xz + wy; out[7] = yz - wx; out[8] = 1 - (xx + yy);       // local Z in world\n    return out;\n}\n\n/** Intrinsic XYZ euler degrees -> quaternion. */\nfunction eulerToQuaternion(xDeg, yDeg, zDeg) {\n    const hx = (xDeg * Math.PI) / 360, hy = (yDeg * Math.PI) / 360, hz = (zDeg * Math.PI) / 360;\n    const cx = Math.cos(hx), sx = Math.sin(hx);\n    const cy = Math.cos(hy), sy = Math.sin(hy);\n    const cz = Math.cos(hz), sz = Math.sin(hz);\n    return {\n        x: sx * cy * cz + cx * sy * sz,\n        y: cx * sy * cz - sx * cy * sz,\n        z: cx * cy * sz + sx * sy * cz,\n        w: cx * cy * cz - sx * sy * sz,\n    };\n}\n\n/**\n * An oriented box: world centre, half extents, and a world basis whose rows are\n * the box's local axes.\n */\nclass Obb {\n    constructor(center, halfExtents, basis) {\n        this.c = center;                       // [3]\n        this.e = halfExtents;                  // [3]\n        this.b = basis || new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);\n    }\n\n    static fromCenterSize(center, size, quaternion) {\n        const basis = new Float64Array(9);\n        if (quaternion) quatToBasis(quaternion, basis);\n        else { basis[0] = 1; basis[4] = 1; basis[8] = 1; }\n        return new Obb(\n            new Float64Array([center[0], center[1], center[2]]),\n            new Float64Array([Math.abs(size[0]) / 2, Math.abs(size[1]) / 2, Math.abs(size[2]) / 2]),\n            basis);\n    }\n\n    axis(i, out) { out[0] = this.b[i * 3]; out[1] = this.b[i * 3 + 1]; out[2] = this.b[i * 3 + 2]; return out; }\n\n    /** Squared distance from a world point to this box (0 when inside). */\n    distanceSquaredToPoint(px, py, pz) {\n        const dx = px - this.c[0], dy = py - this.c[1], dz = pz - this.c[2];\n        let sum = 0;\n        for (let i = 0; i < 3; i++) {\n            const d = dx * this.b[i * 3] + dy * this.b[i * 3 + 1] + dz * this.b[i * 3 + 2];\n            const excess = Math.abs(d) - this.e[i];\n            if (excess > 0) sum += excess * excess;\n        }\n        return sum;\n    }\n\n    containsPoint(px, py, pz) { return this.distanceSquaredToPoint(px, py, pz) <= 0; }\n\n    /** Closest point on/inside the box to a world point. */\n    closestPoint(px, py, pz, out) {\n        const dx = px - this.c[0], dy = py - this.c[1], dz = pz - this.c[2];\n        out[0] = this.c[0]; out[1] = this.c[1]; out[2] = this.c[2];\n        for (let i = 0; i < 3; i++) {\n            let d = dx * this.b[i * 3] + dy * this.b[i * 3 + 1] + dz * this.b[i * 3 + 2];\n            if (d > this.e[i]) d = this.e[i]; else if (d < -this.e[i]) d = -this.e[i];\n            out[0] += d * this.b[i * 3];\n            out[1] += d * this.b[i * 3 + 1];\n            out[2] += d * this.b[i * 3 + 2];\n        }\n        return out;\n    }\n\n    corners(out) {\n        let n = 0;\n        for (let sx = -1; sx <= 1; sx += 2)\n            for (let sy = -1; sy <= 1; sy += 2)\n                for (let sz = -1; sz <= 1; sz += 2) {\n                    out[n++] = this.c[0] + sx * this.e[0] * this.b[0] + sy * this.e[1] * this.b[3] + sz * this.e[2] * this.b[6];\n                    out[n++] = this.c[1] + sx * this.e[0] * this.b[1] + sy * this.e[1] * this.b[4] + sz * this.e[2] * this.b[7];\n                    out[n++] = this.c[2] + sx * this.e[0] * this.b[2] + sy * this.e[1] * this.b[5] + sz * this.e[2] * this.b[8];\n                }\n        return out;\n    }\n}\n\n// Scratch for obbIntersectsObb. It is a leaf function - it calls nothing that could\n// call back into it - so one set of buffers for the whole module is safe, and it matters:\n// the trigger objectives run this once per frame (times the sweep sample count), and a\n// Float64Array(9) is 72 bytes, which is over V8's inline-allocation threshold. Allocating\n// them per call measured 400-640 ns against roughly 40 ns for the reused buffers.\nconst OBB_R = new Float64Array(9);\nconst OBB_ABS_R = new Float64Array(9);\nconst OBB_T = new Float64Array(3);\n\n/**\n * Separating-axis test between two oriented boxes - the same 15-axis test an\n * OBB implementation like the game's physics/obb.cpp performs.\n */\nfunction obbIntersectsObb(a, b) {\n    // Rotation of b expressed in a's frame, and the translation between them.\n    const R = OBB_R, AbsR = OBB_ABS_R;\n    for (let i = 0; i < 3; i++) {\n        for (let j = 0; j < 3; j++) {\n            const v = a.b[i * 3] * b.b[j * 3] + a.b[i * 3 + 1] * b.b[j * 3 + 1] + a.b[i * 3 + 2] * b.b[j * 3 + 2];\n            R[i * 3 + j] = v;\n            AbsR[i * 3 + j] = Math.abs(v) + EPS;\n        }\n    }\n    const dx = b.c[0] - a.c[0], dy = b.c[1] - a.c[1], dz = b.c[2] - a.c[2];\n    const t = OBB_T;\n    for (let i = 0; i < 3; i++) t[i] = dx * a.b[i * 3] + dy * a.b[i * 3 + 1] + dz * a.b[i * 3 + 2];\n\n    // a's face normals\n    for (let i = 0; i < 3; i++) {\n        const ra = a.e[i];\n        const rb = b.e[0] * AbsR[i * 3] + b.e[1] * AbsR[i * 3 + 1] + b.e[2] * AbsR[i * 3 + 2];\n        if (Math.abs(t[i]) > ra + rb) return false;\n    }\n    // b's face normals\n    for (let j = 0; j < 3; j++) {\n        const ra = a.e[0] * AbsR[j] + a.e[1] * AbsR[3 + j] + a.e[2] * AbsR[6 + j];\n        const rb = b.e[j];\n        if (Math.abs(t[0] * R[j] + t[1] * R[3 + j] + t[2] * R[6 + j]) > ra + rb) return false;\n    }\n    // edge x edge\n    const e = a.e, f = b.e;\n    let ra, rb, s;\n    ra = e[1] * AbsR[6] + e[2] * AbsR[3]; rb = f[1] * AbsR[2] + f[2] * AbsR[1];\n    s = Math.abs(t[2] * R[3] - t[1] * R[6]); if (s > ra + rb) return false;\n    ra = e[1] * AbsR[7] + e[2] * AbsR[4]; rb = f[0] * AbsR[2] + f[2] * AbsR[0];\n    s = Math.abs(t[2] * R[4] - t[1] * R[7]); if (s > ra + rb) return false;\n    ra = e[1] * AbsR[8] + e[2] * AbsR[5]; rb = f[0] * AbsR[1] + f[1] * AbsR[0];\n    s = Math.abs(t[2] * R[5] - t[1] * R[8]); if (s > ra + rb) return false;\n    ra = e[0] * AbsR[6] + e[2] * AbsR[0]; rb = f[1] * AbsR[5] + f[2] * AbsR[4];\n    s = Math.abs(t[0] * R[6] - t[2] * R[0]); if (s > ra + rb) return false;\n    ra = e[0] * AbsR[7] + e[2] * AbsR[1]; rb = f[0] * AbsR[5] + f[2] * AbsR[3];\n    s = Math.abs(t[0] * R[7] - t[2] * R[1]); if (s > ra + rb) return false;\n    ra = e[0] * AbsR[8] + e[2] * AbsR[2]; rb = f[0] * AbsR[4] + f[1] * AbsR[3];\n    s = Math.abs(t[0] * R[8] - t[2] * R[2]); if (s > ra + rb) return false;\n    ra = e[0] * AbsR[3] + e[1] * AbsR[0]; rb = f[1] * AbsR[8] + f[2] * AbsR[7];\n    s = Math.abs(t[1] * R[0] - t[0] * R[3]); if (s > ra + rb) return false;\n    ra = e[0] * AbsR[4] + e[1] * AbsR[1]; rb = f[0] * AbsR[8] + f[2] * AbsR[6];\n    s = Math.abs(t[1] * R[1] - t[0] * R[4]); if (s > ra + rb) return false;\n    ra = e[0] * AbsR[5] + e[1] * AbsR[2]; rb = f[0] * AbsR[7] + f[1] * AbsR[6];\n    s = Math.abs(t[1] * R[2] - t[0] * R[5]); if (s > ra + rb) return false;\n    return true;\n}\n\n/** Sphere volume: a centre and a radius. */\nclass Sphere {\n    constructor(center, radius) { this.c = center; this.r = radius; }\n    containsPoint(px, py, pz) {\n        const dx = px - this.c[0], dy = py - this.c[1], dz = pz - this.c[2];\n        return dx * dx + dy * dy + dz * dz <= this.r * this.r;\n    }\n    distanceSquaredToPoint(px, py, pz) {\n        const dx = px - this.c[0], dy = py - this.c[1], dz = pz - this.c[2];\n        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - this.r;\n        return d > 0 ? d * d : 0;\n    }\n}\n\nfunction obbIntersectsSphere(box, sphere) {\n    return box.distanceSquaredToPoint(sphere.c[0], sphere.c[1], sphere.c[2]) <= sphere.r * sphere.r;\n}\n\n/**\n * The car's convex collision hull, as a set of unique vertices, face planes and\n * unique edge directions - everything a separating-axis test against a box\n * needs. Built once from the triangle soup the game hands the physics module.\n */\nclass ConvexHull {\n    constructor(triangleVertices, offsetY) {\n        const key = (x, y, z) => x.toFixed(5) + \",\" + y.toFixed(5) + \",\" + z.toFixed(5);\n        const seen = new Map();\n        const verts = [];\n        const src = triangleVertices;\n        for (let i = 0; i < src.length; i += 3) {\n            const x = src[i], y = src[i + 1] + offsetY, z = src[i + 2];\n            const k = key(x, y, z);\n            if (!seen.has(k)) { seen.set(k, verts.length / 3); verts.push(x, y, z); }\n        }\n        this.vertices = new Float64Array(verts);\n        this.vertexCount = verts.length / 3;\n\n        // Face normals and unique edge directions, deduplicated by direction so\n        // the axis list stays short (12 vertices, 16 triangles for the car).\n        const normals = [], edges = [];\n        const addUnique = (list, x, y, z) => {\n            const len = Math.hypot(x, y, z);\n            if (len < 1e-9) return;\n            x /= len; y /= len; z /= len;\n            for (let i = 0; i < list.length; i += 3) {\n                const d = Math.abs(list[i] * x + list[i + 1] * y + list[i + 2] * z);\n                if (d > 1 - 1e-7) return;\n            }\n            list.push(x, y, z);\n        };\n        for (let i = 0; i < src.length; i += 9) {\n            const ax = src[i], ay = src[i + 1] + offsetY, az = src[i + 2];\n            const bx = src[i + 3], by = src[i + 4] + offsetY, bz = src[i + 5];\n            const cx = src[i + 6], cy = src[i + 7] + offsetY, cz = src[i + 8];\n            const ux = bx - ax, uy = by - ay, uz = bz - az;\n            const vx = cx - ax, vy = cy - ay, vz = cz - az;\n            addUnique(normals, uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);\n            addUnique(edges, ux, uy, uz);\n            addUnique(edges, vx, vy, vz);\n            addUnique(edges, cx - bx, cy - by, cz - bz);\n        }\n        this.faceNormals = new Float64Array(normals);\n        this.edgeDirections = new Float64Array(edges);\n\n        let r = 0;\n        for (let i = 0; i < this.vertices.length; i += 3) {\n            r = Math.max(r, Math.hypot(this.vertices[i], this.vertices[i + 1], this.vertices[i + 2]));\n        }\n        this.boundingRadius = r;\n    }\n}\n\n/**\n * The car's hitbox, transformed into world space each time it is queried.\n *\n * mode \"detector\" reproduces the box the game uses for checkpoint and finish\n * detection, \"hull\" uses the full convex collision shape Bullet simulates with,\n * \"point\" is just the body origin and \"sphere\" is the body origin with a radius.\n */\nclass CarHitbox {\n    constructor(options) {\n        const opts = options || {};\n        this.mode = opts.mode || \"detector\";\n        this.massOffset = Number.isFinite(opts.massOffset) ? opts.massOffset : CAR_MASS_OFFSET_DEFAULT;\n        this.detectorCenter = opts.detectorCenter || CAR_DETECTOR_CENTER;\n        // Half extents, matching the game's own constant.\n        this.detectorHalfExtents = opts.detectorHalfExtents || CAR_DETECTOR_HALF_EXTENTS;\n        this.pointRadius = Number.isFinite(opts.pointRadius) ? opts.pointRadius : 0;\n        this.hull = null;\n        if (this.mode === \"hull\") {\n            if (!opts.collisionShapeVertices) throw new Error(\"hull hitbox needs the car collision vertices\");\n            this.hull = new ConvexHull(opts.collisionShapeVertices, this.massOffset);\n        }\n        this._basis = new Float64Array(9);\n        this._obb = new Obb(new Float64Array(3), new Float64Array([\n            Math.abs(this.detectorHalfExtents[0]),\n            Math.abs(this.detectorHalfExtents[1]),\n            Math.abs(this.detectorHalfExtents[2]),\n        ]), this._basis);\n        this._tmp = new Float64Array(3);\n        this._ref = new Float64Array(3);\n        this._worldVerts = this.hull ? new Float64Array(this.hull.vertices.length) : null;\n    }\n\n    /** Reference point used for distance guidance and for point mode. */\n    referencePoint(t, out) {\n        if (this.mode === \"point\" || this.mode === \"sphere\") {\n            out[0] = t.px; out[1] = t.py; out[2] = t.pz;\n            return out;\n        }\n        const c = this.mode === \"hull\" ? [0, this.massOffset, 0] : this.detectorCenter;\n        const v = quatRotate({ x: t.qx, y: t.qy, z: t.qz, w: t.qw }, c[0], c[1], c[2], this._tmp);\n        out[0] = t.px + v[0]; out[1] = t.py + v[1]; out[2] = t.pz + v[2];\n        return out;\n    }\n\n    /** Places the detector box in world space for the given car transform. */\n    _updateObb(t) {\n        const q = { x: t.qx, y: t.qy, z: t.qz, w: t.qw };\n        quatToBasis(q, this._basis);\n        const c = this.detectorCenter;\n        const v = quatRotate(q, c[0], c[1], c[2], this._tmp);\n        this._obb.c[0] = t.px + v[0];\n        this._obb.c[1] = t.py + v[1];\n        this._obb.c[2] = t.pz + v[2];\n        return this._obb;\n    }\n\n    _updateHull(t) {\n        const q = { x: t.qx, y: t.qy, z: t.qz, w: t.qw };\n        const src = this.hull.vertices, dst = this._worldVerts, tmp = this._tmp;\n        for (let i = 0; i < src.length; i += 3) {\n            quatRotate(q, src[i], src[i + 1], src[i + 2], tmp);\n            dst[i] = t.px + tmp[0]; dst[i + 1] = t.py + tmp[1]; dst[i + 2] = t.pz + tmp[2];\n        }\n        return dst;\n    }\n\n    /** True when the car's geometry intersects the given trigger volume. */\n    intersects(t, volume) {\n        switch (this.mode) {\n            case \"point\":\n                return volume.containsPoint(t.px, t.py, t.pz);\n            case \"sphere\": {\n                const r = this.pointRadius;\n                return volume.distanceSquaredToPoint(t.px, t.py, t.pz) <= r * r;\n            }\n            case \"hull\":\n                return volume.intersectsHull(this._updateHull(t), this.hull, t);\n            case \"detector\":\n            default:\n                return volume.intersectsObb(this._updateObb(t));\n        }\n    }\n\n    /** Distance from the car's reference point to the volume, for search guidance. */\n    distanceTo(t, volume) {\n        const p = this.referencePoint(t, this._ref);\n        return Math.sqrt(volume.distanceSquaredToPoint(p[0], p[1], p[2]));\n    }\n}\n\n/** A trigger volume: an oriented box or a sphere, with the tests each supports. */\nclass TriggerVolume {\n    constructor(spec) {\n        this.shape = spec.shape === \"sphere\" ? \"sphere\" : \"box\";\n        const center = [Number(spec.center[0]) || 0, Number(spec.center[1]) || 0, Number(spec.center[2]) || 0];\n        if (this.shape === \"sphere\") {\n            this.sphere = new Sphere(new Float64Array(center), Math.max(1e-4, Number(spec.radius) || 1));\n            this.box = null;\n        } else {\n            const rot = spec.rotation || [0, 0, 0];\n            const q = eulerToQuaternion(Number(rot[0]) || 0, Number(rot[1]) || 0, Number(rot[2]) || 0);\n            const size = spec.size || [1, 1, 1];\n            this.box = Obb.fromCenterSize(center, [\n                Math.max(1e-4, Number(size[0]) || 0),\n                Math.max(1e-4, Number(size[1]) || 0),\n                Math.max(1e-4, Number(size[2]) || 0),\n            ], q);\n            this.sphere = null;\n        }\n        this.center = center;\n    }\n\n    containsPoint(x, y, z) {\n        return this.shape === \"sphere\" ? this.sphere.containsPoint(x, y, z) : this.box.containsPoint(x, y, z);\n    }\n\n    distanceSquaredToPoint(x, y, z) {\n        return this.shape === \"sphere\" ? this.sphere.distanceSquaredToPoint(x, y, z) : this.box.distanceSquaredToPoint(x, y, z);\n    }\n\n    intersectsObb(obb) {\n        return this.shape === \"sphere\" ? obbIntersectsSphere(obb, this.sphere) : obbIntersectsObb(obb, this.box);\n    }\n\n    /**\n     * Convex hull against this volume. For a sphere it is a closest-point test;\n     * for a box it is a separating-axis test over the box axes, the hull's face\n     * normals and the cross products of their edge directions, which is exact\n     * for two convex polyhedra.\n     */\n    intersectsHull(worldVerts, hull, t) {\n        if (this.shape === \"sphere\") {\n            const s = this.sphere;\n            // Quick reject, then an exact test against the hull's own planes and\n            // the closest point on its surface.\n            let best = Infinity;\n            for (let i = 0; i < worldVerts.length; i += 3) {\n                const dx = worldVerts[i] - s.c[0], dy = worldVerts[i + 1] - s.c[1], dz = worldVerts[i + 2] - s.c[2];\n                best = Math.min(best, dx * dx + dy * dy + dz * dz);\n            }\n            if (best <= s.r * s.r) return true;\n            // Sphere centre inside the hull, or within radius of a face.\n            return this._hullSphereSeparated(worldVerts, hull, t) === false;\n        }\n        const box = this.box;\n        const q = { x: t.qx, y: t.qy, z: t.qz, w: t.qw };\n        const axis = new Float64Array(3);\n        const test = (ax, ay, az) => {\n            const len = Math.hypot(ax, ay, az);\n            if (len < 1e-9) return false;\n            ax /= len; ay /= len; az /= len;\n            let lo = Infinity, hi = -Infinity;\n            for (let i = 0; i < worldVerts.length; i += 3) {\n                const d = worldVerts[i] * ax + worldVerts[i + 1] * ay + worldVerts[i + 2] * az;\n                if (d < lo) lo = d;\n                if (d > hi) hi = d;\n            }\n            const c = box.c[0] * ax + box.c[1] * ay + box.c[2] * az;\n            let r = 0;\n            for (let i = 0; i < 3; i++) {\n                r += box.e[i] * Math.abs(box.b[i * 3] * ax + box.b[i * 3 + 1] * ay + box.b[i * 3 + 2] * az);\n            }\n            return lo > c + r + EPS || hi < c - r - EPS;   // separated on this axis\n        };\n        for (let i = 0; i < 3; i++) {\n            if (test(box.b[i * 3], box.b[i * 3 + 1], box.b[i * 3 + 2])) return false;\n        }\n        const fn = hull.faceNormals;\n        for (let i = 0; i < fn.length; i += 3) {\n            quatRotate(q, fn[i], fn[i + 1], fn[i + 2], axis);\n            if (test(axis[0], axis[1], axis[2])) return false;\n        }\n        const ed = hull.edgeDirections;\n        for (let i = 0; i < ed.length; i += 3) {\n            quatRotate(q, ed[i], ed[i + 1], ed[i + 2], axis);\n            for (let j = 0; j < 3; j++) {\n                const bx = box.b[j * 3], by = box.b[j * 3 + 1], bz = box.b[j * 3 + 2];\n                if (test(axis[1] * bz - axis[2] * by, axis[2] * bx - axis[0] * bz, axis[0] * by - axis[1] * bx)) return false;\n            }\n        }\n        return true;\n    }\n\n    _hullSphereSeparated(worldVerts, hull, t) {\n        // Separated when some hull face plane leaves the sphere entirely outside.\n        const q = { x: t.qx, y: t.qy, z: t.qz, w: t.qw };\n        const s = this.sphere;\n        const axis = new Float64Array(3);\n        const fn = hull.faceNormals;\n        for (let i = 0; i < fn.length; i += 3) {\n            quatRotate(q, fn[i], fn[i + 1], fn[i + 2], axis);\n            let hi = -Infinity, lo = Infinity;\n            for (let k = 0; k < worldVerts.length; k += 3) {\n                const d = worldVerts[k] * axis[0] + worldVerts[k + 1] * axis[1] + worldVerts[k + 2] * axis[2];\n                if (d > hi) hi = d;\n                if (d < lo) lo = d;\n            }\n            const c = s.c[0] * axis[0] + s.c[1] * axis[1] + s.c[2] * axis[2];\n            if (c - s.r > hi || c + s.r < lo) return true;\n        }\n        return false;\n    }\n\n    describe() {\n        if (this.shape === \"sphere\") {\n            return \"sphere r=\" + this.sphere.r.toFixed(3) + \" at \" + this.center.map(v => v.toFixed(2)).join(\", \");\n        }\n        return \"box \" + this.box.e.map(v => (v * 2).toFixed(2)).join(\" x \") + \" at \" + this.center.map(v => v.toFixed(2)).join(\", \");\n    }\n}\n\n/** Spherical interpolation, used when sub-sampling motion between frames. */\nfunction slerp(a, b, s, out) {\n    let cos = a.qx * b.qx + a.qy * b.qy + a.qz * b.qz + a.qw * b.qw;\n    let bx = b.qx, by = b.qy, bz = b.qz, bw = b.qw;\n    if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }\n    let k0, k1;\n    if (cos > 0.9995) { k0 = 1 - s; k1 = s; }\n    else {\n        const theta = Math.acos(cos), sin = Math.sin(theta);\n        k0 = Math.sin((1 - s) * theta) / sin;\n        k1 = Math.sin(s * theta) / sin;\n    }\n    out.qx = a.qx * k0 + bx * k1;\n    out.qy = a.qy * k0 + by * k1;\n    out.qz = a.qz * k0 + bz * k1;\n    out.qw = a.qw * k0 + bw * k1;\n    out.px = a.px + (b.px - a.px) * s;\n    out.py = a.py + (b.py - a.py) * s;\n    out.pz = a.pz + (b.pz - a.pz) * s;\n    return out;\n}\n\nmodule.exports = {\n    Obb, Sphere, ConvexHull, CarHitbox, TriggerVolume,\n    obbIntersectsObb, obbIntersectsSphere,\n    quatRotate, quatToBasis, eulerToQuaternion, slerp,\n    CAR_MASS_OFFSET_DEFAULT, CAR_DETECTOR_CENTER, CAR_DETECTOR_HALF_EXTENTS,\n};\n", "objectives": "\"use strict\";\n// Modular bruteforce objectives.\n//\n// Every objective is an independent module with the same tiny interface, so the\n// checkpoint/restore machinery in simulator.js never has to know which one is\n// running:\n//\n//   create(context)   -> an evaluator for one candidate\n//   evaluator.observe(frame, raw, transform) -> true to stop simulating early\n//   evaluator.result() -> { score, state, ... }   higher score is better\n//\n// Adding another objective means adding another entry to REGISTRY; nothing else\n// in the engine changes.\n\nconst { readSpeedKmh, readNextCheckpointIndex, readFinishFrames, hasFinished, hasStarted, readFrames } = require(\"./car-state\");\nconst { CarHitbox, TriggerVolume, slerp } = require(\"./geometry\");\n\n// Scores are compared as plain numbers, so objectives that must dominate others\n// (a run that reached the trigger always beats one that did not) are separated\n// by a wide constant band rather than by clever tie-breaking.\nconst REACHED_BAND = 1e9;\n\n// No bound in force. Kept inside the Int32 range because the coordinator publishes the\n// bound the current best justifies to the workers through a shared Int32Array.\nconst NO_BOUND = 0x7fffffff;\n\nfunction distance(ax, ay, az, bx, by, bz) {\n    const dx = ax - bx, dy = ay - by, dz = az - bz;\n    return Math.sqrt(dx * dx + dy * dy + dz * dz);\n}\n\n/* ------------------------------------------------------------------ finish */\n\nfunction finishObjective(context, bound) {\n    const evalFrame = context.evalFrame;\n    let finishFrames = null;\n    let bestCheckpoint = 0;\n    let lastSpeed = 0;\n    // A run that has not finished by the time its own lap counter reaches the best\n    // run's finish time cannot beat it, so there is nothing left to learn from it.\n    // The test is against the car's own counter rather than the loop frame, so it holds\n    // whatever that counter's origin is; and if the counter is ever seen going\n    // backwards the bound is abandoned rather than risk cutting off a run that could\n    // still have won.\n    let bounded = false;\n    let trustCounter = bound < NO_BOUND;\n    let lastFrames = -1;\n    return {\n        // The car's position is never consulted, so the simulator can skip decoding it.\n        needsTransform: false,\n        observe(frame, raw) {\n            const cp = readNextCheckpointIndex(raw);\n            if (cp > bestCheckpoint) bestCheckpoint = cp;\n            lastSpeed = readSpeedKmh(raw);\n            if (hasFinished(raw)) { finishFrames = readFinishFrames(raw); return true; }\n            if (trustCounter) {\n                const now = readFrames(raw);\n                if (now < lastFrames) trustCounter = false;\n                else {\n                    lastFrames = now;\n                    if (now >= bound) { bounded = true; return true; }\n                }\n            }\n            return false;\n        },\n        result() {\n            const score = finishFrames != null\n                ? REACHED_BAND + (evalFrame - finishFrames)\n                : bestCheckpoint * 1000 + lastSpeed;\n            return { bounded, score, state: { finishFrames, nextCheckpointIndex: bestCheckpoint, speedKmh: lastSpeed } };\n        },\n    };\n}\n\n/* -------------------------------------------------------- checkpoint+speed */\n\nfunction checkpointSpeedObjective(context) {\n    let bestCheckpoint = 0, lastSpeed = 0, finishFrames = null;\n    const evalFrame = context.evalFrame;\n    return {\n        needsTransform: false,\n        observe(frame, raw) {\n            const cp = readNextCheckpointIndex(raw);\n            if (cp > bestCheckpoint) bestCheckpoint = cp;\n            lastSpeed = readSpeedKmh(raw);\n            if (hasFinished(raw) && finishFrames == null) finishFrames = readFinishFrames(raw);\n            return false;\n        },\n        result() {\n            let score = bestCheckpoint * 10000 + lastSpeed;\n            if (finishFrames != null) score += REACHED_BAND + (evalFrame - finishFrames);\n            return { score, state: { finishFrames, nextCheckpointIndex: bestCheckpoint, speedKmh: lastSpeed } };\n        },\n    };\n}\n\n/* ------------------------------------------------------------------- speed */\n\nfunction speedObjective() {\n    let last = 0, best = 0, cp = 0, finishFrames = null;\n    return {\n        needsTransform: false,\n        observe(frame, raw) {\n            last = readSpeedKmh(raw);\n            if (last > best) best = last;\n            cp = readNextCheckpointIndex(raw);\n            if (hasFinished(raw) && finishFrames == null) finishFrames = readFinishFrames(raw);\n            return false;\n        },\n        result() { return { score: last, state: { speedKmh: last, maxSpeedKmh: best, nextCheckpointIndex: cp, finishFrames } }; },\n    };\n}\n\n/* ---------------------------------------------------------- distance+speed */\n\nfunction distanceSpeedObjective(context) {\n    const target = context.targetPoint || { x: 0, y: 0, z: 0 };\n    const w = Math.max(0, Math.min(1, context.distanceWeight != null ? context.distanceWeight : 0.5));\n    let closest = Infinity, lastSpeed = 0, cp = 0, finishFrames = null;\n    return {\n        observe(frame, raw, t) {\n            const d = distance(t.px, t.py, t.pz, target.x, target.y, target.z);\n            if (d < closest) closest = d;\n            lastSpeed = readSpeedKmh(raw);\n            cp = readNextCheckpointIndex(raw);\n            if (hasFinished(raw) && finishFrames == null) finishFrames = readFinishFrames(raw);\n            return false;\n        },\n        result() {\n            const score = (1 - w) * lastSpeed - w * closest;\n            return { score, state: { speedKmh: lastSpeed, distanceToTarget: closest, nextCheckpointIndex: cp, finishFrames } };\n        },\n    };\n}\n\n/* -------------------------------------------------------------- axis extreme */\n\nfunction axisObjective(axis, sign) {\n    return function (context) {\n        let best = -Infinity, lastSpeed = 0, cp = 0, finishFrames = null;\n        const key = axis === 0 ? \"px\" : axis === 1 ? \"py\" : \"pz\";\n        return {\n            observe(frame, raw, t) {\n                const v = sign * t[key];\n                if (v > best) best = v;\n                lastSpeed = readSpeedKmh(raw);\n                cp = readNextCheckpointIndex(raw);\n                if (hasFinished(raw) && finishFrames == null) finishFrames = readFinishFrames(raw);\n                return false;\n            },\n            result() {\n                return { score: best, state: { speedKmh: lastSpeed, nextCheckpointIndex: cp, finishFrames, axisValue: sign * best } };\n            },\n        };\n    };\n}\n\n/* ----------------------------------------------------------------- trigger */\n\n/**\n * Trigger: find the input sequence that reaches a user-placed volume on the\n * earliest possible frame.\n *\n * The metric really is \"first frame on which the car's collision geometry is\n * inside the trigger\" - what the car does afterwards is irrelevant, so the\n * simulation stops as soon as it fires. A run that never reaches the trigger\n * still needs to be rankable, otherwise the search has nothing to climb, so\n * misses are scored by how close they came; every hit outranks every miss\n * because hits sit in their own band.\n */\nfunction triggerObjective(context, bound) {\n    return makeTriggerObjective(context, \"earliest\", bound);\n}\n\n/**\n * Trigger, scored on speed instead of time: every sequence that reaches the\n * volume outranks every one that misses, and among those that reach it the\n * fastest car at the moment of contact wins.\n */\nfunction triggerSpeedObjective(context) {\n    // Scored on speed at the moment of contact, so a later hit can still win: there is\n    // no frame bound to be had here.\n    return makeTriggerObjective(context, \"speed\", NO_BOUND);\n}\n\nfunction makeTriggerObjective(context, mode, bound) {\n    const volume = context.triggerVolume;\n    const hitbox = context.carHitbox;\n    const evalFrame = context.evalFrame;\n    const startFrame = context.startFrame || 0;\n    const substeps = Math.max(1, Math.min(16, context.triggerSweepSamples || 1));\n    const requireStarted = context.triggerRequireStarted !== false;\n    const armFrame = Number.isFinite(context.triggerArmFrame) ? context.triggerArmFrame : -Infinity;\n\n    // The earliest-frame variant scores hits by frame, so a candidate that has not\n    // reached the volume by the frame the best run reached it on cannot win.\n    const boundFrame = (mode === \"earliest\" && bound != null) ? bound : NO_BOUND;\n    let bounded = false;\n    let hitFrame = null;\n    let closest = Infinity;\n    let closestFrame = -1;\n    let lastSpeed = 0, speedAtHit = null, cp = 0, finishFrames = null;\n    let hasPrevious = false;\n    const previous = { px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 };\n    const lerped = { px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 };\n    const remember = t => {\n        previous.px = t.px; previous.py = t.py; previous.pz = t.pz;\n        previous.qx = t.qx; previous.qy = t.qy; previous.qz = t.qz; previous.qw = t.qw;\n        hasPrevious = true;\n    };\n\n    return {\n        observe(frame, raw, t) {\n            lastSpeed = readSpeedKmh(raw);\n            cp = readNextCheckpointIndex(raw);\n            if (hasFinished(raw) && finishFrames == null) finishFrames = readFinishFrames(raw);\n            if (hitFrame != null) return true;\n            if (frame >= boundFrame) { bounded = true; return true; }\n            if (frame < armFrame) { remember(t); return false; }\n            if (requireStarted && !hasStarted(raw)) { remember(t); return false; }\n\n            // Sub-sampling the motion between two physics frames costs almost\n            // nothing next to a 3 us physics step and removes any chance of\n            // stepping straight through a thin trigger at high speed.\n            if (substeps > 1 && hasPrevious) {\n                for (let s = 1; s < substeps; s++) {\n                    slerp(previous, t, s / substeps, lerped);\n                    if (hitbox.intersects(lerped, volume)) {\n                        hitFrame = frame;\n                        speedAtHit = lastSpeed;\n                        return true;\n                    }\n                }\n            }\n            if (hitbox.intersects(t, volume)) {\n                hitFrame = frame;\n                speedAtHit = lastSpeed;\n                return true;\n            }\n            const d = hitbox.distanceTo(t, volume);\n            if (d < closest) { closest = d; closestFrame = frame; }\n            remember(t);\n            return false;\n        },\n        result() {\n            let score;\n            if (hitFrame == null) score = -closest;\n            else if (mode === \"speed\") score = REACHED_BAND + speedAtHit;\n            else score = REACHED_BAND + (evalFrame - hitFrame);\n            return {\n                bounded,\n                score,\n                state: {\n                    triggerFrame: hitFrame,\n                    triggerFramesFromStart: hitFrame != null ? hitFrame - startFrame : null,\n                    distanceToTarget: hitFrame != null ? 0 : (closest === Infinity ? null : closest),\n                    closestFrame: hitFrame != null ? hitFrame : closestFrame,\n                    speedKmh: hitFrame != null ? speedAtHit : lastSpeed,\n                    nextCheckpointIndex: cp,\n                    finishFrames,\n                },\n            };\n        },\n    };\n}\n\nconst REGISTRY = {\n    finish: { label: \"Finish time\", create: finishObjective },\n    checkpoint_speed: { label: \"Checkpoint + speed\", create: checkpointSpeedObjective },\n    speed: { label: \"Max speed\", create: speedObjective },\n    distance_speed: { label: \"Distance + speed\", create: distanceSpeedObjective },\n    x: { label: \"Max X\", create: axisObjective(0, 1) },\n    \"-x\": { label: \"Min X\", create: axisObjective(0, -1) },\n    y: { label: \"Max Y\", create: axisObjective(1, 1) },\n    \"-y\": { label: \"Min Y\", create: axisObjective(1, -1) },\n    z: { label: \"Max Z\", create: axisObjective(2, 1) },\n    \"-z\": { label: \"Min Z\", create: axisObjective(2, -1) },\n    trigger: { label: \"Trigger (earliest frame)\", create: triggerObjective },\n    trigger_speed: { label: \"Trigger (most speed)\", create: triggerSpeedObjective },\n};\n\nfunction hasObjective(id) { return Object.prototype.hasOwnProperty.call(REGISTRY, id); }\n\n/** True for every objective that searches for a user-placed trigger volume. */\nfunction isTriggerObjective(id) { return id === \"trigger\" || id === \"trigger_speed\"; }\n\n/**\n * Builds the shared evaluation context once per run, including the trigger\n * volume and the car hitbox so they are not rebuilt per candidate.\n */\nfunction buildContext(settings, assets) {\n    const context = {\n        evalFrame: settings.evalFrame,\n        startFrame: settings.start,\n        targetPoint: settings.targetPoint,\n        distanceWeight: settings.distanceWeight,\n    };\n    if (isTriggerObjective(settings.objective)) {\n        const trigger = settings.trigger || {};\n        context.triggerVolume = new TriggerVolume({\n            shape: trigger.shape || \"box\",\n            center: trigger.center || [0, 0, 0],\n            size: trigger.size || [4, 4, 4],\n            rotation: trigger.rotation || [0, 0, 0],\n            radius: trigger.radius,\n        });\n        context.carHitbox = new CarHitbox({\n            mode: trigger.hitbox || \"detector\",\n            massOffset: assets.carMassOffset,\n            collisionShapeVertices: assets.carCollisionShapeVertices,\n            pointRadius: trigger.pointRadius,\n        });\n        context.triggerSweepSamples = trigger.sweepSamples;\n        context.triggerRequireStarted = trigger.requireStarted;\n        context.triggerArmFrame = trigger.armFrame;\n    }\n    return context;\n}\n\nfunction createObjective(id, context, bound) {\n    const entry = REGISTRY[id];\n    if (!entry) throw new Error(\"Unknown bruteforce objective: \" + id);\n    return entry.create(context, bound == null ? NO_BOUND : bound);\n}\n\n/**\n * True for the objectives that can cut a hopeless candidate short.\n *\n * Both score a run that fired its event at frame E as REACHED_BAND + (evalFrame - E),\n * and every run that never fires it strictly below REACHED_BAND. That shape is what\n * makes an exact bound possible: the event frame is the only thing a winning candidate\n * can improve, so once it is too late to fire early enough, the candidate is finished.\n * Every other objective ends in the speed on the last simulated frame or a running\n * maximum, neither of which can be bounded from above without inventing a speed cap.\n */\nfunction supportsBound(id) { return id === \"finish\" || id === \"trigger\"; }\n\n/**\n * The frame by which a candidate must have fired its event to beat `bestSelectionScore`.\n *\n * Selection is on selectionScore, not on the raw objective score, and in \"lis\" mode\n * those differ: selectionScore = (1-w)*score - w*inputCount, so a candidate carrying\n * fewer inputs can win with a LATER finish. Bounding on the best run's raw event frame\n * would therefore throw away real improvements - which is why the threshold is derived\n * per candidate from the input count it is already carrying. For every other mode w is\n * effectively 0 and this collapses to \"beat the best run's event frame\".\n */\nfunction boundFrameFor(settings, bestSelectionScore, inputCount) {\n    if (!Number.isFinite(bestSelectionScore)) return NO_BOUND;\n    let target = bestSelectionScore;\n    if (settings.mutationMode === \"lis\") {\n        const w = Math.max(0, Math.min(1, settings.lisWeight != null ? settings.lisWeight : 0.5));\n        // With all the weight on the input count the objective score cannot decide\n        // anything, so there is nothing to bound.\n        if (w >= 1) return NO_BOUND;\n        target = (target + w * inputCount) / (1 - w);\n    }\n    const bound = settings.evalFrame + REACHED_BAND - target;\n    if (!(bound > 0)) return 0;\n    return bound < NO_BOUND ? bound : NO_BOUND;\n}\n\n// The bound travels between threads as the raw bits of a double in one atomic 64-bit\n// word, so a worker can never read half of an update.\nconst _scoreF64 = new Float64Array(1);\nconst _scoreI64 = new BigInt64Array(_scoreF64.buffer);\nfunction scoreToBits(value) { _scoreF64[0] = value; return _scoreI64[0]; }\nfunction bitsToScore(bits) { _scoreI64[0] = bits; return _scoreF64[0]; }\n\nmodule.exports = {\n    REGISTRY, hasObjective, isTriggerObjective, buildContext, createObjective,\n    supportsBound, boundFrameFor, scoreToBits, bitsToScore, REACHED_BAND, NO_BOUND,\n};\n", "tas-text": "\"use strict\";\n// The TAS editor's text format: one \"frame,keys\" line per input change, with\n// keys drawn from w/a/s/d/r (up/left/down/right/reset) and each line holding\n// until the next one. Kept byte-compatible with the parser in tas-tool.html so\n// candidates produced here paste straight back into the editor.\n\nconst KEY_ORDER = [\"w\", \"a\", \"s\", \"d\", \"r\"];\n\n// normalizeKeys is called once per entry inside compactEntries and entriesToText, which\n// puts it on the per-candidate path of a search that tests thousands of candidates a\n// second. The alphabet is five letters, so there are only 32 distinct results: memoising\n// turns a Set build plus an array filter into a Map lookup. The cache is bounded so a\n// pathological input cannot grow it without limit.\nconst NORMALIZE_CACHE = new Map();\nconst NORMALIZE_CACHE_LIMIT = 4096;\n\nfunction normalizeKeys(str) {\n    const key = typeof str === \"string\" ? str : String(str || \"\");\n    const hit = NORMALIZE_CACHE.get(key);\n    if (hit !== undefined) return hit;\n    const set = new Set();\n    for (const ch of key.toLowerCase()) if (KEY_ORDER.indexOf(ch) >= 0) set.add(ch);\n    const out = KEY_ORDER.filter(k => set.has(k)).join(\"\");\n    if (NORMALIZE_CACHE.size < NORMALIZE_CACHE_LIMIT) NORMALIZE_CACHE.set(key, out);\n    return out;\n}\n\n// Per-frame control bits, in the order updateCarModel() takes them.\nconst BIT_UP = 1, BIT_RIGHT = 2, BIT_DOWN = 4, BIT_LEFT = 8, BIT_RESET = 16;\n\nconst MASK_CACHE = new Map();\nfunction maskForKeys(keys) {\n    const hit = MASK_CACHE.get(keys);\n    if (hit !== undefined) return hit;\n    let mask = 0;\n    if (keys.includes(\"w\")) mask |= BIT_UP;\n    if (keys.includes(\"d\")) mask |= BIT_RIGHT;\n    if (keys.includes(\"s\")) mask |= BIT_DOWN;\n    if (keys.includes(\"a\")) mask |= BIT_LEFT;\n    if (keys.includes(\"r\")) mask |= BIT_RESET;\n    if (MASK_CACHE.size < NORMALIZE_CACHE_LIMIT) MASK_CACHE.set(keys, mask);\n    return mask;\n}\n\nfunction parseEntries(text) {\n    return String(text || \"\").split(\"\\n\")\n        .map(line => { const i = line.indexOf(\"#\"); return i >= 0 ? line.slice(0, i) : line; })\n        .filter(line => line.trim() !== \"\")\n        .map(line => {\n            const parts = line.split(\",\");\n            return { frame: parseInt(parts[0], 10), keys: normalizeKeys(parts.slice(1).join(\",\").trim()) };\n        })\n        .filter(e => Number.isFinite(e.frame))\n        .sort((a, b) => a.frame - b.frame);\n}\n\nfunction entriesToText(entries) {\n    return entries.slice().sort((a, b) => a.frame - b.frame)\n        .map(e => e.frame + \",\" + normalizeKeys(e.keys)).join(\"\\n\");\n}\n\n/** Drops repeats so the count matches what the editor calls an input event. */\nfunction compactEntries(entries) {\n    const byFrame = new Map();\n    for (const e of entries || []) if (Number.isFinite(e.frame)) byFrame.set(e.frame, normalizeKeys(e.keys));\n    const sorted = Array.from(byFrame.entries())\n        .map(([frame, keys]) => ({ frame, keys }))\n        .sort((a, b) => a.frame - b.frame);\n    const out = [];\n    let previous = \"\";\n    for (const e of sorted) {\n        if (e.keys === previous) continue;\n        out.push(e);\n        previous = e.keys;\n    }\n    return out;\n}\n\n/**\n * True when `entries` is already in the form compactEntries() produces: sorted, one per\n * frame, normalised keys, and no run of two events holding the same keys. Every caller\n * downstream of a mutation hands us exactly that, so recognising it in a single pass\n * avoids rebuilding a Map and re-sorting for nothing.\n */\nfunction isCompactEntries(entries) {\n    const list = entries || [];\n    let previousFrame = -Infinity;\n    let previousKeys = \"\";\n    for (let i = 0; i < list.length; i++) {\n        const e = list[i];\n        if (!e || !Number.isFinite(e.frame) || e.frame <= previousFrame) return false;\n        if (typeof e.keys !== \"string\" || e.keys !== normalizeKeys(e.keys)) return false;\n        if (e.keys === previousKeys) return false;\n        previousFrame = e.frame;\n        previousKeys = e.keys;\n    }\n    return true;\n}\n\nfunction countInputEvents(entries) {\n    if (isCompactEntries(entries)) return entries.length;\n    return compactEntries(entries).length;\n}\n\nfunction stateAt(entries, frame) {\n    let state = \"\";\n    for (const e of entries) { if (e.frame <= frame) state = e.keys; else break; }\n    return state;\n}\n\n/**\n * Expands input events into a per-frame control table. The engine steps the\n * physics one frame at a time, so resolving the whole plan up front removes a\n * binary search from the inner loop.\n */\nclass ControlPlan {\n    /**\n     * `fromFrame` bounds the work: in checkpointed mode nothing ever asks for a frame\n     * before the search start, so filling the prefix is pure cost. The table is one\n     * byte of control bits per frame instead of five parallel arrays, which lets the\n     * fill run as a handful of bulk fills - one per input event - rather than a write\n     * per frame, and lets two plans be compared with a single typed-array scan.\n     */\n    constructor(entries, frameCount, fromFrame) {\n        this.frameCount = frameCount;\n        this.bits = new Uint8Array(frameCount);\n        this.filledFrom = frameCount;\n        // The last frame on which the controls change. Past it the inputs are frozen\n        // for the rest of the run, which is what lets a stalled car be written off.\n        this.lastChange = 0;\n        this._controls = { up: false, right: false, down: false, left: false, reset: false };\n        if (entries) this.fill(entries, fromFrame || 0);\n    }\n\n    /** Rewrites [fromFrame, frameCount). Frames below it keep whatever was there. */\n    fill(entries, fromFrame) {\n        // The mutation operators hand over entries that are already compact; only copy\n        // and rebuild when they are not.\n        const compact = isCompactEntries(entries) ? entries : compactEntries(entries);\n        const n = this.frameCount;\n        const from = Math.max(0, Math.min(n, fromFrame | 0));\n        this.filledFrom = from;\n        this.lastChange = from;\n        const bits = this.bits;\n        let index = 0;\n        let keys = \"\";\n        while (index < compact.length && compact[index].frame <= from) keys = compact[index++].keys;\n        let frame = from;\n        let mask = maskForKeys(keys);\n        while (frame < n) {\n            const next = index < compact.length ? Math.min(n, Math.max(frame, compact[index].frame)) : n;\n            if (next > frame) bits.fill(mask, frame, next);\n            frame = next;\n            if (frame >= n) break;\n            while (index < compact.length && compact[index].frame <= frame) keys = compact[index++].keys;\n            const nextMask = maskForKeys(keys);\n            // compactEntries has already dropped repeats, so every boundary here is a\n            // real change; guard anyway so the flag never overstates.\n            if (nextMask !== mask) this.lastChange = frame;\n            mask = nextMask;\n        }\n        return this;\n    }\n\n    /** The raw control bits for one frame; 0 past the end of the plan. */\n    bitsAt(frame) { return frame < this.frameCount ? this.bits[frame] : 0; }\n\n    /**\n     * The first frame at or after `from` where this plan and `other` differ, or -1.\n     * Both plans must have been filled from at or below `from`.\n     */\n    firstDifference(other, from, to) {\n        const a = this.bits, b = other.bits;\n        const end = Math.min(to, this.frameCount, other.frameCount);\n        for (let f = Math.max(0, from); f < end; f++) if (a[f] !== b[f]) return f;\n        if (this.frameCount !== other.frameCount) {\n            const longer = this.frameCount > other.frameCount ? this : other;\n            for (let f = end; f < Math.min(to, longer.frameCount); f++) if (longer.bits[f] !== 0) return f;\n        }\n        return -1;\n    }\n\n    at(frame) {\n        const c = this._controls;\n        const b = frame < this.frameCount ? this.bits[frame] : 0;\n        c.up = (b & BIT_UP) !== 0;\n        c.right = (b & BIT_RIGHT) !== 0;\n        c.down = (b & BIT_DOWN) !== 0;\n        c.left = (b & BIT_LEFT) !== 0;\n        c.reset = (b & BIT_RESET) !== 0;\n        return c;\n    }\n}\n\nmodule.exports = {\n    KEY_ORDER, normalizeKeys, parseEntries, entriesToText,\n    compactEntries, countInputEvents, isCompactEntries, stateAt, ControlPlan, maskForKeys,\n    BIT_UP, BIT_RIGHT, BIT_DOWN, BIT_LEFT, BIT_RESET,\n};\n"};
var __cache = Object.create(null);
function __require(request) {
  var name = String(request);
  if (name.slice(0, 2) === './') name = name.slice(2);
  if (name.slice(-3) === '.js') name = name.slice(0, -3);
  if (!(name in __sources)) throw new Error('missing module ' + name);
  if (__cache[name]) return __cache[name].exports;
  var module = { exports: {} };
  __cache[name] = module;
  (new Function('require', 'module', 'exports', __sources[name]))(__require, module, module.exports);
  return module.exports;
}
globalThis.__polyTasEvalModules = {
  objectives: __require('objectives'),
  carState: __require('car-state'),
  tasText: __require('tas-text'),
  geometry: __require('geometry'),
};
})();
;(function(){
// Vanilla backend, renderer side.
//
// Simulates candidates through the game's own Simulation object - the same
// createCar / startCar path a ghost uses, fanned out across the same worker
// pool - and scores them with the same objective code the other backends use.
//
// Two details make the reuse exact rather than approximate:
//
//   * createCar only ever calls .serialize() on the recording it is given, so a
//     plain object carrying the encoded string is accepted in place of a real
//     Recording. The string itself is produced in the main process, which
//     already has the game's recording encoder, so nothing is reimplemented.
//
//   * the objectives read the packed car-state bytes. The game ships both the
//     decoder and the encoder for that format, so each streamed state is put
//     back into bytes with the game's own encoder and handed to the unmodified
//     objective code. Nothing about scoring is duplicated.

function evalModules() {
    return globalThis.__polyTasEvalModules;
}

var runs = Object.create(null);

function reply(payload) {
    try {
        var ipc = window.electron;
        if (ipc && ipc.tasToolVanillaResult) ipc.tasToolVanillaResult(payload);
    } catch (e) {}
}

globalThis.__polyTasSetupVanilla = function (view) {
    if (view._polyTasVanillaReady) return;
    view._polyTasVanillaReady = true;
    try {
        var ipc = window.electron;
        if (!ipc || !ipc.onTasToolVanillaEval) return;
        ipc.onTasToolVanillaEval(function (request) { run(globalThis.__polyTasView, request); });
        if (ipc.onTasToolVanillaCancel) {
            ipc.onTasToolVanillaCancel(function (payload) {
                var id = payload && payload.runId;
                if (!id) return;
                var record = runs[id] || (runs[id] = {});
                record.cancelled = true;
                // Every batch still being simulated is closed out on the spot
                // with whatever each car has reached. The search waits on those
                // replies before it can stop, and a car that had not started
                // yet would never have reported at all, so waiting for them was
                // the whole of the delay between pressing Cancel and the search
                // actually stopping.
                var pendingAborts = record.aborts || [];
                record.aborts = [];
                for (var i = 0; i < pendingAborts.length; i++) {
                    try { pendingAborts[i](); } catch (e) {}
                }
            });
        }
    } catch (e) {}
};

function run(view, request) {
    var modules = evalModules();
    var codec = globalThis.__polyTasCarStateCodec;
    var sim = view._polyTasSim;
    var track = view._polyTasTrackA;
    var trackData = view._polyTasTrackData;
    var mountain = view._polyTasMountain;

    if (!request || !request.runId) return;
    if (!modules || !codec || !sim || !track || !trackData || !mountain) {
        reply({ runId: request.runId, batchId: request.batchId,
            error: "The vanilla backend needs a replay open in the game so its simulation is running." });
        return;
    }
    if (runs[request.runId] && runs[request.runId].cancelled) {
        reply({ runId: request.runId, batchId: request.batchId, results: [], physicsFrames: 0 });
        return;
    }

    var startTransform;
    try { startTransform = track.getStartTransform(); } catch (e) { startTransform = null; }
    if (!startTransform) {
        reply({ runId: request.runId, batchId: request.batchId, error: "The current track has no start point." });
        return;
    }

    var objectives = modules.objectives;
    var carState = modules.carState;
    var tasText = modules.tasText;
    var context;
    try {
        context = objectives.buildContext({
            evalFrame: request.evalFrame,
            start: request.startFrame,
            objective: request.objective,
            targetPoint: request.targetPoint,
            distanceWeight: request.distanceWeight,
            trigger: request.trigger,
        }, {
            carMassOffset: (globalThis.__polyTasPhysicsInit || {}).carMassOffset,
            carCollisionShapeVertices: (globalThis.__polyTasPhysicsInit || {}).carCollisionShapeVertices,
        });
    } catch (e) {
        reply({ runId: request.runId, batchId: request.batchId, error: "Objective setup failed: " + (e && e.message || e) });
        return;
    }

    var verts, offset;
    try { verts = mountain.getMountainVertices(); offset = mountain.getMountainOffset(); }
    catch (e) {
        reply({ runId: request.runId, batchId: request.batchId, error: "The track's terrain is not ready." });
        return;
    }

    var candidates = request.candidates || [];
    var results = new Array(candidates.length);
    var pending = candidates.length;
    var frames = 0;
    // Every candidate's finish function, so a cancel can close the batch out.
    var finishers = [];
    if (!pending) { reply({ runId: request.runId, batchId: request.batchId, results: [], physicsFrames: 0 }); return; }

    // A scratch buffer for the packed state: four bytes of car id, then the
    // record itself, which is the layout the objectives expect.
    var scratch = new Uint8Array(240);

    // The backend keeps several batches in flight at once, so each registers
    // its own way of being closed out rather than replacing the last one's.
    var record = runs[request.runId] || (runs[request.runId] = {});
    if (!record.aborts) record.aborts = [];
    var abortThis = function () {
        for (var i = 0; i < finishers.length; i++) {
            try { finishers[i](null); } catch (e) {}
        }
    };
    record.aborts.push(abortThis);
    function forgetAbort() {
        var list = record.aborts || [];
        var at = list.indexOf(abortThis);
        if (at >= 0) list.splice(at, 1);
    }

    candidates.forEach(function (candidate, index) {
        var entries = tasText.parseEntries(candidate.text);
        var recording = candidate.recording;
        var objective = objectives.createObjective(request.objective, context);
        var transform = { px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
        var done = false;
        var carId = null;
        var simulated = 0;

        function finish(lastState) {
            if (done) return;
            done = true;
            try { if (carId != null) sim.deleteCar(carId); } catch (e) {}
            var outcome = objective.result();
            results[index] = {
                text: candidate.text,
                label: candidate.label,
                index: index,
                score: outcome.score,
                selectionScore: outcome.score,
                inputCount: tasText.countInputEvents(entries),
                state: outcome.state,
                frames: simulated,
            };
            frames += simulated;
            if (--pending === 0) {
                forgetAbort();
                reply({ runId: request.runId, batchId: request.batchId,
                    results: results.filter(Boolean), physicsFrames: frames });
            }
        }
        finishers.push(finish);

        try {
            var created = sim.createCar(startTransform, verts, offset, trackData,
                { serialize: function () { return recording; } },
                function (state) {
                    if (done) return;
                    simulated = state.frames;
                    var packed;
                    try { packed = codec._c(state); } catch (e) { finish(state); return; }
                    if (packed.length + 4 > scratch.length) scratch = new Uint8Array(packed.length + 8);
                    scratch.set(packed, 4);
                    var raw = scratch.subarray(0, packed.length + 4);
                    carState.readTransform(raw, transform);
                    var stop = false;
                    try { stop = objective.observe(state.frames, raw, transform); } catch (e) { stop = true; }
                    if (stop || state.frames >= request.evalFrame) finish(state);
                });
            carId = created.id;
            sim.startCar(carId, { numberOfFrames: request.evalFrame });
            if (runs[request.runId] && runs[request.runId].cancelled) finish(null);
        } catch (e) {
            results[index] = null;
            if (--pending === 0) {
                reply({ runId: request.runId, batchId: request.batchId,
                    results: results.filter(Boolean), physicsFrames: frames });
            }
        }
    });
}

})();

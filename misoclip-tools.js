/*
 * Added by the MisoTweaks Live Inputs fork.
 * Pure input-set parser shared by the in-game converter and its tests.
 */
(function(root, factory) {
    var api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root) root.MisoClipTools = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
    "use strict";

    var CONTROL_KEYS = [ "up", "right", "down", "left", "reset" ];
    var ALIASES = {
        w: "up",
        d: "right",
        s: "down",
        a: "left",
        r: "reset",
        accelerate: "up",
        throttle: "up",
        forward: "up",
        brake: "down",
        reverse: "down",
        back: "down",
        turnright: "right",
        turnleft: "left",
        restart: "reset"
    };

    function neutralControls() {
        return {
            up: false,
            right: false,
            down: false,
            left: false,
            reset: false
        };
    }

    function normalizeToken(token) {
        var key = String(token || "").trim().toLowerCase().replace(/[^a-z]/g, "");
        return ALIASES[key] || key;
    }

    function normalizeControls(value) {
        var out = neutralControls();
        if (value == null || value === "" || value === false) return out;
        if (typeof value === "number") {
            out.up = !!(value & 1);
            out.right = !!(value & 2);
            out.down = !!(value & 4);
            out.left = !!(value & 8);
            out.reset = !!(value & 16);
            return out;
        }
        if (typeof value === "string") {
            var lowered = value.trim().toLowerCase();
            if (!lowered || lowered === "none" || lowered === "neutral" || lowered === "off" || lowered === "-") return out;
            if (/^\d+$/.test(lowered)) return normalizeControls(parseInt(lowered, 10));
            if (/^[wasdr]+$/.test(lowered)) return normalizeControls(lowered.split(""));
            return normalizeControls(lowered.split(/[+,|/\s]+/g));
        }
        if (Array.isArray(value)) {
            value.forEach(function(token) {
                var key = normalizeToken(token);
                if (CONTROL_KEYS.indexOf(key) !== -1) out[key] = true;
            });
            return out;
        }
        if (typeof value === "object") {
            if (value.inputs != null) return normalizeControls(value.inputs);
            if (value.controls != null) return normalizeControls(value.controls);
            CONTROL_KEYS.forEach(function(key) {
                if (value[key] != null) out[key] = !!value[key];
            });
            Object.keys(ALIASES).forEach(function(alias) {
                if (value[alias] != null) out[ALIASES[alias]] = !!value[alias];
            });
            return out;
        }
        throw new Error("Unsupported control state: " + String(value));
    }

    function controlsEqual(a, b) {
        return CONTROL_KEYS.every(function(key) {
            return !!a[key] === !!b[key];
        });
    }

    function clampFps(value, fallback) {
        var fps = Number(value == null ? fallback : value);
        if (!isFinite(fps) || fps <= 0 || fps > 1000) throw new Error("Sample rate must be between 0 and 1000 Hz.");
        return fps;
    }

    function compactEvents(events) {
        var byFrame = new Map;
        events.forEach(function(event) {
            var at = Math.max(0, Math.round(Number(event.at)));
            if (!Number.isSafeInteger(at)) throw new Error("Every event time must be a finite millisecond value.");
            byFrame.set(at, normalizeControls(event.controls));
        });
        var sorted = Array.from(byFrame, function(pair) {
            return {
                at: pair[0],
                controls: pair[1]
            };
        }).sort(function(a, b) {
            return a.at - b.at;
        });
        if (!sorted.length || sorted[0].at !== 0) sorted.unshift({
            at: 0,
            controls: neutralControls()
        });
        return sorted.filter(function(event, index) {
            return index === 0 || !controlsEqual(event.controls, sorted[index - 1].controls);
        });
    }

    function parseDenseFrames(frames, fps) {
        if (!Array.isArray(frames) || !frames.length) throw new Error("The frames array is empty.");
        var sampleRate = clampFps(fps, 60);
        var events = frames.map(function(controls, index) {
            return {
                at: Math.round(index * 1000 / sampleRate),
                controls: controls
            };
        });
        return {
            fps: sampleRate,
            frames: Math.max(1, Math.round(frames.length * 1000 / sampleRate)),
            events: compactEvents(events)
        };
    }

    function eventTime(event, fps) {
        if (event.at != null) return Number(event.at);
        if (event.ms != null) return Number(event.ms);
        if (event.time != null) return Number(event.time);
        if (event.frame != null) return Number(event.frame) * 1000 / fps;
        throw new Error("Each event needs an at/ms/time value, or a frame number.");
    }

    function parseEventObject(data, fallbackFps) {
        var fps = clampFps(data.fps, fallbackFps || 60);
        if (!Array.isArray(data.events) || !data.events.length) throw new Error("The events array is empty.");
        var events = data.events.map(function(event) {
            if (event == null || typeof event !== "object") throw new Error("Every event must be an object.");
            return {
                at: eventTime(event, fps),
                controls: event.controls != null ? event.controls : event.inputs != null ? event.inputs : event
            };
        });
        var compact = compactEvents(events);
        var inferredEnd = compact[compact.length - 1].at + Math.max(1, Math.round(1000 / fps));
        var duration = data.durationMs != null ? Number(data.durationMs) : data.duration != null ? Number(data.duration) : inferredEnd;
        duration = Math.max(inferredEnd, Math.round(duration));
        if (!Number.isSafeInteger(duration)) throw new Error("durationMs must be a finite millisecond value.");
        return {
            fps: fps,
            frames: duration,
            events: compact
        };
    }

    function parseTextTimeline(text, fallbackFps) {
        var fps = clampFps(fallbackFps, 60);
        var duration = null;
        var events = [];
        String(text).split(/\r?\n/).forEach(function(rawLine, index) {
            var line = rawLine.replace(/#.*$/, "").trim();
            if (!line) return;
            var directive = line.match(/^(fps|duration(?:ms)?)\s*[:=]\s*([0-9.]+)$/i);
            if (directive) {
                if (directive[1].toLowerCase() === "fps") fps = clampFps(directive[2], fps); else duration = Number(directive[2]);
                return;
            }
            var match = line.match(/^(\d+(?:\.\d+)?)\s*(?:ms)?\s*[,;:\s]\s*(.*?)\s*$/i);
            if (!match) throw new Error("Could not parse line " + (index + 1) + ': "' + rawLine + '".');
            events.push({
                at: Number(match[1]),
                controls: match[2]
            });
        });
        if (!events.length) throw new Error("No input events were found.");
        return parseEventObject({
            fps: fps,
            durationMs: duration,
            events: events
        }, fps);
    }

    function parseInputSet(source, fallbackFps) {
        var text = typeof source === "string" ? source.trim() : source;
        if (text == null || text === "") throw new Error("Paste a set of inputs first.");
        var data = text;
        if (typeof text === "string" && /^[\[{]/.test(text)) {
            try {
                data = JSON.parse(text);
            } catch (error) {
                throw new Error("Invalid JSON: " + error.message);
            }
        }
        var result;
        if (typeof data === "string") {
            result = parseTextTimeline(data, fallbackFps);
        } else if (Array.isArray(data)) {
            if (data.length && data.every(function(item) {
                return item && typeof item === "object" && (item.at != null || item.ms != null || item.time != null || item.frame != null);
            })) result = parseEventObject({
                fps: fallbackFps,
                events: data
            }, fallbackFps); else result = parseDenseFrames(data, fallbackFps);
        } else if (data && typeof data === "object") {
            if (Array.isArray(data.events)) result = parseEventObject(data, fallbackFps); else if (Array.isArray(data.frames)) result = parseDenseFrames(data.frames, data.fps == null ? fallbackFps : data.fps); else throw new Error('JSON must contain a "frames" or "events" array.');
            if (data.durationMs != null || data.duration != null) {
                var requestedDuration = Math.round(Number(data.durationMs == null ? data.duration : data.durationMs));
                if (!Number.isSafeInteger(requestedDuration) || requestedDuration < result.frames) throw new Error("durationMs cannot end before the final input sample.");
                result.frames = requestedDuration;
            }
        } else {
            throw new Error("Unsupported input-set format.");
        }
        if (result.frames > 16777215) throw new Error("The input set is longer than PolyTrack's maximum recording length.");
        return result;
    }

    function readUint24(bytes, offset) {
        return bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16;
    }

    function eventsFromRecordingBytes(source, durationMs) {
        var bytes = source instanceof Uint8Array ? source : new Uint8Array(source || []);
        var toggles = new Map;
        var offset = 0;
        CONTROL_KEYS.forEach(function(key) {
            if (offset + 3 > bytes.length) throw new Error("The misoclip input recording is truncated.");
            var count = readUint24(bytes, offset);
            offset += 3;
            if (offset + count * 3 > bytes.length) throw new Error("The misoclip input recording is truncated.");
            var at = 0;
            for (var i = 0; i < count; i += 1) {
                var delta = readUint24(bytes, offset);
                offset += 3;
                at = i === 0 ? delta : at + delta;
                if (!toggles.has(at)) toggles.set(at, []);
                toggles.get(at).push(key);
            }
        });
        if (offset !== bytes.length) throw new Error("The misoclip input recording has unexpected trailing data.");
        var state = neutralControls();
        var events = [];
        var times = Array.from(toggles.keys()).sort(function(a, b) {
            return a - b;
        });
        if (!times.length || times[0] !== 0) events.push({
            at: 0,
            controls: Object.assign({}, state)
        });
        times.forEach(function(at) {
            toggles.get(at).forEach(function(key) {
                state[key] = !state[key];
            });
            events.push({
                at: at,
                controls: Object.assign({}, state)
            });
        });
        var duration = Math.max(0, Math.round(Number(durationMs)));
        return {
            frames: duration,
            events: events.filter(function(event) {
                return event.at <= duration;
            })
        };
    }

    function activeControlNames(controls) {
        return CONTROL_KEYS.filter(function(key) {
            return !!controls[key];
        });
    }

    function controlsAt(events, at) {
        var state = neutralControls();
        for (var i = 0; i < events.length && events[i].at <= at; i += 1) state = events[i].controls;
        return state;
    }

    function formatInputEvents(input, format, sampleRate) {
        var events = input.events || [];
        var duration = Math.max(0, Math.round(Number(input.frames) || 0));
        if (format === "compact") {
            var letters = {
                up: "w",
                right: "d",
                down: "s",
                left: "a",
                reset: "r"
            };
            return events.map(function(event) {
                var value = activeControlNames(event.controls).map(function(key) {
                    return letters[key];
                }).join("") || "-";
                return event.at + "," + value;
            }).join("\n");
        }
        if (format === "named") {
            return [ "duration=" + duration ].concat(events.map(function(event) {
                return event.at + " " + (activeControlNames(event.controls).join("+") || "none");
            })).join("\n");
        }
        if (format === "json-events") {
            return JSON.stringify({
                durationMs: duration,
                events: events.map(function(event) {
                    return {
                        at: event.at,
                        inputs: activeControlNames(event.controls)
                    };
                })
            }, null, 2);
        }
        if (format === "dense-json") {
            var fps = clampFps(sampleRate, 60);
            var count = Math.max(1, Math.ceil(duration * fps / 1000));
            var frames = [];
            for (var i = 0; i < count; i += 1) frames.push(activeControlNames(controlsAt(events, Math.round(i * 1000 / fps))));
            return JSON.stringify({
                fps: fps,
                frames: frames
            }, null, 2);
        }
        throw new Error("Unknown extraction format.");
    }

    return {
        CONTROL_KEYS: CONTROL_KEYS.slice(),
        neutralControls: neutralControls,
        normalizeControls: normalizeControls,
        controlsEqual: controlsEqual,
        compactEvents: compactEvents,
        parseInputSet: parseInputSet,
        eventsFromRecordingBytes: eventsFromRecordingBytes,
        formatInputEvents: formatInputEvents
    };
});

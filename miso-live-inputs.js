/*
 * Added by the MisoTweaks Live Inputs fork.
 * Replays misoclip control recordings through PolyTrack's real-time car.
 */
(function() {
    "use strict";

    var armed = null;
    var active = null;
    var picker = null;
    var converter = null;
    var extractor = null;
    var fakeFinish = false;
    var capturingTriggerKey = false;
    var triggerKey = localStorage.getItem("_misoLiveInputsTriggerKey") || "KeyB";
    var leaderboardPlacementCache = Object.create(null);
    var leaderboardUrl = "https://ptproxy.cwcinc.dev/v6/leaderboard?version=0.6.0&onlyVerified=false";
    var previousSoundControls = {
        up: false,
        left: false,
        right: false,
        down: false
    };

    function api() {
        return window.__misoClipApi;
    }

    function pako() {
        return window.__clipPako && (window.__clipPako.Ay || window.__clipPako);
    }

    function toUrlBase64(bytes) {
        return api().bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    }

    function fromUrlBase64(value) {
        var b64 = String(value).replace(/-/g, "+").replace(/_/g, "/");
        while (b64.length % 4) b64 += "=";
        return api().base64ToBytes(b64);
    }

    function inflateSerializedRecording(serialized) {
        var inflater = new (pako().Inflate);
        inflater.push(fromUrlBase64(serialized), true);
        if (inflater.err) throw new Error("Could not decompress the control recording.");
        return inflater.result;
    }

    function recordingFromClip(clip) {
        var Recording = window.__clipRecordingClass;
        if (!Recording || !pako()) throw new Error("PolyTrack's replay engine is not ready yet.");
        var deflater = new (pako().Deflate)({
            level: 9
        });
        deflater.push(api().recordingBytes(clip), true);
        if (deflater.err) throw new Error("Could not compress the clip recording.");
        var recording = Recording.deserialize(toUrlBase64(deflater.result));
        if (!recording) throw new Error("This misoclip has an invalid input recording.");
        try {
            recording.recordFrame(Math.round(clip.frames), window.MisoClipTools.neutralControls());
        } catch (error) {
            console.warn("[Miso Live Inputs] Could not append a neutral end frame:", error);
        }
        return recording;
    }

    function selectedAccount() {
        var nickname = typeof window.__getPlayerNickname === "function" ? window.__getPlayerNickname() : null;
        var carStyle = typeof window.__getPlayerCarStyle === "function" ? window.__getPlayerCarStyle() : null;
        if (nickname && carStyle) return {
            nickname: nickname,
            carStyle: carStyle
        };
        try {
            var slotValue = localStorage.getItem("polytrack_v5_prod_user_slot");
            var slot = slotValue == null ? 0 : JSON.parse(slotValue);
            if (!Number.isSafeInteger(slot) || slot < 0) slot = 0;
            var raw = localStorage.getItem("polytrack_v5_prod_user_" + slot);
            var profile = raw ? JSON.parse(raw) : null;
            if (profile) {
                nickname = nickname || (typeof profile.nickname === "string" ? profile.nickname : null);
                carStyle = carStyle || (typeof profile.carStyle === "string" ? profile.carStyle : null);
            }
        } catch (error) {}
        return {
            nickname: nickname || "Anonymous",
            carStyle: carStyle || ""
        };
    }

    function buildClipFromInputSet(name, source, fallbackFps, options) {
        options = options || {};
        var parsed = window.MisoClipTools.parseInputSet(source, fallbackFps);
        var Recording = window.__clipRecordingClass;
        if (!Recording || !pako()) throw new Error("PolyTrack's replay engine is not ready yet.");
        var recording = new Recording;
        parsed.events.forEach(function(event) {
            recording.recordFrame(event.at, event.controls);
        });
        recording.recordFrame(parsed.frames, window.MisoClipTools.neutralControls());
        var rawBytes = inflateSerializedRecording(recording.serialize());
        var now = Date.now();
        var track = typeof window.__getCurrentTrack === "function" ? window.__getCurrentTrack() : null;
        var trackId = track && typeof track.getId === "function" ? track.getId() : "";
        var mapLocked = false;
        var accountBound = !!options.useCurrentAccount;
        var account = selectedAccount();
        if (mapLocked && !trackId) throw new Error("Open the map you want to lock this misoclip to first.");
        var clipName = name || "Converted inputs " + new Date(now).toLocaleString();
        return {
            id: "clip_inputs_" + now,
            name: clipName,
            playerName: accountBound ? account.nickname : clipName,
            trackId: trackId,
            trackName: api().trackName(trackId),
            carStyle: accountBound ? account.carStyle : "",
            frames: parsed.frames,
            recordingBytes: api().bytesToBase64(rawBytes),
            createdAt: now,
            portableInputs: !mapLocked,
            mapLocked: mapLocked,
            accountBound: accountBound,
            sourceFps: parsed.fps
        };
    }

    function toast(message, tone) {
        var el = document.createElement("div");
        el.className = "miso-live-toast" + (tone ? " " + tone : "");
        el.textContent = message;
        document.body.appendChild(el);
        requestAnimationFrame(function() {
            requestAnimationFrame(function() {
                el.classList.add("show");
            });
        });
        setTimeout(function() {
            el.classList.remove("show");
            setTimeout(function() {
                el.remove();
            }, 250);
        }, 2400);
    }

    function restartIfDriving() {
        if (document.querySelector(".game-ui:not(.poly-replay-view)") && typeof window.__misoRestartCurrentRun === "function") {
            window.__misoRestartCurrentRun();
            return true;
        }
        return false;
    }

    function queueRestartIfDriving() {
        var canRestart = !!document.querySelector(".game-ui:not(.poly-replay-view)") && typeof window.__misoRestartCurrentRun === "function";
        if (canRestart) setTimeout(restartIfDriving, 0);
        return canRestart;
    }

    function keyLabel(code) {
        if (/^Key[A-Z]$/.test(code)) return code.slice(3);
        if (/^Digit\d$/.test(code)) return code.slice(5);
        return ({
            Space: "Space",
            Enter: "Enter",
            ShiftLeft: "Left Shift",
            ShiftRight: "Right Shift"
        })[code] || code;
    }

    function refreshKeyLabels() {
        document.querySelectorAll(".miso-trigger-key").forEach(function(el) {
            el.textContent = capturingTriggerKey ? "Press a key…" : "Start key: " + keyLabel(triggerKey);
        });
    }

    function setTriggerKey(code) {
        triggerKey = code;
        localStorage.setItem("_misoLiveInputsTriggerKey", triggerKey);
        capturingTriggerKey = false;
        refreshKeyLabels();
    }

    function currentTrackId() {
        var track = typeof window.__getCurrentTrack === "function" ? window.__getCurrentTrack() : null;
        return track && typeof track.getId === "function" ? track.getId() : "";
    }

    function fetchLeaderboardPage(trackId, skip, amount) {
        var url = leaderboardUrl + "&trackId=" + encodeURIComponent(trackId) + "&skip=" + skip + "&amount=" + amount;
        return fetch(url).then(function(response) {
            if (!response.ok) throw new Error("HTTP " + response.status);
            return response.json();
        });
    }

    function getPlacementForTime(frames, trackId) {
        trackId = trackId || currentTrackId();
        frames = Math.round(Number(frames));
        if (!trackId || !Number.isSafeInteger(frames) || frames < 0) return Promise.resolve(null);
        var cacheKey = trackId + ":" + frames;
        if (leaderboardPlacementCache[cacheKey]) return leaderboardPlacementCache[cacheKey];
        leaderboardPlacementCache[cacheKey] = fetchLeaderboardPage(trackId, 0, 1).then(function(firstPage) {
            var total = firstPage && Number.isSafeInteger(firstPage.total) ? firstPage.total : 0;
            if (total < 1) return {
                position: 1,
                total: 1,
                frames: frames,
                percentile: 1
            };
            var low = 0;
            var high = total;
            function search() {
                if (low >= high) {
                    var position = low + 1;
                    var rankedTotal = Math.max(total, position);
                    return Promise.resolve({
                        position: position,
                        total: rankedTotal,
                        frames: frames,
                        percentile: position / rankedTotal
                    });
                }
                var middle = Math.floor((low + high) / 2);
                return fetchLeaderboardPage(trackId, middle, 1).then(function(page) {
                    var entry = page && Array.isArray(page.entries) ? page.entries[0] : null;
                    if (!entry || typeof entry.frames !== "number") throw new Error("Leaderboard entry is missing.");
                    if (entry.frames < frames) low = middle + 1; else high = middle;
                    return search();
                });
            }
            return search();
        }).catch(function() {
            delete leaderboardPlacementCache[cacheKey];
            return null;
        });
        return leaderboardPlacementCache[cacheKey];
    }

    function ensureMapCompatible(clip) {
        if (!clip.mapLocked) return true;
        var loadedId = currentTrackId();
        if (!loadedId) throw new Error("Open this misoclip's locked map before arming it.");
        if (loadedId !== clip.trackId) throw new Error("This misoclip is locked to a different map.");
        return true;
    }

    function resetReplaySoundControls() {
        window.PolyMods?.resetSounds();
        previousSoundControls.up = false;
        previousSoundControls.left = false;
        previousSoundControls.right = false;
        previousSoundControls.down = false;
    }

    function playReplayControlSounds(controls, at) {
        if (typeof window.__misoPlayCustomSoundPool !== "function") return;
        [ "up", "left", "right", "down" ].forEach(function(key) {
            var pressed = !!controls[key];
            if (pressed !== previousSoundControls[key]) {
                if (window.PolyMods.shouldSound(key, pressed, at)) window.__misoPlayCustomSoundPool("replay_key_" + key + "_" + (pressed ? "press" : "release"));
                previousSoundControls[key] = pressed;
            }
        });
    }

    function startClip(clip) {
        ensureMapCompatible(clip);
        var recording = recordingFromClip(clip);
        var soundEvents = [];
        try {
            soundEvents = window.MisoClipTools.eventsFromRecordingBytes(api().recordingBytes(clip), clip.frames).events;
        } catch (error) {
            console.warn("[Miso Live Inputs] Could not prepare replay key sounds:", error);
        }
        armed = {
            clip: clip,
            recording: recording,
            soundEvents: soundEvents
        };
        active = null;
        resetReplaySoundControls();
        window.__replayInputActive = false;
        window.__replayControls = window.MisoClipTools.neutralControls();
        window.__misoLivePlaybackAttached = false;
    }

    function beginReplay() {
        if (!armed) return;
        try {
            ensureMapCompatible(armed.clip);
        } catch (error) {
            return;
        }
        active = {
            clip: armed.clip,
            recording: armed.recording,
            soundEvents: armed.soundEvents,
            soundEventIndex: 0,
            lastSoundFrame: -1,
            finished: false,
            finishShown: false,
            startedAt: Date.now()
        };
        removeFakeFinish();
        resetReplaySoundControls();
        window.__replayInputActive = true;
        window.__replayControls = window.MisoClipTools.neutralControls();
        queueRestartIfDriving();
    }

    function toggleReplay() {
        if (active) {
            stopReplay({
                disarm: false,
                toggle: true
            });
        } else {
            beginReplay();
        }
    }

    function stopReplay(options) {
        active = null;
        if (!options || options.disarm !== false) armed = null;
        removeFakeFinish();
        resetReplaySoundControls();
        window.__replayInputActive = false;
        window.__replayControls = window.MisoClipTools.neutralControls();
        window.__misoLivePlaybackAttached = false;
        if (!options || options.restart !== false) queueRestartIfDriving();
    }

    function selectedClipFrom(container) {
        var selected = container.querySelector(".clip-menu-entry.selected,[data-live-clip].selected");
        if (!selected) return null;
        var id = selected.dataset.clipId || selected.dataset.liveClip;
        return api().list().find(function(clip) {
            return clip.id === id;
        }) || null;
    }

    function duplicateClip(clip) {
        var copy = JSON.parse(JSON.stringify(clip));
        copy.id = "clip_copy_" + Date.now();
        copy.name = (clip.name || "Misoclip") + " (copy)";
        copy.createdAt = Date.now();
        if (!api().add(copy)) throw new Error("Browser storage is full.");
        toast('Copied "' + clip.name + '".', "ok");
        return copy;
    }

    function button(label, className, onClick) {
        var el = document.createElement("button");
        el.className = "button" + (className ? " " + className : "");
        el.textContent = label;
        el.addEventListener("click", onClick);
        return el;
    }

    function closePicker() {
        if (picker) picker.remove();
        picker = null;
    }

    function openPicker() {
        if(window.PolyMods)return window.PolyMods.openLibrary();
        if (picker) {
            closePicker();
            return;
        }
        var clips = api() ? api().list() : [];
        var overlay = document.createElement("div");
        overlay.className = "miso-live-overlay";
        var panel = document.createElement("section");
        panel.className = "miso-live-panel";
        var heading = document.createElement("header");
        heading.innerHTML = "<h2>Live Input Replay</h2><p>Arm any saved misoclip, then start it on demand in solo or multiplayer. Origin map is informational only.</p>";
        panel.appendChild(heading);
        var list = document.createElement("div");
        list.className = "miso-live-list";
        if (!clips.length) {
            var empty = document.createElement("p");
            empty.className = "empty";
            empty.textContent = "No misoclips saved yet. Press C during a run, import one in Clips, or convert an input set.";
            list.appendChild(empty);
        }
        clips.forEach(function(clip) {
            var row = document.createElement("button");
            row.type = "button";
            row.dataset.liveClip = clip.id;
            row.innerHTML = "<strong></strong><span></span>";
            row.querySelector("strong").textContent = clip.name || "Untitled clip";
            var trackLabel = clip.mapLocked ? "Locked to map " + clip.trackId.slice(0, 10) + "…" : clip.portableInputs ? "Portable input set" : clip.trackId ? "Source map " + clip.trackId.slice(0, 10) + "…" : "Any map";
            var accountLabel = clip.accountBound ? " · Account: " + (clip.playerName || "Anonymous") : "";
            row.querySelector("span").textContent = trackLabel + accountLabel + " · " + api().formatDuration(clip.frames);
            if ((active && active.clip.id === clip.id) || (armed && armed.clip.id === clip.id)) row.classList.add("selected");
            row.addEventListener("click", function() {
                list.querySelectorAll("button").forEach(function(other) {
                    other.classList.remove("selected");
                });
                row.classList.add("selected");
            });
            list.appendChild(row);
        });
        panel.appendChild(list);
        var actions = document.createElement("footer");
        actions.appendChild(button("Close", "secondary", closePicker));
        var keyButton = button("", "miso-trigger-key", function() {
            capturingTriggerKey = true;
            refreshKeyLabels();
        });
        keyButton.textContent = "Start key: " + keyLabel(triggerKey);
        actions.appendChild(keyButton);
        actions.appendChild(button("Convert inputs", "", function() {
            openConverter();
        }));
        actions.appendChild(button("Extract inputs", "", function() {
            var clip = selectedClipFrom(panel);
            if (!clip) return toast("Select one misoclip first.", "warn");
            try {
                openExtractor(clip);
            } catch (error) {
                toast(error.message, "warn");
            }
        }));
        actions.appendChild(button("Duplicate", "", function() {
            var clip = selectedClipFrom(panel);
            if (!clip) return toast("Select one misoclip first.", "warn");
            try {
                duplicateClip(clip);
                closePicker();
                openPicker();
            } catch (error) {
                toast(error.message, "warn");
            }
        }));
        actions.appendChild(button("Stop replay", "danger", function() {
            stopReplay();
            closePicker();
        }));
        actions.appendChild(button("Arm replay", "primary", function() {
            var clip = selectedClipFrom(panel);
            if (!clip) return toast("Select one misoclip first.", "warn");
            try {
                startClip(clip);
                closePicker();
            } catch (error) {
                toast(error.message, "warn");
            }
        }));
        panel.appendChild(actions);
        overlay.appendChild(panel);
        overlay.addEventListener("mousedown", function(event) {
            if (event.target === overlay) closePicker();
        });
        document.body.appendChild(overlay);
        picker = overlay;
    }

    function closeConverter() {
        if (converter) converter.remove();
        converter = null;
    }

    function openConverter() {
        if (converter) return;
        var overlay = document.createElement("div");
        overlay.className = "miso-live-overlay converter";
        var panel = document.createElement("section");
        panel.className = "miso-live-panel miso-converter";
        panel.innerHTML = '<header><h2>Inputs → misoclip</h2><p>Use compact time,WASD lines, named controls, dense JSON samples, or JSON events.</p></header>' + '<label>Name<input class="miso-converter-name" value="Converted input set"></label>' + '<label>Default sample rate (Hz)<input class="miso-converter-fps" type="number" min="1" max="1000" step="1" value="60"></label>' + '<div class="miso-converter-options"><label><input class="miso-converter-account" type="checkbox"><span>Use the selected account’s name and car style</span></label></div>' + '<label>Input set<textarea class="miso-converter-source" spellcheck="false" placeholder=\'Compact timeline:&#10;0,w&#10;731,wd&#10;747,w&#10;1570,wa&#10;&#10;Named controls:&#10;0 up&#10;250 up+left&#10;1000 none&#10;&#10;Dense JSON:&#10;{"fps":60,"frames":[["up"],["up","left"],[]]}\'></textarea></label>' + '<p class="miso-converter-error" aria-live="polite"></p>' + '<label class="miso-converter-result-label hidden">misoclip code<textarea class="miso-converter-result" readonly></textarea></label>';
        var actions = document.createElement("footer");
        actions.appendChild(button("Close", "secondary", closeConverter));
        var copyButton = button("Copy code", "hidden", function() {
            var result = panel.querySelector(".miso-converter-result").value;
            navigator.clipboard.writeText(result).then(function() {
                toast("misoclip code copied.", "ok");
            }).catch(function() {
                panel.querySelector(".miso-converter-result").select();
                toast("Select and copy the code manually.", "warn");
            });
        });
        actions.appendChild(copyButton);
        actions.appendChild(button("Create misoclip", "primary", function() {
            var errorEl = panel.querySelector(".miso-converter-error");
            errorEl.textContent = "";
            try {
                var clip = buildClipFromInputSet(panel.querySelector(".miso-converter-name").value.trim(), panel.querySelector(".miso-converter-source").value, Number(panel.querySelector(".miso-converter-fps").value), {
                    useCurrentAccount: panel.querySelector(".miso-converter-account").checked,
                    mapLocked: false
                });
                if (!api().add(clip)) throw new Error("Browser storage is full.");
                var code = api().encode(clip);
                panel.querySelector(".miso-converter-result").value = code;
                panel.querySelector(".miso-converter-result-label").classList.remove("hidden");
                copyButton.classList.remove("hidden");
                toast('Created "' + clip.name + '" and saved it to Clips.', "ok");
            } catch (error) {
                errorEl.textContent = error.message;
            }
        }));
        panel.appendChild(actions);
        overlay.appendChild(panel);
        overlay.addEventListener("mousedown", function(event) {
            if (event.target === overlay) closeConverter();
        });
        document.body.appendChild(overlay);
        converter = overlay;
    }

    function closeExtractor() {
        if (extractor) extractor.remove();
        extractor = null;
    }

    function openExtractor(clip) {
        closeExtractor();
        var extracted = window.MisoClipTools.eventsFromRecordingBytes(api().recordingBytes(clip), clip.frames);
        var overlay = document.createElement("div");
        overlay.className = "miso-live-overlay extractor";
        var panel = document.createElement("section");
        panel.className = "miso-live-panel miso-extractor";
        var header = document.createElement("header");
        var title = document.createElement("h2");
        title.textContent = "Extract misoclip inputs";
        var description = document.createElement("p");
        description.textContent = (clip.name || "Untitled clip") + " · " + api().formatDuration(clip.frames) + " · " + extracted.events.length + " input changes";
        header.appendChild(title);
        header.appendChild(description);
        panel.appendChild(header);
        var controls = document.createElement("div");
        controls.className = "miso-extractor-controls";
        controls.innerHTML = '<label>Output format<select class="miso-extractor-format"><option value="compact">Compact time,WASD</option><option value="named">Named-control timeline</option><option value="json-events">JSON events</option><option value="dense-json">Dense JSON samples</option></select></label><label class="miso-extractor-fps hidden">Dense sample rate (Hz)<input type="number" min="1" max="1000" step="1" value="60"></label>';
        panel.appendChild(controls);
        var outputLabel = document.createElement("label");
        outputLabel.className = "miso-extractor-output-label";
        outputLabel.append("Extracted inputs");
        var output = document.createElement("textarea");
        output.className = "miso-extractor-output";
        output.readOnly = true;
        output.spellcheck = false;
        outputLabel.appendChild(output);
        panel.appendChild(outputLabel);
        var error = document.createElement("p");
        error.className = "miso-converter-error";
        panel.appendChild(error);
        var format = controls.querySelector(".miso-extractor-format");
        var fpsLabel = controls.querySelector(".miso-extractor-fps");
        var fpsInput = fpsLabel.querySelector("input");
        function render() {
            error.textContent = "";
            fpsLabel.classList.toggle("hidden", format.value !== "dense-json");
            try {
                output.value = window.MisoClipTools.formatInputEvents(extracted, format.value, Number(fpsInput.value));
            } catch (renderError) {
                output.value = "";
                error.textContent = renderError.message;
            }
        }
        format.addEventListener("change", render);
        fpsInput.addEventListener("change", render);
        render();
        var actions = document.createElement("footer");
        actions.appendChild(button("Close", "secondary", closeExtractor));
        actions.appendChild(button("Copy inputs", "primary", function() {
            navigator.clipboard.writeText(output.value).then(function() {
                toast("Extracted inputs copied.", "ok");
            }).catch(function() {
                output.focus();
                output.select();
            });
        }));
        panel.appendChild(actions);
        overlay.appendChild(panel);
        overlay.addEventListener("mousedown", function(event) {
            if (event.target === overlay) closeExtractor();
        });
        document.body.appendChild(overlay);
        extractor = overlay;
    }

    function installLibraryButtons(wrapper) {
        if (wrapper.closest('.poly-library')) return;
        if (wrapper.dataset.liveInputsInstalled) return;
        wrapper.dataset.liveInputsInstalled = "true";
        var menu = wrapper.closest(".clip-menu-bg") || wrapper.parentElement;
        wrapper.appendChild(button("Arm Inputs", "", function() {
            var clip = selectedClipFrom(menu);
            if (!clip) return toast("Select one misoclip first.", "warn");
            try {
                startClip(clip);
                var back = menu.querySelector(".button.back");
                if (back) back.click();
            } catch (error) {
                toast(error.message, "warn");
            }
        }));
        wrapper.appendChild(button("Duplicate", "", function() {
            var clip = selectedClipFrom(menu);
            if (!clip) return toast("Select one misoclip first.", "warn");
            try {
                duplicateClip(clip);
                var back = menu.querySelector(".button.back");
                if (back) back.click();
            } catch (error) {
                toast(error.message, "warn");
            }
        }));
        wrapper.appendChild(button("Extract Inputs", "", function() {
            var clip = selectedClipFrom(menu);
            if (!clip) return toast("Select one misoclip first.", "warn");
            try {
                openExtractor(clip);
            } catch (error) {
                toast(error.message, "warn");
            }
        }));
        wrapper.appendChild(button("Convert Inputs", "", openConverter));
    }

    function removeFakeFinish() {
        if (fakeFinish && typeof window.__misoClearLocalReplayFinish === "function") window.__misoClearLocalReplayFinish();
        fakeFinish = false;
    }

    function showFakeFinish(frames) {
        return; // The normal finish/submission flow owns the announcer.
        if (!active || active.finishShown) return;
        if (typeof window.__misoShowLocalReplayFinish !== "function") return;
        active.finished = true;
        active.finishShown = true;
        removeFakeFinish();
        window.__misoShowLocalReplayFinish(frames);
        fakeFinish = true;
    }

    function updateRuntime() {
        if (!active || !document.querySelector(".game-ui:not(.poly-replay-view)")) return;
        var player = typeof window.__getPlayerState === "function" ? window.__getPlayerState() : null;
        var state = player && player.getRawControls ? player.getRawControls() : window.MisoClipTools.neutralControls();
        window.__replayControls = state;
        if (window.__misoLivePlaybackAttached && player && player.getTime) {
            var soundFrame = player.getTime().numberOfFrames;
            if (soundFrame < active.lastSoundFrame) {
                active.soundEventIndex = 0;
                resetReplaySoundControls();
            }
            if (active.soundEvents && active.soundEvents.length) {
                while (active.soundEventIndex < active.soundEvents.length && active.soundEvents[active.soundEventIndex].at <= soundFrame) {
                    playReplayControlSounds(active.soundEvents[active.soundEventIndex].controls, active.soundEvents[active.soundEventIndex].at);
                    active.soundEventIndex++;
                }
            }
            // The exact event stream preserves taps between animation frames. The raw
            // replay state is also checked so format changes cannot make key audio mute.
            playReplayControlSounds(state, soundFrame);
            active.lastSoundFrame = soundFrame;
        }
        if (window.__misoLivePlaybackAttached && player && player.hasFinished && player.hasFinished()) {
            var finishTime = player.getFinishTime ? player.getFinishTime() : null;
            showFakeFinish(finishTime ? finishTime.numberOfFrames : player.getTime().numberOfFrames);
        }
    }

    function initializeUi() {
        new MutationObserver(function() {
            document.querySelectorAll(".clip-menu-wrapper").forEach(installLibraryButtons);
        }).observe(document.getElementById("ui") || document.body, {
            childList: true,
            subtree: true
        });
        function update() {
            updateRuntime();
            requestAnimationFrame(update);
        }
        requestAnimationFrame(update);
    }

    window.__misoLiveInputs = {
        isActive: function() {
            return !!active;
        },
        getRecording: function() {
            if (active) {
                active.finished = false;
                active.finishShown = false;
                active.soundEventIndex = 0;
                active.lastSoundFrame = -1;
                resetReplaySoundControls();
            }
            return active ? active.recording : null;
        },
        startClip: startClip,
        begin: beginReplay,
        toggle: toggleReplay,
        stop: stopReplay,
        open: openPicker,
        close: function(){closePicker();closeConverter();closeExtractor();},
        openConverter: openConverter,
        openExtractor: openExtractor,
        recordingFromClip: recordingFromClip,
        setTriggerKey: setTriggerKey,
        buildClipFromInputSet: buildClipFromInputSet,
        getSelectedAccount: selectedAccount,
        getPlacementForTime: getPlacementForTime,
        onFinish: function(frames) {
            if (!active) return;
            showFakeFinish(frames);
        }
    };

    window.addEventListener("keydown", function(event) {
        if (capturingTriggerKey) {
            event.preventDefault();
            event.stopPropagation();
            if (event.code === "Escape") {
                capturingTriggerKey = false;
                refreshKeyLabels();
            } else if (!event.ctrlKey && !event.metaKey && !event.altKey) {
                setTriggerKey(event.code);
            }
            return;
        }
        var focused = document.activeElement;
        if (focused && (focused.tagName === "INPUT" || focused.tagName === "TEXTAREA" || focused.isContentEditable)) return;
        if (event.code === window.PolyMods.binding("picker") && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            openPicker();
        } else if (event.code === triggerKey && !event.ctrlKey && !event.metaKey && !event.altKey && !event.repeat) {
            event.preventDefault();
            toggleReplay();
        } else if (event.code === "Escape") {
            if (extractor) closeExtractor(); else if (converter) closeConverter(); else if (picker) closePicker();
        }
    });

    function boot() {
        if (!api() || !window.MisoClipTools) return setTimeout(boot, 50);
        initializeUi();
    }
    boot();
})();

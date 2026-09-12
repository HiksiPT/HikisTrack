(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };

  // work/polytrack-unified/electron/bruteforce/tas-text.js
  var require_tas_text = __commonJS({
    "work/polytrack-unified/electron/bruteforce/tas-text.js"(exports, module) {
      "use strict";
      var KEY_ORDER = ["w", "a", "s", "d", "r"];
      var NORMALIZE_CACHE = /* @__PURE__ */ new Map();
      var NORMALIZE_CACHE_LIMIT = 4096;
      function normalizeKeys(str) {
        const key = typeof str === "string" ? str : String(str || "");
        const hit = NORMALIZE_CACHE.get(key);
        if (hit !== void 0) return hit;
        const set = /* @__PURE__ */ new Set();
        for (const ch of key.toLowerCase()) if (KEY_ORDER.indexOf(ch) >= 0) set.add(ch);
        const out = KEY_ORDER.filter((k) => set.has(k)).join("");
        if (NORMALIZE_CACHE.size < NORMALIZE_CACHE_LIMIT) NORMALIZE_CACHE.set(key, out);
        return out;
      }
      var BIT_UP = 1;
      var BIT_RIGHT = 2;
      var BIT_DOWN = 4;
      var BIT_LEFT = 8;
      var BIT_RESET = 16;
      var MASK_CACHE = /* @__PURE__ */ new Map();
      function maskForKeys(keys) {
        const hit = MASK_CACHE.get(keys);
        if (hit !== void 0) return hit;
        let mask = 0;
        if (keys.includes("w")) mask |= BIT_UP;
        if (keys.includes("d")) mask |= BIT_RIGHT;
        if (keys.includes("s")) mask |= BIT_DOWN;
        if (keys.includes("a")) mask |= BIT_LEFT;
        if (keys.includes("r")) mask |= BIT_RESET;
        if (MASK_CACHE.size < NORMALIZE_CACHE_LIMIT) MASK_CACHE.set(keys, mask);
        return mask;
      }
      function parseEntries(text) {
        return String(text || "").split("\n").map((line) => {
          const i = line.indexOf("#");
          return i >= 0 ? line.slice(0, i) : line;
        }).filter((line) => line.trim() !== "").map((line) => {
          const parts = line.split(",");
          return { frame: parseInt(parts[0], 10), keys: normalizeKeys(parts.slice(1).join(",").trim()) };
        }).filter((e) => Number.isFinite(e.frame)).sort((a, b) => a.frame - b.frame);
      }
      function entriesToText(entries) {
        return entries.slice().sort((a, b) => a.frame - b.frame).map((e) => e.frame + "," + normalizeKeys(e.keys)).join("\n");
      }
      function compactEntries(entries) {
        const byFrame = /* @__PURE__ */ new Map();
        for (const e of entries || []) if (Number.isFinite(e.frame)) byFrame.set(e.frame, normalizeKeys(e.keys));
        const sorted = Array.from(byFrame.entries()).map(([frame, keys]) => ({ frame, keys })).sort((a, b) => a.frame - b.frame);
        const out = [];
        let previous = "";
        for (const e of sorted) {
          if (e.keys === previous) continue;
          out.push(e);
          previous = e.keys;
        }
        return out;
      }
      function isCompactEntries(entries) {
        const list = entries || [];
        let previousFrame = -Infinity;
        let previousKeys = "";
        for (let i = 0; i < list.length; i++) {
          const e = list[i];
          if (!e || !Number.isFinite(e.frame) || e.frame <= previousFrame) return false;
          if (typeof e.keys !== "string" || e.keys !== normalizeKeys(e.keys)) return false;
          if (e.keys === previousKeys) return false;
          previousFrame = e.frame;
          previousKeys = e.keys;
        }
        return true;
      }
      function countInputEvents(entries) {
        if (isCompactEntries(entries)) return entries.length;
        return compactEntries(entries).length;
      }
      function stateAt(entries, frame) {
        let state = "";
        for (const e of entries) {
          if (e.frame <= frame) state = e.keys;
          else break;
        }
        return state;
      }
      var ControlPlan = class {
        /**
         * `fromFrame` bounds the work: in checkpointed mode nothing ever asks for a frame
         * before the search start, so filling the prefix is pure cost. The table is one
         * byte of control bits per frame instead of five parallel arrays, which lets the
         * fill run as a handful of bulk fills - one per input event - rather than a write
         * per frame, and lets two plans be compared with a single typed-array scan.
         */
        constructor(entries, frameCount, fromFrame) {
          this.frameCount = frameCount;
          this.bits = new Uint8Array(frameCount);
          this.filledFrom = frameCount;
          this.lastChange = 0;
          this._controls = { up: false, right: false, down: false, left: false, reset: false };
          if (entries) this.fill(entries, fromFrame || 0);
        }
        /** Rewrites [fromFrame, frameCount). Frames below it keep whatever was there. */
        fill(entries, fromFrame) {
          const compact = isCompactEntries(entries) ? entries : compactEntries(entries);
          const n = this.frameCount;
          const from = Math.max(0, Math.min(n, fromFrame | 0));
          this.filledFrom = from;
          this.lastChange = from;
          const bits = this.bits;
          let index = 0;
          let keys = "";
          while (index < compact.length && compact[index].frame <= from) keys = compact[index++].keys;
          let frame = from;
          let mask = maskForKeys(keys);
          while (frame < n) {
            const next = index < compact.length ? Math.min(n, Math.max(frame, compact[index].frame)) : n;
            if (next > frame) bits.fill(mask, frame, next);
            frame = next;
            if (frame >= n) break;
            while (index < compact.length && compact[index].frame <= frame) keys = compact[index++].keys;
            const nextMask = maskForKeys(keys);
            if (nextMask !== mask) this.lastChange = frame;
            mask = nextMask;
          }
          return this;
        }
        /** The raw control bits for one frame; 0 past the end of the plan. */
        bitsAt(frame) {
          return frame < this.frameCount ? this.bits[frame] : 0;
        }
        /**
         * The first frame at or after `from` where this plan and `other` differ, or -1.
         * Both plans must have been filled from at or below `from`.
         */
        firstDifference(other, from, to) {
          const a = this.bits, b = other.bits;
          const end = Math.min(to, this.frameCount, other.frameCount);
          for (let f = Math.max(0, from); f < end; f++) if (a[f] !== b[f]) return f;
          if (this.frameCount !== other.frameCount) {
            const longer = this.frameCount > other.frameCount ? this : other;
            for (let f = end; f < Math.min(to, longer.frameCount); f++) if (longer.bits[f] !== 0) return f;
          }
          return -1;
        }
        at(frame) {
          const c = this._controls;
          const b = frame < this.frameCount ? this.bits[frame] : 0;
          c.up = (b & BIT_UP) !== 0;
          c.right = (b & BIT_RIGHT) !== 0;
          c.down = (b & BIT_DOWN) !== 0;
          c.left = (b & BIT_LEFT) !== 0;
          c.reset = (b & BIT_RESET) !== 0;
          return c;
        }
      };
      module.exports = {
        KEY_ORDER,
        normalizeKeys,
        parseEntries,
        entriesToText,
        compactEntries,
        countInputEvents,
        isCompactEntries,
        stateAt,
        ControlPlan,
        maskForKeys,
        BIT_UP,
        BIT_RIGHT,
        BIT_DOWN,
        BIT_LEFT,
        BIT_RESET
      };
    }
  });

  // work/polytrack-unified/electron/bruteforce/search.js
  var require_search = __commonJS({
    "work/polytrack-unified/electron/bruteforce/search.js"(exports, module) {
      "use strict";
      var { normalizeKeys, entriesToText, compactEntries, countInputEvents, stateAt } = require_tas_text();
      function makeRng(seed) {
        let a = seed >>> 0 || 1;
        return function() {
          a |= 0;
          a = a + 1831565813 | 0;
          let t = Math.imul(a ^ a >>> 15, 1 | a);
          t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
          return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
      }
      function randomInt(rng, min, max) {
        min = Math.ceil(min);
        max = Math.floor(max);
        if (max <= min) return min;
        return min + Math.floor(rng() * (max - min + 1));
      }
      function rollSpec(rng, spec) {
        if (!spec || spec.max <= spec.min) return spec ? spec.min : 0;
        return randomInt(rng, spec.min, spec.max);
      }
      function cloneEntries(entries) {
        return entries.map((e) => ({ frame: e.frame, keys: e.keys }));
      }
      function insertBlock(entries, settings, rng, focus) {
        const step = Math.max(1, rollSpec(rng, settings.step));
        const hold = Math.max(1, rollSpec(rng, settings.hold));
        const span = settings.finish - settings.start;
        if (span < 0) return null;
        const slots = Math.max(0, Math.floor(span / step));
        const slot = focus ? focus.pickGrid(rng, settings.start, step, slots) : randomInt(rng, 0, slots);
        const frame = settings.start + slot * step;
        if (frame > settings.finish) return null;
        const keysets = settings.keysets;
        if (!keysets.length) return null;
        const keys = normalizeKeys(keysets[randomInt(rng, 0, keysets.length - 1)]);
        const end = frame + hold;
        const revert = stateAt(entries, end);
        const map = /* @__PURE__ */ new Map();
        for (const e of entries) if (!(e.frame > frame && e.frame < end)) map.set(e.frame, e.keys);
        map.set(frame, keys);
        map.set(end, revert);
        return {
          entries: Array.from(map.entries()).map(([f, k]) => ({ frame: f, keys: k })).sort((a, b) => a.frame - b.frame),
          note: "+" + (keys || "none") + "@" + frame + " hold " + hold,
          frame
        };
      }
      function shiftTiming(entries, settings, rng, focus) {
        if (settings.maxTimeDifference < 1) return null;
        const eligible = [];
        for (let i = 0; i < entries.length; i++) {
          const item = entries[i];
          if (item.frame < settings.start || item.frame > settings.finish) continue;
          const previousFrame = i > 0 ? entries[i - 1].frame : -1;
          const nextFrame = i + 1 < entries.length ? entries[i + 1].frame : Number.MAX_SAFE_INTEGER;
          const low = Math.max(settings.start, previousFrame + 1, item.frame - settings.maxTimeDifference);
          const high = Math.min(settings.finish, nextFrame - 1, item.frame + settings.maxTimeDifference);
          if (low < item.frame || high > item.frame) eligible.push({ index: i, low, high, frame: item.frame });
        }
        if (!eligible.length) return null;
        const picked = eligible[focus ? focus.pickList(rng, eligible) : randomInt(rng, 0, eligible.length - 1)];
        const source = entries[picked.index];
        const choices = [];
        for (let f = picked.low; f <= picked.high; f++) if (f !== source.frame) choices.push(f);
        if (!choices.length) return null;
        const target = choices[randomInt(rng, 0, choices.length - 1)];
        const out = cloneEntries(entries);
        out[picked.index] = { frame: target, keys: source.keys };
        out.sort((a, b) => a.frame - b.frame);
        return { entries: out, note: "move " + source.frame + "->" + target, frame: source.frame };
      }
      function removeEvent(entries, settings, rng, focus) {
        const eligible = [];
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i];
          if (e.frame < settings.start || e.frame > settings.finish) continue;
          eligible.push(i);
        }
        if (!eligible.length) return null;
        const index = eligible[focus ? focus.pickIndexed(rng, eligible, entries) : randomInt(rng, 0, eligible.length - 1)];
        const removed = entries[index];
        const out = cloneEntries(entries);
        out.splice(index, 1);
        return { entries: out, note: "drop @" + removed.frame, frame: removed.frame };
      }
      function applyMutations(entries, settings, rng, changes, focus) {
        let current = cloneEntries(entries);
        const notes = [];
        const edits = focus ? [] : null;
        for (let i = 0; i < changes; i++) {
          let applied = null;
          const mode = settings.mutationMode;
          let kinds;
          if (mode === "inputs_only") kinds = ["insert"];
          else if (mode === "timing_only") kinds = ["shift"];
          else if (mode === "lis") kinds = rng() < 0.6 ? ["remove", "shift"] : ["shift", "remove"];
          else kinds = rng() < 0.5 ? ["insert", "shift"] : ["shift", "insert"];
          for (const kind of kinds) {
            if (kind === "insert") applied = insertBlock(current, settings, rng, focus);
            else if (kind === "shift") applied = shiftTiming(current, settings, rng, focus);
            else if (kind === "remove") applied = removeEvent(current, settings, rng, focus);
            if (applied) break;
          }
          if (!applied) continue;
          current = applied.entries;
          notes.push(applied.note);
          if (edits) edits.push(applied.frame);
        }
        return { entries: current, notes, edits };
      }
      function mutate(baseEntries, settings, rng, focus) {
        const changes = randomInt(rng, 1, Math.max(1, settings.maxChangedInputs));
        const applied = applyMutations(baseEntries, settings, rng, changes, focus);
        if (!applied.notes.length) return null;
        const compact = compactEntries(applied.entries);
        return {
          entries: compact,
          text: entriesToText(compact),
          inputCount: countInputEvents(compact),
          label: applied.notes.join(" | "),
          edits: applied.edits
        };
      }
      function selectionScore(result, inputCount, settings) {
        if (settings.mutationMode !== "lis") return result.score;
        const w = Math.max(0, Math.min(1, settings.lisWeight != null ? settings.lisWeight : 0.5));
        return (1 - w) * result.score - w * inputCount;
      }
      module.exports = { makeRng, randomInt, rollSpec, mutate, applyMutations, selectionScore };
    }
  });

  // work/polytrack-unified/electron/bruteforce/genetic.js
  var require_genetic = __commonJS({
    "work/polytrack-unified/electron/bruteforce/genetic.js"(exports, module) {
      "use strict";
      var { entriesToText, compactEntries, countInputEvents, parseEntries } = require_tas_text();
      var { randomInt, applyMutations } = require_search();
      var TOURNAMENT = 3;
      var SUCCESS_TARGET = 0.2;
      var MIN_SCALE = 0.5;
      var MAX_SCALE = 3;
      var CEILING_PATIENCE = 3;
      var STALL_GENERATIONS = 24;
      var CREDIT_DECAY = 0.98;
      var MIN_CROSSOVER = 0.05;
      var MAX_CROSSOVER = 0.8;
      var SMART_MIN_POP = 8;
      var SMART_MAX_POP = 64;
      var SMART_START_POP = 16;
      var PENDING_LIMIT = 2e4;
      var BREED_MISS_LIMIT = 16;
      var FOCUS_BUCKETS = 32;
      var LOGIT_LIMIT = 4;
      var EPS_MAX = 0.35;
      var EPS_MIN = 0.04;
      var EPS_TAU = 900;
      var KERNEL_WIDE = 4;
      var KERNEL_TAU = 1200;
      var FORGET_HALFLIFE = 2400;
      var NOISE_FLOOR = 0.35;
      var LR_MIN = 2e-3;
      var LR_MAX = 0.5;
      var TRUST_T = 2;
      var TRUST_MIN = 60;
      var TRUST_FLOOR = 0.25;
      var FAILED = -0.4;
      var INERT = -1.2;
      var BEST_BONUS = 1;
      function clampLogit(v) {
        return v > LOGIT_LIMIT ? LOGIT_LIMIT : v < -LOGIT_LIMIT ? -LOGIT_LIMIT : v;
      }
      function cloneEntries(entries) {
        return entries.map((e) => ({ frame: e.frame, keys: e.keys }));
      }
      function differingRange(a, b, limit) {
        let i = 0, j = 0, lo = Infinity, hi = -Infinity;
        while (i < a.length || j < b.length) {
          const fa = i < a.length ? a[i].frame : Infinity;
          const fb = j < b.length ? b[j].frame : Infinity;
          let frame;
          if (fa === fb) {
            const same = a[i].keys === b[j].keys;
            frame = fa;
            i++;
            j++;
            if (same) continue;
          } else if (fa < fb) {
            frame = fa;
            i++;
          } else {
            frame = fb;
            j++;
          }
          if (frame < lo) lo = frame;
          if (frame > hi && frame < limit) hi = frame;
        }
        return { lo, hi };
      }
      function crossover(a, b, settings, rng, limit) {
        const span = differingRange(a, b, limit);
        if (!Number.isFinite(span.lo) || span.hi < 0) return null;
        const lo = Math.max(settings.start, span.lo + 1);
        const hi = Math.min(Math.max(settings.start, settings.finish), span.hi);
        if (hi < lo) return null;
        const split = randomInt(rng, lo, hi);
        const merged = [];
        for (const e of a) if (e.frame < split) merged.push({ frame: e.frame, keys: e.keys });
        for (const e of b) if (e.frame >= split) merged.push({ frame: e.frame, keys: e.keys });
        return merged;
      }
      var Population = class {
        constructor(settings, rng) {
          this.settings = settings;
          this.rng = rng;
          this.smart = settings.smartPopulation === true;
          this.focus = settings.focusPopulation === true;
          this.focusLearn = settings.focusLearn !== false;
          this.size = this.smart ? SMART_START_POP : Math.max(4, Math.min(256, settings.populationSize || 24));
          this.crossoverRate = settings.crossoverRate != null ? settings.crossoverRate : 0.6;
          this.canCross = settings.mutationMode === "inputs_timing" || settings.mutationMode === "inputs_only";
          this.members = [];
          this.seen = /* @__PURE__ */ new Set();
          this.pending = /* @__PURE__ */ new Map();
          this.generation = 0;
          this.scale = 1;
          this.atCeiling = 0;
          this.excursions = 0;
          this.recentTried = 0;
          this.recentImproved = 0;
          this.staleCandidates = 0;
          this.stallGenerations = settings.stallGenerations != null ? settings.stallGenerations : STALL_GENERATIONS;
          this.diversifies = 0;
          this.absorbedTotal = 0;
          this.bestScore = -Infinity;
          this.admitted = 0;
          this.bred = 0;
          this.creditCrossTried = 0;
          this.creditCrossWon = 0;
          this.creditMutTried = 0;
          this.creditMutWon = 0;
          this.resized = 0;
          this.pendingDropped = 0;
          this.absorbed = 0;
          this.fStart = settings.start;
          this.fFinish = Math.max(settings.start, settings.finish);
          const fSpan = this.fFinish - this.fStart;
          this.fBuckets = Math.max(1, Math.min(FOCUS_BUCKETS, fSpan + 1));
          this.fBucketWidth = (fSpan + 1) / this.fBuckets;
          this._editLimit = this.fFinish + 1;
          this._liveBucketCount = this.fBuckets;
          this.fLogits = null;
          this.fSoft = null;
          this.fProbs = null;
          this.fCumulative = null;
          this.fEps = EPS_MAX;
          this._focusUniform = false;
          this.polN = 0;
          this.polSum = 0;
          this.polSq = 0;
          this.ctrlN = 0;
          this.ctrlSum = 0;
          this.ctrlSq = 0;
          this.fTrust = 1;
          this.fDirty = true;
          this.fSamples = 0;
          this.fUpdates = 0;
          this.fInert = 0;
          this.fGains = 0;
          this.rewardMean = 0;
          this.gainScale = 0;
          this.advantageScale = 0.5;
          this.forget = Math.pow(0.5, 1 / FORGET_HALFLIFE);
          this.pullback = Math.sqrt(1 - this.forget * this.forget);
          this.barHigh = -Infinity;
          if (this.focus) {
            this.fLogits = new Float64Array(this.fBuckets);
            this.fSoft = new Float64Array(this.fBuckets).fill(1 / this.fBuckets);
            this.fProbs = new Float64Array(this.fBuckets).fill(1 / this.fBuckets);
            this.fCumulative = new Float64Array(this.fBuckets);
          }
          this._focusHooks = this.focus ? {
            pickGrid: (rng2, base, stride, slots) => this._pickGrid(rng2, base, stride, slots),
            pickList: (rng2, eligible) => this._pickEvent(rng2, eligible, null),
            pickIndexed: (rng2, eligible, entries) => this._pickEvent(rng2, eligible, entries)
          } : null;
        }
        get best() {
          return this.members.length ? this.members[0] : null;
        }
        /**
         * The selection score a child has to beat to be kept.
         *
         * `absorb` sorts members and new results together and keeps the strongest
         * `size` distinct sequences, so a child scoring at or below the weakest kept
         * member is dropped whatever its exact score turns out to be. That makes this
         * a sound bound to hand the workers: a candidate cut short reports a censored
         * score, but a censored score is only ever lower than the true one, and the
         * true one was already under the bar. The population that comes out is the
         * same population; it just costs less to get there.
         *
         * -Infinity while there are fewer members than places, because then every
         * child is admissible and nothing can be cut. That is also what a smart-mode
         * growth step produces for a wave or two, which is correct rather than
         * merely safe: after a grow there really are places going spare.
         */
        get bar() {
          if (this.members.length < this.size) return -Infinity;
          return this.members[this.size - 1].selectionScore;
        }
        /** Seeds the population from the evaluated baseline. */
        seed(entry) {
          if (entry && entry.stopFrame === void 0) entry.stopFrame = this._stopFrameOf(entry);
          this.members = [entry];
          this.seen.clear();
          this.seen.add(entry.text);
          this.bestScore = entry.selectionScore;
        }
        /**
         * Crossover's share of the next children.
         *
         * In smart mode it is crossover's share of recent admissions: the posterior
         * mean admission rate of each operator, normalised against the other. Both
         * start at one win in two tries, so the first children are an even split and
         * the evidence takes over from there. A track where splicing works keeps the
         * rate up; a track where it does not - which is most of them - walks it down
         * to the floor within a few hundred candidates and stops wasting the machine
         * on incoherent children.
         */
        _crossoverRate() {
          if (this.members.length < 2 || !this.canCross) return 0;
          if (!this.smart) return this.crossoverRate;
          const rc = (this.creditCrossWon + 1) / (this.creditCrossTried + 2);
          const rm = (this.creditMutWon + 1) / (this.creditMutTried + 2);
          const share = rc / (rc + rm);
          this.crossoverRate = Math.max(MIN_CROSSOVER, Math.min(MAX_CROSSOVER, share));
          return this.crossoverRate;
        }
        /**
         * The most changes one child may carry.
         *
         * "Max changed inputs" is a maximum. The number in the box is the hard
         * ceiling and the step size controller may only draw in under it.
         *
         * It used to multiply the box by `scale` instead, which reads as the
         * natural way to give an adaptive controller something to control, and is
         * wrong for the reason the label gives: `scale` is clamped to MAX_SCALE, so
         * a stalled run - which is exactly the state that drives it up there and
         * holds it - bred children carrying up to three times the number of edits
         * that was asked for. Measured on trigger_offline at a setting of 2, a
         * quarter of all bred children took three to six changes. The hill climber
         * and the learned search both stay inside the box, so the same number in
         * the same field bought a different mutation budget in each mode, and a head
         * to head between the modes was comparing the budgets as much as the
         * searches.
         *
         * The cost is that the controller can only reduce now: there is nothing
         * left to escalate once `scale` reaches 1, and at a setting of one change it
         * cannot move the count at all, which makes it inert - the ceiling is the
         * only thing `scale` feeds. That is the honest trade. A run that wants wider
         * steps has a control for asking, and it is the box.
         */
        _changeCeiling() {
          const max = Math.max(1, this.settings.maxChangedInputs);
          return Math.max(1, Math.min(max, Math.round(max * this.scale)));
        }
        /** Produces `count` children ready to be evaluated. */
        breed(count) {
          const out = [];
          if (!this.members.length) return out;
          const crossoverRate = this._crossoverRate();
          if (this.focus && this.fDirty) this._focusRefresh();
          let guard = 0;
          let misses = 0;
          while (out.length < count && guard++ < count * 8 && misses < BREED_MISS_LIMIT) {
            const parentA = this._tournament();
            let entries = null;
            let op = "mutate";
            let parentScore = parentA.selectionScore;
            if (this.canCross && this.members.length > 1 && this.rng() < crossoverRate) {
              const parentB = this._tournament();
              const spliced = crossover(
                parentA.entries,
                parentB.entries,
                this.settings,
                this.rng,
                this.focus ? this._liveLimit(parentA) : this.fFinish + 1
              );
              if (spliced) {
                entries = spliced;
                op = "cross";
                if (parentB.selectionScore > parentScore) parentScore = parentB.selectionScore;
              }
            }
            if (!entries) entries = cloneEntries(parentA.entries);
            this._editLimit = this.focus && op === "mutate" ? this._liveLimit(parentA) : this.fFinish + 1;
            this._liveBucketCount = this._liveBuckets(this._editLimit);
            this._focusUniform = this.focus ? this.rng() < this.fEps : false;
            const changes = randomInt(this.rng, 1, this._changeCeiling());
            const mutated = applyMutations(entries, this.settings, this.rng, changes, this._focusHooks);
            const compact = compactEntries(mutated.entries);
            const text = entriesToText(compact);
            if (!text || this.seen.has(text)) {
              misses++;
              continue;
            }
            misses = 0;
            this.seen.add(text);
            if (this.pending.size < PENDING_LIMIT) {
              this.pending.set(text, {
                entries: compact,
                op,
                parentScore,
                edits: mutated.edits,
                uniform: this._focusUniform,
                parent: parentA,
                parentValue: parentA.value != null ? parentA.value : this.rewardMean
              });
            } else {
              this.pendingDropped++;
            }
            this.bred++;
            if (op === "cross") this.creditCrossTried++;
            else this.creditMutTried++;
            out.push({
              text,
              entries: compact,
              inputCount: countInputEvents(compact),
              label: op + (mutated.notes.length ? " | " + mutated.notes.join(" | ") : "")
            });
          }
          if (this.seen.size > 4e4) {
            this.seen.clear();
            for (const m of this.members) this.seen.add(m.text);
          }
          return out;
        }
        /** Folds evaluated children back in and advances the generation. */
        absorb(results) {
          let improved = false;
          this.creditCrossTried *= CREDIT_DECAY;
          this.creditCrossWon *= CREDIT_DECAY;
          this.creditMutTried *= CREDIT_DECAY;
          this.creditMutWon *= CREDIT_DECAY;
          const bar = this.bar;
          if (bar > this.barHigh) this.barHigh = bar;
          const admits = [];
          const scored = this.focus && this.focusLearn ? [] : null;
          for (const r of results) {
            if (!r || !r.text) continue;
            const origin = this.pending.get(r.text);
            if (origin) this.pending.delete(r.text);
            this.recentTried++;
            const reference = origin ? origin.parentScore : this.members.length ? this.members[0].selectionScore : bar;
            if (r.selectionScore > reference) this.recentImproved++;
            let verdict = null;
            if (scored && origin && origin.edits && origin.edits.length) {
              verdict = { origin, reward: this._focusReward(r, origin.parentScore) };
              scored.push(verdict);
            }
            if (r.bounded) continue;
            if (r.selectionScore > this.bestScore) {
              this.bestScore = r.selectionScore;
              improved = true;
              if (verdict) verdict.reward += BEST_BONUS;
            }
            admits.push(Object.assign({}, r, {
              entries: origin && origin.entries ? origin.entries : null,
              op: origin ? origin.op : null,
              stopFrame: this._stopFrameOf(r),
              value: origin && origin.parentValue != null ? origin.parentValue : this.rewardMean
            }));
          }
          const before = new Set(this.members.map((m) => m.text));
          for (const a of admits) this.members.push(a);
          this.members.sort((a, b) => b.selectionScore - a.selectionScore);
          const kept = [];
          const texts = /* @__PURE__ */ new Set();
          for (const m of this.members) {
            if (texts.has(m.text)) continue;
            texts.add(m.text);
            kept.push(m);
            if (kept.length >= this.size) break;
          }
          this.members = kept;
          for (const m of this.members) if (!m.entries) m.entries = parseEntries(m.text);
          for (const m of this.members) {
            if (before.has(m.text)) continue;
            this.seen.add(m.text);
            if (!m.op) continue;
            this.admitted++;
            if (m.op === "cross") this.creditCrossWon++;
            else this.creditMutWon++;
          }
          this.absorbed += results.length;
          this.absorbedTotal += results.length;
          while (this.absorbed >= this.size) {
            this.absorbed -= this.size;
            this.generation++;
          }
          if (scored) for (const v of scored) this._focusLearn(v.origin, v.reward);
          this._adaptScale();
          if (improved) {
            this.staleCandidates = 0;
            this.scale = Math.max(MIN_SCALE, this.scale * 0.7);
            if (this.smart) this._shrink();
          } else if ((this.staleCandidates += results.length) >= this.size * this.stallGenerations) {
            this._diversify();
          }
          return improved;
        }
        /**
         * Rechenberg's 1/5th success rule: a healthy search improves on roughly a
         * fifth of its attempts. Above that the steps are too timid, below it they
         * are too wild.
         *
         * What counts as an attempt succeeding has to be the child beating its own
         * parent. Measuring against the population's admission bar instead - the
         * score of the weakest kept member - looks reasonable and is a runaway: the
         * population is elitist and never forgets, so as it converges the bar
         * ratchets up to within a hair of the all-time best and the admission rate
         * decays to zero no matter how large or small the steps are. Fed that, this
         * rule reads "nothing is succeeding, the steps must be too small", grows
         * them, gets fewer admissions still, and pins itself at MAX_SCALE for the
         * rest of the run. Traced on a real track it reached the ceiling four
         * seconds in and stayed there, so every child after that was drawn from the
         * widest step the box allows, whatever the run in front of it needed.
         * Parent-relative success does not decay as the population converges and
         * does respond to step size in the direction the rule assumes, which is the
         * whole requirement.
         *
         * The second half of it is the ceiling. Even on an honest signal, a search
         * that has actually converged succeeds at nothing at any step size, so the
         * rule grows the step to the ceiling and - left alone - holds it there for
         * the rest of the run. Sitting at the ceiling is not wild - _changeCeiling
         * keeps it inside the box - so much as indiscriminate: it spends the whole
         * budget on the widest edits the setting allows, when nearly all of what a
         * converging run turns out to want are the narrowest ones.
         * The rule is right that a stuck run should look further afield and wrong
         * that it should never look close again, so the escalation is made a cycle:
         * grow on failure, hold at the ceiling long enough for a wide excursion to
         * find something, then drop back to the floor and refine whatever it landed
         * on. Most of the run is then spent at small steps, which is where the
         * improvements are, without giving up the ability to leave a dead hill.
         */
        _adaptScale() {
          if (this.recentTried < 40) return;
          const rate = this.recentImproved / this.recentTried;
          if (rate > SUCCESS_TARGET) {
            this.scale = Math.max(MIN_SCALE, this.scale * 0.85);
            this.atCeiling = 0;
          } else if (this.scale >= MAX_SCALE) {
            if (++this.atCeiling >= CEILING_PATIENCE) {
              this.atCeiling = 0;
              this.excursions++;
              this.scale = MIN_SCALE;
            }
          } else {
            this.scale = Math.min(MAX_SCALE, this.scale * 1.18);
          }
          this.recentTried = 0;
          this.recentImproved = 0;
        }
        /**
         * A run that has stopped improving is stuck on one hill. Widen the mutation
         * steps for a while so children land further away, and in smart mode widen
         * the population too.
         *
         * The step widening is the part this was written for and it is not the part
         * that pays. Measured with the population pinned, so that the step size is the
         * only thing a diversify can move: firing 44 times a run against never firing
         * is +10.0 frames, t = 0.47 over 12 paired runs, which is a null. Nor does a
         * fire improve the odds of getting out of the stall it fired in - the escape
         * hazard over the next 200 candidates is within noise of the control's at the
         * same depth for every threshold measured. Two reasons, and the first is
         * enough: `scale` has exactly one consumer, _changeCeiling, which rounds it
         * into `maxChangedInputs` - so at the maxChangedInputs of 2 these benchmarks
         * use, every scale at or above 0.75 is the same ceiling, and the 1.6x below is
         * a move between two states rather than a widening. Second, _adaptScale is
         * already an escalation cycle and gets there on its own.
         *
         * The population growth is the part that pays, and it pays because of what is
         * on the other side of it rather than because of variety: _shrink runs on every
         * improvement, so this is the only thing that ever grows `size` back, and with
         * it turned off the population falls to SMART_MIN_POP and stays there for the
         * rest of the run - worth 55.6 frames, t = 3.17. Which makes STALL_GENERATIONS
         * a population-sizing dial wearing a stall detector's name, and means the sizing
         * rule is where to look next: a fixed population of 64 with this turned off beat
         * smart sizing at its best threshold by 20.6 frames over 20 paired runs.
         *
         * Nothing is discarded. Members are the only record of what has been found,
         * and dropping the weak ones would also drop the admission bar the workers
         * are bounding against, which is the one thing here that has to stay honest.
         */
        _diversify() {
          this.staleCandidates = 0;
          this.diversifies++;
          this.scale = Math.min(MAX_SCALE, Math.max(this.scale, 1) * 1.6);
          if (this.smart && this.size < SMART_MAX_POP) {
            this.size = Math.min(SMART_MAX_POP, Math.round(this.size * 1.5) + 1);
            this.resized++;
          }
        }
        /**
         * A population is a budget spent on variety, and while the leader's
         * neighbourhood is still producing improvements that variety is not being
         * used - the machine does better spending those slots refining what is
         * working. So progress shrinks the population and a stall grows it back.
         */
        _shrink() {
          if (this.size <= SMART_MIN_POP) return;
          const next = Math.max(SMART_MIN_POP, Math.round(this.size * 0.85));
          if (next === this.size) return;
          this.size = next;
          this.resized++;
          if (this.members.length > this.size) this.members.length = this.size;
        }
        // ------------------------------------------------------------------ focus
        //
        // The live window first, because it is free and exact, and then the policy.
        /**
         * Where a result stopped, or null when that frame proves nothing.
         *
         * A run abandoned for going still is the exception, and it is the one that
         * would make this unsound. The stall cutoff only starts counting after the last
         * frame *this* candidate's inputs change on, so a child that adds an input later
         * than its parent's last one does not stall where its parent did: it keeps
         * simulating, and what it does with those frames can score. Every other way of
         * stopping - the trigger fired, the car crossed the line, the evaluation frame
         * arrived - depends only on the frames before it, which a mutant reproduces
         * exactly, so for those the frame is a proof.
         *
         * A bounded result is never asked: its frame count is where the bound fired, not
         * where the objective answered, and absorb drops it before this is reached.
         */
        _stopFrameOf(result) {
          if (!result || result.stalled === true) return null;
          return Number.isFinite(result.frames) ? result.frames : null;
        }
        /**
         * The first frame this parent's run never reached, so an edit at or after it
         * cannot possibly change the outcome. Exclusive.
         *
         * Per-parent, and it closes on its own: a parent that finishes earlier has a
         * shorter live window than one that finishes late, and as the search improves
         * the window shortens. Before anything has reached the objective at all, every
         * member runs to the evaluation frame and nothing is excluded.
         *
         * The proof is for one edit at a time. A child carrying two could in principle
         * use an early one to make the run last longer and a late one to do something
         * with the frames that opens up, and that combination is not drawn here. It is
         * not one worth reaching: on every objective that stops early "lasts longer" is
         * the wrong direction, and if a slower prefix really is on the way to something
         * better it is admitted on its own merits first and arrives with a longer live
         * window of its own.
         */
        _liveLimit(parent) {
          const stop = parent && parent.stopFrame;
          if (!Number.isFinite(stop)) return this.fFinish + 1;
          return Math.max(this.fStart + 1, Math.min(this.fFinish + 1, stop));
        }
        /** How many buckets can still produce a frame below `limit`. */
        _liveBuckets(limit) {
          if (!this.focus) return this.fBuckets;
          return Math.max(1, Math.min(this.fBuckets, Math.ceil((limit - this.fStart) / this.fBucketWidth)));
        }
        /**
         * Rebuilds the sampling distribution: a softmax over the logits mixed with
         * enough uniform mass that no bucket can be driven out of the run.
         *
         * There is no optimism bonus here, and that is a difference from rl.js worth
         * stating. The bonus is what makes an early survey across seven interacting
         * heads systematic rather than merely random; with one head the logits start at
         * zero, so the softmax *is* uniform to begin with, and the exploration floor is
         * a third of every draw for the first few hundred candidates. It would buy
         * nothing and it carries a failure mode - a bucket that stops being sampled
         * keeps a count of zero while the total climbs, so its bonus grows without
         * bound.
         */
        _focusRefresh() {
          const n = this.fBuckets;
          this.fDirty = false;
          if (n === 1) {
            this.fSoft[0] = 1;
            this.fProbs[0] = 1;
            this.fCumulative[0] = 1;
            this.fEps = 0;
            return;
          }
          const annealed = EPS_MIN + (EPS_MAX - EPS_MIN) * Math.exp(-this.fSamples / EPS_TAU);
          const eps = Math.max(
            EPS_MIN,
            Math.min(1 - TRUST_FLOOR, Math.max(annealed, 1 - this._focusTrust()))
          );
          this.fEps = eps;
          const logits = this.fLogits, soft = this.fSoft, probs = this.fProbs;
          let max = -Infinity;
          for (let i = 0; i < n; i++) if (logits[i] > max) max = logits[i];
          let sum = 0;
          for (let i = 0; i < n; i++) {
            const e = Math.exp(logits[i] - max);
            soft[i] = e;
            sum += e;
          }
          const floor = eps / n;
          let running = 0;
          for (let i = 0; i < n; i++) {
            soft[i] /= sum;
            probs[i] = soft[i] * (1 - eps) + floor;
            running += soft[i];
            this.fCumulative[i] = running;
          }
        }
        /**
         * How much of the draw the policy has earned, from 0 to 1.
         *
         * This is the part that decides whether the whole idea applies to the run in
         * front of it, and it is not optional. A frame policy assumes there is
         * something to know about where in the run an edit is worth making, and on
         * plenty of tracks there is not: on a straight, every frame is as good a place
         * to start steering as every other. The policy will still commit - improvements
         * do happen, and every one of them gets credited to whichever bucket the edit
         * that produced it happened to sit in, which is a real reward attributed to an
         * irrelevant feature. Measured on exactly such a preset, the search lost about a
         * fifth of its improvements and finished 43 frames worse.
         *
         * So the exploration mass is put to work as a control. A child that drew its
         * bucket from the uniform component is identical to one that drew it from the
         * policy in every other respect - same tournament, same parent, same operators,
         * same step size - so the difference in what the two groups earn is the
         * policy's contribution and nothing else. Comparing the mean advantage of the
         * two in standard errors needs no threshold to be invented: what "better than
         * chance" means is already the question the statistic answers.
         *
         * The result only ever *raises* the exploration floor. A policy that is
         * measurably ahead behaves exactly as it would have without this; one that is
         * not is walked back to a uniform draw, which leaves the live-window pruning -
         * free, exact, and the half of Focus that does not depend on there being
         * anything to learn - doing its job alone.
         */
        _focusTrust() {
          if (this.ctrlN < TRUST_MIN || this.polN < TRUST_MIN) return 1;
          const pm = this.polSum / this.polN, cm = this.ctrlSum / this.ctrlN;
          const pv = Math.max(0, this.polSq / this.polN - pm * pm);
          const cv = Math.max(0, this.ctrlSq / this.ctrlN - cm * cm);
          const se = Math.sqrt(pv / this.polN + cv / this.ctrlN);
          if (!(se > 0)) return 1;
          const t = (pm - cm) / se;
          this.fTrust = Math.max(0, Math.min(1, 0.5 + t / (2 * TRUST_T)));
          return this.fTrust;
        }
        /**
         * One bucket, drawn from the live prefix only.
         *
         * Restricting to a prefix is exact rather than approximate, and costs nothing,
         * because the table is already a prefix sum: drawing inside
         * [0, cumulative[allowed-1]) gives every live bucket its own probability
         * renormalised over the rest, with no rejection loop and no rebuild.
         */
        _focusBucket(rng) {
          const n = Math.max(1, Math.min(this.fBuckets, this._liveBucketCount));
          if (n === 1) return 0;
          if (this._focusUniform) return randomInt(rng, 0, n - 1);
          const target = rng() * this.fCumulative[n - 1];
          let lo = 0, hi = n - 1;
          while (lo < hi) {
            const mid = lo + hi >> 1;
            if (this.fCumulative[mid] < target) lo = mid + 1;
            else hi = mid;
          }
          return lo;
        }
        /** A frame drawn uniformly inside a bucket, clipped to the live window. */
        _focusFrame(bucket, rng) {
          const frame = this.fStart + Math.floor((bucket + rng()) * this.fBucketWidth);
          const top = Math.min(this.fFinish, this._editLimit - 1);
          return Math.max(this.fStart, Math.min(top, frame));
        }
        /**
         * A slot on the insert grid, for the bucket the policy chose.
         *
         * Snapping rounds, so it can land up to half a step past the frame that was
         * asked for - which is past the live window when the frame asked for is the last
         * live one. The cap goes on the slot rather than the frame, so what comes back
         * is still on the grid the unguided operator uses. Moving the grid instead, by
         * narrowing the window the operator is handed, would make frames reachable that
         * were not reachable before, which is the one thing this must not do.
         */
        _pickGrid(rng, base, stride, slots) {
          const wanted = this._focusFrame(this._focusBucket(rng), rng);
          const last = Math.floor((Math.min(this.fFinish, this._editLimit - 1) - base) / stride);
          return Math.max(0, Math.min(slots, last, Math.round((wanted - base) / stride)));
        }
        /**
         * An index into the eligible list the retiming and removal operators built,
         * drawn from the bucket the policy chose.
         *
         * Uniformly among the events actually inside the bucket, falling back to the
         * nearest one when the bucket holds none - which it usually does, since the
         * window is split into 32 buckets and a run may carry only a handful of events.
         * Uniform-within-bucket rather than always-nearest matters more than it looks:
         * with "nearest" the operator is deterministic given the bucket, so a policy
         * that had settled on one bucket would redraw the same handful of sequences,
         * the dedupe would throw nearly all of them away, and the threads would run
         * short of work while the search sat still.
         *
         * The live window bounds the fallback as well as the bucket. Without that, a
         * bucket holding no events falls back to the nearest event anywhere in the
         * sequence, which on a run whose window is mostly dead is usually one out in the
         * dead part - so the operator would go and edit exactly the frames the whole
         * point was to stop drawing. Only if nothing at all is live does it take a
         * uniform draw, since the operators have no null path here.
         *
         * Reservoir sampling rather than collecting the matches, so a draw on the
         * coordinator thread stays one pass and allocates nothing.
         */
        _pickEvent(rng, eligible, entries) {
          const bucket = this._focusBucket(rng);
          const wanted = this._focusFrame(bucket, rng);
          const lo = this.fStart + bucket * this.fBucketWidth;
          const hi = lo + this.fBucketWidth;
          const limit = this._editLimit;
          let seen = 0, chosen = -1, nearest = -1, bestGap = Infinity;
          for (let i = 0; i < eligible.length; i++) {
            const frame = entries ? entries[eligible[i]].frame : eligible[i].frame;
            if (frame >= limit) continue;
            const gap = frame > wanted ? frame - wanted : wanted - frame;
            if (gap < bestGap) {
              bestGap = gap;
              nearest = i;
            }
            if (frame >= lo && frame < hi && rng() * ++seen < 1) chosen = i;
          }
          if (chosen >= 0) return chosen;
          if (nearest >= 0) return nearest;
          return randomInt(rng, 0, eligible.length - 1);
        }
        /**
         * What one child's edits earned.
         *
         * Only beating the parent pays, and what it pays is the size of the gain
         * measured against the run's own recent gains. Every way of failing is worth the
         * same. Two things this deliberately does not do, both of which look reasonable
         * and were measured to be traps in rl.js: it does not rank the losers against
         * each other, because a search that keeps only its best cannot afford to believe
         * a candidate that says "nearly"; and it does not pay for merely clearing the
         * admission bar, because on a wide population that is most of what an edit too
         * small to matter achieves. Both of those collapse the policy onto the smallest,
         * safest edit - and specifically onto the buckets nearest the end of the window,
         * where an edit has the least time left to change anything. It learns to do
         * nothing, carefully.
         *
         * The inert tier is the one signal here a hill climber cannot see at all: an
         * edit that changed the controls and left the score bit-identical did not fail,
         * it did *nothing*, which is a far stronger statement about that part of the run
         * than any loss is. It is scored below a loss.
         *
         * It is also the one tier that has to be guarded, because it is the only one
         * that is not the same verdict with bounded evaluation on and off. A tie is
         * reported as a tie only if the child ran to the end; had the parent been the
         * weakest kept member, a child tying it sits at the bar and is cut short, coming
         * back as a bounded failure instead. Requiring the parent to be above every bar
         * this run has ever published proves the tie could not have been cut in either
         * case - and when it cannot be proved the verdict falls back to the failure both
         * paths agree on. Everything below the bar reads the same either way already:
         * bounded implies the score is at or under the bar, the bar is at or under any
         * member's score, so a bounded child was never a gain.
         */
        _focusReward(result, parentScore) {
          if (result.bounded) return FAILED;
          const delta = result.selectionScore - parentScore;
          if (!Number.isFinite(delta)) return FAILED;
          if (delta === 0) {
            if (!(parentScore > this.barHigh)) return FAILED;
            this.fInert++;
            return INERT;
          }
          if (delta < 0) return FAILED;
          this.fGains++;
          this.gainScale = this.gainScale > 0 ? this.gainScale * 0.97 + delta * 0.03 : delta;
          return 1 + Math.min(1.5, this.gainScale > 0 ? delta / this.gainScale : 1);
        }
        /**
         * One REINFORCE step over the buckets: push the chosen one's logit up when the
         * advantage is positive, and every other bucket's down in proportion to how
         * likely it was.
         *
         * The chosen bucket is replaced by a triangular kernel centred on it, which is
         * the same update with the action read as "an edit somewhere around here"
         * rather than "an edit in exactly this bucket". That is the honest reading - the
         * bucket boundaries are arbitrary - and it is what makes 32 buckets learnable
         * inside a couple of thousand candidates instead of a couple of tens of
         * thousands.
         */
        _focusUpdate(index, advantage, lr, width) {
          const n = this.fBuckets;
          if (n < 2) return;
          const step = lr * advantage;
          const logits = this.fLogits, probs = this.fProbs;
          const half = Math.min(width, n);
          const lo = Math.max(0, index - half + 1), hi = Math.min(n - 1, index + half - 1);
          let weight = 0;
          for (let i = lo; i <= hi; i++) weight += half - Math.abs(i - index);
          for (let i = 0; i < n; i++) {
            const k = i >= lo && i <= hi ? (half - Math.abs(i - index)) / weight : 0;
            logits[i] = clampLogit(logits[i] + step * (k - probs[i]));
          }
        }
        /**
         * Applies one child's advantage to every bucket it edited.
         *
         * The advantage is the reward less what a child of *that particular parent* was
         * expected to earn, a value estimate kept per member and updated from its own
         * children. That is the critic half of an actor-critic, and the confound it
         * removes is large and systematic here: parents are drawn by a tournament over
         * the whole population, so a child is far more likely to be bred from a middling
         * member than from the leader, and improving on a middling member is enormously
         * easier. Against one global average, "was bred from a weak parent" swamps "was
         * a good edit", and the policy spends its learning on the difference between
         * parents instead of the difference between edits.
         *
         * Nothing divides it by a spread. Normalising by the deviation is the textbook
         * thing to do and is wrong here for a specific reason: with failures at nineteen
         * in twenty the spread is small, so every gain normalises to the clip whatever
         * its size, and the policy goes back to climbing the *odds* of an improvement
         * rather than its size. The rewards are already built to be comparable across
         * objectives. The clip is only there to stop one freak result rewriting the
         * policy on its own.
         *
         * The step size is derived rather than set. A logit here is a random walk with a
         * decay: it takes a kick of about lr * |advantage| whenever its bucket is
         * chosen, and is multiplied by `forget` every child, which settles at a spread
         * of lr * |advantage| * sqrt(u / n) / sqrt(1 - forget^2) where u is how often the
         * policy is updated per child. Both of those are measured from the run, so the
         * rate is whatever puts the drift-on-noise-alone at NOISE_FLOOR. A hand-set rate
         * cannot do that: selectionScore is a distance on one objective and a frame
         * count plus a billion on another, and the same number means different things in
         * each.
         *
         * The fade is applied once per learned child, not once per update. Folding it
         * into the update would make a child carrying three edits forget three times as
         * fast as one carrying one, which gives the half-life above three different
         * meanings depending on the mutation budget.
         */
        _focusLearn(origin, reward) {
          this.fSamples++;
          this.rewardMean = this.rewardMean * 0.995 + reward * 5e-3;
          const baseline = origin.parentValue != null ? origin.parentValue : this.rewardMean;
          if (origin.parent) {
            origin.parent.value = (origin.parent.value != null ? origin.parent.value : baseline) * 0.98 + reward * 0.02;
          }
          const advantage = Math.max(-5, Math.min(5, reward - baseline));
          this.advantageScale = this.advantageScale * 0.995 + Math.abs(advantage) * 5e-3;
          if (origin.uniform) {
            this.ctrlN++;
            this.ctrlSum += advantage;
            this.ctrlSq += advantage * advantage;
          } else {
            this.polN++;
            this.polSum += advantage;
            this.polSq += advantage * advantage;
          }
          const width = Math.max(1, Math.round(1 + (KERNEL_WIDE - 1) * Math.exp(-this.fSamples / KERNEL_TAU)));
          const perChild = this.fUpdates / Math.max(1, this.fSamples);
          const chosenRate = Math.max(1e-3, perChild / this.fBuckets);
          const lr = Math.max(LR_MIN, Math.min(
            LR_MAX,
            NOISE_FLOOR * this.pullback / (Math.max(0.05, this.advantageScale) * Math.sqrt(chosenRate))
          ));
          const logits = this.fLogits;
          for (let i = 0; i < this.fBuckets; i++) logits[i] *= this.forget;
          for (const frame of origin.edits) {
            const bucket = Math.max(0, Math.min(
              this.fBuckets - 1,
              Math.floor((frame - this.fStart) / this.fBucketWidth)
            ));
            this._focusUpdate(bucket, advantage, lr, width);
            this.fUpdates++;
          }
          this.fDirty = true;
        }
        /** How far the policy has committed: 0 having learned nothing, 1 collapsed. */
        _focusCommitment() {
          const n = this.fBuckets;
          if (!this.focus || n < 2) return null;
          let h = 0;
          for (let i = 0; i < n; i++) {
            const value = this.fProbs[i];
            if (value > 0) h -= value * Math.log(value);
          }
          return Math.max(0, Math.min(1, 1 - h / Math.log(n)));
        }
        /**
         * The stretch of the run the policy currently likes best, in frames.
         *
         * Over the live buckets only. Taking the best of the whole table would report
         * whatever is sitting out in the part of the window the search has stopped
         * drawing from, which is the opposite of what the line is for.
         */
        _hotFrames() {
          if (!this.focus || this.fBuckets < 2 || !this.members.length || !this.fSamples) return null;
          const allowed = this._liveBuckets(this._liveLimit(this.members[0]));
          let best = 0;
          for (let i = 1; i < allowed; i++) if (this.fProbs[i] > this.fProbs[best]) best = i;
          return {
            lo: Math.round(this.fStart + best * this.fBucketWidth),
            hi: Math.min(this.fFinish, Math.round(this.fStart + (best + 1) * this.fBucketWidth) - 1)
          };
        }
        _tournament() {
          const n = this.members.length;
          if (n <= 1) return this.members[0] || null;
          let best = null;
          for (let i = 0; i < TOURNAMENT; i++) {
            const pick = this.members[randomInt(this.rng, 0, n - 1)];
            if (!best || pick.selectionScore > best.selectionScore) best = pick;
          }
          return best;
        }
        /** The progress line, so a running search is not a black box. */
        describe() {
          const st = this.stats();
          const admitRate = st.bred ? " (" + Math.round(st.admitted / st.bred * 100) + "% kept)" : "";
          const where = st.hot ? ", now editing around frames " + st.hot.lo + "-" + st.hot.hi : "";
          return (st.smart ? " Smart population: " : " Population: ") + st.population + " of " + st.size + ", generation " + st.generation + ", up to " + st.changeCeiling + (st.changeCeiling === 1 ? " change" : " changes") + ", crossover " + Math.round(st.crossoverRate * 100) + "%" + admitRate + where + ".";
        }
        stats() {
          return {
            kind: "genetic",
            generation: this.generation,
            population: this.members.length,
            size: this.size,
            mutationScale: this.scale,
            changeCeiling: this._changeCeiling(),
            excursions: this.excursions,
            diversifies: this.diversifies,
            // Candidates since the last new best, and the threshold they are
            // measured against, so a stuck run says how stuck it is.
            staleCandidates: this.staleCandidates,
            stallAt: this.size * this.stallGenerations,
            crossoverRate: this.members.length > 1 ? this.crossoverRate : 0,
            admitted: this.admitted,
            bred: this.bred,
            smart: this.smart,
            distinct: this.members.length,
            focused: this.focus,
            // Named to match the learned mode's, so the progress readouts and the
            // benchmark harnesses can print either without knowing which is running.
            focus: this._focusCommitment(),
            hot: this._hotFrames(),
            liveTo: this.focus && this.members.length ? this._liveLimit(this.members[0]) : null,
            // How much of the draw the policy has earned against its own control,
            // and how much of it is being held back to keep measuring that.
            trust: this.focus ? this.fTrust : null,
            exploring: this.focus ? this.fEps : null,
            inert: this.fInert,
            pendingDropped: this.pendingDropped
          };
        }
      };
      module.exports = { Population, crossover };
    }
  });

  // work/polytrack-unified/electron/bruteforce/rl.js
  var require_rl = __commonJS({
    "work/polytrack-unified/electron/bruteforce/rl.js"(exports, module) {
      "use strict";
      var { entriesToText, compactEntries, countInputEvents, parseEntries, normalizeKeys, stateAt } = require_tas_text();
      var { rollSpec } = require_search();
      var FRAME_BUCKETS = 32;
      var HOLD_BUCKETS = 8;
      var SHIFT_MAGNITUDES = 4;
      var LOGIT_LIMIT = 4;
      var EPS_MAX = 0.35;
      var EPS_MIN = 0.04;
      var EPS_TAU = 900;
      var UCB_C = 0.7;
      var KERNEL_WIDE = 4;
      var KERNEL_TAU = 1200;
      var FORGET_HALFLIFE = 2400;
      var FAILED = -0.4;
      var INERT = -1.2;
      var BEST_BONUS = 1;
      var NOISE_FLOOR = 0.35;
      var LR_MIN = 2e-3;
      var LR_MAX = 0.5;
      var TOURNAMENT = 3;
      var MIN_ELITES = 8;
      var MAX_ELITES = 64;
      var START_ELITES = 16;
      var STALL_GENERATIONS = 24;
      var PENDING_LIMIT = 2e4;
      function cloneEntries(entries) {
        return entries.map((e) => ({ frame: e.frame, keys: e.keys }));
      }
      function clampLogit(v) {
        return v > LOGIT_LIMIT ? LOGIT_LIMIT : v < -LOGIT_LIMIT ? -LOGIT_LIMIT : v;
      }
      var Head = class {
        constructor(n, ordinal) {
          this.n = Math.max(1, n | 0);
          this.ordinal = !!ordinal;
          this.logits = new Float64Array(this.n);
          this.counts = new Float64Array(this.n);
          this.probs = new Float64Array(this.n).fill(1 / this.n);
          this.cumulative = new Float64Array(this.n);
          this.total = 0;
          this.updates = 0;
          this.dirty = true;
        }
        /**
         * Rebuilds the sampling distribution: a softmax over the logits plus an
         * optimism bonus for arms with few samples, mixed with `eps` of uniform so
         * no arm can be driven out of the run entirely.
         *
         * Called once per chunk rather than once per candidate. Within a chunk the
         * table goes stale by however many results came back while it was being
         * filled, which is a distribution a few dozen updates behind the newest
         * evidence - not a correctness question, and worth an exp() per arm per
         * chunk instead of per arm per candidate.
         */
        refresh(eps) {
          const n = this.n;
          this.dirty = false;
          if (n === 1) {
            this.probs[0] = 1;
            this.cumulative[0] = 1;
            return;
          }
          const logN = Math.log(this.total + 1);
          let max = -Infinity;
          for (let i = 0; i < n; i++) {
            const value = this.logits[i] + UCB_C * Math.sqrt(logN / (this.counts[i] + 1));
            this.probs[i] = value;
            if (value > max) max = value;
          }
          let sum = 0;
          for (let i = 0; i < n; i++) {
            const e = Math.exp(this.probs[i] - max);
            this.probs[i] = e;
            sum += e;
          }
          const floor = eps / n;
          const scale = (1 - eps) / sum;
          let running = 0;
          for (let i = 0; i < n; i++) {
            const p = this.probs[i] * scale + floor;
            this.probs[i] = p;
            running += p;
            this.cumulative[i] = running;
          }
        }
        sample(rng) {
          return this.sampleBelow(rng, this.n);
        }
        /**
         * Samples from the first `allowed` arms only.
         *
         * Restricting to a prefix is exact rather than approximate, and costs nothing,
         * because the cumulative table is already a prefix sum: drawing inside
         * [0, cumulative[allowed-1]) gives every allowed arm its own probability
         * renormalised over the rest, with no rejection loop and no rebuild. It is
         * only meaningful for a head whose arms are ordered, and only used by one -
         * the frame head, whose tail is the part of the run the simulation never
         * reaches. See RLSearch._liveBuckets.
         */
        sampleBelow(rng, allowed) {
          const n = Math.max(1, Math.min(this.n, allowed | 0));
          this.total++;
          if (n === 1) {
            this.counts[0]++;
            return 0;
          }
          const target = rng() * this.cumulative[n - 1];
          let lo = 0, hi = n - 1;
          while (lo < hi) {
            const mid = lo + hi >> 1;
            if (this.cumulative[mid] < target) lo = mid + 1;
            else hi = mid;
          }
          this.counts[lo]++;
          return lo;
        }
        /**
         * One REINFORCE step: push the chosen arm's logit up when the advantage is
         * positive, and every other arm's down in proportion to how likely it was.
         *
         * For an ordinal head the chosen arm is replaced by a triangular kernel
         * centred on it, which is the same update with the action read as "an edit
         * somewhere around here" rather than "an edit in exactly this bucket". That
         * is the honest reading - the bucket boundaries are arbitrary - and it is
         * what makes the frame head learnable inside a couple of thousand candidates.
         */
        update(index, advantage, lr, width) {
          const n = this.n;
          this.updates++;
          if (n === 1) return;
          const step = lr * advantage;
          const logits = this.logits, probs = this.probs;
          if (this.ordinal && width > 1) {
            const half = Math.min(width, n);
            const lo = Math.max(0, index - half + 1), hi = Math.min(n - 1, index + half - 1);
            let weight = 0;
            for (let i = lo; i <= hi; i++) weight += half - Math.abs(i - index);
            for (let i = 0; i < n; i++) {
              const k = i >= lo && i <= hi ? (half - Math.abs(i - index)) / weight : 0;
              logits[i] = clampLogit(logits[i] + step * (k - probs[i]));
            }
          } else {
            for (let i = 0; i < n; i++) {
              logits[i] = clampLogit(logits[i] + step * ((i === index ? 1 : 0) - probs[i]));
            }
          }
          this.dirty = true;
        }
        /**
         * Fades every logit toward uniform.
         *
         * Once per candidate, not once per update, and that is not a detail: a
         * candidate carrying two edits updates the frame head three times and the
         * keyset head once, so folding the fade into update() gave FORGET_HALFLIFE
         * three different meanings across the seven heads and made the fastest of them
         * forget more than twice as quickly as the constant claims.
         */
        decay(forget) {
          if (this.n === 1) return;
          const logits = this.logits;
          for (let i = 0; i < this.n; i++) logits[i] *= forget;
          this.dirty = true;
        }
        /** Normalised entropy: 1 when the head has learned nothing, 0 when it has collapsed. */
        entropy() {
          if (this.n < 2) return 1;
          let h = 0;
          for (let i = 0; i < this.n; i++) {
            const p = this.probs[i];
            if (p > 0) h -= p * Math.log(p);
          }
          return h / Math.log(this.n);
        }
        /** The arm the policy currently likes best, out of the first `allowed`. */
        argmax(allowed) {
          const n = Math.max(1, Math.min(this.n, allowed == null ? this.n : allowed | 0));
          let best = 0;
          for (let i = 1; i < n; i++) if (this.probs[i] > this.probs[best]) best = i;
          return best;
        }
      };
      function logRanges(min, max, wanted) {
        const lo = Math.max(1, min | 0), hi = Math.max(lo, max | 0);
        if (hi === lo) return [{ lo, hi }];
        const n = Math.max(1, Math.min(wanted, hi - lo + 1));
        const out = [];
        let from = lo;
        for (let i = 0; i < n && from <= hi; i++) {
          const t = (i + 1) / n;
          const edge = i === n - 1 ? hi : Math.max(from, Math.min(hi, Math.round(lo * Math.pow(hi / lo, t))));
          out.push({ lo: from, hi: edge });
          from = edge + 1;
        }
        return out;
      }
      function shiftRanges(maxDifference) {
        const magnitudes = logRanges(1, Math.max(1, maxDifference | 0), SHIFT_MAGNITUDES);
        const out = [];
        for (let i = magnitudes.length - 1; i >= 0; i--) out.push({ lo: -magnitudes[i].hi, hi: -magnitudes[i].lo });
        for (const r of magnitudes) out.push({ lo: r.lo, hi: r.hi });
        return out;
      }
      function operatorsFor(mode) {
        if (mode === "inputs_only") return ["insert"];
        if (mode === "timing_only") return ["shift"];
        if (mode === "lis") return ["remove", "shift"];
        return ["insert", "shift"];
      }
      function crossoverAllowed(mode) {
        return mode === "inputs_timing" || mode === "inputs_only";
      }
      var RLSearch = class {
        constructor(settings, rng) {
          this.settings = settings;
          this.rng = rng;
          this.smart = settings.smartRl !== false;
          this.size = this.smart ? START_ELITES : Math.max(1, Math.min(MAX_ELITES, settings.rlElites || START_ELITES));
          this.explore = Number.isFinite(Number(settings.rlExploration)) ? Number(settings.rlExploration) : 0.3;
          this.start = settings.start;
          this.finish = Math.max(settings.start, settings.finish);
          const span = this.finish - this.start;
          this.frameBuckets = Math.max(1, Math.min(FRAME_BUCKETS, span + 1));
          this.bucketWidth = (span + 1) / this.frameBuckets;
          this.operators = operatorsFor(settings.mutationMode);
          this.keysets = (settings.keysets || []).map(normalizeKeys);
          this.holds = logRanges(settings.hold.min, settings.hold.max, HOLD_BUCKETS);
          this.shifts = shiftRanges(settings.maxTimeDifference);
          this.canCross = crossoverAllowed(settings.mutationMode);
          this.heads = {
            recomb: new Head(this.canCross ? 2 : 1, false),
            op: new Head(this.operators.length, false),
            frame: new Head(this.frameBuckets, true),
            keys: new Head(Math.max(1, this.keysets.length), false),
            hold: new Head(this.holds.length, true),
            shift: new Head(this.shifts.length, true),
            count: new Head(Math.max(1, settings.maxChangedInputs), true)
          };
          this.headList = Object.keys(this.heads).map((k) => this.heads[k]);
          this.members = [];
          this.seen = /* @__PURE__ */ new Set();
          this.pending = /* @__PURE__ */ new Map();
          this._roomOut = { low: 0, high: 0 };
          this._editLimit = this.finish + 1;
          this._liveBucketCount = this.frameBuckets;
          this.bestScore = -Infinity;
          this.samples = 0;
          this.staleCandidates = 0;
          this.stallGenerations = settings.stallGenerations != null ? settings.stallGenerations : STALL_GENERATIONS;
          this.stallTrips = 0;
          this.absorbedTotal = 0;
          this.admitted = 0;
          this.bred = 0;
          this.inert = 0;
          this.gains = 0;
          this.generation = 0;
          this.absorbed = 0;
          this.resized = 0;
          this.rewardMean = 0;
          this.gainScale = 0;
          this.advantageScale = 0.5;
          this.pullback = 0;
          this.stall = 0;
          this.forget = Math.pow(0.5, 1 / FORGET_HALFLIFE);
          this.pullback = Math.sqrt(1 - this.forget * this.forget);
        }
        /**
         * The step size for one head, sized so that with no signal at all its logits
         * settle around NOISE_FLOOR rather than wherever the clamp happens to be.
         *
         * Inverted straight out of the stationary spread of the walk the update rule
         * describes - see NOISE_FLOOR for the derivation. Everything in it is measured
         * from the run except the target: how big an advantage typically is, and how
         * often this particular head gets updated per candidate.
         */
        _rateFor(head) {
          if (head.n < 2) return 0;
          const perCandidate = head.updates / Math.max(1, this.samples);
          const chosenRate = Math.max(1e-3, perCandidate / head.n);
          const magnitude = Math.max(0.05, this.advantageScale);
          const lr = NOISE_FLOOR * this.pullback / (magnitude * Math.sqrt(chosenRate));
          return Math.max(LR_MIN, Math.min(LR_MAX, lr));
        }
        get best() {
          return this.members.length ? this.members[0] : null;
        }
        /**
         * The selection score a child has to clear to be kept, published to the
         * workers as an evaluation bound. -Infinity while there are more places than
         * members, because then nothing can be cut. Identical in meaning to the
         * population search's bar; see genetic.js for why it is exact.
         */
        get bar() {
          if (this.members.length < this.size) return -Infinity;
          return this.members[this.size - 1].selectionScore;
        }
        seed(entry) {
          if (entry && entry.stopFrame === void 0) entry.stopFrame = this._stopFrameOf(entry);
          this.members = [entry];
          this.seen.clear();
          this.seen.add(entry.text);
          this.bestScore = entry.selectionScore;
        }
        /** Exploration floor: wide while the run is young, wider again when it is stuck. */
        _eps() {
          const settled = EPS_MIN + (EPS_MAX - EPS_MIN) * Math.exp(-this.samples / EPS_TAU);
          return Math.max(0, Math.min(EPS_MAX, settled * (1 + 2 * this.stall) * (0.5 + this.explore)));
        }
        /** Credit kernel half-width, in buckets. Narrows with evidence, widens on a stall. */
        _kernel() {
          const settled = 1 + (KERNEL_WIDE - 1) * Math.exp(-this.samples / KERNEL_TAU);
          return Math.max(1, Math.round(settled * (1 + this.stall)));
        }
        /**
         * A three-way tournament, which is what the population search uses: mild
         * pressure, so the archive keeps some variety instead of collapsing onto the
         * current leader. Comparing by rank rather than by score would work equally
         * well here and is not worth the table it would need - members are already
         * sorted, so the lowest index wins.
         */
        _selectParent() {
          const n = this.members.length;
          if (n <= 1) return this.members[0] || null;
          let best = n;
          for (let i = 0; i < TOURNAMENT; i++) {
            const pick = Math.floor(this.rng() * n);
            if (pick < best) best = pick;
          }
          return this.members[best];
        }
        /**
         * The first frame this parent's run never reached, so an input placed at or
         * after it cannot possibly change the outcome.
         *
         * Every objective here stops the simulation as soon as it has its answer - the
         * frame the trigger fired on, the frame the car crossed the line, or the
         * evaluation frame if neither happened - and the simulator reports where it
         * stopped. The control table is read only up to that frame, so an edit past it
         * is not a bad edit or an unlikely one, it is a *proved* no-op: the child is
         * byte-identical to its parent for every frame that was simulated, and comes
         * back with exactly the parent's score having cost a full physics replay to
         * find out.
         *
         * This matters because a search window is chosen before anyone knows where the
         * interesting part of the run is, so it is routinely far wider than it needs to
         * be - and every candidate the other two modes draw into that tail is spent
         * proving the same nothing again. On the wide-window benchmark here the tail is
         * more than half the window.
         *
         * Free, exact, and per-parent: a parent that finishes earlier has a shorter
         * live window than one that finishes late, and as the search improves the
         * window closes on its own. Before anything has reached the objective at all,
         * every member runs to the evaluation frame and nothing is excluded.
         *
         * The proof is for one edit at a time. A candidate carrying two could in
         * principle use an early one to make the run last longer and a late one to do
         * something with the frames that opens up - and that combination is not drawn
         * here. It is not a combination worth reaching: on every objective that stops
         * early, "lasts longer" is the wrong direction, and if a slower prefix really
         * is on the way to something better it is admitted on its own merits first and
         * arrives with a longer live window of its own.
         */
        _liveLimit(parent) {
          const stop = parent && parent.stopFrame;
          if (!Number.isFinite(stop)) return this.finish + 1;
          return Math.max(this.start + 1, Math.min(this.finish + 1, stop));
        }
        /**
         * Where a result stopped, or null when that frame proves nothing.
         *
         * A run abandoned for going still is the exception, and it is the one that
         * would have made this unsound. The stall cutoff only starts counting after
         * the last frame *this* candidate's inputs change on, so a child that adds an
         * input later than the parent's last one does not stall where its parent did:
         * it keeps simulating, and what it does with those frames can score. Every
         * other way of stopping - the trigger fired, the car crossed the line, the
         * evaluation frame arrived - depends only on the frames before it, which the
         * child reproduces exactly, so for those the frame is a proof.
         */
        _stopFrameOf(result) {
          if (!result || result.stalled === true) return null;
          return Number.isFinite(result.frames) ? result.frames : null;
        }
        /** How many frame buckets can still produce a frame below `limit`. */
        _liveBuckets(limit) {
          return Math.max(1, Math.min(this.frameBuckets, Math.ceil((limit - this.start) / this.bucketWidth)));
        }
        /** A frame drawn uniformly inside the bucket the frame head chose. */
        _frameIn(bucket) {
          const f = this.start + Math.floor((bucket + this.rng()) * this.bucketWidth);
          return Math.max(this.start, Math.min(Math.min(this.finish, this._editLimit - 1), f));
        }
        /** A value drawn uniformly inside one of a head's ranges. */
        _valueIn(range) {
          return range.lo + Math.floor(this.rng() * (range.hi - range.lo + 1));
        }
        /**
         * Inserts a held block at the policy's chosen frame.
         *
         * The frame is snapped onto the same `step` grid the unguided operator uses,
         * so the set of sequences this mode can reach is exactly the set the hill
         * climber can reach. The policy changes which of them get drawn, never which
         * of them exist - which is what makes a head-to-head against the other modes
         * mean anything, and what keeps the search inside the settings that were
         * actually typed in.
         */
        _insert(entries, action) {
          if (!this.keysets.length) return null;
          const step = Math.max(1, rollSpec(this.rng, this.settings.step));
          const span = this.finish - this.start;
          if (span < 0) return null;
          const slots = Math.floor(span / step);
          const wanted = this._frameIn(action.frame);
          const last = Math.floor((Math.min(this.finish, this._editLimit - 1) - this.start) / step);
          const slot = Math.max(0, Math.min(slots, last, Math.round((wanted - this.start) / step)));
          const frame = this.start + slot * step;
          if (frame > this.finish || frame >= this._editLimit) return null;
          const keys = this.keysets[action.keys] || "";
          const hold = Math.max(1, this._valueIn(this.holds[action.hold]));
          const end = frame + hold;
          const revert = stateAt(entries, end);
          const map = /* @__PURE__ */ new Map();
          for (const e of entries) if (!(e.frame > frame && e.frame < end)) map.set(e.frame, e.keys);
          map.set(frame, keys);
          map.set(end, revert);
          return {
            entries: Array.from(map.entries()).map(([f, k]) => ({ frame: f, keys: k })).sort((a, b) => a.frame - b.frame),
            note: "+" + (keys || "none") + "@" + frame + " hold " + hold
          };
        }
        /**
         * An event for the retiming and removal operators to work on, drawn from the
         * frame bucket the policy chose.
         *
         * Uniformly among the events actually inside the bucket, falling back to the
         * nearest one when the bucket holds none - which it usually does, since the
         * window is split into 32 buckets and a run may only carry a handful of
         * events. Uniform-within-bucket rather than always-nearest matters more than
         * it looks: with "nearest" the whole operator is deterministic given the
         * bucket, so a policy that had settled on one bucket redrew the same handful
         * of sequences over and over, the dedupe threw nearly all of them away, and
         * threads started running short of work while the search sat still.
         *
         * Reservoir sampling rather than collecting the matches, so a draw on the
         * coordinator thread stays one pass and no allocation.
         */
        _pickEvent(entries, bucket, movableOnly) {
          const wanted = this._frameIn(bucket);
          const lo = this.start + bucket * this.bucketWidth;
          const hi = lo + this.bucketWidth;
          let seen = 0, chosen = -1, nearest = -1, bestGap = Infinity;
          for (let i = 0; i < entries.length; i++) {
            const f = entries[i].frame;
            if (f < this.start || f > this.finish || f >= this._editLimit) continue;
            if (movableOnly) {
              const room = this._roomFor(entries, i);
              if (room.low >= f && room.high <= f) continue;
            }
            const gap = f > wanted ? f - wanted : wanted - f;
            if (gap < bestGap) {
              bestGap = gap;
              nearest = i;
            }
            if (f >= lo && f < hi && this.rng() * ++seen < 1) chosen = i;
          }
          return chosen >= 0 ? chosen : nearest;
        }
        /**
         * How far the event at `index` may move without reordering the sequence,
         * written into `this._roomOut` rather than returned.
         *
         * This is called once per event while looking for the nearest movable one, on
         * every retiming draw, on the coordinator thread every thread is waiting
         * behind. Returning a fresh object from it made breeding a chunk allocate one
         * per event per draw for a pair of numbers.
         */
        _roomFor(entries, index) {
          const item = entries[index];
          const previousFrame = index > 0 ? entries[index - 1].frame : -1;
          const nextFrame = index + 1 < entries.length ? entries[index + 1].frame : Number.MAX_SAFE_INTEGER;
          const room = this._roomOut;
          room.low = Math.max(this.start, previousFrame + 1, item.frame - this.settings.maxTimeDifference);
          room.high = Math.min(this.finish, nextFrame - 1, item.frame + this.settings.maxTimeDifference);
          return room;
        }
        /**
         * Moves the event nearest the chosen frame by the chosen signed amount.
         * Both halves are the policy's: which part of the run to retime, and which
         * way and how far to go.
         */
        _shift(entries, action) {
          if (this.settings.maxTimeDifference < 1) return null;
          const index = this._pickEvent(entries, action.frame, true);
          if (index < 0) return null;
          const source = entries[index];
          const room = this._roomFor(entries, index);
          const delta = this._valueIn(this.shifts[action.shift]);
          let target = Math.max(room.low, Math.min(room.high, source.frame + delta));
          if (target === source.frame) {
            target = delta < 0 ? Math.min(room.high, source.frame + 1) : Math.max(room.low, source.frame - 1);
            if (target === source.frame) return null;
          }
          const out = cloneEntries(entries);
          out[index] = { frame: target, keys: source.keys };
          out.sort((a, b) => a.frame - b.frame);
          return { entries: out, note: "move " + source.frame + "->" + target };
        }
        /** Removes the event nearest the chosen frame, which is what a low-input search wants. */
        _remove(entries, action) {
          const index = this._pickEvent(entries, action.frame, false);
          if (index < 0) return null;
          const removed = entries[index];
          const out = cloneEntries(entries);
          out.splice(index, 1);
          return { entries: out, note: "drop @" + removed.frame };
        }
        /**
         * One-point crossover in time at the chosen frame: events before it come from
         * one parent and events from it onward from the other. Offered as an arm of
         * the recombination head rather than at a fixed rate, so the run's own
         * evidence decides whether splicing works on this track.
         */
        _cross(parent, action) {
          if (this.members.length < 2) return null;
          let other = null;
          for (let attempt = 0; attempt < 4; attempt++) {
            const pick = this._selectParent();
            if (pick && pick !== parent && pick.entries) {
              other = pick;
              break;
            }
          }
          if (!other) return null;
          const split = this._frameIn(action.frame);
          const merged = [];
          for (const e of parent.entries) if (e.frame < split) merged.push({ frame: e.frame, keys: e.keys });
          for (const e of other.entries) if (e.frame >= split) merged.push({ frame: e.frame, keys: e.keys });
          merged.sort((a, b) => a.frame - b.frame);
          return { entries: merged, note: "splice @" + split, otherScore: other.selectionScore };
        }
        /** Produces `count` children ready to be evaluated. */
        breed(count) {
          const out = [];
          if (!this.members.length) return out;
          const eps = this._eps();
          for (const head of this.headList) if (head.dirty) head.refresh(eps);
          const heads = this.heads;
          let guard = 0;
          while (out.length < count && guard++ < count * 8) {
            const parent = this._selectParent();
            if (!parent || !parent.entries) break;
            this._editLimit = this._liveLimit(parent);
            this._liveBucketCount = this._liveBuckets(this._editLimit);
            const actions = [];
            const notes = [];
            let current = parent.entries;
            let reference = parent.selectionScore;
            if (this.canCross && this.members.length > 1) {
              if (heads.recomb.sample(this.rng) === 1) {
                const record = {
                  kind: "recomb",
                  recomb: 1,
                  frame: heads.frame.sampleBelow(this.rng, this._liveBucketCount)
                };
                const applied = this._cross(parent, record);
                if (applied) {
                  current = applied.entries;
                  notes.push(applied.note);
                  if (applied.otherScore > reference) reference = applied.otherScore;
                  actions.push(record);
                }
              } else {
                actions.push({ kind: "recomb", recomb: 0 });
              }
            }
            const countIndex = heads.count.sample(this.rng);
            actions.push({ kind: "count", count: countIndex });
            for (let i = 0; i <= countIndex; i++) {
              const record = { kind: "edit", op: heads.op.sample(this.rng) };
              record.frame = heads.frame.sampleBelow(this.rng, this._liveBucketCount);
              const operator = this.operators[record.op];
              let applied = null;
              if (operator === "insert") {
                record.keys = heads.keys.sample(this.rng);
                record.hold = heads.hold.sample(this.rng);
                applied = this._insert(current, record);
              } else if (operator === "shift") {
                record.shift = heads.shift.sample(this.rng);
                applied = this._shift(current, record);
              } else if (operator === "remove") {
                applied = this._remove(current, record);
              }
              if (!applied) continue;
              actions.push(record);
              current = applied.entries;
              notes.push(applied.note);
            }
            if (!notes.length) continue;
            const compact = compactEntries(current);
            const text = entriesToText(compact);
            if (!text || this.seen.has(text)) continue;
            this.seen.add(text);
            if (this.pending.size < PENDING_LIMIT) {
              this.pending.set(text, {
                entries: compact,
                actions,
                parentScore: reference,
                // The parent, and its value estimate as it stood when the
                // decision was made. See _learn.
                parent,
                parentValue: parent.value != null ? parent.value : this.rewardMean
              });
            }
            this.bred++;
            out.push({
              text,
              entries: compact,
              inputCount: countInputEvents(compact),
              label: notes.join(" | ")
            });
          }
          if (this.seen.size > 4e4) {
            this.seen.clear();
            for (const m of this.members) this.seen.add(m.text);
          }
          return out;
        }
        /**
         * The verdict on one child, as a number a learning rate can be tuned against
         * on any objective.
         *
         * Four tiers, and every one of them is an *absolute* standard rather than a
         * comparison against how much the child resembles its parent. That
         * distinction is the whole design of this function, and getting it wrong the
         * first time cost the search everything it was for:
         *
         *   cut short   it could not reach the weakest kept member's score, so the
         *               archive was never going to take it whatever the exact number
         *               turned out to be.
         *   kept, worse it cleared the bar - which is a real achievement, since the
         *               bar is the standing best few - but did not beat its own
         *               parent.
         *   better      it beat its parent. The size of the gain is scaled against
         *               the run's own recent gains, so a one-frame improvement on a
         *               converged run counts for as much as the first big one did.
         *   inert       below all of them: an edit that changed the inputs and left
         *               the score bit-identical. That is not a failure, it is a
         *               report that this part of the run does not respond to
         *               anything - and it is the one outcome a hill climber cannot
         *               see at all, since to it "no better" is a single verdict.
         *
         * Every failing outcome scores exactly the same, and separating them was
         * measured twice as a mistake, twice in the same direction.
         *
         * The tempting version ranks the losers against each other: nineteen
         * candidates in twenty are cut short on a hard objective, and flattening them
         * looks like throwing the run away. But a candidate is cut at the frame the
         * bar fired its event on, and the number it reports is how close it came by
         * then, so the way to rank high among the cut-short is to end up wherever the
         * parent was going to end up - and the surest way to do that is to barely
         * change the parent at all. The second version dropped the ranking but still
         * scored "cleared the bar" above "cut short", which is the same trap wearing
         * a different hat, because the bar is the weakest kept member and clearing it
         * is exactly what an edit too small to matter does. Both taught the policy
         * the same lesson inside three thousand candidates: it collapsed onto the
         * smallest retiming step allowed, the shortest hold allowed, and the frame
         * buckets nearest the end of the window, where an edit has the least time
         * left to change anything. It had learned to do nothing, carefully.
         *
         * So the only thing that earns a positive reward is beating the parent, and
         * what it earns is proportional to by how much. That makes the quantity the
         * policy climbs the expected size of an improvement rather than the odds of
         * one - which is the correct objective for a search that keeps its best and
         * discards everything else, and the one objective under which a bold edit
         * that fails forty-nine times in fifty and wins big on the fiftieth is worth
         * more than a timid edit that never loses and never gains.
         *
         * Losing candidates say "no". They do not say "nearly", and a search that
         * keeps only its best cannot afford to believe them when they seem to.
         */
        _reward(result, parentScore) {
          if (result.bounded) return FAILED;
          const delta = result.selectionScore - parentScore;
          if (!Number.isFinite(delta)) return FAILED;
          if (delta === 0) {
            this.inert++;
            return INERT;
          }
          if (delta < 0) return FAILED;
          this.gains++;
          this.gainScale = this.gainScale > 0 ? this.gainScale * 0.97 + delta * 0.03 : delta;
          return 1 + Math.min(1.5, this.gainScale > 0 ? delta / this.gainScale : 1);
        }
        /**
         * Applies one child's advantage to every head that helped produce it.
         *
         * The advantage is the reward less what a child of *that particular parent*
         * was expected to earn - a value estimate kept per archive member and updated
         * from its own children, which is the critic half of an actor-critic and the
         * standard way to take the variance out of a policy gradient.
         *
         * It matters more here than it usually does, because the confound it removes
         * is large and systematic. Parents are drawn by rank, so a child is as likely
         * to be bred from the eleventh best sequence as from the best, and improving
         * on the eleventh best is enormously easier than improving on the best.
         * Against one global average, "was bred from a weak parent" swamps "was a good
         * edit", and the policy spends its learning on the difference between parents
         * instead of the difference between edits. Against the parent's own average,
         * an edit is credited with what it added, whichever parent it started from -
         * so a rare improvement on the leader is worth what it should be, and a routine
         * one on a weak member is not mistaken for skill.
         *
         * Nothing divides it by a spread. Normalising by the deviation is the textbook
         * thing to do, and what this did at first, and it is wrong here for a specific
         * reason: with failures at nineteen in twenty the spread is small, so every
         * gain normalises to the clip whatever its size, and the policy goes back to
         * climbing the *odds* of an improvement rather than its size. The rewards are
         * already built to be comparable across objectives (see _reward). The clip is
         * only there to stop one freak result rewriting a head on its own.
         */
        _learn(origin, reward) {
          this.samples++;
          this.rewardMean = this.rewardMean * 0.995 + reward * 5e-3;
          const baseline = origin.parentValue != null ? origin.parentValue : this.rewardMean;
          if (origin.parent) {
            origin.parent.value = (origin.parent.value != null ? origin.parent.value : baseline) * 0.98 + reward * 0.02;
          }
          const advantage = Math.max(-5, Math.min(5, reward - baseline));
          this.advantageScale = this.advantageScale * 0.995 + Math.abs(advantage) * 5e-3;
          const width = this._kernel();
          const heads = this.heads;
          for (const head of this.headList) head.decay(this.forget);
          const rate = this._rateFor.bind(this);
          for (const record of origin.actions) {
            if (record.kind === "recomb") {
              heads.recomb.update(record.recomb, advantage, rate(heads.recomb), 1);
              if (record.frame != null) heads.frame.update(record.frame, advantage, rate(heads.frame), width);
            } else if (record.kind === "count") {
              heads.count.update(record.count, advantage, rate(heads.count), width);
            } else {
              heads.op.update(record.op, advantage, rate(heads.op), 1);
              heads.frame.update(record.frame, advantage, rate(heads.frame), width);
              if (record.keys != null) heads.keys.update(record.keys, advantage, rate(heads.keys), 1);
              if (record.hold != null) heads.hold.update(record.hold, advantage, rate(heads.hold), width);
              if (record.shift != null) heads.shift.update(record.shift, advantage, rate(heads.shift), width);
            }
          }
        }
        /**
         * Folds evaluated children back in and learns from every one of them.
         *
         * The policy update waits until the archive has been rebuilt. Everything the
         * reward depends on is known before the sort except one thing - whether the
         * child is the new all-time best - and the value estimate the advantage is
         * measured against belongs to a parent the sort may be about to drop, so the
         * verdicts are collected on the way through and applied once at the end.
         */
        absorb(results) {
          let improved = false;
          const scored = [];
          const admits = [];
          for (const r of results) {
            if (!r || !r.text) continue;
            const origin = this.pending.get(r.text);
            let reward = null;
            if (origin) {
              this.pending.delete(r.text);
              reward = this._reward(r, origin.parentScore);
            }
            if (!r.bounded) {
              if (r.selectionScore > this.bestScore) {
                this.bestScore = r.selectionScore;
                improved = true;
                if (reward != null) reward += BEST_BONUS;
              }
              admits.push(origin && origin.entries ? Object.assign({}, r, {
                entries: origin.entries,
                value: origin.parentValue != null ? origin.parentValue : this.rewardMean,
                stopFrame: this._stopFrameOf(r)
              }) : Object.assign({}, r, {
                entries: parseEntries(r.text),
                value: this.rewardMean,
                stopFrame: this._stopFrameOf(r)
              }));
            }
            if (reward != null) scored.push({ origin, reward });
          }
          const before = new Set(this.members.map((m) => m.text));
          for (const a of admits) this.members.push(a);
          this.members.sort((a, b) => b.selectionScore - a.selectionScore);
          const kept = [];
          const texts = /* @__PURE__ */ new Set();
          for (const m of this.members) {
            if (texts.has(m.text)) continue;
            texts.add(m.text);
            kept.push(m);
            if (kept.length >= this.size) break;
          }
          this.members = kept;
          for (const m of this.members) {
            if (before.has(m.text)) continue;
            this.seen.add(m.text);
            this.admitted++;
          }
          for (const entry of scored) this._learn(entry.origin, entry.reward);
          this.absorbed += results.length;
          this.absorbedTotal += results.length;
          while (this.absorbed >= this.size) {
            this.absorbed -= this.size;
            this.generation++;
          }
          if (improved) this.staleCandidates = 0;
          else this.staleCandidates += results.length;
          this.stall = Math.min(1, this.staleCandidates / Math.max(1, this.size * this.stallGenerations));
          if (this.smart) this._resize(improved);
          return improved;
        }
        /**
         * A run that is still finding improvements does better spending its slots
         * refining what works than holding variety it is not using, so progress
         * shrinks the archive and a stall grows it back. Same rule and same numbers
         * as the population search, for the reason given where they are declared.
         *
         * Nothing is discarded except by the shrink: members are the only record of
         * what has been found, and the weakest of them is the bound the workers are
         * cutting candidates against.
         */
        _resize(improved) {
          let wanted = this.size;
          if (improved) wanted = Math.max(MIN_ELITES, Math.round(this.size * 0.85));
          else if (this.staleCandidates >= this.size * this.stallGenerations) {
            this.staleCandidates = 0;
            this.stallTrips++;
            wanted = Math.min(MAX_ELITES, Math.round(this.size * 1.5) + 1);
          }
          if (wanted === this.size) return;
          this.size = wanted;
          this.resized++;
          if (this.members.length > this.size) this.members.length = this.size;
        }
        /**
         * Where the policy currently thinks the run is worth editing, as a frame range.
         *
         * Only over the buckets it can actually draw from. The dead tail past the
         * leader's stop frame keeps a high probability in the table - nothing is
         * sampled there, so its optimism bonus never decays - and taking the argmax
         * across the whole head therefore pointed at the one region the search had
         * deliberately stopped touching, in the same sentence that said so.
         */
        _hotFrames() {
          const head = this.heads.frame;
          if (head.n < 2) return null;
          const live = this._liveBuckets(this._liveLimit(this.members[0]));
          const best = head.argmax(live);
          const lo = Math.round(this.start + best * this.bucketWidth);
          const hi = Math.round(this.start + (best + 1) * this.bucketWidth) - 1;
          return { lo, hi: Math.max(lo, hi), share: head.probs[best] };
        }
        stats() {
          return {
            kind: "rl",
            smart: this.smart,
            population: this.members.length,
            size: this.size,
            generation: this.generation,
            samples: this.samples,
            admitted: this.admitted,
            bred: this.bred,
            inert: this.inert,
            gains: this.gains,
            stall: this.stall,
            // Candidates since the last new best, and the threshold they are
            // measured against, so a stuck run says how stuck it is.
            staleCandidates: this.staleCandidates,
            stallAt: this.size * this.stallGenerations,
            stallTrips: this.stallTrips,
            // 0 while the frame head is still uniform, 1 when it has settled on
            // one part of the run.
            focus: 1 - this.heads.frame.entropy(),
            hot: this._hotFrames(),
            crossoverRate: this.canCross && this.members.length > 1 ? this.heads.recomb.probs[1] : 0,
            explorationFloor: this._eps(),
            // The part of the search window that can still change the result, from
            // the leader's own run. Worth showing: a window whose back half is dead
            // is a setting the user can fix, and nothing else in the tool would ever
            // tell them.
            liveTo: this.members.length ? this._liveLimit(this.members[0]) - 1 : null
          };
        }
        /** The progress line, so a running search is not a black box. */
        describe() {
          const st = this.stats();
          const kept = st.bred ? ", " + Math.round(st.admitted / st.bred * 100) + "% kept" : "";
          const where = st.hot ? ", now editing around frames " + st.hot.lo + "-" + st.hot.hi : "";
          const dead = st.inert && st.samples ? ", " + Math.round(st.inert / st.samples * 100) + "% of edits changed nothing" : "";
          const cross = st.crossoverRate > 0 ? ", crossover " + Math.round(st.crossoverRate * 100) + "%" : "";
          const live = st.liveTo != null && st.liveTo < this.finish ? ", inputs after frame " + st.liveTo + " are never read so nothing is spent there" : "";
          return (st.smart ? " Smart reinforcement learning: " : " Reinforcement learning: ") + st.population + " of " + st.size + " elites, learned from " + st.samples + " candidate" + (st.samples === 1 ? "" : "s") + kept + ", policy focus " + Math.round(st.focus * 100) + "%" + where + live + dead + cross + ".";
        }
      };
      module.exports = { RLSearch, Head, logRanges, shiftRanges, operatorsFor, crossoverAllowed };
    }
  });

  // work/polytrack-unified/electron/bruteforce/driver.js
  var require_driver = __commonJS({
    "work/polytrack-unified/electron/bruteforce/driver.js"(exports, module) {
      "use strict";
      var { parseEntries, entriesToText, compactEntries, countInputEvents } = require_tas_text();
      var { makeRng, mutate } = require_search();
      var { Population } = require_genetic();
      var { RLSearch } = require_rl();
      var SearchDriver = class {
        constructor(settings, seed) {
          this.settings = settings;
          this.rng = makeRng(seed >>> 0);
          this.search = settings.searchMode === "genetic" ? new Population(settings, makeRng((seed ^ 1597463007) >>> 0)) : settings.searchMode === "rl" ? new RLSearch(settings, makeRng((seed ^ 2654435769) >>> 0)) : null;
          this.best = null;
          this.baseEntries = null;
          this.improvements = 0;
        }
        get ready() {
          return this.search ? this.search.members.length > 0 : this.baseEntries !== null;
        }
        /** The evaluated baseline becomes generation zero / the first hill to climb. */
        seedBaseline(result) {
          this.best = result;
          const entries = compactEntries(parseEntries(result.text));
          if (this.search) this.search.seed(Object.assign({}, result, { entries }));
          else this.baseEntries = entries;
        }
        /** Produces up to `count` candidates to evaluate. */
        next(count) {
          if (!this.ready) return [];
          if (this.search) return this.search.breed(count);
          const out = [];
          for (let i = 0; i < count; i++) {
            const candidate = mutate(this.baseEntries, this.settings, this.rng);
            if (candidate) out.push(candidate);
          }
          return out;
        }
        /** Folds results back in. Returns true when the best candidate improved. */
        absorb(results) {
          if (this.search) {
            this.search.absorb(results);
            const leader = this.search.best;
            if (leader && (!this.best || leader.selectionScore > this.best.selectionScore)) {
              if (this.best) this.improvements++;
              this.best = leader;
              return true;
            }
            return false;
          }
          let improved = false;
          for (const r of results) {
            if (!r || !r.text) continue;
            if (!this.best || r.selectionScore > this.best.selectionScore) {
              if (this.best) {
                this.improvements++;
                improved = true;
              }
              this.best = r;
              this.baseEntries = compactEntries(parseEntries(r.text));
            }
          }
          return improved;
        }
        stats() {
          if (!this.search) return null;
          return this.search.stats();
        }
        /** The one-line summary of what the chosen search is doing, or "". */
        describe() {
          return this.search ? this.search.describe() : "";
        }
      };
      module.exports = { SearchDriver, entriesToText, countInputEvents };
    }
  });

  // work/polytrack-unified/electron/bruteforce/car-state.js
  var require_car_state = __commonJS({
    "work/polytrack-unified/electron/bruteforce/car-state.js"(exports, module) {
      "use strict";
      var CAR_ID_BYTES = 4;
      function readFlags(raw) {
        return raw[CAR_ID_BYTES + 7];
      }
      function hasFinished(raw) {
        return (readFlags(raw) & 2) !== 0;
      }
      function hasStarted(raw) {
        return (readFlags(raw) & 1) !== 0;
      }
      function readFrames(raw) {
        return raw[CAR_ID_BYTES] | raw[CAR_ID_BYTES + 1] << 8 | raw[CAR_ID_BYTES + 2] << 16;
      }
      var cachedSource = null;
      var cachedView = null;
      function viewFor(raw) {
        if (cachedSource !== raw || cachedView.buffer !== raw.buffer) {
          cachedSource = raw;
          cachedView = new DataView(raw.buffer, raw.byteOffset + CAR_ID_BYTES, raw.byteLength - CAR_ID_BYTES);
        }
        return cachedView;
      }
      function readTransform(raw, out) {
        const view = viewFor(raw);
        const flags = raw[CAR_ID_BYTES + 7];
        let i = 8;
        if (flags & 2) i += 3;
        i += 2;
        out.px = view.getFloat32(i, true);
        out.py = view.getFloat32(i + 4, true);
        out.pz = view.getFloat32(i + 8, true);
        i += 12;
        out.qx = view.getFloat32(i, true);
        out.qy = view.getFloat32(i + 4, true);
        out.qz = view.getFloat32(i + 8, true);
        out.qw = view.getFloat32(i + 12, true);
        return out;
      }
      function readSpeedKmh(raw) {
        return viewFor(raw).getFloat32(3, true);
      }
      function readNextCheckpointIndex(raw) {
        const view = viewFor(raw);
        const flags = raw[CAR_ID_BYTES + 7];
        return view.getUint16(flags & 2 ? 11 : 8, true);
      }
      var OBSERVED_FROM = CAR_ID_BYTES + 3;
      function observedEnd(raw) {
        const flags = raw[CAR_ID_BYTES + 7];
        let i = 8;
        if (flags & 2) i += 3;
        return CAR_ID_BYTES + i + 2 + 12 + 16;
      }
      function sameObservedState(raw, saved, length) {
        for (let i = 0; i < length; i++) if (raw[OBSERVED_FROM + i] !== saved[i]) return false;
        return true;
      }
      function copyObservedState(raw, saved, length) {
        for (let i = 0; i < length; i++) saved[i] = raw[OBSERVED_FROM + i];
      }
      function stateLength(raw) {
        const flags = raw[CAR_ID_BYTES + 7];
        let i = 8;
        if (flags & 2) i += 3;
        i += 2 + 12 + 16;
        i += 1 + 4 * raw[CAR_ID_BYTES + i];
        for (let w = 0; w < 4; w++) if (flags & 8 << w) i += 24;
        i += 64 + 4 + 1;
        return CAR_ID_BYTES + i;
      }
      function readFinishFrames(raw) {
        if (!hasFinished(raw)) return null;
        const b = CAR_ID_BYTES + 8;
        return raw[b] | raw[b + 1] << 8 | raw[b + 2] << 16;
      }
      function decodeCarState(raw) {
        const view = new DataView(raw.buffer, raw.byteOffset + CAR_ID_BYTES, raw.byteLength - CAR_ID_BYTES);
        const bytes = raw.subarray(CAR_ID_BYTES);
        let i = 0;
        const frames = bytes[0] | bytes[1] << 8 | bytes[2] << 16;
        i += 3;
        const speedKmh = view.getFloat32(i, true);
        i += 4;
        const flags = bytes[i];
        const started = (flags & 1) !== 0;
        const finished = (flags & 2) !== 0;
        const hasCheckpointToRespawnAt = (flags & 4) !== 0;
        const wheelHasContact = [(flags & 8) !== 0, (flags & 16) !== 0, (flags & 32) !== 0, (flags & 64) !== 0];
        i += 1;
        let finishFrames = null;
        if (finished) {
          finishFrames = bytes[i] | bytes[i + 1] << 8 | bytes[i + 2] << 16;
          i += 3;
        }
        const nextCheckpointIndex = view.getUint16(i, true);
        i += 2;
        const position = { x: view.getFloat32(i, true), y: view.getFloat32(i + 4, true), z: view.getFloat32(i + 8, true) };
        i += 12;
        const quaternion = {
          x: view.getFloat32(i, true),
          y: view.getFloat32(i + 4, true),
          z: view.getFloat32(i + 8, true),
          w: view.getFloat32(i + 12, true)
        };
        i += 16;
        const impulseCount = bytes[i];
        i += 1;
        const collisionImpulses = [];
        for (let k = 0; k < impulseCount; k++) {
          collisionImpulses.push(view.getFloat32(i, true));
          i += 4;
        }
        const wheelContact = [null, null, null, null];
        for (let k = 0; k < 4; k++) {
          if (!wheelHasContact[k]) continue;
          wheelContact[k] = {
            position: { x: view.getFloat32(i, true), y: view.getFloat32(i + 4, true), z: view.getFloat32(i + 8, true) },
            normal: { x: view.getFloat32(i + 12, true), y: view.getFloat32(i + 16, true), z: view.getFloat32(i + 20, true) }
          };
          i += 24;
        }
        const quad = () => {
          const a = [0, 0, 0, 0];
          for (let k = 0; k < 4; k++) {
            a[k] = view.getFloat32(i, true);
            i += 4;
          }
          return a;
        };
        const wheelSuspensionLength = quad();
        const wheelSuspensionVelocity = quad();
        const wheelDeltaRotation = quad();
        const wheelSkidInfo = quad();
        const steering = view.getFloat32(i, true);
        i += 4;
        const controlBits = bytes[i];
        return {
          frames,
          speedKmh,
          hasStarted: started,
          finishFrames,
          nextCheckpointIndex,
          hasCheckpointToRespawnAt,
          position,
          quaternion,
          collisionImpulses,
          wheelContact,
          wheelSuspensionLength,
          wheelSuspensionVelocity,
          wheelDeltaRotation,
          wheelSkidInfo,
          steering,
          brakeLightEnabled: (controlBits & 32) !== 0,
          controls: {
            up: (controlBits & 1) !== 0,
            right: (controlBits & 2) !== 0,
            down: (controlBits & 4) !== 0,
            left: (controlBits & 8) !== 0,
            reset: (controlBits & 16) !== 0
          }
        };
      }
      module.exports = {
        decodeCarState,
        readTransform,
        readSpeedKmh,
        readFrames,
        stateLength,
        readNextCheckpointIndex,
        readFinishFrames,
        hasFinished,
        hasStarted,
        OBSERVED_FROM,
        observedEnd,
        sameObservedState,
        copyObservedState
      };
    }
  });

  // work/polytrack-unified/electron/bruteforce/geometry.js
  var require_geometry = __commonJS({
    "work/polytrack-unified/electron/bruteforce/geometry.js"(exports, module) {
      "use strict";
      var CAR_MASS_OFFSET_DEFAULT = 0.6;
      var CAR_DETECTOR_CENTER = [0, 0.48, -0.15];
      var CAR_DETECTOR_HALF_EXTENTS = [0.89, 0.22, 1.8];
      var EPS = 1e-6;
      function quatRotate(q, x, y, z, out) {
        const { x: qx, y: qy, z: qz, w: qw } = q;
        const ix = qw * x + qy * z - qz * y;
        const iy = qw * y + qz * x - qx * z;
        const iz = qw * z + qx * y - qy * x;
        const iw = -qx * x - qy * y - qz * z;
        out[0] = ix * qw + iw * -qx + iy * -qz - iz * -qy;
        out[1] = iy * qw + iw * -qy + iz * -qx - ix * -qz;
        out[2] = iz * qw + iw * -qz + ix * -qy - iy * -qx;
        return out;
      }
      function quatToBasis(q, out) {
        const { x, y, z, w } = q;
        const x2 = x + x, y2 = y + y, z2 = z + z;
        const xx = x * x2, xy = x * y2, xz = x * z2;
        const yy = y * y2, yz = y * z2, zz = z * z2;
        const wx = w * x2, wy = w * y2, wz = w * z2;
        out[0] = 1 - (yy + zz);
        out[1] = xy + wz;
        out[2] = xz - wy;
        out[3] = xy - wz;
        out[4] = 1 - (xx + zz);
        out[5] = yz + wx;
        out[6] = xz + wy;
        out[7] = yz - wx;
        out[8] = 1 - (xx + yy);
        return out;
      }
      function eulerToQuaternion(xDeg, yDeg, zDeg) {
        const hx = xDeg * Math.PI / 360, hy = yDeg * Math.PI / 360, hz = zDeg * Math.PI / 360;
        const cx = Math.cos(hx), sx = Math.sin(hx);
        const cy = Math.cos(hy), sy = Math.sin(hy);
        const cz = Math.cos(hz), sz = Math.sin(hz);
        return {
          x: sx * cy * cz + cx * sy * sz,
          y: cx * sy * cz - sx * cy * sz,
          z: cx * cy * sz + sx * sy * cz,
          w: cx * cy * cz - sx * sy * sz
        };
      }
      var Obb = class _Obb {
        constructor(center, halfExtents, basis) {
          this.c = center;
          this.e = halfExtents;
          this.b = basis || new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
        }
        static fromCenterSize(center, size, quaternion) {
          const basis = new Float64Array(9);
          if (quaternion) quatToBasis(quaternion, basis);
          else {
            basis[0] = 1;
            basis[4] = 1;
            basis[8] = 1;
          }
          return new _Obb(
            new Float64Array([center[0], center[1], center[2]]),
            new Float64Array([Math.abs(size[0]) / 2, Math.abs(size[1]) / 2, Math.abs(size[2]) / 2]),
            basis
          );
        }
        axis(i, out) {
          out[0] = this.b[i * 3];
          out[1] = this.b[i * 3 + 1];
          out[2] = this.b[i * 3 + 2];
          return out;
        }
        /** Squared distance from a world point to this box (0 when inside). */
        distanceSquaredToPoint(px, py, pz) {
          const dx = px - this.c[0], dy = py - this.c[1], dz = pz - this.c[2];
          let sum = 0;
          for (let i = 0; i < 3; i++) {
            const d = dx * this.b[i * 3] + dy * this.b[i * 3 + 1] + dz * this.b[i * 3 + 2];
            const excess = Math.abs(d) - this.e[i];
            if (excess > 0) sum += excess * excess;
          }
          return sum;
        }
        containsPoint(px, py, pz) {
          return this.distanceSquaredToPoint(px, py, pz) <= 0;
        }
        /** Closest point on/inside the box to a world point. */
        closestPoint(px, py, pz, out) {
          const dx = px - this.c[0], dy = py - this.c[1], dz = pz - this.c[2];
          out[0] = this.c[0];
          out[1] = this.c[1];
          out[2] = this.c[2];
          for (let i = 0; i < 3; i++) {
            let d = dx * this.b[i * 3] + dy * this.b[i * 3 + 1] + dz * this.b[i * 3 + 2];
            if (d > this.e[i]) d = this.e[i];
            else if (d < -this.e[i]) d = -this.e[i];
            out[0] += d * this.b[i * 3];
            out[1] += d * this.b[i * 3 + 1];
            out[2] += d * this.b[i * 3 + 2];
          }
          return out;
        }
        corners(out) {
          let n = 0;
          for (let sx = -1; sx <= 1; sx += 2)
            for (let sy = -1; sy <= 1; sy += 2)
              for (let sz = -1; sz <= 1; sz += 2) {
                out[n++] = this.c[0] + sx * this.e[0] * this.b[0] + sy * this.e[1] * this.b[3] + sz * this.e[2] * this.b[6];
                out[n++] = this.c[1] + sx * this.e[0] * this.b[1] + sy * this.e[1] * this.b[4] + sz * this.e[2] * this.b[7];
                out[n++] = this.c[2] + sx * this.e[0] * this.b[2] + sy * this.e[1] * this.b[5] + sz * this.e[2] * this.b[8];
              }
          return out;
        }
      };
      var OBB_R = new Float64Array(9);
      var OBB_ABS_R = new Float64Array(9);
      var OBB_T = new Float64Array(3);
      function obbIntersectsObb(a, b) {
        const R = OBB_R, AbsR = OBB_ABS_R;
        for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 3; j++) {
            const v = a.b[i * 3] * b.b[j * 3] + a.b[i * 3 + 1] * b.b[j * 3 + 1] + a.b[i * 3 + 2] * b.b[j * 3 + 2];
            R[i * 3 + j] = v;
            AbsR[i * 3 + j] = Math.abs(v) + EPS;
          }
        }
        const dx = b.c[0] - a.c[0], dy = b.c[1] - a.c[1], dz = b.c[2] - a.c[2];
        const t = OBB_T;
        for (let i = 0; i < 3; i++) t[i] = dx * a.b[i * 3] + dy * a.b[i * 3 + 1] + dz * a.b[i * 3 + 2];
        for (let i = 0; i < 3; i++) {
          const ra2 = a.e[i];
          const rb2 = b.e[0] * AbsR[i * 3] + b.e[1] * AbsR[i * 3 + 1] + b.e[2] * AbsR[i * 3 + 2];
          if (Math.abs(t[i]) > ra2 + rb2) return false;
        }
        for (let j = 0; j < 3; j++) {
          const ra2 = a.e[0] * AbsR[j] + a.e[1] * AbsR[3 + j] + a.e[2] * AbsR[6 + j];
          const rb2 = b.e[j];
          if (Math.abs(t[0] * R[j] + t[1] * R[3 + j] + t[2] * R[6 + j]) > ra2 + rb2) return false;
        }
        const e = a.e, f = b.e;
        let ra, rb, s;
        ra = e[1] * AbsR[6] + e[2] * AbsR[3];
        rb = f[1] * AbsR[2] + f[2] * AbsR[1];
        s = Math.abs(t[2] * R[3] - t[1] * R[6]);
        if (s > ra + rb) return false;
        ra = e[1] * AbsR[7] + e[2] * AbsR[4];
        rb = f[0] * AbsR[2] + f[2] * AbsR[0];
        s = Math.abs(t[2] * R[4] - t[1] * R[7]);
        if (s > ra + rb) return false;
        ra = e[1] * AbsR[8] + e[2] * AbsR[5];
        rb = f[0] * AbsR[1] + f[1] * AbsR[0];
        s = Math.abs(t[2] * R[5] - t[1] * R[8]);
        if (s > ra + rb) return false;
        ra = e[0] * AbsR[6] + e[2] * AbsR[0];
        rb = f[1] * AbsR[5] + f[2] * AbsR[4];
        s = Math.abs(t[0] * R[6] - t[2] * R[0]);
        if (s > ra + rb) return false;
        ra = e[0] * AbsR[7] + e[2] * AbsR[1];
        rb = f[0] * AbsR[5] + f[2] * AbsR[3];
        s = Math.abs(t[0] * R[7] - t[2] * R[1]);
        if (s > ra + rb) return false;
        ra = e[0] * AbsR[8] + e[2] * AbsR[2];
        rb = f[0] * AbsR[4] + f[1] * AbsR[3];
        s = Math.abs(t[0] * R[8] - t[2] * R[2]);
        if (s > ra + rb) return false;
        ra = e[0] * AbsR[3] + e[1] * AbsR[0];
        rb = f[1] * AbsR[8] + f[2] * AbsR[7];
        s = Math.abs(t[1] * R[0] - t[0] * R[3]);
        if (s > ra + rb) return false;
        ra = e[0] * AbsR[4] + e[1] * AbsR[1];
        rb = f[0] * AbsR[8] + f[2] * AbsR[6];
        s = Math.abs(t[1] * R[1] - t[0] * R[4]);
        if (s > ra + rb) return false;
        ra = e[0] * AbsR[5] + e[1] * AbsR[2];
        rb = f[0] * AbsR[7] + f[1] * AbsR[6];
        s = Math.abs(t[1] * R[2] - t[0] * R[5]);
        if (s > ra + rb) return false;
        return true;
      }
      var Sphere = class {
        constructor(center, radius) {
          this.c = center;
          this.r = radius;
        }
        containsPoint(px, py, pz) {
          const dx = px - this.c[0], dy = py - this.c[1], dz = pz - this.c[2];
          return dx * dx + dy * dy + dz * dz <= this.r * this.r;
        }
        distanceSquaredToPoint(px, py, pz) {
          const dx = px - this.c[0], dy = py - this.c[1], dz = pz - this.c[2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - this.r;
          return d > 0 ? d * d : 0;
        }
      };
      function obbIntersectsSphere(box, sphere) {
        return box.distanceSquaredToPoint(sphere.c[0], sphere.c[1], sphere.c[2]) <= sphere.r * sphere.r;
      }
      var ConvexHull = class {
        constructor(triangleVertices, offsetY) {
          const key = (x, y, z) => x.toFixed(5) + "," + y.toFixed(5) + "," + z.toFixed(5);
          const seen = /* @__PURE__ */ new Map();
          const verts = [];
          const src = triangleVertices;
          for (let i = 0; i < src.length; i += 3) {
            const x = src[i], y = src[i + 1] + offsetY, z = src[i + 2];
            const k = key(x, y, z);
            if (!seen.has(k)) {
              seen.set(k, verts.length / 3);
              verts.push(x, y, z);
            }
          }
          this.vertices = new Float64Array(verts);
          this.vertexCount = verts.length / 3;
          const normals = [], edges = [];
          const addUnique = (list, x, y, z) => {
            const len = Math.hypot(x, y, z);
            if (len < 1e-9) return;
            x /= len;
            y /= len;
            z /= len;
            for (let i = 0; i < list.length; i += 3) {
              const d = Math.abs(list[i] * x + list[i + 1] * y + list[i + 2] * z);
              if (d > 1 - 1e-7) return;
            }
            list.push(x, y, z);
          };
          for (let i = 0; i < src.length; i += 9) {
            const ax = src[i], ay = src[i + 1] + offsetY, az = src[i + 2];
            const bx = src[i + 3], by = src[i + 4] + offsetY, bz = src[i + 5];
            const cx = src[i + 6], cy = src[i + 7] + offsetY, cz = src[i + 8];
            const ux = bx - ax, uy = by - ay, uz = bz - az;
            const vx = cx - ax, vy = cy - ay, vz = cz - az;
            addUnique(normals, uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
            addUnique(edges, ux, uy, uz);
            addUnique(edges, vx, vy, vz);
            addUnique(edges, cx - bx, cy - by, cz - bz);
          }
          this.faceNormals = new Float64Array(normals);
          this.edgeDirections = new Float64Array(edges);
          let r = 0;
          for (let i = 0; i < this.vertices.length; i += 3) {
            r = Math.max(r, Math.hypot(this.vertices[i], this.vertices[i + 1], this.vertices[i + 2]));
          }
          this.boundingRadius = r;
        }
      };
      var CarHitbox = class {
        constructor(options) {
          const opts = options || {};
          this.mode = opts.mode || "detector";
          this.massOffset = Number.isFinite(opts.massOffset) ? opts.massOffset : CAR_MASS_OFFSET_DEFAULT;
          this.detectorCenter = opts.detectorCenter || CAR_DETECTOR_CENTER;
          this.detectorHalfExtents = opts.detectorHalfExtents || CAR_DETECTOR_HALF_EXTENTS;
          this.pointRadius = Number.isFinite(opts.pointRadius) ? opts.pointRadius : 0;
          this.hull = null;
          if (this.mode === "hull") {
            if (!opts.collisionShapeVertices) throw new Error("hull hitbox needs the car collision vertices");
            this.hull = new ConvexHull(opts.collisionShapeVertices, this.massOffset);
          }
          this._basis = new Float64Array(9);
          this._obb = new Obb(new Float64Array(3), new Float64Array([
            Math.abs(this.detectorHalfExtents[0]),
            Math.abs(this.detectorHalfExtents[1]),
            Math.abs(this.detectorHalfExtents[2])
          ]), this._basis);
          this._tmp = new Float64Array(3);
          this._ref = new Float64Array(3);
          this._worldVerts = this.hull ? new Float64Array(this.hull.vertices.length) : null;
        }
        /** Reference point used for distance guidance and for point mode. */
        referencePoint(t, out) {
          if (this.mode === "point" || this.mode === "sphere") {
            out[0] = t.px;
            out[1] = t.py;
            out[2] = t.pz;
            return out;
          }
          const c = this.mode === "hull" ? [0, this.massOffset, 0] : this.detectorCenter;
          const v = quatRotate({ x: t.qx, y: t.qy, z: t.qz, w: t.qw }, c[0], c[1], c[2], this._tmp);
          out[0] = t.px + v[0];
          out[1] = t.py + v[1];
          out[2] = t.pz + v[2];
          return out;
        }
        /** Places the detector box in world space for the given car transform. */
        _updateObb(t) {
          const q = { x: t.qx, y: t.qy, z: t.qz, w: t.qw };
          quatToBasis(q, this._basis);
          const c = this.detectorCenter;
          const v = quatRotate(q, c[0], c[1], c[2], this._tmp);
          this._obb.c[0] = t.px + v[0];
          this._obb.c[1] = t.py + v[1];
          this._obb.c[2] = t.pz + v[2];
          return this._obb;
        }
        _updateHull(t) {
          const q = { x: t.qx, y: t.qy, z: t.qz, w: t.qw };
          const src = this.hull.vertices, dst = this._worldVerts, tmp = this._tmp;
          for (let i = 0; i < src.length; i += 3) {
            quatRotate(q, src[i], src[i + 1], src[i + 2], tmp);
            dst[i] = t.px + tmp[0];
            dst[i + 1] = t.py + tmp[1];
            dst[i + 2] = t.pz + tmp[2];
          }
          return dst;
        }
        /** True when the car's geometry intersects the given trigger volume. */
        intersects(t, volume) {
          switch (this.mode) {
            case "point":
              return volume.containsPoint(t.px, t.py, t.pz);
            case "sphere": {
              const r = this.pointRadius;
              return volume.distanceSquaredToPoint(t.px, t.py, t.pz) <= r * r;
            }
            case "hull":
              return volume.intersectsHull(this._updateHull(t), this.hull, t);
            case "detector":
            default:
              return volume.intersectsObb(this._updateObb(t));
          }
        }
        /** Distance from the car's reference point to the volume, for search guidance. */
        distanceTo(t, volume) {
          const p = this.referencePoint(t, this._ref);
          return Math.sqrt(volume.distanceSquaredToPoint(p[0], p[1], p[2]));
        }
      };
      var TriggerVolume = class {
        constructor(spec) {
          this.shape = spec.shape === "sphere" ? "sphere" : "box";
          const center = [Number(spec.center[0]) || 0, Number(spec.center[1]) || 0, Number(spec.center[2]) || 0];
          if (this.shape === "sphere") {
            this.sphere = new Sphere(new Float64Array(center), Math.max(1e-4, Number(spec.radius) || 1));
            this.box = null;
          } else {
            const rot = spec.rotation || [0, 0, 0];
            const q = eulerToQuaternion(Number(rot[0]) || 0, Number(rot[1]) || 0, Number(rot[2]) || 0);
            const size = spec.size || [1, 1, 1];
            this.box = Obb.fromCenterSize(center, [
              Math.max(1e-4, Number(size[0]) || 0),
              Math.max(1e-4, Number(size[1]) || 0),
              Math.max(1e-4, Number(size[2]) || 0)
            ], q);
            this.sphere = null;
          }
          this.center = center;
        }
        containsPoint(x, y, z) {
          return this.shape === "sphere" ? this.sphere.containsPoint(x, y, z) : this.box.containsPoint(x, y, z);
        }
        distanceSquaredToPoint(x, y, z) {
          return this.shape === "sphere" ? this.sphere.distanceSquaredToPoint(x, y, z) : this.box.distanceSquaredToPoint(x, y, z);
        }
        intersectsObb(obb) {
          return this.shape === "sphere" ? obbIntersectsSphere(obb, this.sphere) : obbIntersectsObb(obb, this.box);
        }
        /**
         * Convex hull against this volume. For a sphere it is a closest-point test;
         * for a box it is a separating-axis test over the box axes, the hull's face
         * normals and the cross products of their edge directions, which is exact
         * for two convex polyhedra.
         */
        intersectsHull(worldVerts, hull, t) {
          if (this.shape === "sphere") {
            const s = this.sphere;
            let best = Infinity;
            for (let i = 0; i < worldVerts.length; i += 3) {
              const dx = worldVerts[i] - s.c[0], dy = worldVerts[i + 1] - s.c[1], dz = worldVerts[i + 2] - s.c[2];
              best = Math.min(best, dx * dx + dy * dy + dz * dz);
            }
            if (best <= s.r * s.r) return true;
            return this._hullSphereSeparated(worldVerts, hull, t) === false;
          }
          const box = this.box;
          const q = { x: t.qx, y: t.qy, z: t.qz, w: t.qw };
          const axis = new Float64Array(3);
          const test = (ax, ay, az) => {
            const len = Math.hypot(ax, ay, az);
            if (len < 1e-9) return false;
            ax /= len;
            ay /= len;
            az /= len;
            let lo = Infinity, hi = -Infinity;
            for (let i = 0; i < worldVerts.length; i += 3) {
              const d = worldVerts[i] * ax + worldVerts[i + 1] * ay + worldVerts[i + 2] * az;
              if (d < lo) lo = d;
              if (d > hi) hi = d;
            }
            const c = box.c[0] * ax + box.c[1] * ay + box.c[2] * az;
            let r = 0;
            for (let i = 0; i < 3; i++) {
              r += box.e[i] * Math.abs(box.b[i * 3] * ax + box.b[i * 3 + 1] * ay + box.b[i * 3 + 2] * az);
            }
            return lo > c + r + EPS || hi < c - r - EPS;
          };
          for (let i = 0; i < 3; i++) {
            if (test(box.b[i * 3], box.b[i * 3 + 1], box.b[i * 3 + 2])) return false;
          }
          const fn = hull.faceNormals;
          for (let i = 0; i < fn.length; i += 3) {
            quatRotate(q, fn[i], fn[i + 1], fn[i + 2], axis);
            if (test(axis[0], axis[1], axis[2])) return false;
          }
          const ed = hull.edgeDirections;
          for (let i = 0; i < ed.length; i += 3) {
            quatRotate(q, ed[i], ed[i + 1], ed[i + 2], axis);
            for (let j = 0; j < 3; j++) {
              const bx = box.b[j * 3], by = box.b[j * 3 + 1], bz = box.b[j * 3 + 2];
              if (test(axis[1] * bz - axis[2] * by, axis[2] * bx - axis[0] * bz, axis[0] * by - axis[1] * bx)) return false;
            }
          }
          return true;
        }
        _hullSphereSeparated(worldVerts, hull, t) {
          const q = { x: t.qx, y: t.qy, z: t.qz, w: t.qw };
          const s = this.sphere;
          const axis = new Float64Array(3);
          const fn = hull.faceNormals;
          for (let i = 0; i < fn.length; i += 3) {
            quatRotate(q, fn[i], fn[i + 1], fn[i + 2], axis);
            let hi = -Infinity, lo = Infinity;
            for (let k = 0; k < worldVerts.length; k += 3) {
              const d = worldVerts[k] * axis[0] + worldVerts[k + 1] * axis[1] + worldVerts[k + 2] * axis[2];
              if (d > hi) hi = d;
              if (d < lo) lo = d;
            }
            const c = s.c[0] * axis[0] + s.c[1] * axis[1] + s.c[2] * axis[2];
            if (c - s.r > hi || c + s.r < lo) return true;
          }
          return false;
        }
        describe() {
          if (this.shape === "sphere") {
            return "sphere r=" + this.sphere.r.toFixed(3) + " at " + this.center.map((v) => v.toFixed(2)).join(", ");
          }
          return "box " + this.box.e.map((v) => (v * 2).toFixed(2)).join(" x ") + " at " + this.center.map((v) => v.toFixed(2)).join(", ");
        }
      };
      function slerp(a, b, s, out) {
        let cos = a.qx * b.qx + a.qy * b.qy + a.qz * b.qz + a.qw * b.qw;
        let bx = b.qx, by = b.qy, bz = b.qz, bw = b.qw;
        if (cos < 0) {
          cos = -cos;
          bx = -bx;
          by = -by;
          bz = -bz;
          bw = -bw;
        }
        let k0, k1;
        if (cos > 0.9995) {
          k0 = 1 - s;
          k1 = s;
        } else {
          const theta = Math.acos(cos), sin = Math.sin(theta);
          k0 = Math.sin((1 - s) * theta) / sin;
          k1 = Math.sin(s * theta) / sin;
        }
        out.qx = a.qx * k0 + bx * k1;
        out.qy = a.qy * k0 + by * k1;
        out.qz = a.qz * k0 + bz * k1;
        out.qw = a.qw * k0 + bw * k1;
        out.px = a.px + (b.px - a.px) * s;
        out.py = a.py + (b.py - a.py) * s;
        out.pz = a.pz + (b.pz - a.pz) * s;
        return out;
      }
      module.exports = {
        Obb,
        Sphere,
        ConvexHull,
        CarHitbox,
        TriggerVolume,
        obbIntersectsObb,
        obbIntersectsSphere,
        quatRotate,
        quatToBasis,
        eulerToQuaternion,
        slerp,
        CAR_MASS_OFFSET_DEFAULT,
        CAR_DETECTOR_CENTER,
        CAR_DETECTOR_HALF_EXTENTS
      };
    }
  });

  // work/polytrack-unified/electron/bruteforce/objectives.js
  var require_objectives = __commonJS({
    "work/polytrack-unified/electron/bruteforce/objectives.js"(exports, module) {
      "use strict";
      var { readSpeedKmh, readNextCheckpointIndex, readFinishFrames, hasFinished, hasStarted, readFrames } = require_car_state();
      var { CarHitbox, TriggerVolume, slerp } = require_geometry();
      var REACHED_BAND = 1e9;
      var NO_BOUND = 2147483647;
      function distance(ax, ay, az, bx, by, bz) {
        const dx = ax - bx, dy = ay - by, dz = az - bz;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
      function finishObjective(context, bound) {
        const evalFrame = context.evalFrame;
        let finishFrames = null;
        let bestCheckpoint = 0;
        let lastSpeed = 0;
        let bounded = false;
        let trustCounter = bound < NO_BOUND;
        let lastFrames = -1;
        return {
          // The car's position is never consulted, so the simulator can skip decoding it.
          needsTransform: false,
          observe(frame, raw) {
            const cp = readNextCheckpointIndex(raw);
            if (cp > bestCheckpoint) bestCheckpoint = cp;
            lastSpeed = readSpeedKmh(raw);
            if (hasFinished(raw)) {
              finishFrames = readFinishFrames(raw);
              return true;
            }
            if (trustCounter) {
              const now = readFrames(raw);
              if (now < lastFrames) trustCounter = false;
              else {
                lastFrames = now;
                if (now >= bound) {
                  bounded = true;
                  return true;
                }
              }
            }
            return false;
          },
          result() {
            const score = finishFrames != null ? REACHED_BAND + (evalFrame - finishFrames) : bestCheckpoint * 1e3 + lastSpeed;
            return { bounded, score, state: { finishFrames, nextCheckpointIndex: bestCheckpoint, speedKmh: lastSpeed } };
          }
        };
      }
      function checkpointSpeedObjective(context) {
        let bestCheckpoint = 0, lastSpeed = 0, finishFrames = null;
        const evalFrame = context.evalFrame;
        return {
          needsTransform: false,
          observe(frame, raw) {
            const cp = readNextCheckpointIndex(raw);
            if (cp > bestCheckpoint) bestCheckpoint = cp;
            lastSpeed = readSpeedKmh(raw);
            if (hasFinished(raw) && finishFrames == null) finishFrames = readFinishFrames(raw);
            return false;
          },
          result() {
            let score = bestCheckpoint * 1e4 + lastSpeed;
            if (finishFrames != null) score += REACHED_BAND + (evalFrame - finishFrames);
            return { score, state: { finishFrames, nextCheckpointIndex: bestCheckpoint, speedKmh: lastSpeed } };
          }
        };
      }
      function speedObjective() {
        let last = 0, best = 0, cp = 0, finishFrames = null;
        return {
          needsTransform: false,
          observe(frame, raw) {
            last = readSpeedKmh(raw);
            if (last > best) best = last;
            cp = readNextCheckpointIndex(raw);
            if (hasFinished(raw) && finishFrames == null) finishFrames = readFinishFrames(raw);
            return false;
          },
          result() {
            return { score: last, state: { speedKmh: last, maxSpeedKmh: best, nextCheckpointIndex: cp, finishFrames } };
          }
        };
      }
      function distanceSpeedObjective(context) {
        const target = context.targetPoint || { x: 0, y: 0, z: 0 };
        const w = Math.max(0, Math.min(1, context.distanceWeight != null ? context.distanceWeight : 0.5));
        let closest = Infinity, lastSpeed = 0, cp = 0, finishFrames = null;
        return {
          observe(frame, raw, t) {
            const d = distance(t.px, t.py, t.pz, target.x, target.y, target.z);
            if (d < closest) closest = d;
            lastSpeed = readSpeedKmh(raw);
            cp = readNextCheckpointIndex(raw);
            if (hasFinished(raw) && finishFrames == null) finishFrames = readFinishFrames(raw);
            return false;
          },
          result() {
            const score = (1 - w) * lastSpeed - w * closest;
            return { score, state: { speedKmh: lastSpeed, distanceToTarget: closest, nextCheckpointIndex: cp, finishFrames } };
          }
        };
      }
      function axisObjective(axis, sign) {
        return function(context) {
          let best = -Infinity, lastSpeed = 0, cp = 0, finishFrames = null;
          const key = axis === 0 ? "px" : axis === 1 ? "py" : "pz";
          return {
            observe(frame, raw, t) {
              const v = sign * t[key];
              if (v > best) best = v;
              lastSpeed = readSpeedKmh(raw);
              cp = readNextCheckpointIndex(raw);
              if (hasFinished(raw) && finishFrames == null) finishFrames = readFinishFrames(raw);
              return false;
            },
            result() {
              return { score: best, state: { speedKmh: lastSpeed, nextCheckpointIndex: cp, finishFrames, axisValue: sign * best } };
            }
          };
        };
      }
      function triggerObjective(context, bound) {
        return makeTriggerObjective(context, "earliest", bound);
      }
      function triggerSpeedObjective(context) {
        return makeTriggerObjective(context, "speed", NO_BOUND);
      }
      function triggerTimeSpeedObjective(context) {
        return makeTriggerObjective(context, "time_speed", NO_BOUND);
      }
      function makeTriggerObjective(context, mode, bound) {
        const volume = context.triggerVolume;
        const hitbox = context.carHitbox;
        const evalFrame = context.evalFrame;
        const startFrame = context.startFrame || 0;
        const substeps = Math.max(1, Math.min(16, context.triggerSweepSamples || 1));
        const requireStarted = context.triggerRequireStarted !== false;
        const armFrame = Number.isFinite(context.triggerArmFrame) ? context.triggerArmFrame : -Infinity;
        const boundFrame = mode === "earliest" && bound != null ? bound : NO_BOUND;
        let bounded = false;
        let hitFrame = null;
        let closest = Infinity;
        let closestFrame = -1;
        let lastSpeed = 0, speedAtHit = null, cp = 0, finishFrames = null;
        let hasPrevious = false;
        const previous = { px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
        const lerped = { px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
        const remember = (t) => {
          previous.px = t.px;
          previous.py = t.py;
          previous.pz = t.pz;
          previous.qx = t.qx;
          previous.qy = t.qy;
          previous.qz = t.qz;
          previous.qw = t.qw;
          hasPrevious = true;
        };
        return {
          observe(frame, raw, t) {
            lastSpeed = readSpeedKmh(raw);
            cp = readNextCheckpointIndex(raw);
            if (hasFinished(raw) && finishFrames == null) finishFrames = readFinishFrames(raw);
            if (hitFrame != null) return true;
            if (frame >= boundFrame) {
              bounded = true;
              return true;
            }
            if (frame < armFrame) {
              remember(t);
              return false;
            }
            if (requireStarted && !hasStarted(raw)) {
              remember(t);
              return false;
            }
            if (substeps > 1 && hasPrevious) {
              for (let s = 1; s < substeps; s++) {
                slerp(previous, t, s / substeps, lerped);
                if (hitbox.intersects(lerped, volume)) {
                  hitFrame = frame;
                  speedAtHit = lastSpeed;
                  return true;
                }
              }
            }
            if (hitbox.intersects(t, volume)) {
              hitFrame = frame;
              speedAtHit = lastSpeed;
              return true;
            }
            const d = hitbox.distanceTo(t, volume);
            if (d < closest) {
              closest = d;
              closestFrame = frame;
            }
            remember(t);
            return false;
          },
          result() {
            let score;
            if (hitFrame == null) score = -closest;
            else if (mode === "speed") score = REACHED_BAND + speedAtHit;
            else if (mode === "time_speed") {
              const w = Math.max(0, Math.min(1, Number(context.triggerSpeedWeight) || 0));
              score = REACHED_BAND + (1 - w) * (evalFrame - hitFrame) + w * speedAtHit;
            } else score = REACHED_BAND + (evalFrame - hitFrame);
            return {
              bounded,
              score,
              state: {
                triggerFrame: hitFrame,
                triggerFramesFromStart: hitFrame != null ? hitFrame - startFrame : null,
                distanceToTarget: hitFrame != null ? 0 : closest === Infinity ? null : closest,
                closestFrame: hitFrame != null ? hitFrame : closestFrame,
                speedKmh: hitFrame != null ? speedAtHit : lastSpeed,
                nextCheckpointIndex: cp,
                finishFrames
              }
            };
          }
        };
      }
      function triggerSequenceObjective(context) {
        const stages = context.triggerStages || [];
        const startFrame = context.startFrame || 0;
        let stage = 0, closest = Infinity, closestFrame = -1, lastSpeed = 0;
        let cp = 0, finishFrames = null, completionFrame = null;
        const hitFrames = [];
        let hasPrevious = false;
        const previous = { px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
        const lerped = { px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
        const remember = (t) => {
          previous.px = t.px;
          previous.py = t.py;
          previous.pz = t.pz;
          previous.qx = t.qx;
          previous.qy = t.qy;
          previous.qz = t.qz;
          previous.qw = t.qw;
          hasPrevious = true;
        };
        return {
          observe(frame, raw, t) {
            lastSpeed = readSpeedKmh(raw);
            cp = readNextCheckpointIndex(raw);
            if (hasFinished(raw) && finishFrames == null) finishFrames = readFinishFrames(raw);
            if (!stages.length) return true;
            const current = stages[stage];
            if (frame < current.armFrame || current.requireStarted && !hasStarted(raw)) {
              remember(t);
              return false;
            }
            let hit = current.hitbox.intersects(t, current.volume);
            if (!hit && current.substeps > 1 && hasPrevious) {
              for (let s = 1; s < current.substeps; s++) {
                slerp(previous, t, s / current.substeps, lerped);
                if (current.hitbox.intersects(lerped, current.volume)) {
                  hit = true;
                  break;
                }
              }
            }
            if (hit) {
              hitFrames.push(frame);
              stage++;
              closest = Infinity;
              closestFrame = -1;
              hasPrevious = false;
              if (stage >= stages.length) {
                completionFrame = frame;
                return true;
              }
              return false;
            }
            const d = current.hitbox.distanceTo(t, current.volume);
            if (d < closest) {
              closest = d;
              closestFrame = frame;
            }
            remember(t);
            return false;
          },
          result() {
            const complete = stage >= stages.length && stages.length > 0;
            const score = stage * REACHED_BAND + (complete ? context.evalFrame - completionFrame : -(closest === Infinity ? 1e8 : closest));
            return { score, state: {
              triggersReached: stage,
              triggerCount: stages.length,
              triggerFrames: hitFrames,
              triggerFrame: completionFrame,
              triggerFramesFromStart: completionFrame == null ? null : completionFrame - startFrame,
              distanceToTarget: complete ? 0 : closest === Infinity ? null : closest,
              closestFrame,
              speedKmh: lastSpeed,
              nextCheckpointIndex: cp,
              finishFrames
            } };
          }
        };
      }
      var REGISTRY = {
        finish: { label: "Finish time", create: finishObjective },
        checkpoint_speed: { label: "Checkpoint + speed", create: checkpointSpeedObjective },
        speed: { label: "Max speed", create: speedObjective },
        distance_speed: { label: "Distance + speed", create: distanceSpeedObjective },
        x: { label: "Max X", create: axisObjective(0, 1) },
        "-x": { label: "Min X", create: axisObjective(0, -1) },
        y: { label: "Max Y", create: axisObjective(1, 1) },
        "-y": { label: "Min Y", create: axisObjective(1, -1) },
        z: { label: "Max Z", create: axisObjective(2, 1) },
        "-z": { label: "Min Z", create: axisObjective(2, -1) },
        trigger: { label: "Trigger (earliest frame)", create: triggerObjective },
        trigger_speed: { label: "Trigger (most speed)", create: triggerSpeedObjective },
        trigger_time_speed: { label: "Trigger (time + speed)", create: triggerTimeSpeedObjective },
        trigger_sequence: { label: "Sequential triggers", create: triggerSequenceObjective }
      };
      function hasObjective(id) {
        return Object.prototype.hasOwnProperty.call(REGISTRY, id);
      }
      function isTriggerObjective(id) {
        return id === "trigger" || id === "trigger_speed" || id === "trigger_time_speed" || id === "trigger_sequence";
      }
      function makeTriggerStage(trigger, assets) {
        return {
          volume: new TriggerVolume({
            shape: trigger.shape || "box",
            center: trigger.center || [0, 0, 0],
            size: trigger.size || [4, 4, 4],
            rotation: trigger.rotation || [0, 0, 0],
            radius: trigger.radius
          }),
          hitbox: new CarHitbox({
            mode: trigger.hitbox || "detector",
            massOffset: assets.carMassOffset,
            collisionShapeVertices: assets.carCollisionShapeVertices,
            pointRadius: trigger.pointRadius
          }),
          substeps: Math.max(1, Math.min(16, trigger.sweepSamples || 1)),
          requireStarted: trigger.requireStarted !== false,
          armFrame: Number.isFinite(trigger.armFrame) ? trigger.armFrame : -Infinity
        };
      }
      function buildContext(settings, assets) {
        const context = {
          evalFrame: settings.evalFrame,
          startFrame: settings.start,
          targetPoint: settings.targetPoint,
          distanceWeight: settings.distanceWeight,
          triggerSpeedWeight: settings.triggerSpeedWeight
        };
        const configured = Array.isArray(settings.triggers) ? settings.triggers : [];
        if (settings.invalidationTriggersEnabled) {
          context.invalidationStages = configured.filter((t) => t && t.enabled !== false && t.invalidating === true).map((t) => {
            const stage = makeTriggerStage(t, assets);
            stage.requireStarted = t.requireStarted === true;
            stage.name = String(t.name || "Invalidation trigger");
            return stage;
          });
        }
        if (isTriggerObjective(settings.objective)) {
          const enabled = configured.filter((t) => t && t.enabled !== false && t.invalidating !== true);
          if (settings.objective === "trigger_sequence") {
            context.triggerStages = enabled.map((t) => makeTriggerStage(t, assets));
          } else {
            const selected = settings.trigger;
            const trigger = selected && selected.enabled !== false && selected.invalidating !== true ? selected : enabled[0] || {};
            const stage = makeTriggerStage(trigger, assets);
            context.triggerVolume = stage.volume;
            context.carHitbox = stage.hitbox;
            context.triggerSweepSamples = stage.substeps;
            context.triggerRequireStarted = stage.requireStarted;
            context.triggerArmFrame = stage.armFrame;
          }
        }
        return context;
      }
      function createObjective(id, context, bound) {
        const entry = REGISTRY[id];
        if (!entry) throw new Error("Unknown bruteforce objective: " + id);
        const base = entry.create(context, bound == null ? NO_BOUND : bound);
        const invalidationStages = context.invalidationStages || [];
        if (!invalidationStages.length) return base;
        let invalidated = null;
        let hasPrevious = false;
        const previous = { px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
        const lerped = { px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
        function remember(t) {
          previous.px = t.px;
          previous.py = t.py;
          previous.pz = t.pz;
          previous.qx = t.qx;
          previous.qy = t.qy;
          previous.qz = t.qz;
          previous.qw = t.qw;
          hasPrevious = true;
        }
        return {
          needsTransform: true,
          observe(frame, raw, t) {
            for (let i = 0; i < invalidationStages.length; i++) {
              const stage = invalidationStages[i];
              if (frame < stage.armFrame || stage.requireStarted && !hasStarted(raw)) continue;
              let hit = stage.hitbox.intersects(t, stage.volume);
              if (!hit && stage.substeps > 1 && hasPrevious) {
                for (let s = 1; s < stage.substeps; s++) {
                  slerp(previous, t, s / stage.substeps, lerped);
                  if (stage.hitbox.intersects(lerped, stage.volume)) {
                    hit = true;
                    break;
                  }
                }
              }
              if (hit) {
                invalidated = { index: i, name: stage.name, frame };
                return true;
              }
            }
            const stop = base.observe(frame, raw, t);
            remember(t);
            return stop;
          },
          result() {
            const result = base.result();
            if (!invalidated) return result;
            result.score = -1e300;
            result.state = Object.assign({}, result.state || {}, {
              invalidated: true,
              invalidationTrigger: invalidated.name,
              invalidationTriggerIndex: invalidated.index,
              invalidationFrame: invalidated.frame
            });
            return result;
          }
        };
      }
      function supportsBound(id) {
        return id === "finish" || id === "trigger";
      }
      function boundFrameFor(settings, bestSelectionScore, inputCount) {
        if (!Number.isFinite(bestSelectionScore)) return NO_BOUND;
        let target = bestSelectionScore;
        if (settings.mutationMode === "lis") {
          const w = Math.max(0, Math.min(1, settings.lisWeight != null ? settings.lisWeight : 0.5));
          if (w >= 1) return NO_BOUND;
          target = (target + w * inputCount) / (1 - w);
        }
        const bound = settings.evalFrame + REACHED_BAND - target;
        if (!(bound > 0)) return 0;
        return bound < NO_BOUND ? bound : NO_BOUND;
      }
      var _scoreF64 = new Float64Array(1);
      var _scoreI64 = new BigInt64Array(_scoreF64.buffer);
      function scoreToBits(value) {
        _scoreF64[0] = value;
        return _scoreI64[0];
      }
      function bitsToScore(bits) {
        _scoreI64[0] = bits;
        return _scoreF64[0];
      }
      module.exports = {
        REGISTRY,
        hasObjective,
        isTriggerObjective,
        buildContext,
        createObjective,
        supportsBound,
        boundFrameFor,
        scoreToBits,
        bitsToScore,
        REACHED_BAND,
        NO_BOUND
      };
    }
  });

  // work/polytrack-unified/electron/bruteforce/browser-normalize.js
  var require_browser_normalize = __commonJS({
    "work/polytrack-unified/electron/bruteforce/browser-normalize.js"(exports, module) {
      "use strict";
      var { hasObjective } = require_objectives();
      function clampInt(value, min, max, fallback) {
        const n = parseInt(value, 10);
        return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
      }
      function normalizeSettings(raw) {
        const s = raw || {}, start = clampInt(s.start, 0, 5999999, 0), finish = clampInt(s.finish, start, 5999999, start + 30);
        const stepMin = clampInt(s.stepMin, 1, 1e5, 1), stepMax = Math.max(stepMin, clampInt(s.stepMax, 1, 1e5, stepMin));
        const holdMin = clampInt(s.holdMin, 1, 1e5, 8), holdMax = Math.max(holdMin, clampInt(s.holdMax, 1, 1e5, holdMin));
        const objective = String(s.objective || "checkpoint_speed"), keysets = Array.isArray(s.keysets) ? s.keysets.slice() : [], mutationMode = String(s.mutationMode || "inputs_timing");
        if (!hasObjective(objective)) throw Error("Unknown bruteforce objective: " + objective);
        if (mutationMode !== "timing_only" && mutationMode !== "lis" && !keysets.length) throw Error("An input-changing mutation mode needs at least one keyset.");
        return { start, finish, evalFrame: clampInt(s.evalFrame, start + 1, 5999999, finish + 120), step: { min: stepMin, max: stepMax }, hold: { min: holdMin, max: holdMax }, maxChangedInputs: clampInt(s.maxChangedInputs, 1, 100, 1), maxTimeDifference: clampInt(s.maxTimeDifference, 0, 1e5, 5), mutationMode, batchSize: clampInt(s.batchSize, 1, 4096, 48), keysets, objective, distanceWeight: Number.isFinite(Number(s.distanceWeight)) ? Number(s.distanceWeight) : 0.5, triggerSpeedWeight: Number.isFinite(Number(s.triggerSpeedWeight)) ? Number(s.triggerSpeedWeight) : 0.5, lisWeight: Number.isFinite(Number(s.lisWeight)) ? Number(s.lisWeight) : 0.5, targetPoint: s.targetPoint || { x: 0, y: 0, z: 0 }, trigger: s.trigger || null, triggers: Array.isArray(s.triggers) ? s.triggers : [], invalidationTriggersEnabled: s.invalidationTriggersEnabled === true, seed: clampInt(s.seed, 0, 2147483647, Date.now() & 2147483647), boundedEval: s.boundedEval !== false, skipRepeats: s.skipRepeats !== false, stallFrames: clampInt(s.stallFrames, 0, 1e5, 0), searchMode: ["genetic", "rl"].includes(s.searchMode) ? s.searchMode : "random", populationSize: clampInt(s.populationSize, 4, 256, 24), crossoverRate: Number.isFinite(Number(s.crossoverRate)) ? Number(s.crossoverRate) : 0.6, smartPopulation: s.smartPopulation === true, focusPopulation: s.focusPopulation === true, focusLearn: s.focusLearn !== false, stallGenerations: s.stallGenerations == null ? null : Math.max(1, Number(s.stallGenerations) || 1), rlElites: clampInt(s.rlElites, 1, 48, 16), rlExploration: Number.isFinite(Number(s.rlExploration)) ? Math.max(0, Math.min(1, Number(s.rlExploration))) : 0.3, smartRl: s.smartRl !== false };
      }
      module.exports = { normalizeSettings };
    }
  });

  // work/polytrack-unified/electron/bruteforce/renderer-backend.js
  var require_renderer_backend = __commonJS({
    "work/polytrack-unified/electron/bruteforce/renderer-backend.js"(exports, module) {
      "use strict";
      var { SearchDriver } = require_driver();
      var { parseEntries } = require_tas_text();
      var { normalizeSettings } = require_browser_normalize();
      var CANCEL_DEADLINE_MS = 1500;
      var RendererBackend = class {
        /**
         * @param {object} options
         *   runId, baseText, settings
         *   send(channel, payload)   delivers a request to the game renderer
         *   onProgress / onResult
         */
        constructor(options) {
          this.runId = options.runId;
          this.baseText = String(options.baseText || "");
          const rawSettings = options.settings || {};
          this.settings = normalizeSettings(rawSettings);
          this.settings.vanillaConcurrency = rawSettings.vanillaConcurrency;
          this.send = options.send;
          this.onProgress = options.onProgress || (() => {
          });
          this.onResult = options.onResult || (() => {
          });
          this.driver = new SearchDriver(this.settings, this.settings.seed);
          this.concurrency = Math.max(1, Math.min(32, this.settings.vanillaConcurrency || 6));
          this.batchId = 0;
          this.inFlight = 0;
          this.tested = 0;
          this.wave = 0;
          this.improvements = 0;
          this.physicsFrames = 0;
          this.startedAt = 0;
          this.best = null;
          this.cancelled = false;
          this.finished = false;
          this.ready = false;
          this._sinceRound = 0;
          this._progressTimer = null;
          this._cancelTimer = null;
          if (!parseEntries(this.baseText).length) throw new Error("The base TAS contains no input events.");
          if (this.settings.evalFrame <= this.settings.start) throw new Error("Evaluate at frame must be later than the start frame.");
        }
        start() {
          this.startedAt = Date.now();
          this.onProgress({
            runId: this.runId,
            status: "running",
            done: 0,
            message: "Starting the vanilla backend: candidates are simulated by the game's own simulation workers, " + this.concurrency + " at a time."
          });
          this._dispatch([{ text: this.baseText, label: "Original TAS baseline" }], true);
          this._progressTimer = setInterval(() => this._emitProgress(false), 500);
          if (this._progressTimer.unref) this._progressTimer.unref();
        }
        _dispatch(candidates, isBaseline) {
          if (!candidates.length) return;
          this.inFlight++;
          this.send("tas-tool-vanilla-eval", {
            runId: this.runId,
            batchId: ++this.batchId,
            isBaseline: !!isBaseline,
            evalFrame: this.settings.evalFrame,
            startFrame: this.settings.start,
            objective: this.settings.objective,
            distanceWeight: this.settings.distanceWeight,
            targetPoint: this.settings.targetPoint,
            trigger: this.settings.trigger,
            mutationMode: this.settings.mutationMode,
            lisWeight: this.settings.lisWeight,
            candidates: candidates.map((c) => ({ text: c.text, label: c.label || "" }))
          });
        }
        /** Called by main when the renderer returns a scored batch. */
        handleResults(message) {
          if (this.finished || !message || message.runId !== this.runId) return;
          this.inFlight--;
          if (message.error) {
            this._fail(String(message.error));
            return;
          }
          const results = Array.isArray(message.results) ? message.results : [];
          this.tested += results.length;
          this._sinceRound += results.length;
          this.physicsFrames += message.physicsFrames || 0;
          let improved;
          if (!this.driver.ready) {
            if (results.length) {
              this.driver.seedBaseline(results[0]);
              this.best = results[0];
              this.ready = true;
            }
            improved = false;
          } else {
            improved = this.driver.absorb(results);
            if (this.driver.best) this.best = this.driver.best;
            this.improvements = this.driver.improvements;
          }
          if (this._sinceRound >= this.settings.batchSize) {
            this._sinceRound = 0;
            this.wave++;
          }
          if (improved) this._emitProgress(true);
          if (this.cancelled) {
            if (this.inFlight === 0) this._finish("cancelled");
            return;
          }
          this._pump();
        }
        _pump() {
          if (this.cancelled || this.finished || !this.driver.ready) return;
          const perBatch = Math.max(1, Math.ceil(this.settings.batchSize / this.concurrency));
          while (this.inFlight < this.concurrency) {
            const candidates = this.driver.next(perBatch);
            if (!candidates.length) break;
            this._dispatch(candidates, false);
          }
        }
        /** The sequences the search is holding, best first. See BruteforceEngine.snapshot. */
        snapshot() {
          const search = this.driver && this.driver.search;
          const members = search && search.members || [];
          return {
            runId: this.runId,
            mode: this.settings.searchMode,
            backend: "vanilla",
            running: !this.finished,
            tested: this.tested,
            wave: this.wave,
            improvements: this.improvements,
            note: this.driver ? this.driver.describe().trim() : "",
            keepsArchive: !!search,
            elites: members.map((m, index) => ({
              rank: index + 1,
              text: m.text,
              label: m.label || null,
              score: m.score,
              selectionScore: m.selectionScore,
              inputCount: m.inputCount,
              state: m.state || null
            }))
          };
        }
        _rates() {
          const seconds = Math.max(1e-3, (Date.now() - this.startedAt) / 1e3);
          return {
            candidatesPerSecond: this.tested / seconds,
            physicsFramesPerSecond: this.physicsFrames / seconds
          };
        }
        _emitProgress(improved) {
          if (this.finished) return;
          const rates = this._rates();
          this.onProgress({
            runId: this.runId,
            status: "running",
            done: this.tested,
            wave: this.wave,
            improvements: this.improvements,
            threads: this.concurrency,
            candidatesPerSecond: rates.candidatesPerSecond,
            physicsFramesPerSecond: rates.physicsFramesPerSecond,
            best: this.best,
            message: (improved ? "New best accepted. " : "") + "Vanilla backend running; the game's own simulation workers are simulating " + this.concurrency + " candidates at a time from frame 0." + this.driver.describe()
          });
        }
        cancel() {
          if (this.finished) return;
          this.cancelled = true;
          this.send("tas-tool-vanilla-cancel", { runId: this.runId });
          if (this.inFlight === 0) {
            this._finish("cancelled");
            return;
          }
          if (!this._cancelTimer) {
            this._cancelTimer = setTimeout(() => this._finish("cancelled"), CANCEL_DEADLINE_MS);
            if (this._cancelTimer.unref) this._cancelTimer.unref();
          }
        }
        _fail(message) {
          if (this.finished) return;
          this.finished = true;
          this._cleanup();
          this.onResult({ runId: this.runId, status: "error", message, done: this.tested });
        }
        _finish(status) {
          if (this.finished) return;
          this.finished = true;
          const rates = this._rates();
          this._cleanup();
          this.onResult({
            runId: this.runId,
            status,
            done: this.tested,
            best: this.best,
            candidatesPerSecond: rates.candidatesPerSecond,
            physicsFramesPerSecond: rates.physicsFramesPerSecond
          });
        }
        _cleanup() {
          if (this._progressTimer) {
            clearInterval(this._progressTimer);
            this._progressTimer = null;
          }
          if (this._cancelTimer) {
            clearTimeout(this._cancelTimer);
            this._cancelTimer = null;
          }
        }
      };
      module.exports = { RendererBackend };
    }
  });

  // work/browser-search-entry.cjs
  var require_browser_search_entry = __commonJS({
    "work/browser-search-entry.cjs"() {
      window.HikisWebSearch = require_renderer_backend();
    }
  });
  require_browser_search_entry();
})();

/*
  DrumGen Generator — Max for Live (Live 12)            phase 2
  Runs inside [js dg_generator.js] in a Max MIDI Effect on your drum track.

  Arrangement target (default): generates over the Arrangement loop brace.
    - reads MIDI clips on other tracks inside the loop
    - merges audio onsets from DrumGen Listener devices (receive name: dg_onsets)
    - optional: splits the loop at locators into sections, energy per section
    - writes the clip(s) onto this track (built in a Session slot, then copied in)
  Session target: as phase 1, writes into the selected scene's slot.

  Written as ES5 for the classic [js] object.
*/
autowatch = 1;
inlets = 1;
outlets = 2; // 0: status text, 1: seed (display update)

var P = {
    energy: 0.5, swing: 0, complexity: 0.4, humanize: 0.3, feel: 0.2, follow: 0.5,
    seed: 1, bars: 0, swingGrid: 16, style: "backbeat", target: "arrangement",
    sections: false, keepTakes: false
};
var LOCK = { kick: false, snare: false, hats: false, fills: false };
var MAP = { kick: 36, sidestick: 37, snare: 38, chh: 42, ohh: 46, crash: 49, tomhi: 50, tommid: 47, tomlow: 45 };
var BAR_CHOICES = [0, 1, 2, 4, 8]; // Session only; 0 = auto

var STYLE_NAMES = ["backbeat", "fourfloor", "halftime", "breakbeat", "trap"];
var STYLES = {
    backbeat:  { snare: "24", kick: "follow", hats: "normal",  ghost: 1.0 },
    fourfloor: { snare: "24", kick: "four",   hats: "offbeat", ghost: 0.4 },
    halftime:  { snare: "3",  kick: "follow", hats: "normal",  ghost: 1.0 },
    breakbeat: { snare: "24", kick: "break",  hats: "normal",  ghost: 1.6 },
    trap:      { snare: "3",  kick: "follow", hats: "trap",    ghost: 0.0 }
};

// one-beat rhythm cells for fills, indexed by hits per beat (16th grid)
var FILL_CELLS = {
    1: [[1, 0, 0, 0]],
    2: [[1, 0, 1, 0], [1, 0, 0, 1]],
    3: [[1, 0, 1, 1], [1, 1, 0, 1], [1, 1, 1, 0]],
    4: [[1, 1, 1, 1]]
};

// locator names -> energy offset (first match wins). "E70" in a name sets energy outright.
var SECTION_WORDS = [
    ["intro", -0.25], ["verse", -0.1], ["pre", 0.05], ["chorus", 0.25], ["hook", 0.25],
    ["drop", 0.3], ["bridge", -0.05], ["breakdown", -0.3], ["break", -0.3], ["outro", -0.25]
];

var listening = false;
var captured = [];          // { track, role, beat, vel }   beat = absolute song time
var listenFirst = null;
var listenLast = null;

// ---------------------------------------------------------------- params
function energy(v)     { P.energy = clamp(v / 100, 0, 1); }
function swing(v)      { P.swing = clamp(v / 100, 0, 1); }
function complexity(v) { P.complexity = clamp(v / 100, 0, 1); }
function humanize(v)   { P.humanize = clamp(v / 100, 0, 1); }
function feel(v)       { P.feel = clamp(v / 100, 0, 1); }
function follow(v)     { P.follow = clamp(v / 100, 0, 1); }
function seed(v)       { P.seed = Math.max(0, Math.floor(v)); }
// menus may send their index (left outlet) or their item text (middle outlet); accept both
function bars(i) {
    var t = String(i).toLowerCase();
    if (t === "auto") P.bars = 0;
    else if (isNaN(parseFloat(i))) return;
    else P.bars = BAR_CHOICES[clamp(Math.floor(i), 0, BAR_CHOICES.length - 1)];
}
function swinggrid(i) {
    var t = String(i).toLowerCase();
    if (t.indexOf("8") === 0) P.swingGrid = 8;
    else if (t.indexOf("16") === 0) P.swingGrid = 16;
    else P.swingGrid = Math.floor(i) === 1 ? 8 : 16;
}
function style(i) {
    var t = String(i).toLowerCase().replace(/[^a-z0-9]/g, "");
    var k = STYLE_NAMES.indexOf(t);
    if (k < 0 && !isNaN(parseFloat(i))) k = clamp(Math.floor(i), 0, STYLE_NAMES.length - 1);
    if (k < 0) { status("Unknown style: " + i); return; }
    P.style = STYLE_NAMES[k];
    status("Style: " + P.style);
}
function target(i) {
    var t = String(i).toLowerCase();
    if (t === "session" || t === "arrangement") P.target = t;
    else P.target = Math.floor(i) === 1 ? "session" : "arrangement";
    status("Target: " + P.target);
}

// "state" prints every current setting to the status box and Max Console
function state() {
    status("style " + P.style + ", target " + P.target + ", energy " + Math.round(P.energy * 100) +
           ", complexity " + Math.round(P.complexity * 100) + ", follow " + Math.round(P.follow * 100) +
           ", feel " + Math.round(P.feel * 100) + ", seed " + P.seed +
           ", locks " + (LOCK.kick ? "K" : "") + (LOCK.snare ? "S" : "") + (LOCK.hats ? "H" : "") + (LOCK.fills ? "F" : "") +
           ", sections " + (P.sections ? "on" : "off") + ", takes " + (P.keepTakes ? "on" : "off"));
}
function sections(v)   { P.sections = !!v; }
function keeptakes(v)  { P.keepTakes = !!v; }

// "lock kick 1", "lock hats 0" ...
function lock(name, v) {
    name = String(name);
    if (LOCK.hasOwnProperty(name)) LOCK[name] = !!v;
    else status("Unknown lock: " + name);
}

// remap a drum voice to a pad note, e.g. "map kick 36"
function map(name, pitch) {
    if (MAP.hasOwnProperty(name)) {
        MAP[name] = clamp(Math.floor(pitch), 0, 127);
        status(name + " -> " + MAP[name]);
    } else {
        status("Unknown voice: " + name);
    }
}

// ---------------------------------------------------------------- listening
function listen(v) {
    if (v) {
        listening = true;
        captured = [];
        listenFirst = null;
        listenLast = null;
        status("Listening - play the section through at least once");
    } else {
        if (!listening) return;   // ignore the off state sent at load
        listening = false;
        status("Captured " + captured.length + " onsets over " + listenedBars() + " bars");
    }
}

// from Listener devices: onset <trackId> <role> <beat> <velocity>
function onset(trackId, role, beat, vel) {
    if (!listening) return;
    captured.push({ track: parseInt(trackId, 10), role: String(role), beat: parseFloat(beat), vel: parseFloat(vel) });
    if (listenFirst === null || beat < listenFirst) listenFirst = beat;
    if (listenLast === null || beat > listenLast) listenLast = beat;
}

function listenedBars() {
    if (listenFirst === null) return 0;
    var barBeats = 4;
    try {
        var song = new LiveAPI("live_set");
        barBeats = num(song, "signature_numerator") * 4 / num(song, "signature_denominator");
    } catch (e) { }
    return Math.round((listenLast - listenFirst) / barBeats * 10) / 10;
}

// ---------------------------------------------------------------- actions
function generate() {
    try {
        doGenerate();
    } catch (e) {
        status("Error: " + e.message);
    }
}

function newvariation() {
    P.seed = (P.seed + 1) % 256;   // live.numbox Int max is 255
    outlet(1, P.seed);
    generate();
}

function doGenerate() {
    var song = new LiveAPI("live_set");
    var ctx = { song: song };
    ctx.barBeats = num(song, "signature_numerator") * 4 / num(song, "signature_denominator");
    ctx.tempo = num(song, "tempo") || 120;

    ctx.selfIdx = trackIndexById(song, ownTrackId());
    if (ctx.selfIdx < 0) { status("Can't find this device's track"); return; }
    if (num(new LiveAPI(trackPath(ctx.selfIdx)), "has_midi_input") !== 1) { status("Put DrumGen on a MIDI track"); return; }

    // tracks that sent audio onsets are analysed from audio only
    ctx.listened = {};
    for (var c = 0; c < captured.length; c++) ctx.listened[captured[c].track] = true;

    if (P.target === "session") generateSession(ctx);
    else generateArrangement(ctx);
}

// ---------------------------------------------------------------- Arrangement
function generateArrangement(ctx) {
    var song = ctx.song, bb = ctx.barBeats;
    var rStart = num(song, "loop_start");
    var rLenRaw = num(song, "loop_length");
    if (!(rLenRaw > 0)) { status("Set the Arrangement loop brace over the section to generate"); return; }
    var nb = Math.max(1, Math.round(rLenRaw / bb));
    var rLen = nb * bb;
    var adjusted = Math.abs(rLen - rLenRaw) > 1e-3;

    var secs = P.sections ? splitSections(song, rStart, rLen, bb)
                          : [{ start: rStart, len: rLen, name: "", energy: P.energy }];

    // source MIDI notes across the whole region (relative to rStart)
    var src = [];
    var tcount = song.getcount("tracks");
    for (var i = 0; i < tcount; i++) {
        if (i === ctx.selfIdx) continue;
        var t = new LiveAPI(trackPath(i));
        if (num(t, "mute") === 1 || num(t, "is_foldable") === 1) continue;
        if (ctx.listened[parseInt(t.id, 10)]) continue;
        if (num(t, "has_midi_input") !== 1) continue;
        src = src.concat(collectArrangementNotes(i, rStart, rLen));
    }
    var ons = [];
    for (var a = 0; a < captured.length; a++) {
        var rel = captured[a].beat - rStart;
        if (rel >= -0.02 && rel < rLen) ons.push({ role: captured[a].role, pos: Math.max(0, rel), vel: captured[a].vel });
    }

    var anyLock = LOCK.kick || LOCK.snare || LOCK.hats || LOCK.fills;
    var written = 0, failed = 0, hits = 0;
    for (var k = 0; k < secs.length; k++) {
        var sec = secs[k];
        var off = sec.start - rStart;
        var sn = [], so = [], j;
        for (j = 0; j < src.length; j++) {
            if (src[j].start >= off && src[j].start < off + sec.len) sn.push(shiftNote(src[j], -off));
        }
        for (j = 0; j < ons.length; j++) {
            if (ons[j].pos >= off && ons[j].pos < off + sec.len) so.push({ role: ons[j].role, pos: ons[j].pos - off, vel: ons[j].vel });
        }
        var A = analyse(sn, so, sec.len);
        var existing = anyLock ? collectArrangementNotes(ctx.selfIdx, sec.start, sec.len) : [];
        var notes = generateBlock(ctx, A, sec.len, sec.energy, existing, k);
        hits += notes.length;
        if (writeArrangementClip(ctx, sec.start, sec.len, notes, clipName(sec))) written++;
        else failed++;
    }

    var msg = "Wrote " + written + " clip" + (written === 1 ? "" : "s") + " over " + nb + " bars, " + hits + " hits (" +
              src.length + " MIDI notes, " + ons.length + " audio onsets) seed " + P.seed;
    if (adjusted) msg += " - loop rounded to whole bars";
    if (ctx.backups) msg += " - your existing drum clip was backed up to Session View";
    if (failed) msg = "Couldn't place " + failed + " clip(s) in the Arrangement; they're in Session View on this track. " + msg;
    status(msg);
}

function splitSections(song, rStart, rLen, bb) {
    var rEnd = rStart + rLen;
    var cps = [];
    var n = song.getcount("cue_points");
    for (var i = 0; i < n; i++) {
        var cp = new LiveAPI("live_set cue_points " + i);
        cps.push({ time: num(cp, "time"), name: str(cp, "name") });
    }
    cps.sort(function (x, y) { return x.time - y.time; });

    var bounds = [rStart];
    for (i = 0; i < cps.length; i++) {
        var snap = rStart + Math.round((cps[i].time - rStart) / bb) * bb;
        if (snap > bounds[bounds.length - 1] + 1e-3 && snap < rEnd - 1e-3) bounds.push(snap);
    }
    bounds.push(rEnd);

    var secs = [];
    for (var b = 0; b < bounds.length - 1; b++) {
        var s0 = bounds[b], name = "";
        for (i = 0; i < cps.length; i++) if (cps[i].time <= s0 + bb / 2) name = cps[i].name;
        secs.push({ start: s0, len: bounds[b + 1] - s0, name: name, energy: sectionEnergy(name) });
    }
    return secs;
}

function sectionEnergy(name) {
    var m = /(^|\s)E(\d{1,3})(\s|$)/i.exec(name);
    if (m) return clamp(parseInt(m[2], 10) / 100, 0, 1);
    var lower = name.toLowerCase();
    for (var i = 0; i < SECTION_WORDS.length; i++) {
        if (lower.indexOf(SECTION_WORDS[i][0]) >= 0) return clamp(P.energy + SECTION_WORDS[i][1], 0, 1);
    }
    return P.energy;
}

function clipName(sec) {
    return "DrumGen #" + P.seed + " " + P.style + " E" + Math.round(sec.energy * 100) + (sec.name ? " " + sec.name : "");
}

// MIDI notes from arrangement clips on a track that sound inside [from, from+len),
// returned with start relative to `from`. Handles start marker and looping clips.
function collectArrangementNotes(trackIdx, from, len) {
    var out = [];
    var tp = trackPath(trackIdx);
    var track = new LiveAPI(tp);
    var n = track.getcount("arrangement_clips");
    var to = from + len;
    for (var i = 0; i < n; i++) {
        var clip = new LiveAPI(tp + " arrangement_clips " + i);
        if (num(clip, "is_midi_clip") !== 1 || num(clip, "muted") === 1) continue;
        var cs = num(clip, "start_time"), ce = num(clip, "end_time");
        if (ce <= from || cs >= to) continue;
        var sm = num(clip, "start_marker"), ls = num(clip, "loop_start"), le = num(clip, "loop_end");
        var looping = num(clip, "looping") === 1 && le > ls;
        var notes = getNotes(clip, Math.min(sm, ls) - 1, Math.max(le, num(clip, "end_marker")) - Math.min(sm, ls) + 2);
        for (var j = 0; j < notes.length; j++) {
            var nt = notes[j];
            if (nt.mute) continue;
            var times = [];
            if (!looping) {
                if (nt.start_time >= sm) times.push(cs + (nt.start_time - sm));
            } else {
                if (nt.start_time >= sm && nt.start_time < le) times.push(cs + (nt.start_time - sm));
                if (nt.start_time >= ls && nt.start_time < le) {
                    var loopLen = le - ls;
                    for (var arr = cs + (le - sm) + (nt.start_time - ls); arr < ce && arr < to; arr += loopLen) times.push(arr);
                }
            }
            for (var k = 0; k < times.length; k++) {
                var tt = times[k];
                if (tt < ce && tt >= from && tt < to) {
                    out.push({ pitch: nt.pitch, start: tt - from, duration: nt.duration, velocity: nt.velocity });
                }
            }
        }
    }
    return out;
}

function writeArrangementClip(ctx, start, len, notes, name) {
    var tp = trackPath(ctx.selfIdx);
    // never silently overwrite clips DrumGen didn't make: copy them to Session first
    if (hasForeignClip(tp, start, len)) {
        var old = collectArrangementNotes(ctx.selfIdx, start, len), keep = [];
        for (var i = 0; i < old.length; i++) keep.push({ pitch: old[i].pitch, start_time: old[i].start, duration: old[i].duration || 0.2, velocity: old[i].velocity });
        stageInSession(ctx, len, keep, "Backup before DrumGen");
        ctx.backups = (ctx.backups || 0) + 1;
    }
    var exact = findArrClip(tp, start, len);
    if (exact) {
        // regenerate in place
        var c = new LiveAPI(exact);
        c.call("remove_notes_extended", 0, 128, 0, len + 16);
        c.set("name", name);
        if (notes.length) c.call("add_new_notes", { notes: notes });
        if (P.keepTakes) stageInSession(ctx, len, notes, name);
        return true;
    }
    // build it in an empty Session slot, copy it into the Arrangement
    var sp = stageInSession(ctx, len, notes, name);
    var clip = new LiveAPI(sp + " clip");
    new LiveAPI(tp).call("duplicate_clip_to_arrangement", "id", parseInt(clip.id, 10), start);
    var placed = !!findArrClip(tp, start, len);
    // if Live refused the copy, leave the take in Session View so nothing is lost
    if (placed && !P.keepTakes) new LiveAPI(sp).call("delete_clip");
    return placed;
}

function hasForeignClip(tp, start, len) {
    var track = new LiveAPI(tp);
    var n = track.getcount("arrangement_clips");
    for (var i = 0; i < n; i++) {
        var c = new LiveAPI(tp + " arrangement_clips " + i);
        if (num(c, "end_time") <= start || num(c, "start_time") >= start + len) continue;
        if (str(c, "name").indexOf("DrumGen") !== 0) return true;
    }
    return false;
}

function stageInSession(ctx, len, notes, name) {
    var idx = emptySlot(ctx);
    var sp = trackPath(ctx.selfIdx) + " clip_slots " + idx;
    new LiveAPI(sp).call("create_clip", len);
    var clip = new LiveAPI(sp + " clip");
    clip.set("name", name);
    if (notes.length) clip.call("add_new_notes", { notes: notes });
    return sp;
}

function findArrClip(tp, start, len) {
    var track = new LiveAPI(tp);
    var n = track.getcount("arrangement_clips");
    for (var i = 0; i < n; i++) {
        var path = tp + " arrangement_clips " + i;
        var c = new LiveAPI(path);
        if (Math.abs(num(c, "start_time") - start) > 1e-3) continue;
        if (Math.abs(num(c, "end_time") - (start + len)) > 1e-3) continue;
        if (num(c, "is_midi_clip") !== 1) continue;
        if (Math.abs(num(c, "start_marker")) > 1e-3 || Math.abs(num(c, "loop_start")) > 1e-3) continue;
        if (num(c, "looping") === 1 && num(c, "loop_end") < len - 1e-3) continue;
        return path;
    }
    return null;
}

function emptySlot(ctx) {
    var tp = trackPath(ctx.selfIdx);
    var n = new LiveAPI(tp).getcount("clip_slots");
    for (var i = 0; i < n; i++) {
        if (num(new LiveAPI(tp + " clip_slots " + i), "has_clip") !== 1) return i;
    }
    ctx.song.call("create_scene", -1);
    return n;
}

// ---------------------------------------------------------------- Session
function generateSession(ctx) {
    var song = ctx.song, bb = ctx.barBeats;
    var sceneIdx = selectedSceneIndex(song);
    var sources = [], autoLen = 0;
    var tcount = song.getcount("tracks");
    for (var i = 0; i < tcount; i++) {
        if (i === ctx.selfIdx) continue;
        var t = new LiveAPI(trackPath(i));
        if (num(t, "mute") === 1) continue;
        var slotIdx = num(t, "playing_slot_index");
        if (!(slotIdx >= 0)) slotIdx = sceneIdx;
        var slotPath = trackPath(i) + " clip_slots " + slotIdx;
        if (num(new LiveAPI(slotPath), "has_clip") !== 1) continue;
        var clip = new LiveAPI(slotPath + " clip");
        var ls = num(clip, "loop_start");
        var len = num(clip, "loop_end") - ls;
        if (!(len > 0)) continue;
        if (len > autoLen) autoLen = len;
        if (num(clip, "is_midi_clip") === 1 && !ctx.listened[parseInt(t.id, 10)]) {
            sources.push({ clip: clip, ls: ls, len: len });
        }
    }

    var nBars = P.bars;
    if (!nBars) {
        var need = autoLen > 0 ? autoLen / bb : 4;
        var opts = [1, 2, 4, 8];
        nBars = 8;
        for (var o = 0; o < opts.length; o++) if (opts[o] >= need - 1e-6) { nBars = opts[o]; break; }
    }
    var L = nBars * bb;

    var notes = [];
    for (var s = 0; s < sources.length; s++) {
        var src = sources[s];
        var raw = getNotes(src.clip, src.ls, src.len);
        for (var n = 0; n < raw.length; n++) {
            var rel = raw[n].start_time - src.ls;
            if (raw[n].mute || rel < 0 || rel >= src.len) continue;
            for (var pos = rel; pos < L; pos += src.len) {
                notes.push({ pitch: raw[n].pitch, start: pos, velocity: raw[n].velocity });
                if (src.len >= L) break;
            }
        }
    }
    var ons = [];
    for (var a = 0; a < captured.length; a++) {
        ons.push({ role: captured[a].role, pos: ((captured[a].beat % L) + L) % L, vel: captured[a].vel });
    }

    var targetSlot = sceneIdx;
    var tp = trackPath(ctx.selfIdx);
    var hasClip = num(new LiveAPI(tp + " clip_slots " + sceneIdx), "has_clip") === 1;
    var existing = [];
    if (hasClip && (LOCK.kick || LOCK.snare || LOCK.hats || LOCK.fills)) {
        var raw2 = getNotes(new LiveAPI(tp + " clip_slots " + sceneIdx + " clip"), 0, L);
        for (var e = 0; e < raw2.length; e++) {
            existing.push({ pitch: raw2[e].pitch, start: raw2[e].start_time, duration: raw2[e].duration, velocity: raw2[e].velocity });
        }
    }
    if (hasClip && P.keepTakes) targetSlot = emptySlot(ctx);

    var A = analyse(notes, ons, L);
    var out = generateBlock(ctx, A, L, P.energy, existing, 0);
    writeSessionClip(ctx.selfIdx, targetSlot, L, out, clipName({ energy: P.energy, name: "" }));
    status("Wrote " + nBars + " bars, " + out.length + " hits (" + notes.length + " MIDI notes, " +
           ons.length + " audio onsets) seed " + P.seed);
}

function writeSessionClip(trackIdx, slotIdx, L, notes, name) {
    var slotPath = trackPath(trackIdx) + " clip_slots " + slotIdx;
    var slot = new LiveAPI(slotPath);
    var clip;
    if (num(slot, "has_clip") === 1) {
        clip = new LiveAPI(slotPath + " clip");
        clip.call("remove_notes_extended", 0, 128, 0, 100000);
        clip.set("loop_start", 0);
        clip.set("start_marker", 0);
        clip.set("loop_end", L);
        clip.set("end_marker", L);
        clip.set("looping", 1);
    } else {
        slot.call("create_clip", L);
        clip = new LiveAPI(slotPath + " clip");
    }
    clip.set("name", name);
    if (notes.length) clip.call("add_new_notes", { notes: notes });
}

// ---------------------------------------------------------------- shared generation
function analyse(notes, onsets, L) {
    var steps = Math.round(L * 4);
    var A = { low: zeros(steps), mid: zeros(steps), high: zeros(steps) };
    for (var n = 0; n < notes.length; n++) {
        var p = notes[n].pitch;
        var role = p < 48 ? "low" : (p < 72 ? "mid" : "high");
        addOnset(A[role], notes[n].start, notes[n].velocity / 127, steps);
    }
    for (var o = 0; o < onsets.length; o++) {
        addOnset(A[onsets[o].role] || A.mid, onsets[o].pos, Math.min(1, onsets[o].vel), steps);
    }
    normalize(A.low); normalize(A.mid); normalize(A.high);
    return A;
}

function generateBlock(ctx, A, L, energyVal, existing, salt) {
    var spb = Math.round(ctx.barBeats * 4);
    var steps = Math.round(L * 4);
    var nBars = Math.max(1, Math.round(L / ctx.barBeats));
    var p = {};
    for (var k in P) if (P.hasOwnProperty(k)) p[k] = P[k];
    p.energy = energyVal;
    var rng = makeRng(P.seed * 7919 + 17 + salt * 104729);
    var events = buildPattern(A, steps, spb, nBars, p, rng, MAP, STYLES[P.style] || STYLES.backbeat);
    var out = toNotes(events, p, ctx.tempo, L, rng);
    return mergeLocks(out, existing);
}

function lockedPitches() {
    var s = {};
    if (LOCK.kick)  s[MAP.kick] = true;
    if (LOCK.snare) { s[MAP.snare] = true; s[MAP.sidestick] = true; }
    if (LOCK.hats)  { s[MAP.chh] = true; s[MAP.ohh] = true; }
    if (LOCK.fills) { s[MAP.tomhi] = true; s[MAP.tommid] = true; s[MAP.tomlow] = true; s[MAP.crash] = true; }
    return s;
}

function mergeLocks(generated, existing) {
    var lk = lockedPitches(), out = [], i;
    for (i = 0; i < generated.length; i++) if (!lk[generated[i].pitch]) out.push(generated[i]);
    for (i = 0; i < existing.length; i++) {
        var e = existing[i];
        if (lk[e.pitch]) out.push({ pitch: e.pitch, start_time: e.start, duration: e.duration || 0.2, velocity: e.velocity });
    }
    return out;
}

// swing, then per-voice timing feel (ms) converted to beats
function toNotes(events, p, tempo, L, rng) {
    var beatsPerMs = tempo / 60000;
    var out = [];
    for (var i = 0; i < events.length; i++) {
        var ev = events[i];
        var t = swingTime(ev.step * 0.25, p.swing, p.swingGrid);
        if (p.feel > 0) {
            var g = feelGroup(ev);
            t += ((rng() - 0.5) * 2 * g.spread + g.lean) * p.feel * beatsPerMs;
        }
        if (t < 0) t = 0;
        if (t > L - 0.01) t = L - 0.01;
        out.push({ pitch: ev.pitch, start_time: t, duration: 0.2, velocity: ev.vel });
    }
    return out;
}

// spread = random +/- ms at Feel 100, lean = consistent ms (positive = late).
// Feel comes mostly from the lean: off-beat hats and the backbeat lay back,
// kicks and downbeat hats stay close to the grid.
function feelGroup(ev) {
    var p = ev.pitch;
    var offbeat = Math.abs(ev.step - Math.round(ev.step)) > 1e-6 || Math.round(ev.step) % 2 === 1 || Math.round(ev.step) % 4 === 2;
    if (p === MAP.kick) return { spread: 5, lean: -2 };
    if (p === MAP.snare || p === MAP.sidestick) return ev.vel < 50 ? { spread: 10, lean: 6 } : { spread: 6, lean: 16 };
    if (p === MAP.chh || p === MAP.ohh) return offbeat ? { spread: 8, lean: 14 } : { spread: 5, lean: 2 };
    if (p === MAP.crash) return { spread: 4, lean: 0 };
    return { spread: 8, lean: 4 };
}

// ---------------------------------------------------------------- pattern engine
function buildPattern(A, steps, spb, nBars, P, rng, MAP, ST) {
    var E = P.energy, C = P.complexity, F = P.follow;
    var kick = zeros(steps), snare = zeros(steps), ghost = zeros(steps);
    var chh = zeros(steps), ohh = zeros(steps), crash = zeros(steps);
    var fill = [];      // per step: { pitch, vel }
    var rolls = [];     // { step (fractional), vel } extra closed hats (trap)
    var cleared = [];   // steps owned by a fill
    var beatsInBar = spb / 4;
    var useSideStick = E < 0.25;
    var halfBeat = Math.floor(Math.floor(beatsInBar) / 2) * 4;   // beat 3 in 4/4
    var grooveSeed = Math.floor(rng() * 1000000000);
    var b, p, s;

    function isBackbeat(q) {
        if (ST.snare === "3") return halfBeat > 0 && q === halfBeat;
        return q % 4 === 0 && Math.floor(q / 4) % 2 === 1;
    }

    for (b = 0; b < nBars; b++) {
        var base = b * spb;
        if (base >= steps) break;
        var g = makeRng(grooveSeed + (b % 2) * 7777);   // same groove choices every 2 bars

        // ---- kick
        var forced = [0];
        if (ST.kick === "four") for (p = 4; p < spb; p += 4) forced.push(p);
        if (ST.kick === "break" && spb >= 16) forced.push(10);
        var strongLow = 0;
        for (p = 0; p < spb; p++) if (A.low[base + p] >= 0.5) strongLow++;
        var nKick = ST.kick === "four"
            ? forced.length + (C > 0.6 ? 1 : 0)
            : clamp(Math.round(1 + E * 2.5 + C * 1.5 + F * strongLow * 0.8), forced.length, Math.floor(spb / 2));
        var chosen = {}, count = 0, fi;
        for (fi = 0; fi < forced.length; fi++) {
            chosen[forced[fi]] = true;
            count++;
            kick[base + forced[fi]] = forced[fi] === 0 ? 118 : (ST.kick === "four" ? 112 : 102);
        }
        var cand = [];
        for (p = 1; p < spb; p++) {
            if (chosen[p]) continue;
            s = base + p;
            var m = p % 4 === 0 ? 0.35 : (p % 4 === 2 ? 0.15 : 0.04 + 0.1 * C);
            if (beatsInBar % 2 === 0 && p === spb / 2) m += ST.snare === "3" ? -0.6 : 0.25;
            if (isBackbeat(p)) m -= 0.5 - 0.3 * E;
            var sc = A.low[s] * (0.3 + 1.8 * F) + A.mid[s] * 0.15 + m * (1.15 - 0.7 * F) + g() * 0.35 * C;
            cand.push({ p: p, sc: sc });
        }
        cand.sort(function (x, y) { return y.sc - x.sc; });
        for (var ci = 0; ci < cand.length && count < nKick; ci++) {
            var cp = cand[ci].p;
            if (cand[ci].sc < 0.12) break;
            if (C < 0.6 && (chosen[cp - 1] || chosen[cp + 1])) continue;
            chosen[cp] = true;
            count++;
            kick[base + cp] = Math.round(92 + 20 * A.low[base + cp]);
        }

        // ---- snare
        for (p = 0; p < spb; p++) if (isBackbeat(p)) snare[base + p] = Math.round(98 + 18 * E);
        if (ST.kick === "break" && C > 0.3 && spb >= 16) {
            var extra = g() < 0.5 ? 14 : 7;
            if (!kick[base + extra]) snare[base + extra] = 90;
        }

        // ---- ghost notes
        if (!useSideStick && ST.ghost > 0) {
            var nGhost = Math.round(C * (0.5 + E) * 3 * ST.ghost);
            var gc = [];
            for (p = 1; p < spb; p++) {
                s = base + p;
                if (p % 4 === 0) continue;
                if (C < 0.5 && p % 2 === 0) continue;
                if (kick[s] || snare[s]) continue;
                gc.push({ p: p, sc: A.mid[s] * 0.8 + A.high[s] * 0.4 + g() * 0.6 });
            }
            gc.sort(function (x, y) { return y.sc - x.sc; });
            for (var gi = 0; gi < gc.length && gi < nGhost; gi++) ghost[base + gc[gi].p] = Math.round(28 + g() * 18);
        }

        // ---- hats
        var hatScale = 0.75 + 0.25 * E;
        if (ST.hats === "offbeat") {
            for (p = 0; p < spb; p++) {
                s = base + p;
                var act0 = Math.max(A.high[s], A.mid[s]);
                if (p % 4 === 2) {
                    if (E > 0.45) ohh[s] = 78; else chh[s] = 80;
                } else if (p % 4 === 0) {
                    if (E > 0.7) chh[s] = 55;
                } else if (E > 0.6 && g() < (E - 0.6) * 2 + act0 * 0.2) {
                    chh[s] = 50;
                }
            }
        } else if (ST.hats === "trap") {
            // trap keeps steady 16th hats at any energy; energy sets their weight
            for (p = 0; p < spb; p++) {
                s = base + p;
                var v0 = p % 4 === 0 ? 85 : (p % 2 === 0 ? 68 : 52 + 10 * E);
                chh[s] = Math.round(v0 * hatScale);
            }
            for (var q = 0; q * 4 + 3 < spb; q++) {
                if (g() >= 0.12 + C * 0.4) continue;
                var rs = base + q * 4 + 2;
                chh[rs] = 0; chh[rs + 1] = 0;
                var nr = C > 0.75 && g() < 0.4 ? 6 : 4;
                for (var ri = 0; ri < nr; ri++) rolls.push({ step: rs + ri * 2 / nr, vel: Math.round(50 + 35 * ri / (nr - 1)) });
            }
        } else {
            var hatEvery = E < 0.15 ? 4 : (E < 0.45 ? 2 : 1);
            var p16 = E >= 0.85 ? 1 : clamp((E - 0.45) / 0.4, 0, 1);
            for (p = 0; p < spb; p++) {
                s = base + p;
                var act = Math.max(A.high[s], A.mid[s]);
                var v = 0;
                if (p % 4 === 0) {
                    v = 90;
                } else if (p % 4 === 2) {
                    if (hatEvery <= 2) v = 72;
                } else {
                    var prob = hatEvery === 1 ? p16 * 0.8 + act * 0.2 : C * 0.3 * act;
                    if (p16 >= 1 && hatEvery === 1) prob = 1;
                    if (g() < prob) v = 55;
                }
                if (v) chh[s] = Math.round(v * hatScale);
            }
            if (E > 0.4) {
                var nOpen = Math.round((E - 0.4) * 2.5 * (0.5 + C * 0.5));
                var oc = [];
                for (p = 2; p < spb; p += 4) {
                    oc.push({ p: p, sc: A.high[base + p] + g() * 0.5 + (isBackbeat((p + 2) % spb) ? 0.3 : 0) });
                }
                oc.sort(function (x, y) { return y.sc - x.sc; });
                for (var oi = 0; oi < oc.length && oi < nOpen; oi++) {
                    s = base + oc[oi].p;
                    ohh[s] = 82; chh[s] = 0;
                    if (s + 1 < steps) chh[s + 1] = 0;
                }
            }
        }
    }

    // ---- phrase endings: turnarounds every 2 bars, short fill every 4, bigger every 8 and at the end
    function chooseFillBeats(drive) {
        var fb;
        if (drive < 0.2) fb = 0;
        else if (drive < 0.4) fb = 1;
        else if (drive < 0.65) fb = rng() < 0.6 ? 1 : 2;
        else fb = rng() < 0.5 ? 2 : 4;
        return Math.min(fb, Math.floor(beatsInBar));
    }

    function makeFill(endStep, fb) {
        var start = endStep - fb * 4;
        if (start < 0) return;
        for (var x = start; x < endStep; x++) {
            chh[x] = 0; ohh[x] = 0; ghost[x] = 0; snare[x] = 0; cleared[x] = true;
            if (x !== start) kick[x] = 0;
        }
        var toms = [MAP.tomhi, MAP.tommid, MAP.tomlow];
        var orch, r = rng();
        if (C < 0.35) orch = r < 0.7 ? "snare" : "kicksnare";
        else if (r < 0.45) orch = "down";
        else if (r < 0.75) orch = "around";
        else orch = "kicksnare";
        var total = fb * 4;
        for (var bi = 0; bi < fb; bi++) {
            var prog = fb === 1 ? 1 : bi / (fb - 1);
            var dens = clamp(Math.round(1 + (E * 2.0 + C * 1.6) * (0.55 + 0.45 * prog) + (rng() - 0.5) * 0.8), 1, 4);
            var opts = FILL_CELLS[dens];
            var cell = opts[Math.floor(rng() * opts.length)];
            for (var k = 0; k < 4; k++) {
                if (!cell[k]) continue;
                var st = start + bi * 4 + k;
                var frac = (bi * 4 + k) / total;
                var voice = MAP.snare;
                if (orch === "down") {
                    voice = frac < 0.25 ? MAP.snare : toms[Math.min(2, Math.floor((frac - 0.25) / 0.75 * 3))];
                } else if (orch === "around") {
                    voice = k < 2 ? MAP.snare : toms[Math.min(2, Math.floor(prog * 2.99))];
                } else if (orch === "kicksnare" && k === 0) {
                    kick[st] = 100;
                }
                var vel = 84 + 30 * frac + (k === 0 ? 8 : 0) + (rng() - 0.5) * 6;
                fill[st] = { pitch: voice, vel: clamp(Math.round(vel), 1, 127) };
            }
        }
        if (E > 0.5 && !kick[start]) kick[start] = 100;
    }

    function turnaround(endStep) {
        if (E > 0.5 && rng() < 0.5) {
            var o = endStep - 2;                         // open hat on the last "and"
            ohh[o] = 80; chh[o] = 0; chh[o + 1] = 0;
        } else {
            var t = endStep - 1;                         // snare pickup
            fill[t] = { pitch: MAP.snare, vel: 76 + Math.round(rng() * 10) };
            chh[t] = 0; cleared[t] = true;
            if (C > 0.5) { fill[t - 1] = { pitch: MAP.snare, vel: 68 }; chh[t - 1] = 0; cleared[t - 1] = true; }
        }
    }

    var drive = (E + C) / 2;
    var crashAt = {};
    if (E > 0.6) crashAt[0] = true;
    if (nBars >= 2) {
        for (b = 0; b < nBars; b++) {
            var endStep = Math.min(steps, (b + 1) * spb);
            var pos = b + 1, fb;
            if (b === nBars - 1 || pos % 8 === 0) {
                fb = chooseFillBeats(drive);
                if (fb) {
                    makeFill(endStep, fb);
                    if (E > 0.4 && fb >= 2) crashAt[endStep % steps] = true;
                } else if (E > 0.1) {
                    fill[endStep - 1] = { pitch: MAP.snare, vel: 74 };
                    chh[endStep - 1] = 0; cleared[endStep - 1] = true;
                }
            } else if (pos % 4 === 0) {
                if (drive >= 0.3 && rng() < 0.7) makeFill(endStep, 1); else turnaround(endStep);
            } else if (pos % 2 === 0) {
                if (rng() < 0.25 + 0.5 * C) turnaround(endStep);
            }
        }
    }
    for (var ck in crashAt) {
        if (!crashAt.hasOwnProperty(ck)) continue;
        s = parseInt(ck, 10);
        if (s >= 0 && s < steps) { crash[s] = 100; chh[s] = 0; ohh[s] = 0; }
    }

    // ---- collect events
    var ev = [];
    var hum = P.humanize;
    function push(pitch, step, vel) {
        var vv = vel + (rng() - 0.5) * 2 * 12 * hum;
        ev.push({ pitch: pitch, step: step, vel: clamp(Math.round(vv), 1, 127) });
    }
    for (s = 0; s < steps; s++) {
        if (kick[s]) push(MAP.kick, s, kick[s]);
        if (snare[s]) push(useSideStick ? MAP.sidestick : MAP.snare, s, snare[s]);
        if (ghost[s]) push(MAP.snare, s, ghost[s]);
        if (chh[s]) push(MAP.chh, s, chh[s]);
        if (ohh[s]) push(MAP.ohh, s, ohh[s]);
        if (crash[s]) push(MAP.crash, s, crash[s]);
        if (fill[s]) push(fill[s].pitch, s, fill[s].vel);
    }
    for (var ro = 0; ro < rolls.length; ro++) {
        if (!cleared[Math.floor(rolls[ro].step)] && rolls[ro].step < steps) push(MAP.chh, rolls[ro].step, rolls[ro].vel);
    }
    return ev;
}

// piecewise-linear swing: amt 0..1 maps the off-beat from 50% to 75% of the pair
function swingTime(t, amt, grid) {
    if (!(amt > 0)) return t;
    var pair = grid === 8 ? 1.0 : 0.5;
    var half = pair / 2;
    var d = amt * 0.25 * pair;
    var base = Math.floor(t / pair + 1e-9) * pair;
    var f = t - base;
    var nf = f < half ? f * (half + d) / half : (half + d) + (f - half) * (half - d) / half;
    return base + nf;
}

// ---------------------------------------------------------------- Live API helpers
function trackPath(i) { return "live_set tracks " + i; }

function getNotes(clip, from, span) {
    var raw = clip.call("get_notes_extended", 0, 128, from, span);
    if (isList(raw)) raw = Array.prototype.join.call(raw, " ");
    var parsed = JSON.parse(raw);
    return parsed.notes || [];
}

function ownTrackId() {
    var path = "this_device";
    for (var k = 0; k < 8; k++) {
        path += " canonical_parent";
        var api = new LiveAPI(path);
        if (!api || parseInt(api.id, 10) === 0) return 0;
        if (api.type === "Track") return parseInt(api.id, 10);
    }
    return 0;
}

function trackIndexById(song, id) {
    var n = song.getcount("tracks");
    for (var i = 0; i < n; i++) {
        if (parseInt(new LiveAPI(trackPath(i)).id, 10) === id) return i;
    }
    return -1;
}

function selectedSceneIndex(song) {
    var sid = parseInt(new LiveAPI("live_set view selected_scene").id, 10);
    var n = song.getcount("scenes");
    for (var i = 0; i < n; i++) {
        if (parseInt(new LiveAPI("live_set scenes " + i).id, 10) === sid) return i;
    }
    return 0;
}

function num(api, prop) {
    var v = api.get(prop);
    if (isList(v)) v = v[0];
    return parseFloat(v);
}

function str(api, prop) {
    var v = api.get(prop);
    if (isList(v)) v = Array.prototype.join.call(v, " ");
    return String(v).replace(/^"|"$/g, "");
}

// ---------------------------------------------------------------- utils
function status(s) { outlet(0, s); post("[DrumGen] " + s + "\n"); }
function isList(v) { return v !== null && typeof v === "object" && typeof v.length === "number"; }
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function zeros(n) { var a = []; for (var i = 0; i < n; i++) a.push(0); return a; }
function addOnset(arr, pos, w, steps) { arr[Math.round(pos * 4) % steps] += w; }
function shiftNote(n, d) { return { pitch: n.pitch, start: n.start + d, duration: n.duration, velocity: n.velocity }; }
function normalize(arr) {
    var m = 0, i;
    for (i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i];
    if (m > 0) for (i = 0; i < arr.length; i++) arr[i] /= m;
}
// LCG kept within 2^53 so it's exact in ES5
function makeRng(seedVal) {
    var st = Math.floor(Math.abs(seedVal)) % 4294967296;
    return function () {
        st = (st * 1664525 + 1013904223) % 4294967296;
        return st / 4294967296;
    };
}

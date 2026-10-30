/*
  DrumGen Listener — Max for Live (Live 12)
  Runs inside [js dg_listener.js] in a Max Audio Effect on an audio source track.

  Receives "onset <beatPhase> <velocity>" from the MSP detector, drops repeats
  inside the refractory window, turns the phase into an absolute beat position,
  and forwards it to the DrumGen Generator:
      onset <trackId> <role> <beat> <velocity>  ->  dg_onsets

  The Live API can't be touched until [live.thisdevice] has fired, so nothing
  happens until "init" arrives. Onsets before that are ignored.
*/
autowatch = 1;
inlets = 1;
outlets = 1; // bang per accepted onset (for a blink button)

var ROLES = ["low", "mid", "high"];
var role = "mid";
var ready = false;     // set by "init" from live.thisdevice
var song = null;
var trackId = 0;
var refractoryMs = 60;
var lastMs = 0;
var warned = false;

function init() {
    ready = true;
    song = null;
    trackId = 0;
    warned = false;
    if (connect()) post("[DrumGen Listener] ready on track id " + trackId + "\n");
}

function setrole(i) {
    role = ROLES[Math.max(0, Math.min(ROLES.length - 1, Math.floor(i)))];
}

function refractory(ms) {
    refractoryMs = Math.max(10, Math.min(500, ms));
}

function onset(phase, vel) {
    if (!ready) {
        if (!warned) {
            post("[DrumGen Listener] not initialised - wire live.thisdevice to the init message, or click init\n");
            warned = true;
        }
        return;
    }
    var now = new Date().getTime();
    if (now - lastMs < refractoryMs) return;
    lastMs = now;

    if (!connect()) return;
    if (num(song, "is_playing") !== 1) return;
    // current_song_time is coarse (scheduler jitter); phase from plugphasor~
    // is close to sample-accurate. Integer beat from song time, fraction from phase.
    var t = num(song, "current_song_time");
    var beat = Math.round(t - phase) + phase;
    messnamed("dg_onsets", "onset", trackId, role, beat, vel);
    outlet(0, "bang");
}

// (re)build Live API handles; never keep an invalid one around
function connect() {
    if (!song || parseInt(song.id, 10) === 0) {
        song = new LiveAPI("live_set");
        if (parseInt(song.id, 10) === 0) { song = null; return false; }
    }
    if (!trackId) trackId = ownTrackId();
    return trackId !== 0;
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

function num(api, prop) {
    var v = api.get(prop);
    if (v instanceof Array) v = v[0];
    return parseFloat(v);
}

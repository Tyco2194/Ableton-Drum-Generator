#Disclaimer

This was created using Claude Code because I couldn't find any free applications that would take in a group of audio/midi tracks and create a drum track based on transients. I've reviewed the code myself and didn't find anything that would create issues with Ableton or your currently recorded tracks, but save often and use at your own risk.


# DrumGen — phase 1

Two Max for Live devices for Live 12 Suite:

- **DrumGen Listener** (Audio Effect): put it on each *audio* track you want the drums to follow. It detects transients and reports them in beats.
- **DrumGen Generator** (MIDI Effect): put it on your drum track, in front of a Drum Rack. It reads MIDI clips on other tracks, merges the Listener onsets, and writes a drum clip.

Files:

| File | Goes in |
|---|---|
| `dg_generator.js` | `[js dg_generator.js]` in the Generator |
| `dg_listener.js` | `[js dg_listener.js]` in the Listener |

Session View only for now. The generator writes into **the drum track's slot on the selected scene**.

Everything is typed into object boxes: press **N** on empty space, type the text, click away. Autocomplete only suggests the first word; arguments after it (like `b b` or `48 480`) are typed freely.

---

## 1. Build the Listener

The transient detector is built from standard MSP objects (no `gen~`).

1. On an audio track, drag in **Max Audio Effect** (Browser → Max for Live). Click its edit button to open Max.
2. Save right away with File → Save As into your User Library (e.g. `Documents\Ableton\User Library\Presets\Audio Effects\Max Audio Effect\DrumGen Listener.amxd`). Copy `dg_listener.js` into **the same folder**.
3. The template already has `[plugin~]` → `[plugout~]`. Leave that connection — audio passes through untouched.
4. Add these objects:

   **Detector**
   - `onepole~ 200` and `-~` — together a gentle high-pass that emphasises attacks
   - `abs~`
   - `slide~ 48 480` — fast envelope (call it *fast*)
   - `delay~ 4800 960` — the envelope as it was 20 ms ago
   - `*~ 1.7` — how far above its level 20 ms ago a hit must jump
   - `>~` — no argument
   - `>~ 0.01` — level threshold
   - `*~` — no argument; "both conditions true"
   - `edge~`
   - `plugphasor~`

   **Reporting**
   - `t b b`
   - `snapshot~` (two: call them **A** and **B**)
   - `pack f f`
   - `prepend onset`
   - `js dg_listener.js`
   - `button` (blinks on each detected hit)

   **Controls / init**
   - `live.thisdevice`
   - `t b b` (a second one)
   - a **message** box (press **M**, not N) containing `init`
   - `live.menu` — Inspector: Range/Enum = `Low Mid High`, Long Name `Role`
   - `prepend setrole`
   - `live.dial` — Long Name `Sensitivity`, range 0–100, initial value 50
   - `scale 0 100 2.2 1.2`
   - `live.dial` — Long Name `Threshold`, unit dB, range −70 to 0, initial value −40
   - `dbtoa`

5. Wire the detector:
   - Both `plugin~` outlets → `-~` **left** inlet, and both → `onepole~ 200` (signals arriving at one inlet are summed, so this is L+R mono).
   - `onepole~ 200` → `-~` **right** inlet. `-~` → `abs~`.
   - `abs~` → `slide~ 48 480`.
   - *fast* (`slide~ 48 480` outlet) goes to four places:
     - `>~` **left** inlet
     - `>~ 0.01` **left** inlet
     - `delay~ 4800 960` → `*~ 1.7` → `>~` **right** inlet
     - snapshot~ **B** left inlet (velocity)
   - `>~` → `*~` **left** inlet. `>~ 0.01` → `*~` **right** inlet.
   - `*~` → `edge~`.
   - `plugphasor~` → snapshot~ **A** left inlet (beat phase).
6. Wire the reporting:
   - `edge~` **left** outlet → first `t b b`.
   - `t b b` **right** outlet → snapshot~ B. snapshot~ B outlet → `pack f f` **right** inlet.
   - `t b b` **left** outlet → snapshot~ A. snapshot~ A outlet → `pack f f` **left** inlet.
   - `pack f f` → `prepend onset` → `js dg_listener.js`. js outlet → `button`.
7. Wire the controls:
   - Sensitivity dial → `scale 0 100 2.2 1.2` → `*~ 1.7` **right** inlet.
   - Threshold dial → `dbtoa` → `>~ 0.01` **right** inlet.
   - Role menu → `prepend setrole` → js.
   - `live.thisdevice` → second `t b b`. Its **right** outlet → the Role menu, Sensitivity dial and Threshold dial (a bang makes them send their saved values on load). Its **left** outlet → the `init` message box → js.
8. Optional: select the dials, menu and button → right-click → Add to Presentation, then toggle Presentation mode to lay out a tidy panel. Save.

Sensitivity 100 fires when the level jumps 1.2× above where it was 20 ms earlier; 0 needs 2.2×. 50 (1.7×) is a good start; going much past ~70 adds false triggers on dense material. Threshold ignores anything quieter than that level. Double-triggers within 60 ms are dropped in the script; to change that, send the js a message like `refractory 100`.

**Role** tells the generator what the track is for: `Low` (bass, kick-ish stuff → drives kick placement), `Mid` (chords, guitars → ghost notes, hat accents), `High` (percussion, plucks, hats → hats and open hats).

## 2. Build the Generator

**Already built the phase 1 Generator?** Replace `dg_generator.js`, then add only the objects marked **(new)** in step 4 and the connections marked **(new)** in steps 5 and 7. Nothing you built before changes.

1. On your drum track (with a Drum Rack), drag in **Max MIDI Effect** before the rack. Open it in Max.
2. Save as `DrumGen Generator.amxd` and copy `dg_generator.js` into the same folder.
3. Keep the template's `midiin` → `midiout`.
4. Add these objects:

   **Core**
   - `js dg_generator.js`
   - `receive dg_onsets`
   - `live.thisdevice` (fires once when the device has finished loading)
   - `t b` (a trigger with one bang outlet)

   **Controls** (set in the Inspector)
   - 4 × `live.dial`, Range 0–100, Unit Style Percent, Initial Enable on:
     - Long Name **Energy**, initial 50
     - Long Name **Swing**, initial 0
     - Long Name **Complexity**, initial 40
     - Long Name **Humanize**, initial 30
   - **(new)** 2 × `live.dial`, Range 0–100, Unit Style Percent, Initial Enable on:
     - Long Name **Follow**, initial 50
     - Long Name **Feel**, initial 20
   - **(new)** `live.menu`: Long Name **Style**, Range/Enum `Backbeat FourFloor HalfTime Breakbeat Trap`
   - **(new)** `live.menu`: Long Name **Target**, Range/Enum `Arrangement Session`
   - `live.menu`: Long Name **Bars**, Range/Enum `Auto 1 2 4 8`
   - `live.menu`: Long Name **Grid**, Range/Enum `16th 8th`
   - `live.numbox`: Long Name **Seed**, Type Int (0-255), Range 0 255
   - `live.text`: Long Name **Listen** (toggle — the default)
   - **(new)** 4 × `live.text` (toggle): Long Names **Lock Kick**, **Lock Snare**, **Lock Hats**, **Lock Fills**
   - **(new)** `live.text` (toggle): Long Name **Sections**
   - **(new)** `live.text` (toggle): Long Name **Keep Takes**
   - `live.button`: Long Name **Generate**
   - `live.button`: Long Name **New**

   **Messages to the script**
   - `prepend energy`
   - `prepend swing`
   - `prepend complexity`
   - `prepend humanize`
   - **(new)** `prepend follow`
   - **(new)** `prepend feel`
   - **(new)** `prepend style`
   - **(new)** `prepend target`
   - `prepend bars`
   - `prepend swinggrid`
   - `prepend seed`
   - `prepend listen`
   - **(new)** `prepend lock kick`
   - **(new)** `prepend lock snare`
   - **(new)** `prepend lock hats`
   - **(new)** `prepend lock fills`
   - **(new)** `prepend sections`
   - **(new)** `prepend keeptakes`
   - message box (press **M**) containing `generate`
   - message box containing `newvariation`

   **Feedback from the script**
   - `prepend set` (two of them)
   - an empty message box (the status display)

5. Wire the controls into the script:
   - Energy dial → `prepend energy` → js
   - Swing dial → `prepend swing` → js
   - Complexity dial → `prepend complexity` → js
   - Humanize dial → `prepend humanize` → js
   - **(new)** Follow dial → `prepend follow` → js
   - **(new)** Feel dial → `prepend feel` → js
   - **(new)** Style menu → `prepend style` → js
   - **(new)** Target menu → `prepend target` → js
   - Bars menu → `prepend bars` → js
   - Grid menu → `prepend swinggrid` → js
   - Seed numbox → `prepend seed` → js
   - Listen toggle → `prepend listen` → js
   - **(new)** Lock Kick → `prepend lock kick` → js (same pattern for Lock Snare, Lock Hats, Lock Fills with their own `prepend lock …`)
   - **(new)** Sections toggle → `prepend sections` → js
   - **(new)** Keep Takes toggle → `prepend keeptakes` → js
   - Generate button → `generate` message box → js
   - New button → `newvariation` message box → js
   - `receive dg_onsets` → js
6. Wire the feedback:
   - js **left** outlet → one `prepend set` → the empty status message box (shows what the script is doing)
   - js **right** outlet → the other `prepend set` → the Seed numbox's **left** inlet (the New button changes the seed in the script; this updates the number on screen to match, and `set` stops the numbox from sending it back into the script)
7. Wire the load-time init:
   - `live.thisdevice` **left** outlet → `t b`
   - `t b` outlet → the left inlet of each of: the Energy, Swing, Complexity and Humanize dials, the Bars and Grid menus, and the Seed numbox.
   - **(new)** `t b` outlet → also the Follow and Feel dials, the Style and Target menus, the four Lock toggles, Sections and Keep Takes.
   - The bang makes each control resend its saved value so the script picks up your settings when the set loads. Leave the Listen toggle and the Generate/New buttons off this list, or loading the set would start listening or generate a clip.
8. Optional: tidy up what Live shows. By default Live displays the whole patch in the device strip, cables and all. **Presentation mode** is a second layout of the same patch that shows only the controls you pick:
   - Unlock the patch, select the controls you want to see (dials, menus, Seed, toggles, Generate, New and the status box), right-click → **Add to Presentation**.
   - Click the **Presentation** button in the bottom toolbar (easel icon) to switch to that layout. Only those objects show; drag them into a compact panel that fits the device height. Cables and other objects still work, they're just hidden.
   - With nothing selected, open the Inspector for the patcher itself (right-click empty space → **Inspector Window**) and tick **Open in Presentation**. Without this, Live keeps showing the full patch.
   - Save and close.

If the js object says it can't find the file, the `.js` isn't next to the `.amxd` — or add its folder in Max → Options → File Preferences. Once everything works, **Freeze Device** bundles the scripts into the `.amxd`.

## 3. Using it (Arrangement View)

1. Put a Listener on each audio track you want followed and set its Role. MIDI tracks need nothing — the generator reads their arrangement clips directly.
2. Set the **loop brace** over the part you want drums for. Whole bars work best; anything else is rounded to whole bars.
3. Hit **Listen**, play that part through at least once, then turn Listen off. The status box shows how many onsets were captured. (Skip this if all your sources are MIDI.)
4. Hit **Generate**. A drum clip is written on the drum track covering the loop brace.
   - Generating again over the same loop brace replaces that clip's notes in place.
   - If a clip *you* made is in the way, it's copied to a Session slot on the drum track named "Backup before DrumGen" before being overwritten.
5. **New** bumps the seed and regenerates. Same seed + same settings = same pattern.

Ctrl/Cmd+Z undoes a generation, though it may take a few presses since Live records each step separately.

### Sections

Turn **Sections** on and put the loop brace over a longer stretch (say, a whole song). The loop is split at your **locators**, and each section gets its own clip, its own fills, and an Energy based on the locator's name:

| Name contains | Energy |
|---|---|
| intro, outro | −25 |
| breakdown, break | −30 |
| verse | −10 |
| bridge | −5 |
| pre (e.g. Pre-Chorus) | +5 |
| chorus, hook | +25 |
| drop | +30 |
| anything else | the Energy dial |

To set a section exactly, put `E` and a number in the locator name: **Chorus E85** uses 85 regardless of the dial. Locators are snapped to the nearest bar.

### Keep Takes

With **Keep Takes** on, every generation is also saved to the next empty Session slot on the drum track (new scenes are added if needed), named with its seed, style and energy. Drag any of them back into the Arrangement to restore a take.

### Lock

Each Lock toggle keeps that part of the *current* clip and regenerates the rest:

- **Kick** — kick
- **Snare** — snare, side stick and ghost notes
- **Hats** — closed and open hats
- **Fills** — toms and crash

Fill snare hits use the snare note, so they follow the Snare lock, not the Fills lock.

### Session View

Set **Target** to Session to use the phase 1 behaviour: select a scene row, and the clip goes in the drum track's slot on that scene. **Bars** (Auto/1/2/4/8) only applies here — in Arrangement the loop brace sets the length. With Keep Takes on, a new take goes in the next empty slot instead of replacing the clip.

### Controls

- **Energy** — density and intensity. Low: sparse kick, side stick, 8th hats. High: busy kick, ghost notes, 16th hats, open hats, crash on the 1.
- **Complexity** — syncopation, ghost notes, toms in fills, fill length and density.
- **Style** — the groove's rule set:
  - **Backbeat** — rock/pop: snare on 2 and 4, kicks follow the music.
  - **FourFloor** — kick on every beat, open hats on the off-beats, snare/clap on 2 and 4.
  - **HalfTime** — snare on 3 only.
  - **Breakbeat** — kick on the "and" of 3, extra syncopated snares, more ghost notes.
  - **Trap** — half-time snare, busy hats with 32nd/triplet rolls, no ghost notes.
- **Follow** — how closely kicks track your low parts (bass, Low-role Listeners). 0 = mostly the style's usual kick spots, 100 = kicks land on the bass.
- **Feel** — timing humanize. Hats and ghost notes drift the most (up to ±12 ms at 100); the backbeat snare also sits slightly late (about +6 ms at 100) for a laid-back feel; kicks stay tight.
- **Humanize** — velocity variation.
- **Swing** — 0–100% maps the off-beat from straight (50%) to hard swing (75%). **Grid** picks whether 16ths or 8ths swing. With 16th grid, 8th-note hats don't move — switch Grid to 8th for low-energy grooves.

### Pad mapping

Defaults follow the General MIDI / standard Drum Rack layout: kick 36 (C1), side stick 37, snare 38, closed hat 42, open hat 46, crash 49, toms 50 / 47 / 45.

Remap by sending the js a message, e.g. a message box `map kick 35` or `map chh 44`. Voice names: `kick sidestick snare chh ohh crash tomhi tommid tomlow`.

## How it decides

Everything is analysed on a 16th-note grid over the section, into three lanes:

- MIDI notes below C2 → **low**, C2–B3 → **mid**, C4 and up → **high**
- Listener onsets → whatever Role that Listener is set to

Kicks: the style's fixed kicks (always the 1), then the best-scoring steps by low-lane activity (weighted by Follow) plus metric weight. Snares follow the style. Ghost notes go where mid/high activity is. Hats are filled by energy, with 16ths more likely where the mid/high lanes are busy. Random choices repeat every 2 bars, so the groove stays consistent while still reacting to what's playing in each bar.

Phrase endings: a turnaround (snare pickup or open hat) at the end of every 2 bars, a short fill every 4, a bigger fill every 8 and at the end of each section, with a crash after the bigger ones. Fills are always whole beats and get busier toward the downbeat.

A track that sent audio onsets is analysed from audio only, so a MIDI instrument track with a Listener on it isn't counted twice.

## Known limits

- **Phase 2 hasn't run inside Live yet.** The logic is tested against a simulated Live set; the Arrangement calls (`duplicate_clip_to_arrangement`, arrangement clip reading) still need a real check. If placing a clip fails, the take is left in Session View and the status box says so.
- Uses the song's time signature; signature changes mid-song aren't followed. Accents assume 4/4-style meters.
- MIDI clips are read through their loop and start markers; warped *audio* clips are only heard through Listeners.
- The Listener detects *when* things hit, not pitch or timbre — Role is how you tell it what the track is.
- Very sustained material (pads) produces few or no onsets. Raise Sensitivity or lower Threshold if a percussive part is being missed, and do the opposite if you see double triggers.

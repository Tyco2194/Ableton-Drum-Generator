# DrumGen

> **Disclaimer:** This was created using Claude Code because I couldn't find any free tools that would take a group of audio and MIDI tracks and create a drum track based on their transients. I've reviewed the code myself and didn't find anything that would cause issues with Ableton or your recorded tracks, but save often and use at your own risk.

Max for Live devices that write drum parts that follow your music. The **Listener** detects hits on your audio tracks. The **Generator** reads those hits plus your MIDI clips and writes a drum clip on your drum track.

## Requirements

- Ableton Live 12 Suite, or Live 12 Standard with the Max for Live add-on
- A MIDI track with a Drum Rack (standard note layout: kick C1, snare D1, closed hat F#1)

## Install

1. Download this repository (**Code → Download ZIP**) and unzip it.
2. Copy these files into one folder inside your Ableton User Library, for example `User Library/Presets/MIDI Effects/Max MIDI Effect/DrumGen/`:
   - `DrumGen Generator.amxd`
   - `DrumGen Listener.amxd`
   - `dg_generator.js`
   - `dg_listener.js`

   Keep the `.js` files **in the same folder** as the `.amxd` files. The devices load their scripts from there.
3. In Live, the devices appear in the Browser under **User Library**. If they don't show up, right-click the folder in the Browser and choose **Refresh**.

## Set up

1. **Generator:** drag `DrumGen Generator` onto your drum track, **before** the Drum Rack.
2. **Listener:** drag `DrumGen Listener` onto each audio track you want the drums to follow. Put it first in the chain, before compressors, reverb or delay.
3. On each Listener, set **Role**:
   - **Low**: bass and low parts. These drive kick placement.
   - **Mid**: chords, guitars, keys. These shape ghost notes and accents.
   - **High**: percussion, plucks, bright parts. These shape the hats.

MIDI tracks don't need a Listener. The Generator reads their clips directly.

## Use it (Arrangement View)

1. Set the **loop brace** over the bars you want drums for.
2. If you have audio tracks: click **Listen** on the Generator, press Play, let the loop play through once, then click **Listen** again to stop. The status box shows how many hits were captured.
3. Choose a **Style** and set **Energy** and **Complexity**.
4. Click **Generate**. A drum clip appears on the drum track under the loop brace.
5. Click **New Variation** to try the next seed, or adjust the controls and click **Generate** again. Generating over the same loop updates the clip in place.

Undo works with Ctrl/Cmd+Z. It may take a few presses, since Live records each step separately.

### Generate a whole song with Sections

1. Add locators at the start of each part and name them, for example *Intro*, *Verse*, *Chorus*, *Outro*.
2. Turn on **Sections** and set the loop brace over the whole song.
3. Click **Generate**. Each section gets its own clip, fills at its end, and its own energy:

| Locator name contains | Energy |
|---|---|
| intro, outro | dial − 25 |
| breakdown, break | dial − 30 |
| verse | dial − 10 |
| bridge | dial − 5 |
| pre (Pre-Chorus) | dial + 5 |
| chorus, hook | dial + 25 |
| drop | dial + 30 |
| anything else | the Energy dial |

To set a section's energy exactly, add `E` and a number to the locator name, such as **Chorus E85**.

### Keep what you like

- **Lock Kick / Snare / Hats / Fills** keeps that part of the current clip and regenerates the rest. Snare includes ghost notes and fill snare hits; Fills covers toms and crash.
- **Keep Takes** also saves every generation to the next empty Session View slot on the drum track. Drag any take back into the Arrangement to restore it.
- If a drum clip you made yourself is under the loop brace, it's saved to a Session slot named *Backup before DrumGen* before being overwritten.

### Session View

Set **Target** to **Session**, select a scene, and click **Generate**. The clip goes into the drum track's slot on that scene. **Bars** sets the length (Auto matches your longest clip). With Keep Takes on, each new take goes into the next empty slot.

## Controls

**Generator**

| Control | What it does |
|---|---|
| Energy | Overall density and intensity. Below 25% the snare becomes a side stick. |
| Complexity | Syncopation, ghost notes, fill length and density. |
| Style | Backbeat, FourFloor, HalfTime, Breakbeat, Trap. |
| Follow | How closely kicks follow your bass. 0 = the style's usual spots, 100 = on the bass notes. |
| Feel | Timing humanize. Off-beat hats and the snare lay back; kicks stay tight. Try around 50. |
| Humanize | Velocity variation. |
| Swing / Swing Grid | Swing amount, applied to 16ths or 8ths. Use 8th for low-energy grooves with 8th-note hats. |
| Seed | The pattern's starting point. Same seed + same settings = same pattern. |
| Bars | Pattern length in Session mode. In Arrangement the loop brace sets the length. |
| Target | Arrangement or Session. |

**Listener**

| Control | What it does |
|---|---|
| Role | Low, Mid or High. Tells the Generator how to use this track's hits. |
| Sensitivity | How sharply the level must jump to count as a hit. Raise it if hits are missed; lower it if you see double triggers. 50 is a good start. |
| Threshold | Ignores anything quieter than this level. Around −50 dB is a good start. |

The light on the Listener blinks for each detected hit. It only detects hits while Live is playing.

## Custom drum kits

If your kit uses different notes, send the Generator a `map` message from a message box connected to its script, for example `map kick 35` or `map chh 44`. Voice names: `kick sidestick snare chh ohh crash tomhi tommid tomlow`.

## Troubleshooting

- **The status box says "0 MIDI notes, 0 audio onsets"**: the drums came from the style rules alone. Check that your MIDI clips sit inside the loop brace, that Listeners are on your audio tracks, and that you used Listen while playing.
- **The Max Console says `can't find file dg_generator.js`** (or `dg_listener.js`): the `.js` file isn't in the same folder as the `.amxd`.
- **The Listener's light never blinks**: make sure Live is playing, then lower Threshold or raise Sensitivity.
- **"Couldn't place clip in the Arrangement"**: the take is still saved in a Session View slot on the drum track. Drag it into place by hand.

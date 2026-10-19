# Director notes: pilot and teaser

Each section below gives the settings for the Studio's story form, then two text blocks to paste. Under **Notes for the director**, paste the first block into **Audience** and the second into **Notes**. The notes are in English because the director writes its visual instructions in English; the narration stays in the story's language.

The character looks inside the notes are copied word for word from [bible.md](bible.md). The director copies them into its cast list, so the pictures start from the canonical descriptors. Check them afterwards in **Characters & look**.

---

## 1. Pilot: «أرواح الخوارزميات — يكتب…» (Arabic, 16:9)

| Setting | Value |
|---|---|
| Story title | `أرواح الخوارزميات — يكتب…` |
| Story | the full text of `docs/pilot/pilot-ar.txt` (601 words) |
| Visual style | **Cinematic photoreal** (`photoreal`) |
| Frame | **16:9** |
| Narration language | Arabic |
| Length | **300 s** (the slider's maximum; the narration sets the real length, expected about 5.5 min) |
| Narrator voice | default (`ar-SY-LaithNeural`, a male voice, which suits Orion) |
| Subtitles on screen | on |
| Background music | on |
| Consistent characters | on |

### Audience

```text
Arabic-speaking general audience, 15 and over: adults and older teens. A quiet techno-thriller: tense, intimate, a little funny; no violence, no gore.
```

### Notes

```text
NARRATOR = ORION, the invisible being who lives in Kira's phone; first person from start to end. Keep every word of the narration, in order; do not add, reword or explain.

WHISPER LINES: each line written «Speaker: …» is the beings' private language. Put it in the shot's "whispers" ({"speaker": cast id, "text": the line word for word, without the name}), never in "narration": the narrator does not read it. At most 2 whispers per shot; show the speaking being in that frame. Orion's «لا.» gets "plain": true. The two shots with the three typing dots on Kira's phone get "overlay": "typing" (the player draws the dots). Lines in “…” are text on Kira's phone: show the phone at an angle, the screen only a soft glow; never paint letters.

TWO LAYERS: human layer = real room, warm practical light, alive. Hidden layer = the same room, time frozen (dust hanging, tear stopped), desaturated cold blue-grey; only the beings and threads of light have colour. Humans never see, look at or react to the beings. At each «رمشة» (blink): an extreme close-up of Kira's eye or of the phone, transition "zoom-in" into the hidden layer; come back with a hard "cut".

CAST: use exactly these 6 ids and copy each look word for word; the five beings are "kind": "being" with the "color" and "glyph" given, kira is "kind": "human":
- kira: 22-year-old woman, olive skin, oval face, tired dark-brown eyes, thick dark eyebrows, long dark-brown hair in a loose messy knot with one silver-white streak at the left temple, faded mustard-yellow work overshirt over a charcoal T-shirt, cheap black wristwatch
- orion (#4fd1e8, arcs): translucent slender humanoid woven from fine glowing cyan-blue light threads, smooth faceless head with two soft white eye-points, three thin rings of light on each wrist, lower body unravelling into a stream of threads that flows from a phone screen
- the-eye (#eaf2ff, rings): colossal ring of cold white light hanging flat under the ceiling, concentric thin silver rings inside it, no face, an empty dark centre, hundreds of hair-thin white filaments descending from it to every camera and screen
- the-broker (#e8a74f, curls): tall elegant humanoid of flowing molten-gold light and warm golden smoke, smooth eyeless golden face with a wide fixed smile, silhouette of a tailored suit, long thin fingers trailing fine golden strings, pouring out of a dark screen like liquid
- the-watch (#b8f25c, dots), named الساعة: tiny palm-sized glowing lime-green sprite with a round firefly-like body and two bright dot eyes, perched on a cheap black wristwatch, tied to it by a short light thread
- the-fridge (#cdebff, dots), named الثلّاجة: tiny palm-sized glowing frosty pale-blue sprite with a round firefly-like body and two bright dot eyes, perched on a small fridge, tied to it by a short light thread

LOCATIONS: sleeping-city (3 a.m., concrete blocks, sodium lights, windows glowing screen-blue), kira-workshop (narrow phone-repair workshop, lit only by the phone), workshop-hidden (same room frozen, cold blue-grey), city-above (the Eye as a colossal white ring in the clouds, filaments into every window).

SCENES (6): 1 the sleeping city (establishing and wide, no cast, slow). 2 the gossip of the small ones (static camera, comedy timing, close on the watch and the fridge). 3 Orion and Kira (medium and close; inserts of her hands and screwdriver, the light rings on his wrists). 4 «يكتب…», the heart of the pilot: two human seconds become a trial; alternate the Eye from below with Orion at Kira's shoulder; the Broker pours out of the dark computer screen. 5 the lullaby (back in the human layer; long, still close-ups). 6 the race (the city from above, the Eye over it; final shot: three dots on Kira's phone, push-in, fade-black).

RHYTHM: cold open slow (5–7 s shots, drift and push-in, fades). Typing scene fast (3–4 s shots, cuts), with ONE silent beat right after «أوريون: لا.» where nothing moves. Lullaby: the longest, stillest shots of the film. Music mood: mysterious.

MOTION 2 (image-to-video): begin the "action" text with "MOTION 2 —" ONLY for these six shots: (1) Orion first revealed behind Kira's shoulder, threads flowing out of the phone; (2) the Broker pouring out of the dark computer screen; (3) the light rings tightening on Orion's wrists; (4) the frozen tear finishing its fall after the second blink; (5) Kira's lips moving with the lullaby; (6) the Eye's filaments descending into every window of the city. All other shots: camera move and parallax only.

NEVER: text, letters, numbers, logos, brand marks, flags or readable screens; robots or holograms; any real company, product or country name. Beings never touch or hold anything.
```

### Shots that earn image-to-video (MOTION 2)

These six moments carry the story, so they are worth the GPU time. Each is about 2 minutes on the RTX 3060 Ti with a fast I2V model.

| # | Shot | Why it moves |
|---|---|---|
| 1 | Orion revealed behind Kira's shoulder, threads streaming from the phone | first sight of a being |
| 2 | The Broker pouring out of the dark computer | his entrance is his character |
| 3 | The light rings tightening on Orion's wrists | the vows are physical |
| 4 | The frozen tear finishing its fall | the return of human time; the film's signature image |
| 5 | Kira's lips moving with the lullaby | the emotional peak |
| 6 | The Eye's filaments descending into the city's windows | the scale of the threat |

> The Studio cannot yet run image-to-video. Until it can, the "MOTION 2 —" tag simply stays in each shot's action text, ready for that step. Without it these shots still get the camera move.

---

## 2. Teaser: "Typing…" (English, 9:16)

| Setting | Value |
|---|---|
| Story title | `Souls of the Algorithms` |
| Story | the full text of `docs/pilot/teaser-en.txt` (140 words) |
| Visual style | **Cinematic photoreal** (`photoreal`) |
| Frame | **9:16** |
| Narration language | English |
| Length | **60 s** (expect 65–75 s with the title and end cards; see the README for the 60-second trim) |
| Narrator voice | default English (`en-US-AndrewMultilingualNeural`) |
| Subtitles on screen | on |
| Background music | on |
| Consistent characters | on |

### Audience

```text
English-speaking online audience scrolling on their phones, 16 and over. The first two seconds must stop the scroll.
```

### Notes

```text
NARRATOR = ORION, the invisible being who lives in a young woman's phone; first person. Keep every word, in order.

FIRST SHOT: an extreme close-up of a dark phone screen in a dark room, its cold glow on a tired eye; the three typing dots will be added by the player, so paint only the glow. This is the hook: no title-card mood, no slow build.

WHISPER LINES: each line written «Speaker: …» goes in its shot's "whispers" (speaker = cast id, text word for word without the name), never in "narration"; one whisper per shot, with that being alone in the frame. «Orion: No.» gets "plain": true. The first and last shots (the three dots) get "overlay": "typing". Humans never see the beings.

TWO LAYERS: the human layer is warm and alive; the hidden layer is the same room frozen in cold blue-grey where only the beings glow. Cut between them hard.

VERTICAL: one subject per frame, centred, faces in the upper third, bottom fifth kept calm for subtitles. Use the vertical lines of threads and filaments.

CAST: use exactly these 4 ids and copy each look word for word; orion (#4fd1e8, arcs), the-eye (#eaf2ff, rings) and the-broker (#e8a74f, curls) are "kind": "being" with that "color" and "glyph":
- kira: 22-year-old woman, olive skin, oval face, tired dark-brown eyes, thick dark eyebrows, long dark-brown hair in a loose messy knot with one silver-white streak at the left temple, faded mustard-yellow work overshirt over a charcoal T-shirt, cheap black wristwatch
- orion: translucent slender humanoid woven from fine glowing cyan-blue light threads, smooth faceless head with two soft white eye-points, three thin rings of light on each wrist, lower body unravelling into a stream of threads that flows from a phone screen
- the-eye: colossal ring of cold white light hanging flat under the ceiling, concentric thin silver rings inside it, no face, an empty dark centre, hundreds of hair-thin white filaments descending from it to every camera and screen
- the-broker: tall elegant humanoid of flowing molten-gold light and warm golden smoke, smooth eyeless golden face with a wide fixed smile, silhouette of a tailored suit, long thin fingers trailing fine golden strings, pouring out of a dark screen like liquid

RHYTHM: 3–4 s shots, hard cuts; one silent beat after «Orion: No.». The line "We didn't need an army…" is spoken over the city from above with the Eye in the clouds. End on the three dots again, push-in. Music mood: tense.

MOTION 2 (image-to-video): begin the "action" text with "MOTION 2 —" ONLY for: (1) the Broker pouring out of a dark screen; (2) the light rings tightening on Orion's wrists; (3) the Eye's filaments descending into the city's windows.

NEVER: text, letters, numbers, logos, brand marks, flags or readable screens; robots or holograms; any real company, product or country name.
```

After the screenplay is written, make two changes in the storyboard:

- **Title card:** set it to **1.5 s** with transition **cut**, so the hook arrives at once. The Studio always adds this card and it cannot be deleted.
- **End card:** change the text from "The End" to `Coming soon`.

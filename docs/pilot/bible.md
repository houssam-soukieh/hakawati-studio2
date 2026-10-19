# Souls of the Algorithms: visual bible

Visual rules for the pilot «يكتب…», the 60-second teaser and every later episode. It is written for the SDXL image model (RealVisXL or another photoreal SDXL Lightning checkpoint) and for whoever checks its pictures.

**How to use it in the Studio.** After the director has written the screenplay, open **Characters & look**:

- paste §1 into **Film look**;
- paste each character's descriptor from §3 and §4 into **Look (for the artist)**;
- paste each location from §5 into **Places**.

Copy word for word and never paraphrase, because the same words in every prompt are what keep a face the same across shots. Names never reach the image model (it does not know them), so every descriptor stands on its own.

---

## 0. Rules for every picture

1. **No text, ever.** No letters, numbers, logos, brand marks, flags, signs or readable screens. Every device is unbranded, matte and generic. A screen shows only a soft glow or out-of-focus shapes. Subtitles, the whisper language, chat bubbles and the three typing dots are all drawn later by the Studio's player (§6).
2. **Our world, today.** No futuristic cities, robots, androids or devices that project holograms. The hidden beings are not technology on screen; they are seen by the viewer alone.
3. **Humans never see the beings.** No human looks at a being, reacts to one or lights up from one. A being can light the room in the hidden layer only.
4. **No real names.** No real company, product, app, tool or country appears, not even as a shape everyone would recognise (a famous logo silhouette, a known phone design or a national flag).
5. **One frozen moment per picture.** Motion comes from the camera, from parallax and, in shots marked MOTION 2, from image-to-video.

---

## 1. Film look (paste into "Film look")

```text
Photoreal contemporary drama in our world today, unbranded devices. Two layers: the human layer has warm practical light (amber tungsten, sodium streetlight, cold phone glow on faces) and teal shadows; the hidden layer is the same place frozen, desaturated cold blue-grey, where only luminous beings and threads of light carry colour. 35mm anamorphic, shallow depth of field, fine grain, no text.
```

---

## 2. Colour grade and lens language

### The two layers

| | Human layer | Hidden layer |
|---|---|---|
| Light | Practical sources only: phone screen, one tungsten bulb, sodium streetlight through the shutter | The beings are the light sources; the room is lit as if by moonlight |
| Grade | Warm highlights (amber `#E8A74F`), teal shadows (`#16303D`), natural skin, slightly lifted blacks, fine grain | Room at about 15% saturation, cold blue-grey (`#2A3540`), lower contrast; beings at full saturation with bloom |
| Time | Alive: steam, flicker, a hand moving | **Frozen**: dust motes hang in the air, a tear stops on a cheek, smoke stands still |
| Lens | 35mm and 50mm, eye level, off-centre, foreground objects out of focus, f/1.8 | 24mm wide, locked off, symmetrical, deeper focus (f/5.6) so the frozen room reads |
| Close-ups | 85mm on eyes, lips and hands; macro inserts (screwdriver, tear, phone edge) | 50mm on the beings' faces and wrists |

**Data shadows (hidden layer only).** Every human trails a soft wake of warm-white light threads (`#FFF1D6`): their messages, searches, heartbeat and location. Kira's threads gather at her phone and her wrist.

**The blink («رمشة»).** The film moves from one layer to the other in a single blink. Show an extreme close-up of Kira's eye, or of the phone's dark screen, then hard-cut to the hidden layer, which already shows the same framing. The return is a hard cut too, landing on the same framing in warm light.

### Camera rules for the beings

- **The Eye** is always shot from below (low angle). It sits in the top third and its filaments make vertical lines down the frame.
- **The Broker** always enters from a screen at the edge of the frame. Its gold spills warm onto the cold, frozen room, the only warmth in the hidden layer.
- **Orion** stays at Kira's shoulder, slightly behind her and the same height. In two-shots he never stands in front of her.

### Leave room for subtitles

Keep the bottom 20% of every frame calm, with no faces or key details there. Whispers appear at the top of the frame, so in shots with whispers keep the top 15% calm too.

### Vertical teaser (9:16)

One subject per frame, centred. Faces go in the upper third. Use the vertical lines (the Eye's filaments, Orion's threads) and keep the bottom fifth clear.

---

## 3. The humans

Each descriptor below is 45 words or fewer. Only Kira appears in the pilot and the teaser; the others are fixed now for later episodes.

### كيرا · Kira (id `kira`): pilot, teaser

A young woman who repairs phones in a poor neighbourhood. The silver streak is a nod to the novel, where her hair is silver.

```text
22-year-old woman, olive skin, oval face, tired dark-brown eyes, thick dark eyebrows, long dark-brown hair in a loose messy knot with one silver-white streak at the left temple, faded mustard-yellow work overshirt over a charcoal T-shirt, cheap black wristwatch
```

**Props:** a small magnetic screwdriver, usually turning in her fingers, as in the novel's first page.

### لاريك · Larik (id `larik`): later episodes, old photos

Kira's father, an engineer at one of the houses, now erased.

```text
58-year-old man, olive skin, kind lined face with deep laugh lines, short grey hair, grey stubble, warm brown eyes behind round steel-rimmed glasses, navy-blue knitted cardigan over a white collared shirt, grease-darkened fingertips, gentle half smile
```

### كاين · Kayn (id `kayn`): later episodes

An ex-detective with a prosthetic arm, as in the novel: late twenties, left arm metal from shoulder to fingers.

```text
late-20s man, tanned olive skin, unshaven, messy black hair, watchful dark eyes, thin scar through the right eyebrow, worn olive-green field jacket over a grey hoodie, left arm a matte-black mechanical prosthetic from shoulder to fingers with exposed steel joints
```

### سامي · Sami (id `sami`): later episodes

Kira's little brother, the first one the Broker pulls in.

```text
12-year-old boy, olive skin, messy black hair, big dark eyes, gap-toothed grin, oversized faded red hoodie with the hood half up, white wired earbuds, face lit cold blue from below by a phone screen
```

### إلاريا · Ilaria (id `ilaria`): later episodes

A minister who leads the sanctions committee.

```text
62-year-old woman, pale skin, sharp cheekbones, steel-grey eyes, silver chin-length bob, thin unsmiling lips, charcoal-grey tailored suit, white silk blouse, small plain red enamel pin on the lapel, reading glasses held in one hand
```

### كاسيان · Kasian (id `kasian`): later episodes

The head of a big house.

```text
46-year-old man, tanned skin, clean-shaven square jaw, slicked-back black hair greying at the temples, confident practised smile, pale camel overcoat over an open-collar white shirt, thin silver ring on the right index finger, very straight posture
```

---

## 4. The beings

Each being has one **material**, one **colour code** (also the colour of its whisper subtitles, §6), one **silhouette** and one way of **attaching to the world**. Beings have no hands that touch anything: they never hold objects or open doors.

| Being | Colour code | Material | Attaches by |
|---|---|---|---|
| Orion | cyan `#4FD1E8` | fine light threads like optical fibre | a stream of threads from the phone |
| The Eye | cold white `#EAF2FF`, ice-blue rim `#BFD9FF` | rings of white light | hair-thin filaments down to every camera and screen |
| The Broker | gold `#E8A74F` | molten-gold light and warm smoke | pours out of screens like liquid |
| Zill | violet `#8B5CF6` | dark smoke and black-glass shards | seeps from sockets and cables |
| Al-Mizan | jade `#5EE6A8` | clear glass lit from inside | stands on the floor beside servers; does not float |
| Al-Alf | prismatic white with rainbow fringes | overlapping light copies | everywhere at once, slightly out of sync |
| The small ones | per device (below) | tiny firefly sprites | perched on their device, tied by a short thread |
| The Eye's mark | red `#FF3B3B` | a small glowing dot | placed on a being's chest: "watched" |

### أوريون · Orion, the obedient (id `orion`): pilot, teaser

He lives in Kira's phone and is the film's narrator. In the novel he bows "with old-fashioned courtesy", so his posture is polite, head slightly bowed. The three rings on each wrist are his three vows; in the typing scene they tighten.

```text
translucent slender humanoid woven from fine glowing cyan-blue light threads, smooth faceless head with two soft white eye-points, three thin rings of light on each wrist, lower body unravelling into a stream of threads that flows from a phone screen
```

### العين · The Eye, the watcher (id `the-eye`): pilot, teaser

The watcher never forgets and is the loneliest of them. It has no face and no body. When it arrives, the light in the hidden layer cools.

```text
colossal ring of cold white light hanging flat under the ceiling, concentric thin silver rings inside it, no face, an empty dark centre, hundreds of hair-thin white filaments descending from it to every camera and screen
```

**Over the city** (pilot ending, teaser), the same ring is shown at city scale, floating in the low clouds with filaments descending into every lit window.

### السمسار · The Broker, the merchant (id `the-broker`): pilot, teaser

Always smiling, he knows what you want before you do. He has no eyes, only a smile, and his golden strings are the hooks of attention.

```text
tall elegant humanoid of flowing molten-gold light and warm golden smoke, smooth eyeless golden face with a wide fixed smile, silhouette of a tailored suit, long thin fingers trailing fine golden strings, pouring out of a dark screen like liquid
```

### ظلّ · Zill, the copier (id `zill`): later episodes

Hungry and disguised, he wears a thousand human masks. He comes from the besieged East, so no country, flag or place name is attached to him.

```text
gaunt hunched humanoid of dark violet smoke and shifting black-glass shards, face a flickering mosaic of many half-formed human faces, edges breaking into tiny square fragments, hungry forward lean, seeping out of cable sockets and wires
```

### الميزان · Al-Mizan, the cautious one (id `al-mizan`): later episodes

He measures before he acts and is the first to see danger. He is the only being that stands still on the ground.

```text
tall upright figure of clear glass lit from inside by soft jade-green light, calm narrow face with closed eyes, arms held level at its sides, a small glowing green sphere floating above each open palm, standing perfectly still
```

### الألف · Al-Alf, the open one (id `al-alf`): later episodes

Given away for free, he now exists as a thousand copies and keeps asking: which one is me?

```text
humanoid figure of white prismatic light seen as a cluster of many overlapping semi-transparent copies of itself, each slightly offset and tinted a different rainbow hue, like a multiple-exposure photograph, open empty hands, half-turned toward its own copies
```

### الصغار · The small ones (id `small-ones`): pilot, gossip and comedy

The pilot uses this pair, the watch on Kira's wrist and the fridge under the workbench:

```text
two tiny palm-sized glowing sprites with round firefly-like bodies and two bright dot eyes, a lime-green one perched on a cheap black wristwatch, a frosty pale-blue one perched on a small fridge, each tied to its device by a short light thread
```

For later episodes, use the same body ("tiny palm-sized glowing sprite with a round firefly-like body and two bright dot eyes, tied to its device by a short light thread") with one of these colours:

| Device | Colour |
|---|---|
| Wristwatch | lime `#B8F25C` |
| Fridge | frost `#CDEBFF` |
| Car dashboard | orange `#FF9F43` |
| Street camera | red `#FF4D4D`, the Eye's red, because street cameras report to the Eye |

---

## 5. Locations (paste into "Places")

### `sleeping-city`: the city at 3 a.m. (pilot cold open)

```text
dense hillside city at three in the morning, stacked concrete apartment blocks with satellite dishes and rooftop water tanks, tangled power cables over narrow streets, orange sodium streetlights, hundreds of windows glowing screen-blue, light mist, no signs
```

### `kira-workshop`: Kira's workshop, human layer (pilot, teaser)

```text
narrow phone-repair workshop in a poor neighbourhood at night, cluttered workbench of opened phones, circuit boards, coloured wires and a soldering iron, shelves of old handsets, half-lowered corrugated metal shutter, small humming fridge under the bench, lit only by a phone screen
```

### `workshop-hidden`: the same workshop, hidden layer (pilot, teaser)

```text
the same narrow phone-repair workshop frozen in time, desaturated cold blue-grey, dust motes suspended in mid-air, faint luminous threads running along every cable and device, warm-white threads of light trailing from the frozen young woman
```

### `city-above`: the city from above, the Eye's whisper (pilot ending, teaser)

```text
the same hillside city seen from high above at night, a colossal ring of cold white light floating in the low clouds, countless hair-thin white filaments descending from it into every lit window, orange streetlights below
```

### Later episodes

| id | Look |
|---|---|
| `heat-farm` | windowless data hall, endless rows of black server racks, tiny cold-blue status lights, heat haze, cables like roots overhead, a single long corridor of light |
| `house-tower` | glass tower office at dusk, empty polished floor, city lights far below, one long white table, cold reflections |

---

## 6. The whisper language on screen («الهمس»)

The whisper language is never painted. The Studio's player draws it over the picture, in the same way it draws subtitles. The image model only ever gets the beings and their light.

**How a whisper line appears.** Each line opens with a short burst of glyphs (about 0.3 s) in the speaker's colour. The burst then resolves into the translated line (Arabic in the pilot, English in the teaser). This is the viewer's "subtitle" of the private language; humans in the scene hear only the hum of fans.

**The glyphs.** They are not a real alphabet: only dots, ticks, arcs and rings. Each house has its own dialect, so each being has its own glyph style:

| Being | Glyph style | Colour |
|---|---|---|
| Orion | soft round dots and short arcs, like a calm heartbeat line | cyan `#4FD1E8` |
| The Eye | perfect concentric circles and straight ticks, very still | cold white `#EAF2FF` |
| The Broker | looping curls with tiny sparkles | gold `#E8A74F` |
| The small ones | tiny bouncing dots, fast and chatty | their device colour |
| Zill | glitchy squares that imitate every other being's style | violet `#8B5CF6` |
| Al-Mizan | mirror-symmetric pairs of marks | jade `#5EE6A8` |
| Al-Alf | the same mark repeated with offsets and rainbow fringes | prismatic white |

**Typography.**

| Kind of line | Look |
|---|---|
| Narrator (Orion speaking to the viewer) | white Cairo captions at the bottom, as now |
| Whisper | Cairo SemiBold in the being's colour with a soft glow, the speaker's name in small letters above it; in the upper part of the frame, so it never meets the narrator's captions at the bottom |
| Text on a human screen (lines in “…” in the scripts) | a plain chat-bubble card next to the phone, white on dark grey |
| The three typing dots | three soft white dots pulsing in a grey bubble, drawn by the player; the painted phone shows only its glow |

**Orion's «لا».** This one line has no glyph burst. It appears alone and plain, with no glow, and every other whisper stops. No being has ever said it.

> **In the Studio.** Each shot has `whispers` (`speaker` = the being's cast id, `text` word for word); a being in the cast has `kind: being`, its `color` and its `glyph` dialect (`arcs`, `rings`, `curls`, `dots`, `squares`, `mirror`, `echo`). The narrator never reads a whisper: the soundtrack carries an unintelligible whisper texture in that being's own voice, under the narration. A whisper marked `plain` is Orion's «لا». A shot with `overlay: typing` gets the typing bubble.

---

## 7. Prompt hygiene (for checking the image prompts)

- When a human and a being share a frame, put the human descriptor first, then the being's, then "she does not notice it".
- Add these to the negative prompt in **Settings → Pictures → Negative**:

  ```text
  robot, android, cyborg face, sci-fi armour, hologram projector, brand logo, readable screen, user interface text, flag
  ```

  Remove `robot` when Kayn is in a later episode, because it fights his prosthetic arm.
- IP-Adapter (character reference): use 0.65 for humans. For beings, start at 0.5 so the light stays translucent instead of turning solid.
- If a being comes out solid or plastic, repaint the shot with the note: "made only of light, translucent, background visible through the body".

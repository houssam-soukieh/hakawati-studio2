// Hakawati Studio — the control panel in the browser. One page, hash routes (#/, #/new, #/p/<id>/<tab>).
// The server owns every file; this page edits the screenplay (autosaved), starts jobs and follows them over SSE,
// and plays the animatic: the same player.html the renderer uses, chained shot by shot with the real voices.
// Interface in English by default or Arabic (RTL), chosen in the sidebar and kept in Settings.
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (v, d = 1) => (Math.round((Number(v) || 0) * 10 ** d) / 10 ** d).toString();
const mmss = s => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// ---------------------------------------------------------------- language
let UI = 'en';
const isRTL = () => UI === 'ar';
// Arabic counted nouns: 1 and 2 have their own forms, 3–10 take the plural, 11 and up the singular.
const arN = (n, [one, two, few, many]) => n === 1 ? one : n === 2 ? two : n % 100 >= 3 && n % 100 <= 10 ? `${n} ${few}` : `${n} ${many}`;
const T = {
  en: {
    tagline: 'Hakawati Studio · story to film', newStory: '＋ New story', yourStories: 'Your stories', noStories: 'No stories yet. Start one with “New story”.',
    engineTitle: 'Engine and settings', noJobs: 'No jobs', stop: '⏹ Stop', log: 'Log', switchLang: 'العربية', langTitle: 'Interface language', menu: 'Menu',
    shotsN: n => `${n} shot${n === 1 ? '' : 's'}`, noScript: 'no screenplay', mockEngine: 'Offline test engine (no key)',
    heroText: 'Write a story. The director cuts it into scenes and shots, the narrator records it, every shot is painted and set in motion, then filmed frame by frame and cut into a film with music and subtitles.',
    heroBtn: '＋ Start a new story', how: ['Story and look', 'The director writes the montage', 'The narrator sets the rhythm', 'Every shot painted', 'Filmed frame by frame', 'MP4 film + subtitles'],
    storyTitle: 'Story title (optional)', storyTitlePh: 'The director suggests one if left empty', story: 'The story', storyPh: 'Write or paste your story here…', needStory: 'Write the story first',
    words: n => `${n} word${n === 1 ? '' : 's'}`, sample: '✨ Sample story', look: 'Visual style', frame: 'Frame', narratorLang: 'Narration language',
    length: n => `Length: about <b id="fLenV">${n}</b> s`, narratorVoice: 'Narrator voice', quality: 'Quality', fromSettings: 'From Settings',
    defaultVoice: v => `Default (${v})`, female: 'female', male: 'male', captions: 'Subtitles on screen', music: 'Background music', consistentCast: 'Consistent characters',
    directorNotes: 'Notes for the director', audience: 'Audience', audiencePh: 'e.g. children 6–10', notes: 'Notes', notesPh: 'Rhythm, ending, what must or must not appear…',
    newTitle: 'New <span class="rq">story</span>', newHint: 'Write the story and pick the look; the director then writes the screenplay. You can edit every shot before it is painted.',
    writeScreenplay: '🎬 Write the screenplay', saveOnly: 'Save only', ctrlEnter: 'Ctrl+Enter', notWritten: 'The screenplay is not written yet.', running: '⏳ Working',
    makeFilm: '🎞 Make the film', revealTitle: 'Open the project folder', trashTitle: 'Move to trash',
    trashQ: 'Move the story to the trash?', trashText: v => `“<bdi>${v}</bdi>” moves to <code dir="ltr">projects/_trash</code>; nothing is deleted.`, move: 'Move',
    tabs: { story: 'Story', board: 'Storyboard', cast: 'Characters & look', room: 'Screening room' }, queuedToast: 'Added to the queue',
    rewriteQ: 'Write a new screenplay?', rewriteText: 'The director writes the montage again. The current screenplay is kept in <code dir="ltr">history</code>, but your shot edits do not carry over.', rewriteBtn: 'Write again',
    save: '💾 Save', saveAndWrite: has => `🎬 Save and ${has ? 'rewrite' : 'write'} the screenplay`, storyHint: 'Changing the style or frame repaints the shots; changing the story changes nothing until the screenplay is rewritten.', saved: 'Saved',
    titleCard: '🎬 Title card', endCard: '🏁 End card', noArtYet: 'Not painted yet', titleLbl: 'Title', endLbl: 'End',
    transitionTitle: 'Transition into the next shot', secondsTitle: 'Length in seconds', minSecondsTitle: 'Minimum length in seconds (the voice may lengthen it)',
    shotSize: 'Shot size', cameraMove: 'Camera move', narrationPh: 'Narrator line (leave empty for a silent beat)', forArtist: 'What we see and what moves (for the artist)',
    visualPh: 'Composition: background, midground, foreground, characters, light…', actionPh: 'What moves, in order, with timing…', imagePrompt: 'Picture prompt',
    motionLbl: 'Motion', motionOpts: { 1: '🖼 Still + camera', 2: '🎥 Image to video' }, score: n => `★ ${n}/10`, critique: 'Critic’s note', stClip: 'Image-to-video clip', stDepth: 'Depth map (2.5D)',
    motionOff: 'Image-to-video is off in Settings → Motion, so this shot stays a still picture with a camera move.',
    lens: 'Lens', lensPh: 'e.g. 35mm, shallow depth of field', light: 'Light', lightPh: 'e.g. warm rim light at dusk',
    whispers: n => `💬 Whispers (${n})`, addWhisper: '＋ Add whisper', speaker: 'Speaker', noSpeaker: '— none —', whisperPh: 'What the being whispers…',
    plain: 'Plain', plainTitle: 'A plain line, without the whisper effect', typing: 'Typing bubble (“typing…”)', moveUp: 'Move up', moveDown: 'Move down', remove: 'Remove',
    kind: 'Kind', kinds: { human: 'Human', being: 'Being' }, beingColor: 'Colour', glyph: 'Glyph',
    glyphs: { arcs: 'Arcs', rings: 'Rings', curls: 'Curls', dots: 'Dots', squares: 'Squares', mirror: 'Mirror', echo: 'Echo', '': 'None' },
    whisperSound: 'Whisper sound', whisperGain: 'Whisper level (dB under the narration, −40…0)',
    doctor: n => `🩺 Script doctor: ${n} note${n === 1 ? '' : 's'}`, doctorPass: (i, n) => `Pass ${i} · ${n} note${n === 1 ? '' : 's'}`,
    placeholder: 'Placeholder', placeholderTitle: 'A rough stand-in drawing, not a real picture',
    noPicEngine: 'No picture engine connected — these are placeholders. Connect ComfyUI in Settings → Pictures for real images.', openPictures: '⚙ Picture settings',
    redraw: 'Paint again with a note', before: 'Move earlier', after: 'Move later', dupShot: 'Duplicate shot', delShot: 'Delete shot', playShot: id => `Play shot ${id}`,
    scenesShots: (a, b) => `${a} scene${a === 1 ? '' : 's'} · ${b} shot${b === 1 ? '' : 's'}`, livePreview: '▶ Live preview', recordVoices: '🎙 Record voices', recordVoicesTitle: 'Voices only: fixes the length of every shot',
    drawMissing: '🎨 Paint what is missing', addShot: '＋ Shot in this scene', addScene: '＋ New scene', sceneN: n => `Scene ${n}`, sceneTitle: 'Scene title', atLeastOne: 'Keep at least one shot',
    deleteQ: id => `Delete shot ${id}?`, emptyShot: 'Empty shot', del: 'Delete', redrawTitleQ: id => `Paint ${id} again`,
    redrawNote: 'Tell the artist what to change. It starts from the current picture and keeps a copy of it. Leave empty for a fresh picture.',
    redrawPh: 'e.g. make the sky a night sky, a bigger lantern, slower fox', draw: '🖌 Paint', cancel: 'Cancel', close: 'Close', enterHint: 'Enter paints · Shift+Enter starts a new line',
    unsaved: '● Unsaved changes', savedChip: '✓ Saved', stVoice: 'Voice', stArt: 'Picture', stFilm: 'Filming', ready: 'ready', needsRedo: 'needs redoing',
    filmTitle: 'Film title', logline: 'The idea in one line', mood: 'Music mood', artStyle: 'Film look (for the artist, in English)', palette: 'Film colours',
    paletteNames: { bg: 'Background', sky1: 'Sky 1', sky2: 'Sky 2', ink: 'Ink', accent: 'Accent', accent2: 'Accent 2', shadow: 'Shadow' },
    paletteNote: 'Changing the colours, the look or a character’s description makes every picture outdated; “Make the film” redoes them.', places: 'Places',
    characters: 'Characters', redrawCast: '👥 Draw the characters again', castOff: 'Consistent characters are off for this story', noCast: 'No characters in this screenplay.',
    lookLbl: 'Look (for the artist)', personality: 'Personality', castSheetAlt: 'Character sheet', portraitsNote: 'Reference portraits: every shot with this character is painted from it (IP-Adapter).',
    film: '🎬 Film', stages: 'Stages', pipe: ['Voice', 'Characters', 'Pictures', 'Filming', 'Film'], stale: 'The film is older than your latest edits. “Make the film” redoes only what changed.',
    updateFilm: '🎞 Update the film', rerender: '↻ Film again', rerenderTitle: 'Films and cuts again even if nothing changed', download: 'Download',
    mp4: '⬇ Film (MP4)', srt: '⬇ Subtitles (SRT)', thumb: '⬇ Thumbnail', notMade: 'The film is not made yet. The live preview plays the painted shots with their voices before filming.',
    noPlay: 'This browser cannot play the film (H.264). Download it, or open the Studio in Chrome or Edge.',
    secs: n => `${n} s`, liveTitle: v => `Live preview — ${v}`, shotTitle: (id, s) => `Shot ${id} — ${s} s`, autoNotes: 'Automatic check notes', noArtShot: id => `${id} — not painted yet`,
    settingsTitle: '⚙ Engine and settings', keyNote: 'The key is stored on this computer only (<code dir="ltr">.studio/settings.json</code>) and sent only to the engine’s own address. The browser only ever sees it masked.',
    sections: { engine: 'Engine', pictures: 'Pictures', motion: 'Motion', narrator: 'Narrator', filming: 'Filming' },
    preset: 'Ready-made engine', protocol: 'Protocol', model: 'Model', baseUrl: 'Address (Base URL)', apiKey: 'API key', keepKey: v => `${v} — leave empty to keep it`, pasteKey: 'Paste the key here',
    artModel: 'Model for drawing (optional)', artModelPh: 'Same model if empty', temperature: v => `Temperature: <b id="sTempV">${v}</b>`, painters: 'Artists at once',
    doctorPasses: 'Script doctor passes', doctorNote: '0 = off. Each pass rereads the screenplay and fixes rhythm, continuity and weak lines before you see it.',
    test: '🔌 Test the connection', testing: '… connecting', modelsAvail: n => `${n} models available`, vision: ok => `Vision ${ok ? '✓' : '✗'} — needed for the picture critic`,
    narrator: 'Narrator', ratePitch: 'Rate / pitch', filming: 'Filming',
    fps: 'Frames per second', pictures: 'Pictures (ComfyUI on your GPU)',
    picturesNote: 'Real pictures come from ComfyUI with an SDXL checkpoint (e.g. RealVisXL V5 Lightning or Juggernaut XL Lightning). Run ComfyUI on this computer and keep it on 127.0.0.1.',
    picOff: 'Off (placeholders only)', picComfy: 'ComfyUI', comfyUrl: 'ComfyUI address', checkpoint: 'Checkpoint', steps: 'Steps', cfg: 'CFG', sampler: 'Sampler', scheduler: 'Scheduler',
    negative: 'Negative prompt', ipadapter: 'Keep faces with IP-Adapter (needs ComfyUI_IPAdapter_plus)', ipWeight: 'IP-Adapter weight', testComfy: '🔌 Test ComfyUI',
    candidates: 'Pictures to choose from (1–4)', critic: 'Picture critic', minScore: 'Lowest accepted score (1–10)', maxRounds: 'Repaint rounds (1–3)', upscaler: 'Upscaler (empty = none)',
    criticNote: 'The critic uses the text engine with vision: it looks at the candidate pictures, keeps the best one and repaints any picture that scores below the threshold.',
    motionTitle: 'Motion (image to video)', motionNote: 'Image-to-video runs only on shots marked “Image to video” in the storyboard (motion 2); every other shot stays a still picture with a camera move.',
    videoOff: 'Off', videoWan: 'Wan 2.2 (TI2V 5B)', unet: 'Video model (UNet)', clipModel: 'Text encoder (CLIP)', vae: 'VAE', clipSeconds: 'Clip length (s)', clipFps: 'Clip frames per second',
    depth: '2.5D parallax for still shots (from a depth map)',
    comfyOk: v => `✓ ComfyUI ${v.version} · ${v.gpu || 'GPU?'}${v.vram ? ` ${v.vram} GB` : ''} · ${(v.checkpoints ?? []).length} checkpoints${v.upscalers ? ` · ${v.upscalers.length} upscalers` : ''}`,
    ipOk: 'IP-Adapter ✓', ipNo: 'IP-Adapter ✗', ipMissing: m => `IP-Adapter: nodes installed, models missing: ${m}`,
    settingsSaved: 'Settings saved', failedSt: e => `Failed: ${e}`, stoppedSt: 'Stopped', doneSt: d => `Done ✓ (${d})`, queuedMore: n => ` (+${n} queued)`,
    reconnect: 'Lost the connection to the Studio… retrying', bootFail: e => `Could not reach the Studio: ${esc(e)}<br>Run <code dir="ltr">npm run studio</code> and reload this page.`,
    jobLabels: { script: 'Writing the screenplay', film: 'Making the film', voices: 'Recording voices', paint: 'Painting', cast: 'Drawing the characters', rerender: 'Filming again', redraw: id => `Painting ${id}` },
  },
  ar: {
    tagline: 'من الحكاية إلى الفيلم', newStory: '＋ حكاية جديدة', yourStories: 'حكاياتك', noStories: 'لا حكايات بعد. ابدأ واحدة من «حكاية جديدة».',
    engineTitle: 'المحرك والإعدادات', noJobs: 'لا مهام', stop: '⏹ إيقاف', log: 'السجل', switchLang: 'English', langTitle: 'لغة الواجهة', menu: 'القائمة',
    shotsN: n => arN(n, ['لقطة واحدة', 'لقطتان', 'لقطات', 'لقطة']), noScript: 'بلا سيناريو', mockEngine: 'المولّد التجريبي (بلا مفتاح)',
    heroText: 'اكتب حكاية، فيقطّعها المخرج إلى مشاهد ولقطات، ويسجّل الراوي صوتها، وتُرسم كل لقطة وتتحرك، ثم تُصوَّر إطاراً بإطار وتُركَّب فيلماً بموسيقى وترجمة.',
    heroBtn: '＋ ابدأ حكاية جديدة', how: ['الحكاية والأسلوب', 'المخرج يكتب المونتاج', 'الراوي يضبط الإيقاع', 'رسم كل لقطة', 'تصوير إطاراً بإطار', 'فيلم MP4 مع الترجمة'],
    storyTitle: 'عنوان الحكاية (اختياري)', storyTitlePh: 'يقترح المخرج عنواناً إن تركته فارغاً', story: 'الحكاية', storyPh: 'اكتب حكايتك هنا أو الصقها…', needStory: 'اكتب الحكاية أولاً',
    words: n => arN(n, ['كلمة واحدة', 'كلمتان', 'كلمات', 'كلمة']), sample: '✨ حكاية تجريبية', look: 'الأسلوب البصري', frame: 'الإطار', narratorLang: 'لغة الراوي',
    length: n => `الطول التقريبي: <b id="fLenV">${n}</b> ثانية`, narratorVoice: 'صوت الراوي', quality: 'الجودة', fromSettings: 'من الإعدادات',
    defaultVoice: v => `الافتراضي (${v})`, female: 'أنثى', male: 'ذكر', captions: 'ترجمة على الشاشة', music: 'موسيقى خلفية', consistentCast: 'شخصيات ثابتة الملامح',
    directorNotes: 'ملاحظات للمخرج', audience: 'الجمهور', audiencePh: 'مثلاً: أطفال من 6 إلى 10 سنوات', notes: 'ملاحظات', notesPh: 'الإيقاع، النهاية، ما يجب أن يظهر وما يجب ألا يظهر…',
    newTitle: 'حكاية <span class="rq">جديدة</span>', newHint: 'اكتب الحكاية واختر الأسلوب، ثم يكتب المخرج السيناريو. يمكنك تعديل كل لقطة قبل رسمها.',
    writeScreenplay: '🎬 اكتب السيناريو', saveOnly: 'حفظ فقط', ctrlEnter: 'Ctrl+Enter', notWritten: 'لم يُكتب السيناريو بعد.', running: '⏳ قيد العمل',
    makeFilm: '🎞 اصنع الفيلم', revealTitle: 'فتح مجلد المشروع', trashTitle: 'نقل إلى سلة المهملات',
    trashQ: 'نقل الحكاية إلى سلة المهملات؟', trashText: v => `ستُنقل «<bdi>${v}</bdi>» إلى <code dir="ltr">projects/_trash</code>، ولن يُحذف منها شيء.`, move: 'نقل',
    tabs: { story: 'الحكاية', board: 'لوحة اللقطات', cast: 'الشخصيات والأسلوب', room: 'قاعة العرض' }, queuedToast: 'أُضيفت المهمة إلى قائمة الانتظار',
    rewriteQ: 'كتابة سيناريو جديد؟', rewriteText: 'سيكتب المخرج المونتاج من جديد. يُحفظ السيناريو الحالي في مجلد <code dir="ltr">history</code>، لكن تعديلاتك على اللقطات لن تنتقل إلى السيناريو الجديد.', rewriteBtn: 'اكتب من جديد',
    save: '💾 حفظ', saveAndWrite: has => `🎬 حفظ و${has ? 'إعادة كتابة' : 'كتابة'} السيناريو`, storyHint: 'تغيير الأسلوب أو الإطار يعيد رسم اللقطات، أما تغيير الحكاية فلا أثر له حتى يُعاد كتابة السيناريو.', saved: 'حُفظت',
    titleCard: '🎬 بطاقة العنوان', endCard: '🏁 بطاقة النهاية', noArtYet: 'لم تُرسم بعد', titleLbl: 'العنوان', endLbl: 'النهاية',
    transitionTitle: 'الانتقال إلى اللقطة التالية', secondsTitle: 'المدة بالثواني', minSecondsTitle: 'أقل مدة بالثواني (قد يطيلها الصوت)',
    shotSize: 'حجم اللقطة', cameraMove: 'حركة الكاميرا', narrationPh: 'جملة الراوي (اتركها فارغة للقطة صامتة)', forArtist: 'ما نراه وما يتحرك (للرسّام)',
    visualPh: 'Composition: background, midground, foreground, characters, light…', actionPh: 'What moves, in order, with timing…', imagePrompt: 'وصف الصورة',
    motionLbl: 'الحركة', motionOpts: { 1: '🖼 صورة ثابتة + كاميرا', 2: '🎥 فيديو من الصورة' }, score: n => `★ ${n}/10`, critique: 'ملاحظة الناقد', stClip: 'مقطع الفيديو من الصورة', stDepth: 'خريطة العمق (2.5D)',
    motionOff: 'التحويل من صورة إلى فيديو معطّل في الإعدادات ← الحركة، فتبقى هذه اللقطة صورة ثابتة تتحرك فوقها الكاميرا.',
    lens: 'العدسة', lensPh: 'e.g. 35mm, shallow depth of field', light: 'الإضاءة', lightPh: 'e.g. warm rim light at dusk',
    whispers: n => `💬 الهمس (${n})`, addWhisper: '＋ أضف همسة', speaker: 'المتكلّم', noSpeaker: '— بلا —', whisperPh: 'ما يهمس به الكائن…',
    plain: 'عادي', plainTitle: 'سطر عادي بلا مؤثر الهمس', typing: 'فقاعة «يكتب الآن…»', moveUp: 'إلى الأعلى', moveDown: 'إلى الأسفل', remove: 'إزالة',
    kind: 'النوع', kinds: { human: 'إنسان', being: 'كائن' }, beingColor: 'اللون', glyph: 'العلامة',
    glyphs: { arcs: 'أقواس', rings: 'حلقات', curls: 'لفائف', dots: 'نقاط', squares: 'مربعات', mirror: 'مرآة', echo: 'صدى', '': 'بلا' },
    whisperSound: 'صوت الهمس', whisperGain: 'مستوى الهمس (ديسيبل تحت صوت الراوي، من −40 إلى 0)',
    doctor: n => `🩺 طبيب السيناريو: ${arN(n, ['ملاحظة واحدة', 'ملاحظتان', 'ملاحظات', 'ملاحظة'])}`, doctorPass: (i, n) => `الجولة ${i} · ${arN(n, ['ملاحظة واحدة', 'ملاحظتان', 'ملاحظات', 'ملاحظة'])}`,
    placeholder: 'صورة مؤقتة', placeholderTitle: 'رسم تقريبي مؤقت، وليس صورة حقيقية',
    noPicEngine: 'لا يوجد محرك صور متصل، وهذه صور مؤقتة فقط. اربط ComfyUI من الإعدادات ← الصور لتحصل على صور حقيقية.', openPictures: '⚙ إعدادات الصور',
    redraw: 'ارسم من جديد بملاحظة', before: 'تقديم اللقطة', after: 'تأخير اللقطة', dupShot: 'تكرار اللقطة', delShot: 'حذف اللقطة', playShot: id => `تشغيل اللقطة ${id}`,
    scenesShots: (a, b) => `${arN(a, ['مشهد واحد', 'مشهدان', 'مشاهد', 'مشهداً'])} · ${arN(b, ['لقطة واحدة', 'لقطتان', 'لقطات', 'لقطة'])}`, livePreview: '▶ المعاينة الحية', recordVoices: '🎙 سجّل الأصوات', recordVoicesTitle: 'تسجيل الأصوات فقط: يضبط طول كل لقطة',
    drawMissing: '🎨 ارسم ما ينقص', addShot: '＋ لقطة في هذا المشهد', addScene: '＋ مشهد جديد', sceneN: n => `المشهد ${n}`, sceneTitle: 'عنوان المشهد', atLeastOne: 'لا بد من لقطة واحدة على الأقل',
    deleteQ: id => `حذف اللقطة ${id}؟`, emptyShot: 'لقطة فارغة', del: 'حذف', redrawTitleQ: id => `ارسم ${id} من جديد`,
    redrawNote: 'اكتب للرسّام ما تريد تغييره، بالعربية أو بالإنجليزية. سيبدأ من الرسم الحالي ويحتفظ بنسخة منه. اتركها فارغة لرسم جديد تماماً.',
    redrawPh: 'مثلاً: اجعل السماء ليلية، وكبّر الفانوس، وأبطئ حركة الثعلب', draw: '🖌 ارسم', cancel: 'إلغاء', close: 'إغلاق', enterHint: 'Enter للرسم · Shift+Enter لسطر جديد',
    unsaved: '● تعديلات غير محفوظة', savedChip: '✓ محفوظ', stVoice: 'الصوت', stArt: 'الرسم', stFilm: 'التصوير', ready: 'جاهز', needsRedo: 'يحتاج إلى إعادة',
    filmTitle: 'عنوان الفيلم', logline: 'الفكرة في جملة واحدة', mood: 'مزاج الموسيقى', artStyle: 'أسلوب الفيلم (للرسّام، بالإنجليزية)', palette: 'ألوان الفيلم',
    paletteNames: { bg: 'الخلفية', sky1: 'السماء 1', sky2: 'السماء 2', ink: 'الحبر', accent: 'لون بارز', accent2: 'لون بارز 2', shadow: 'الظل' },
    paletteNote: 'تغيير الألوان أو الأسلوب أو أوصاف الشخصيات يجعل الرسوم كلها قديمة، فيعيدها «اصنع الفيلم».', places: 'الأماكن',
    characters: 'الشخصيات', redrawCast: '👥 ارسم الشخصيات من جديد', castOff: 'الشخصيات الثابتة معطّلة في هذه الحكاية', noCast: 'لا شخصيات في هذا السيناريو.',
    lookLbl: 'الملامح (للرسّام)', personality: 'الطباع', castSheetAlt: 'لوحة الشخصيات', portraitsNote: 'صور مرجعية: كل لقطة تظهر فيها الشخصية تُرسم انطلاقاً من صورتها (IP-Adapter).',
    film: '🎬 الفيلم', stages: 'مراحل الصناعة', pipe: ['الصوت', 'الشخصيات', 'الرسم', 'التصوير', 'الفيلم'], stale: 'الفيلم أقدم من آخر تعديلاتك. «اصنع الفيلم» يعيد ما تغيّر فقط.',
    updateFilm: '🎞 حدّث الفيلم', rerender: '↻ أعد التصوير', rerenderTitle: 'يعيد التصوير والمونتاج حتى لو لم يتغير شيء', download: 'التنزيل',
    mp4: '⬇ الفيلم (MP4)', srt: '⬇ الترجمة (SRT)', thumb: '⬇ الصورة المصغّرة', notMade: 'لم يُصنع الفيلم بعد. تعرض المعاينة الحية اللقطات المرسومة بأصواتها قبل التصوير.',
    noPlay: 'لا يستطيع هذا المتصفح تشغيل الفيلم (H.264). نزّله، أو افتح الاستوديو في Chrome أو Edge.',
    secs: n => `${n} ث`, liveTitle: v => `المعاينة الحية — ${v}`, shotTitle: (id, s) => `اللقطة ${id} — ${s} ث`, autoNotes: 'ملاحظات الفحص الآلي', noArtShot: id => `${id} — لم تُرسم بعد`,
    settingsTitle: '⚙ المحرك والإعدادات', keyNote: 'يُحفظ المفتاح على هذا الحاسوب فقط (<code dir="ltr">.studio/settings.json</code>) ولا يُرسل إلا إلى عنوان المحرك نفسه، ولا يرى المتصفح منه إلا نسخة مخفية.',
    sections: { engine: 'المحرك', pictures: 'الصور', motion: 'الحركة', narrator: 'الراوي', filming: 'التصوير' },
    preset: 'محرك جاهز', protocol: 'البروتوكول', model: 'النموذج', baseUrl: 'العنوان (Base URL)', apiKey: 'المفتاح (API key)', keepKey: v => `${v} — اتركه فارغاً للإبقاء عليه`, pasteKey: 'الصق المفتاح هنا',
    artModel: 'نموذج الرسم (اختياري)', artModelPh: 'النموذج نفسه إن تُرك فارغاً', temperature: v => `درجة الحرارة: <b id="sTempV">${v}</b>`, painters: 'عدد الرسّامين في آن واحد',
    doctorPasses: 'جولات مراجعة السيناريو', doctorNote: '0 = بلا مراجعة. في كل جولة يعيد «طبيب السيناريو» قراءة النص ويصلح الإيقاع والتسلسل والجمل الضعيفة قبل أن تراه.',
    test: '🔌 اختبر الاتصال', testing: 'جارٍ الاتصال…', modelsAvail: n => `النماذج المتاحة: ${n}`, vision: ok => `الرؤية ${ok ? '✓' : '✗'} — يحتاجها ناقد الصور`,
    narrator: 'الراوي', ratePitch: 'السرعة / طبقة الصوت', filming: 'التصوير',
    fps: 'الإطارات في الثانية', pictures: 'الصور (ComfyUI على بطاقتك الرسومية)',
    picturesNote: 'تأتي الصور الحقيقية من ComfyUI بنموذج SDXL (مثل RealVisXL V5 Lightning أو Juggernaut XL Lightning). شغّل ComfyUI على هذا الحاسوب وأبقه على العنوان 127.0.0.1.',
    picOff: 'معطّلة (صور مؤقتة فقط)', picComfy: 'ComfyUI', comfyUrl: 'عنوان ComfyUI', checkpoint: 'النموذج (Checkpoint)', steps: 'الخطوات', cfg: 'CFG', sampler: 'Sampler', scheduler: 'Scheduler',
    negative: 'ما يجب تجنّبه (Negative prompt)', ipadapter: 'ثبات الوجوه عبر IP-Adapter (يتطلب ComfyUI_IPAdapter_plus)', ipWeight: 'قوة IP-Adapter', testComfy: '🔌 اختبر ComfyUI',
    candidates: 'عدد الصور المرشّحة (1–4)', critic: 'ناقد الصور', minScore: 'أدنى درجة مقبولة (1–10)', maxRounds: 'جولات إعادة الرسم (1–3)', upscaler: 'نموذج التكبير (فارغ = بلا تكبير)',
    criticNote: 'يستعين الناقد بمحرك النصوص القادر على الرؤية: يقارن الصور المرشّحة ويختار أفضلها، ويعيد رسم كل صورة تقل درجتها عن الحد الأدنى.',
    motionTitle: 'الحركة (من صورة إلى فيديو)', motionNote: 'لا يعمل التحويل من صورة إلى فيديو إلا على اللقطات المعلَّمة بـ«فيديو من الصورة» في لوحة اللقطات (الحركة 2)، وتبقى بقية اللقطات صوراً ثابتة تتحرك فوقها الكاميرا.',
    videoOff: 'معطّلة', videoWan: 'Wan 2.2 (TI2V 5B)', unet: 'نموذج الفيديو (UNet)', clipModel: 'مُرمِّز النص (CLIP)', vae: 'VAE', clipSeconds: 'طول المقطع (ثانية)', clipFps: 'إطارات المقطع في الثانية',
    depth: 'عمق 2.5D للّقطات الثابتة (من خريطة العمق)',
    comfyOk: v => `✓ ComfyUI ${v.version} · ${v.gpu || 'GPU?'}${v.vram ? ` ${v.vram} GB` : ''} · النماذج: ${(v.checkpoints ?? []).length}${v.upscalers ? ` · نماذج التكبير: ${v.upscalers.length}` : ''}`,
    ipOk: 'IP-Adapter ✓', ipNo: 'IP-Adapter ✗', ipMissing: m => `IP-Adapter: العُقد مثبّتة، لكن النماذج ناقصة: ${m}`,
    settingsSaved: 'حُفظت الإعدادات', failedSt: e => `تعذّر الإكمال: ${e}`, stoppedSt: 'أُوقفت', doneSt: d => `اكتملت ✓ (${d})`, queuedMore: n => ` (+${n} في الانتظار)`,
    reconnect: 'انقطع الاتصال بالاستوديو… جارٍ إعادة المحاولة', bootFail: e => `تعذّر الاتصال بالاستوديو: ${esc(e)}<br>شغّل <code dir="ltr">npm run studio</code> ثم أعد تحميل الصفحة.`,
    jobLabels: { script: 'كتابة السيناريو', film: 'صناعة الفيلم', voices: 'تسجيل الأصوات', paint: 'الرسم', cast: 'رسم الشخصيات', rerender: 'إعادة التصوير', redraw: id => `رسم ${id}` },
  },
};
const t = (k, ...a) => { const v = T[UI][k] ?? T.en[k]; return typeof v === 'function' ? v(...a) : v ?? k; };
const LABELS = {
  en: {
    shotType: { establishing: 'Establishing', wide: 'Wide', medium: 'Medium', close: 'Close', 'extreme-close': 'Extreme close', insert: 'Insert', 'over-shoulder': 'Over the shoulder', pov: 'Point of view' },
    camera: { static: 'Static', 'push-in': 'Push in', 'pull-out': 'Pull out', 'pan-left': 'Pan left', 'pan-right': 'Pan right', 'tilt-up': 'Tilt up', 'tilt-down': 'Tilt down', drift: 'Drift' },
    transition: { cut: 'Cut', fade: 'Fade', 'fade-black': 'Fade to black', 'wipe-left': 'Wipe left', 'wipe-right': 'Wipe right', 'slide-left': 'Slide left', 'slide-right': 'Slide right', 'circle-open': 'Circle', 'zoom-in': 'Zoom', smooth: 'Smooth' },
    mood: { calm: 'Calm', wonder: 'Wonder', tense: 'Tense', joyful: 'Joyful', sad: 'Sad', epic: 'Epic', mysterious: 'Mysterious', warm: 'Warm' },
  },
  ar: {
    shotType: { establishing: 'تأسيسية', wide: 'واسعة', medium: 'متوسطة', close: 'قريبة', 'extreme-close': 'قريبة جداً', insert: 'تفصيل', 'over-shoulder': 'فوق الكتف', pov: 'بعين الشخصية' },
    camera: { static: 'ثابتة', 'push-in': 'اقتراب', 'pull-out': 'ابتعاد', 'pan-left': 'استدارة يساراً', 'pan-right': 'استدارة يميناً', 'tilt-up': 'إمالة إلى الأعلى', 'tilt-down': 'إمالة إلى الأسفل', drift: 'انسياب' },
    transition: { cut: 'قطع', fade: 'تلاشٍ', 'fade-black': 'إظلام', 'wipe-left': 'مسح يساراً', 'wipe-right': 'مسح يميناً', 'slide-left': 'انزلاق يساراً', 'slide-right': 'انزلاق يميناً', 'circle-open': 'انفتاح دائري', 'zoom-in': 'تقريب', smooth: 'ناعم' },
    mood: { calm: 'هادئ', wonder: 'دهشة', tense: 'توتر', joyful: 'فرح', sad: 'حزن', epic: 'ملحمي', mysterious: 'غموض', warm: 'دافئ' },
  },
};
const L = k => LABELS[UI][k];
const LANGS = { ar: 'العربية', en: 'English', fr: 'Français' };
const styleLabel = s => (UI === 'ar' ? s.labelAr : s.label) ?? s.label;
const SAMPLE = {
  title: 'ليلى والنجمة',
  text: 'في قريةٍ صغيرة عند سفح الجبل، عاشت فتاةٌ اسمها ليلى تحبّ النجوم. كانت كل ليلة تصعد إلى سطح بيتها وتعدّ النجوم واحدةً واحدة. وفي ليلةٍ صافية، رأت نجمةً تسقط خلف التلال البعيدة. حملت ليلى فانوسها وانطلقت مع صديقها الثعلب الصغير نحو التلال. مشيا طويلاً بين الأشجار الصامتة حتى وجدا النجمة الصغيرة تبكي بين الصخور. قالت النجمة إنها فقدت طريقها إلى السماء. فكّرت ليلى قليلاً، ثم صعدت مع الثعلب إلى أعلى قمة، ورفعت فانوسها عالياً. رأت النجمة الضوء فعرفت الطريق، وطارت عائدةً إلى مكانها بين أخواتها. ومنذ تلك الليلة، صارت أجمل نجمة في السماء تلمع فوق بيت ليلى كل مساء.',
};

const S = {
  meta: null, settings: null, projects: [], voices: null,
  p: null, sp: null, tab: 'story', // current project view + the editable screenplay copy
  edit: 0, saved: 0, saving: null, saveTimer: null,
  jobs: new Map(), follow: null,
  ani: null,
};
// Defaults for settings keys the server may not send yet (POST /api/settings saves whatever it gets).
const IMAGE_DEF = { candidates: 2, critic: true, minScore: 7, maxRounds: 2, upscaler: '' };
const VIDEO_DEF = { engine: 'none', unet: 'wan2.2_ti2v_5B_fp16.safetensors', clip: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors', vae: 'wan2.2_vae.safetensors', steps: 20, cfg: 5, fps: 24, seconds: 5, depth: true };
const picturesOn = () => S.settings?.image?.engine === 'comfyui';
const videoOn = () => S.settings?.video?.engine === 'wan22';
/** A shot shown with a stand-in drawing rather than a real picture: never present it as a result. */
const placeholderShot = id => !picturesOn() || !S.p?.assets?.art?.[id]?.image;
const phBadge = (cls = '') => `<span class="ph-badge ${cls}" title="${esc(t('placeholderTitle'))}">${esc(t('placeholder'))}</span>`;
const iso = s => `⁨${s}⁩`; // bidi isolate: an Arabic title inside an English sentence (or the reverse) keeps its own order
/** Job labels are "<story title> — <what>"; isolate the title so mixed scripts read correctly. */
const jobText = label => { const [head, ...rest] = String(label ?? '').split(' — '); return rest.length ? `${iso(head)} — ${rest.join(' — ')}` : head; };

// ---------------------------------------------------------------- server
async function api(path, opts = {}) {
  const init = { method: opts.method ?? 'GET', headers: {} };
  if (opts.body !== undefined) { init.body = JSON.stringify(opts.body); init.headers['content-type'] = 'application/json'; }
  const r = await fetch(`/api/${path}`, init);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}
const pid = () => encodeURIComponent(S.p.id);
const fileUrl = f => `/files/${pid()}/${f.split('/').map(encodeURIComponent).join('/')}`;

function toast(msg, ms = 2600) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg; el.setAttribute('role', 'status');
  el.style.top = `${18 + 50 * $$('.toast').length}px`; // stack, don't overlap
  document.body.append(el);
  setTimeout(() => el.remove(), ms);
}
const fail = e => { console.error(e); toast(`⚠ ${e.message || e}`, 4500); };

/** A small modal: resolves with the clicked button's value, or null when closed (✕, backdrop or Escape). */
function modal(title, body, buttons = [{ label: t('close'), value: null }], { wide = false, onOpen, submit } = {}) {
  const d = $('#modal');
  d.style.width = wide ? 'min(1100px, 96vw)' : '';
  d.innerHTML = `<div class="dlg-h"><h2 id="modalTitle">${esc(title)}</h2><button class="icon-btn" data-v="__x" aria-label="${esc(t('close'))}">✕</button></div>
    <div class="dlg-b">${body}</div>
    <div class="dlg-f">${buttons.map((b, i) => `<button class="btn ${b.cls ?? ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div>`;
  return new Promise(resolve => {
    // Clean up synchronously: the dialog's own "close" event arrives a task later, possibly after the next
    // modal has opened, so a late one (dialog open again) is ignored.
    let finished = false;
    const finish = v => { if (finished) return; finished = true; stopAnimatic(); d.onclose = d.oncancel = null; d.innerHTML = ''; resolve(v); };
    const done = v => { finish(v); d.close(); };
    const pick = i => done(typeof buttons[i].value === 'function' ? buttons[i].value(d) : buttons[i].value);
    d.onclick = e => {
      const b = e.target.closest('button[data-i],button[data-v]');
      if (b?.dataset.v === '__x') return done(null);
      if (b?.dataset.i) return pick(b.dataset.i);
      if (e.target === d) done(null);
    };
    // Enter in a field submits with the first button (Shift+Enter keeps a newline in a textarea)
    d.onkeydown = e => { if (submit !== false && e.key === 'Enter' && !e.shiftKey && !e.isComposing && /INPUT|TEXTAREA/.test(e.target.tagName)) { e.preventDefault(); pick(0); } };
    d.oncancel = () => finish(null); // Escape
    d.onclose = () => { if (!d.open) finish(null); };
    d.showModal();
    $('.dlg-f .btn', d)?.focus();
    onOpen?.(d);
  });
}
const confirmBox = (title, html, ok, cls = 'primary') => modal(title, `<p style="margin:0">${html}</p>`, [{ label: ok, value: true, cls }, { label: t('cancel'), value: false, cls: 'ghost' }]);

/** Disable a button while its request runs, so a double click cannot start the same thing twice. */
async function busy(btn, work) {
  if (btn.disabled) return;
  btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  try { return await work(); } finally { btn.disabled = false; btn.removeAttribute('aria-busy'); }
}

// ---------------------------------------------------------------- shell: language, sidebar, engine chip
function applyLanguage() {
  document.documentElement.lang = UI;
  document.documentElement.dir = isRTL() ? 'rtl' : 'ltr';
  document.title = UI === 'ar' ? 'حكواتي — استوديو القصص' : 'Hakawati Studio';
  for (const el of $$('[data-t]')) el.textContent = t(el.dataset.t);
  for (const el of $$('[data-t-title]')) { el.title = t(el.dataset.tTitle); if (el.matches('.icon-btn')) el.setAttribute('aria-label', el.title); }
  $('#langBtn').textContent = t('switchLang');
  $('#langBtn').lang = isRTL() ? 'en' : 'ar';
  try { localStorage.setItem('hakawati.lang', UI); } catch { /* private window: the page still works */ }
  setDock(!$('#dock').classList.contains('collapsed'));
}
$('#langBtn').addEventListener('click', async () => {
  try { await flushSave(); await api('settings', { method: 'POST', body: { ui: { lang: UI === 'en' ? 'ar' : 'en' } } }); location.reload(); } catch (e) { fail(e); }
});

async function loadProjects() {
  S.projects = await api('projects');
  renderSide();
}
function renderSide() {
  const cur = S.p?.id;
  $('#projects').innerHTML = S.projects.length ? S.projects.map(p => `
    <a class="proj ${p.id === cur ? 'on' : ''}" href="#/p/${esc(p.id)}" ${p.id === cur ? 'aria-current="page"' : ''}>
      <div class="th" style="${p.thumb ? `background-image:url('${esc(p.thumb)}')` : ''}" aria-hidden="true">${p.thumb ? '' : '🎞'}</div>
      <div style="min-width:0"><div class="t" dir="auto">${esc(p.title)}</div>
        <div class="s">${p.shots ? t('shotsN', p.shots) : t('noScript')} · ${esc(p.aspect ?? '')}${p.final ? ' · ✅' : ''}</div></div>
    </a>`).join('') : `<div class="muted small empty-side">${t('noStories')}</div>`;
}
$('#newBtn').addEventListener('click', () => { location.hash = '#/new'; });

function renderEngineChip() {
  const e = S.settings?.engine; if (!e) return;
  const preset = S.settings.presets?.[e.preset];
  $('#engineName').textContent = e.protocol === 'mock' ? t('mockEngine') : `${preset ? styleLabel(preset) : e.preset} · ${e.model}`;
  for (const el of [$('#engineChip'), $('#topSettings')]) el.classList.toggle('ok', e.protocol === 'mock' || e.hasKey);
}
$('#engineChip').addEventListener('click', () => openSettings());
$('#topSettings').addEventListener('click', () => openSettings());

// Phones: the sidebar becomes a drawer behind the ☰ button.
function setNav(open) {
  document.body.classList.toggle('nav-open', open);
  $('#scrim').hidden = !open;
  $('#navBtn').setAttribute('aria-expanded', String(open));
  if (open) ($('#projects .on') ?? $('#newBtn')).focus();
}
const navOpen = () => document.body.classList.contains('nav-open');
$('#navBtn').addEventListener('click', () => setNav(!navOpen()));
$('#scrim').addEventListener('click', () => setNav(false));
$('#side').addEventListener('click', e => { if (navOpen() && e.target.closest('a,#newBtn,#engineChip')) setNav(false); });
addEventListener('keydown', e => {
  if (e.key === 'Escape' && navOpen() && !$('dialog[open]')) { setNav(false); $('#navBtn').focus(); }
  // div "buttons" (shot frames) answer Enter and Space like real buttons
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[role=button]:not(button)')) { e.preventDefault(); e.target.click(); }
});

// ---------------------------------------------------------------- router
async function route() {
  stopAnimatic();
  const h = location.hash.replace(/^#/, '') || '/';
  const m = h.match(/^\/p\/([^/]+)(?:\/(\w+))?/);
  try {
    if (m) {
      const id = decodeURIComponent(m[1]);
      if (S.p?.id !== id) { await flushSave(); await openProject(id); }
      S.tab = m[2] in T.en.tabs && (S.sp || m[2] === 'story') ? m[2] : (S.sp ? 'board' : 'story');
      renderProject();
    } else {
      await flushSave();
      S.p = null; S.sp = null;
      if (h === '/new') renderNew(); else renderHome();
    }
  } catch (e) {
    fail(e);
    if (m) { S.p = null; location.hash = '#/'; }
  }
  renderSide();
  renderDock();
}
addEventListener('hashchange', route);

async function openProject(id) {
  const p = await api(`projects/${encodeURIComponent(id)}`);
  S.p = p; S.sp = p.screenplay ? structuredClone(p.screenplay) : null;
  S.edit = S.saved = 0;
}

// ---------------------------------------------------------------- home
function renderHome() {
  $('#view').innerHTML = `
    <div class="hero">
      <div class="t">حكواتي</div>
      <p>${t('heroText')}</p>
      <button class="btn primary big" id="heroNew">${t('heroBtn')}</button>
      <div class="how">${['📜', '🎬', '🎙', '🎨', '🎞', '🏁'].map((e, i) => `<div><b>${e}</b>${t('how')[i]}</div>`).join('')}</div>
    </div>`;
  $('#heroNew').onclick = () => { location.hash = '#/new'; };
}

// ---------------------------------------------------------------- story form (new project + story tab)
/** Segmented control: one pressed button out of a few; `items` = [[value, html]]. */
const segHTML = (id, items, cur) => `<div class="seg" id="${id}" role="group" aria-labelledby="${id}Lbl">${items.map(([v, h]) => `<button type="button" data-v="${esc(v)}" class="${v === cur ? 'on' : ''}" aria-pressed="${v === cur}">${h}</button>`).join('')}</div>`;
const pickOne = (all, el) => { for (const x of all) { x.classList.toggle('on', x === el); x.setAttribute('aria-pressed', String(x === el)); } };
const bindSeg = (seg, then) => seg.addEventListener('click', e => { const b = e.target.closest('button'); if (!b || b.disabled) return; pickOne($$('button', seg), b); then?.(b.dataset.v); });

function storyFormHTML(p) {
  const o = p?.options ?? { language: 'ar', style: picturesOn() ? 'photoreal' : 'cinematic', aspect: '16:9', length: 60, voice: '', captions: true, music: true, consistentCast: true, audience: '', notes: '', quality: '', fps: 0 };
  const styles = S.meta.styles;
  return `
  <div class="story-grid">
    <div class="card" style="display:flex;flex-direction:column;gap:12px">
      <label class="f">${t('storyTitle')}<input type="text" id="fTitle" dir="auto" value="${esc(p?.title ?? '')}" placeholder="${esc(t('storyTitlePh'))}"></label>
      <label class="f">${t('story')}<textarea id="fStory" class="story-area" dir="auto" placeholder="${esc(t('storyPh'))}">${esc(p?.story ?? '')}</textarea></label>
      <div class="row"><span class="muted small" id="fCount"></span><span class="grow"></span>${p ? '' : `<button class="chip click gold" id="fSample">${t('sample')}</button>`}</div>
    </div>
    <div class="card" style="display:flex;flex-direction:column;gap:16px">
      <div><div class="f-lbl" id="fLookLbl">${t('look')}</div>
        <div class="styles" role="group" aria-labelledby="fLookLbl">${Object.entries(styles).map(([k, s]) => `
          <button type="button" class="style-card ${o.style === k ? 'on' : ''}" data-style="${k}" aria-pressed="${o.style === k}" title="${esc(s.brief)}">
            <span class="e" aria-hidden="true">${s.emoji}</span><span class="l">${esc(styleLabel(s))}</span>
            <span class="sw" aria-hidden="true">${['bg', 'sky1', 'sky2', 'accent', 'accent2'].map(c => `<i style="background:${esc(s.palette[c])}"></i>`).join('')}</span>
          </button>`).join('')}</div></div>
      <div class="seg-row">
        <div class="f"><span id="fAspectLbl">${t('frame')}</span>${segHTML('fAspect', Object.keys(S.meta.aspects).map(a => [a, { '16:9': '▭ 16:9', '9:16': '▯ 9:16', '1:1': '◻ 1:1' }[a] ?? a]), o.aspect)}</div>
        <div class="f"><span id="fLangLbl">${t('narratorLang')}</span>${segHTML('fLang', Object.entries(LANGS).map(([k, v]) => [k, `<span lang="${k}">${v}</span>`]), o.language)}</div>
      </div>
      <label class="f"><span>${t('length', o.length)}</span><input type="range" id="fLen" min="20" max="300" step="5" value="${o.length}"></label>
      <div class="grid2">
        <label class="f">${t('narratorVoice')}<select id="fVoice"><option value="">${t('fromSettings')}</option>${o.voice ? `<option selected>${esc(o.voice)}</option>` : ''}</select></label>
        <label class="f">${t('quality')}<select id="fQuality"><option value="">${t('fromSettings')}</option>${['720p', '1080p'].map(q => `<option ${o.quality === q ? 'selected' : ''}>${q}</option>`).join('')}</select></label>
      </div>
      <div class="row" style="gap:18px">
        ${[['fCaptions', 'captions'], ['fMusic', 'music'], ['fCast', 'consistentCast']].map(([id, k]) => `
          <label class="toggle"><input type="checkbox" id="${id}" ${o[k] ? 'checked' : ''}><span class="sw"></span>${t(k)}</label>`).join('')}
      </div>
      <details><summary class="muted small">${t('directorNotes')}</summary>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
          <label class="f">${t('audience')}<input type="text" id="fAudience" dir="auto" value="${esc(o.audience)}" placeholder="${esc(t('audiencePh'))}"></label>
          <label class="f">${t('notes')}<textarea id="fNotes" rows="3" dir="auto" placeholder="${esc(t('notesPh'))}">${esc(o.notes)}</textarea></label>
        </div></details>
    </div>
  </div>`;
}

function bindStoryForm(root) {
  const count = () => { const n = $('#fStory', root).value.trim().split(/\s+/).filter(Boolean).length; $('#fCount', root).textContent = t('words', n); };
  $('#fStory', root).addEventListener('input', count); count();
  $('#fSample', root)?.addEventListener('click', () => { $('#fStory', root).value = SAMPLE.text; $('#fTitle', root).value = SAMPLE.title; pickOne($$('#fLang button', root), $('#fLang [data-v=ar]', root)); fillVoices(root); count(); });
  $$('.style-card', root).forEach(c => c.addEventListener('click', () => pickOne($$('.style-card', root), c)));
  bindSeg($('#fAspect', root));
  bindSeg($('#fLang', root), () => fillVoices(root));
  $('#fLen', root).addEventListener('input', e => { $('#fLenV', root).textContent = e.target.value; });
  fillVoices(root);
}

async function fillVoices(root) {
  const sel = $('#fVoice', root); if (!sel) return;
  const lang = $('#fLang .on', root)?.dataset.v ?? 'ar';
  const keep = sel.value;
  try { S.voices ??= await api('voices'); } catch { S.voices = []; }
  const list = S.voices.filter(v => v.lang === lang);
  sel.innerHTML = `<option value="">${esc(t('defaultVoice', S.settings.voice[lang] ?? ''))}</option>` +
    list.map(v => `<option value="${esc(v.name)}" ${v.name === keep ? 'selected' : ''}>${esc(v.name)} — ${v.gender === 'Female' ? t('female') : t('male')}</option>`).join('') +
    (keep && !list.some(v => v.name === keep) ? `<option selected>${esc(keep)}</option>` : '');
}

function readStoryForm(root) {
  return {
    title: $('#fTitle', root).value.trim(),
    story: $('#fStory', root).value,
    options: {
      style: $('.style-card.on', root)?.dataset.style ?? 'cinematic',
      aspect: $('#fAspect .on', root)?.dataset.v ?? '16:9',
      language: $('#fLang .on', root)?.dataset.v ?? 'ar',
      length: Number($('#fLen', root).value),
      voice: $('#fVoice', root).value,
      quality: $('#fQuality', root).value,
      captions: $('#fCaptions', root).checked, music: $('#fMusic', root).checked, consistentCast: $('#fCast', root).checked,
      audience: $('#fAudience', root).value.trim(), notes: $('#fNotes', root).value.trim(),
    },
  };
}

function renderNew() {
  $('#view').innerHTML = `
    <div class="phead"><div><h1>${t('newTitle')}</h1><div class="logline">${t('newHint')}</div></div>
      <div class="row"><button class="btn primary big" id="createGo" title="${t('ctrlEnter')}">${t('writeScreenplay')}</button><button class="btn" id="createOnly">${t('saveOnly')}</button></div></div>
    ${storyFormHTML(null)}`;
  const view = $('#view');
  bindStoryForm(view);
  const create = async run => {
    const b = readStoryForm(view);
    if (!b.story.trim()) { toast(t('needStory')); $('#fStory', view).focus(); return; }
    const p = await api('projects', { method: 'POST', body: b });
    await loadProjects();
    if (run) await api(`projects/${encodeURIComponent(p.id)}/run`, { method: 'POST', body: { steps: ['script'], label: t('jobLabels').script } });
    location.hash = `#/p/${p.id}`; // the storyboard opens by itself once the screenplay is written
  };
  const go = run => { const btn = $(run ? '#createGo' : '#createOnly'); busy(btn, () => create(run)).catch(fail); };
  $('#createGo').onclick = () => go(true);
  $('#createOnly').onclick = () => go(false);
  view.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); go(true); } });
  $('#fTitle', view).focus();
}

// ---------------------------------------------------------------- project shell
function projectBusy() { return [...S.jobs.values()].some(j => j.project === S.p?.id && (j.status === 'running' || j.status === 'queued')); }

function renderProject() {
  const p = S.p, sp = S.sp, st = p.status ?? {};
  const shots = sp ? sp.scenes.flatMap(sc => sc.shots) : [];
  const style = S.meta.styles[p.options.style];
  const done = {
    story: !!sp, cast: !!p.assets.cast || Object.keys(p.castImages ?? {}).length > 0 || (sp && !sp.cast.length),
    board: shots.length > 0 && shots.every(s => st[s.id]?.art), room: !!p.final,
  };
  $('#view').innerHTML = `
    <div class="phead">
      <div style="min-width:0">
        <h1 dir="auto">${sp ? `<span class="rq">${esc(sp.title)}</span>` : esc(p.title)}</h1>
        <div class="logline" dir="auto">${sp ? esc(sp.logline) : t('notWritten')}</div>
        <div class="row small" style="margin-top:8px;gap:6px">
          <span class="chip">${esc(style?.emoji ?? '')} ${esc(style ? styleLabel(style) : p.options.style)}</span>
          <span class="chip">${esc(p.options.aspect)}</span><span class="chip">${LANGS[p.options.language] ?? esc(p.options.language)}</span>
          ${p.timeline ? `<span class="chip gold">⏱ ${mmss(p.timeline.total)}</span>` : ''}
          <span class="chip warn" id="busyChip" ${projectBusy() ? '' : 'hidden'}>${t('running')}</span>
          <span class="chip ok" id="saveState" hidden></span>
        </div>
      </div>
      <div class="row">
        ${sp ? `<button class="btn primary big" id="makeFilm">${t('makeFilm')}</button>` : `<button class="btn primary big" id="writeScript">${t('writeScreenplay')}</button>`}
        ${/Win/.test(navigator.platform) ? `<button class="btn ghost" id="reveal" title="${esc(t('revealTitle'))}" aria-label="${esc(t('revealTitle'))}">📂</button>` : ''}
        <button class="btn ghost danger" id="delProj" title="${esc(t('trashTitle'))}" aria-label="${esc(t('trashTitle'))}">🗑</button>
      </div>
    </div>
    <nav class="steps">${Object.entries(t('tabs')).map(([k, l], i) => `<button class="step ${S.tab === k ? 'on' : ''} ${done[k] ? 'done' : ''}" data-tab="${k}" ${S.tab === k ? 'aria-current="page"' : ''} ${!sp && k !== 'story' ? 'disabled' : ''}><span class="n" aria-hidden="true">${done[k] && S.tab !== k ? '✓' : i + 1}</span><span class="l">${l}</span></button>`).join('')}</nav>
    <div id="tab"></div>`;
  $$('.step').forEach(b => b.addEventListener('click', () => { if (!b.disabled) location.hash = `#/p/${p.id}/${b.dataset.tab}`; }));
  $('#makeFilm')?.addEventListener('click', () => runSteps(S.meta.film, { label: t('jobLabels').film }));
  $('#writeScript')?.addEventListener('click', () => writeScript());
  $('#reveal')?.addEventListener('click', () => api(`projects/${pid()}/reveal`, { method: 'POST' }).catch(fail));
  $('#delProj').addEventListener('click', async () => {
    if (!await confirmBox(t('trashQ'), t('trashText', esc(sp?.title ?? p.title)), t('move'), 'danger')) return;
    try { await api(`projects/${pid()}`, { method: 'DELETE' }); } catch (e) { return fail(e); }
    S.p = null; S.sp = null; await loadProjects(); location.hash = '#/';
  });
  ({ story: renderStoryTab, board: renderBoard, cast: renderCastTab, room: renderRoom })[S.tab]();
}

async function runSteps(steps, { shots, note, force, label } = {}) {
  try {
    await flushSave();
    await api(`projects/${pid()}/run`, { method: 'POST', body: { steps, shots, note, force, label } });
    setDock(true);
    toast(t('queuedToast'));
  } catch (e) { fail(e); }
}

async function writeScript() {
  if (S.sp && !await confirmBox(t('rewriteQ'), t('rewriteText'), t('rewriteBtn'))) return;
  runSteps(['script'], { label: t('jobLabels').script });
}

// ---------------------------------------------------------------- tab 1: the story
function renderStoryTab() {
  const tab = $('#tab');
  tab.innerHTML = `${storyFormHTML(S.p)}
    <div class="row" style="margin-top:16px">
      <button class="btn primary" id="saveStory">${t('save')}</button>
      <button class="btn" id="saveScript">${t('saveAndWrite', !!S.sp)}</button>
      <span class="muted small">${t('storyHint')}</span>
    </div>`;
  bindStoryForm(tab);
  const save = async () => {
    const b = readStoryForm(tab);
    if (!b.story.trim()) { toast(t('needStory')); return false; }
    S.p = await api(`projects/${pid()}`, { method: 'PUT', body: { title: b.title || S.p.title, story: b.story, options: b.options } });
    await loadProjects();
    return true;
  };
  $('#saveStory').onclick = e => busy(e.currentTarget, save).then(ok => { if (ok) { toast(t('saved')); renderProject(); } }).catch(fail);
  $('#saveScript').onclick = e => busy(e.currentTarget, save).then(ok => ok && writeScript()).catch(fail);
}

// ---------------------------------------------------------------- tab 2: storyboard
function allShots() { return S.sp.scenes.flatMap(sc => sc.shots.map(sh => ({ sh, sc }))); }
function findShot(id) { for (const sc of S.sp.scenes) { const i = sc.shots.findIndex(s => s.id === id); if (i >= 0) return { sc, sh: sc.shots[i], i }; } return null; }
const row = id => S.p.timeline?.shots.find(r => r.id === id);
const frameCls = () => ({ '9:16': 'v', '1:1': 'sq' })[S.p.options.aspect] ?? '';
const shapeCls = () => ({ '9:16': 'v', '1:1': 'sq' })[S.p.options.aspect] ?? 'h';
const opts = (list, cur, labels) => list.map(v => `<option value="${v}" ${v === cur ? 'selected' : ''}>${esc(labels?.[v] ?? v)}</option>`).join('');

function timelineHTML() {
  const tl = S.p.timeline;
  if (!tl?.shots.length) return '';
  const total = tl.total || 1, st = S.p.status ?? {};
  // each transition overlap is split between its two shots, so the blocks add up to the film length
  const blocks = tl.shots.map((r, i) => {
    const th = st[r.id]?.thumb, w = r.D - ((tl.shots[i - 1]?.T ?? 0) + r.T) / 2;
    return `<button type="button" class="blk ${r.kind === 'shot' ? '' : r.kind}" data-shot="${esc(r.id)}" title="${esc(r.id)} · ${t('secs', fmt(r.D))}" style="width:${w / total * 100}%;${th ? `background-image:url('${esc(th)}')` : ''}"><span class="lb">${esc(r.id === 'title' ? t('titleLbl') : r.id === 'end' ? t('endLbl') : r.id)}</span></button>`;
  }).join('');
  const marks = tl.shots.filter(r => r.T > 0.05).map(r => `<div class="tr" title="${esc(L('transition')[r.transition] ?? r.transition)}" style="inset-inline-start:${(r.start + r.D - r.T / 2) / total * 100}%"></div>`).join('');
  const n = Math.min(8, Math.max(2, Math.round(total / 10)));
  let ticks = Array.from({ length: n + 1 }, (_, i) => `<span>${mmss(total * i / n)}</span>`);
  if (isRTL()) ticks = ticks.reverse(); // the ruler is LTR text; the blocks run right-to-left in Arabic
  return `<div class="timeline">${blocks}${marks}</div><div class="tl-ruler" aria-hidden="true">${ticks.join('')}</div>`;
}

function statusHTML(id, kind) {
  const s = S.p.status?.[id] ?? {}, sh = findShot(id)?.sh;
  const icon = (ok, need, label, ch) => !need ? '' : `<span class="${ok ? 'y' : 'n'}" title="${esc(label)}: ${ok ? t('ready') : t('needsRedo')}">${ch}</span>`;
  return icon(s.voice, !!sh?.narration, t('stVoice'), '🎙') + icon(s.art, kind === 'shot', t('stArt'), picturesOn() ? '🖼' : '🎨') +
    icon(s.video, !!s.video || (kind === 'shot' && videoOn() && Number(sh?.motion) === 2), t('stClip'), '🎬') +
    (s.depth ? `<span class="y" title="${esc(t('stDepth'))}: ${esc(t('ready'))}">◐</span>` : '') + icon(s.clip && s.art && s.voice, true, t('stFilm'), '🎞') +
    (s.problems?.length ? `<span class="w" title="${esc(s.problems.join('\n'))}">⚠ ${s.problems.length}</span>` : '');
}

/** Corner badges on a storyboard frame: "placeholder" and the critic's score (both read from the status safely). */
function frameBadgesHTML(id, kind) {
  const s = S.p.status?.[id] ?? {}, score = Number(s.score);
  return (kind === 'shot' && placeholderShot(id) ? phBadge() : '') +
    (s.score != null && Number.isFinite(score) ? `<span class="score ${score >= (S.settings?.image?.minScore ?? IMAGE_DEF.minScore) ? 'ok' : 'low'}" title="${esc(s.critique ? `${t('critique')}: ${s.critique}` : t('critique'))}">${esc(t('score', fmt(score)))}</span>` : '');
}

function shotCardHTML(sh, sc, idx) {
  const s = S.p.status?.[sh.id] ?? {}, r = row(sh.id);
  const card = sh.kind !== 'shot';
  const cast = S.sp.cast ?? [];
  const secInput = title => `<label class="chip sec" title="${esc(title)}">⏱ <input type="number" data-k="seconds" value="${fmt(sh.seconds)}" min="1.5" max="15" step="0.5" aria-label="${esc(title)}"></label>`;
  const frame = `<div class="frame ${frameCls()}" data-play="${esc(sh.id)}" role="button" tabindex="0" aria-label="${esc(t('playShot', sh.id))}" style="${s.thumb ? `background-image:url('${esc(s.thumb)}')` : ''}">
      ${s.thumb ? '<div class="play" aria-hidden="true">▶</div>' : `<div class="ph" dir="auto">${card ? (sh.kind === 'title' ? t('titleCard') : t('endCard')) : esc(sh.visual ? sh.visual.slice(0, 140) : t('noArtYet'))}</div>`}
      <span class="dur">${r ? `${fmt(r.D)}s` : ''}</span><span class="id">${esc(sh.id)}</span><div class="badges">${frameBadgesHTML(sh.id, sh.kind)}</div></div>`;
  const tsel = `<select data-k="transition" title="${esc(t('transitionTitle'))}" aria-label="${esc(t('transitionTitle'))}">${opts(S.meta.transitions, sh.transition, L('transition'))}</select>`;
  if (card) {
    return `<div class="shot" data-shot="${esc(sh.id)}">${frame}<div class="body">
      <div class="chips">${sh.kind === 'end' ? `<input type="text" data-k="text" dir="auto" value="${esc(sh.text ?? '')}" aria-label="${esc(t('endLbl'))}" class="end-text">` : `<span class="chip" dir="auto">${esc(S.sp.title)}</span>`}
        ${secInput(t('secondsTitle'))}${sh.kind === 'title' ? tsel : ''}</div></div>
      <div class="acts"><div class="st">${statusHTML(sh.id, sh.kind)}</div><div></div></div></div>`;
  }
  const motion = Number(sh.motion) === 2 ? 2 : 1;
  const sel = (k, title, html) => `<select data-k="${k}" title="${esc(title)}" aria-label="${esc(title)}">${html}</select>`;
  const btn = (act, title, ch, off) => `<button class="icon-btn" data-act="${act}" title="${esc(title)}" aria-label="${esc(title)}" ${off ? 'disabled' : ''}>${ch}</button>`;
  return `<div class="shot" data-shot="${esc(sh.id)}">${frame}
    <div class="body">
      <div class="chips">
        ${sel('shotType', t('shotSize'), opts(S.meta.shotTypes, sh.shotType, L('shotType')))}
        ${sel('camera', t('cameraMove'), opts(S.meta.cameras, sh.camera, L('camera')))}
        ${tsel}${secInput(t('minSecondsTitle'))}
        ${sel('motion', t('motionLbl'), opts(['1', '2'], String(motion), t('motionOpts')))}
      </div>
      <button type="button" class="motion-hint small" data-act="motionSettings" ${motion === 2 && !videoOn() ? '' : 'hidden'}>🎥 ${t('motionOff')}</button>
      ${cast.length ? `<div class="chips">${cast.map(c => { const on = sh.cast.includes(c.id); return `<button type="button" class="chip click ${on ? 'gold' : ''}" data-cast="${esc(c.id)}" aria-pressed="${on}" dir="auto">${on ? '●' : '○'} ${esc(c.name)}</button>`; }).join('')}</div>` : ''}
      <textarea data-k="narration" rows="3" dir="auto" placeholder="${esc(t('narrationPh'))}" aria-label="${esc(t('narrationPh'))}">${esc(sh.narration)}</textarea>
      ${whispersHTML(sh)}
      <details class="artist"><summary>${t('forArtist')}</summary>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
          <textarea class="vis" data-k="visual" rows="4" placeholder="${esc(t('visualPh'))}" aria-label="${esc(t('visualPh'))}">${esc(sh.visual)}</textarea>
          <textarea class="vis" data-k="action" rows="3" placeholder="${esc(t('actionPh'))}" aria-label="${esc(t('actionPh'))}">${esc(sh.action)}</textarea>
          <div class="grid2 lens-light">${[['lens', 'lensPh'], ['light', 'lightPh']].map(([k, ph]) => `<label class="f small">${t(k)}<input type="text" data-k="${k}" dir="ltr" value="${esc(sh[k] ?? '')}" placeholder="${esc(t(ph))}"></label>`).join('')}</div>
          <div class="muted small prompt-line" ${s.prompt ? '' : 'hidden'}>🖼 <b>${t('imagePrompt')}:</b> <span dir="ltr">${esc(s.prompt ?? '')}</span></div>
          <div class="small critique-line" ${s.critique ? '' : 'hidden'}>★ <b>${t('critique')}:</b> <span dir="auto">${esc(s.critique ?? '')}</span></div>
        </div></details>
    </div>
    <div class="acts">
      <div class="st">${statusHTML(sh.id, sh.kind)}</div>
      <div class="row" style="gap:0">
        ${btn('redraw', t('redraw'), '🖌')}${btn('up', t('before'), '▲', idx === 0 || sc.shots[idx - 1]?.kind !== 'shot')}${btn('down', t('after'), '▼', sc.shots[idx + 1]?.kind !== 'shot')}${btn('dup', t('dupShot'), '⧉')}${btn('del', t('delShot'), '🗑')}
      </div>
    </div></div>`;
}

/** The script doctor's notes, when the director ran it: sp.doctor = [{ pass, issues, top[], verdict }]. */
function doctorHTML(sp) {
  const passes = Array.isArray(sp.doctor) ? sp.doctor : [];
  if (!passes.length) return '';
  const count = d => (Array.isArray(d.issues) ? d.issues.length : Number(d.issues) || (d.top?.length ?? 0));
  const text = x => (typeof x === 'string' ? x : x?.note ?? x?.issue ?? x?.text ?? JSON.stringify(x));
  return `<details class="doctor"><summary class="chip click">${t('doctor', passes.reduce((a, d) => a + count(d), 0))}</summary><div class="doctor-body">${passes.map((d, i) => `
    <div><b>${t('doctorPass', d.pass ?? i + 1, count(d))}</b>${d.verdict ? ` — <span dir="auto">${esc(text(d.verdict))}</span>` : ''}
      ${d.top?.length ? `<ul>${d.top.map(x => `<li dir="auto">${esc(text(x))}</li>`).join('')}</ul>` : ''}</div>`).join('')}</div></details>`;
}

/** The beings' private lines in a shot (sh.whispers) and the "typing…" bubble (sh.overlay). Timings come from the timeline. */
const castColor = id => S.sp.cast?.find(c => c.id === id)?.color;
function whispersHTML(sh) {
  const list = sh.whispers ?? [], tl = row(sh.id)?.whispers ?? [];
  const cast = [...(S.sp.cast ?? []).filter(c => c.kind === 'being'), ...(S.sp.cast ?? []).filter(c => c.kind !== 'being')];
  const btn = (act, title, ch, off) => `<button type="button" class="icon-btn" data-wact="${act}" title="${esc(title)}" aria-label="${esc(title)}" ${off ? 'disabled' : ''}>${ch}</button>`;
  return `<details class="whispers" ${list.length ? 'open' : ''}><summary>${t('whispers', list.length)}</summary><div class="wh-list">
    ${list.map((w, i) => `<div class="wh-row" data-wi="${i}">
      <div class="wh-top">
        <span class="dot" style="background:${esc(tl[i]?.color ?? castColor(w.speaker) ?? 'var(--muted)')}"></span>
        <select data-wk="speaker" title="${esc(t('speaker'))}" aria-label="${esc(t('speaker'))}"><option value="">${esc(t('noSpeaker'))}</option>${cast.map(c => `<option value="${esc(c.id)}" ${c.id === w.speaker ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        <span class="wh-time">${tl[i] ? `${fmt(tl[i].start)}–${fmt(tl[i].end)} s` : ''}</span>
        <label class="wh-plain" title="${esc(t('plainTitle'))}"><input type="checkbox" data-wk="plain" ${w.plain ? 'checked' : ''}>${t('plain')}</label>
        <span class="grow"></span>${btn('up', t('moveUp'), '▲', i === 0)}${btn('down', t('moveDown'), '▼', i === list.length - 1)}${btn('del', t('remove'), '✕')}
      </div>
      <textarea data-wk="text" rows="2" dir="auto" placeholder="${esc(t('whisperPh'))}" aria-label="${esc(t('whisperPh'))}">${esc(w.text ?? '')}</textarea>
    </div>`).join('')}
    <div class="row" style="gap:8px"><button type="button" class="btn sm ghost" data-add-whisper>${t('addWhisper')}</button>
      <label class="wh-plain"><input type="checkbox" data-k="overlay" ${sh.overlay === 'typing' ? 'checked' : ''}>${t('typing')}</label></div>
  </div></details>`;
}

function renderBoard() {
  const sp = S.sp, tab = $('#tab');
  const n = allShots().filter(x => x.sh.kind === 'shot').length;
  tab.innerHTML = `
    ${picturesOn() ? '' : `<div class="banner" role="note"><span>⚠ ${t('noPicEngine')}</span><button class="btn sm" id="phSettings">${t('openPictures')}</button></div>`}
    <div class="sb-head">
      <div class="row">
        <div class="palette" aria-hidden="true">${Object.entries(sp.palette).map(([k, c]) => `<i style="background:${esc(c)}" title="${k} ${esc(c)}"></i>`).join('')}</div>
        <span class="chip">${t('scenesShots', sp.scenes.length, n)}</span>
        <span class="chip">🎼 ${esc(L('mood')[sp.mood] ?? sp.mood)}</span>
      </div>
      <div class="row">
        <button class="btn" id="aniBtn">${t('livePreview')}</button>
        <button class="btn" id="voiceBtn" title="${esc(t('recordVoicesTitle'))}">${t('recordVoices')}</button>
        <button class="btn" id="artBtn">${t('drawMissing')}</button>
      </div>
    </div>
    ${doctorHTML(sp)}
    <div id="tlWrap">${timelineHTML()}</div>
    ${sp.scenes.map((sc, si) => `
      <section class="scene" data-scene="${esc(sc.id)}">
        <div class="scene-h"><span class="sn">${si + 1}</span><input type="text" data-scene-title dir="auto" value="${esc(sc.title)}" aria-label="${esc(t('sceneTitle'))}"></div>
        <div class="shots">${sc.shots.map((sh, i) => shotCardHTML(sh, sc, i)).join('')}
          <button class="btn ghost add-shot" data-add-shot>${t('addShot')}</button></div>
      </section>`).join('')}
    <button class="btn ghost add-scene" id="addScene">${t('addScene')}</button>`;

  tab.addEventListener('input', onBoardInput);
  tab.addEventListener('change', onBoardInput);
  tab.addEventListener('click', onBoardClick);
  $('#phSettings')?.addEventListener('click', () => openSettings('pictures'));
  $('#aniBtn').onclick = () => openAnimatic();
  $('#voiceBtn').onclick = () => runSteps(['voice'], { label: t('jobLabels').voices });
  $('#artBtn').onclick = () => runSteps(paintSteps(), { label: t('jobLabels').paint });
  $('#addScene').onclick = () => {
    const sp = S.sp; // the current copy (autosave replaces it)
    const ids = new Set(sp.scenes.map(s => s.id));
    let k = sp.scenes.length + 1; while (ids.has(`s${k}`)) k++;
    const sc = { id: `s${k}`, title: t('sceneN', sp.scenes.length + 1), location: '', shots: [newShot(`s${k}`)] };
    const last = sp.scenes[sp.scenes.length - 1];
    const endIdx = last.shots.findIndex(s => s.kind === 'end');
    if (endIdx >= 0) { const [end] = last.shots.splice(endIdx, 1); sc.shots.push(end); } // the end card stays last
    sp.scenes.push(sc);
    changed(true);
  };
}

/** Painting a shot also redoes its depth map / video clip when the server has the motion step. */
const paintSteps = () => ['voice', 'cast', 'art', 'motion'].filter(s => S.meta.steps.includes(s));

function newShot(sceneId) {
  const ids = new Set(allShots().map(x => x.sh.id));
  let n = 1; while (ids.has(`${sceneId}-${n}`)) n++;
  return { id: `${sceneId}-${n}`, kind: 'shot', narration: '', visual: '', action: '', cast: [], shotType: 'medium', camera: 'drift', transition: 'cut', seconds: 4, motion: 1, lens: '', light: '' };
}

function onBoardInput(e) {
  const el = e.target;
  if (el.dataset.wk) {
    if (e.type === 'input' && (el.tagName === 'SELECT' || el.type === 'checkbox')) return; // handled on "change"
    const w = findShot(el.closest('.shot').dataset.shot).sh.whispers[el.closest('.wh-row').dataset.wi];
    if (el.dataset.wk === 'plain') { if (el.checked) w.plain = true; else delete w.plain; } else w[el.dataset.wk] = el.value;
    if (el.dataset.wk === 'speaker') el.closest('.wh-row').querySelector('.dot').style.background = castColor(el.value) ?? 'var(--muted)';
    return changed();
  }
  if (el.dataset.k === 'overlay') { if (e.type === 'change') { findShot(el.closest('.shot').dataset.shot).sh.overlay = el.checked ? 'typing' : ''; changed(); } return; }
  if (el.matches('[data-scene-title]')) { S.sp.scenes.find(s => s.id === el.closest('.scene').dataset.scene).title = el.value; return changed(); }
  const k = el.dataset.k, card = el.closest('.shot');
  if (!k || !card) return;
  if (e.type === 'input' && el.tagName === 'SELECT') return;
  const { sh } = findShot(card.dataset.shot);
  sh[k] = k === 'seconds' ? Math.min(15, Math.max(1.5, Number(el.value) || 4)) : k === 'motion' ? Number(el.value) : el.value;
  if (k === 'motion') { $('.motion-hint', card).hidden = !(sh.motion === 2 && !videoOn()); $('.st', card).innerHTML = statusHTML(sh.id, sh.kind); }
  card.classList.add('dirty');
  changed();
}

async function onBoardClick(e) {
  const el = e.target;
  const play = el.closest('[data-play]');
  if (play) return previewShot(play.dataset.play);
  const blk = el.closest('.timeline .blk');
  if (blk) {
    const card = $(`.shots .shot[data-shot="${CSS.escape(blk.dataset.shot)}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('.frame', card).focus({ preventScroll: true });
    card.animate([{ outline: '2px solid var(--gold)' }, { outline: '2px solid transparent' }], 1200);
    return;
  }
  if (el.matches('[data-add-shot]')) {
    const sc = S.sp.scenes.find(s => s.id === el.closest('.scene').dataset.scene);
    const at = sc.shots.findIndex(s => s.kind === 'end');
    sc.shots.splice(at >= 0 ? at : sc.shots.length, 0, newShot(sc.id));
    return changed(true);
  }
  const wact = el.closest('[data-wact],[data-add-whisper]');
  if (wact) {
    const { sh } = findShot(el.closest('.shot').dataset.shot), list = (sh.whispers ??= []);
    if (wact.matches('[data-add-whisper]')) list.push({ speaker: S.sp.cast?.find(c => c.kind === 'being')?.id ?? '', text: '' });
    else {
      const i = Number(wact.closest('.wh-row').dataset.wi), j = { up: i - 1, down: i + 1 }[wact.dataset.wact];
      if (wact.dataset.wact === 'del') list.splice(i, 1); else if (list[j]) [list[i], list[j]] = [list[j], list[i]];
    }
    return changed(true);
  }
  const chip = el.closest('[data-cast]');
  if (chip) {
    const { sh } = findShot(chip.closest('.shot').dataset.shot), c = chip.dataset.cast;
    sh.cast = sh.cast.includes(c) ? sh.cast.filter(x => x !== c) : [...sh.cast, c];
    const on = sh.cast.includes(c);
    chip.classList.toggle('gold', on); chip.setAttribute('aria-pressed', String(on)); chip.textContent = `${on ? '●' : '○'} ${S.sp.cast.find(x => x.id === c)?.name ?? c}`;
    return changed();
  }
  const act = el.closest('[data-act]')?.dataset.act;
  if (!act) return;
  if (act === 'motionSettings') return openSettings('motion');
  const id = el.closest('.shot').dataset.shot, { sc, sh, i } = findShot(id);
  if (act === 'up' && i > 0) { [sc.shots[i - 1], sc.shots[i]] = [sc.shots[i], sc.shots[i - 1]]; return changed(true); }
  if (act === 'down' && i < sc.shots.length - 1) { [sc.shots[i + 1], sc.shots[i]] = [sc.shots[i], sc.shots[i + 1]]; return changed(true); }
  if (act === 'dup') { sc.shots.splice(i + 1, 0, { ...structuredClone(sh), id: newShot(sc.id).id }); return changed(true); }
  if (act === 'del') {
    if (allShots().filter(x => x.sh.kind === 'shot').length <= 1) return toast(t('atLeastOne'));
    const text = (sh.narration || sh.visual || '').slice(0, 200);
    if (!await confirmBox(t('deleteQ', id), text ? `<span class="quote" dir="auto">${esc(text)}</span>` : t('emptyShot'), t('del'), 'danger')) return;
    const at = findShot(id); // again: an autosave may have replaced S.sp while the dialog was open
    if (!at) return;
    at.sc.shots.splice(at.i, 1);
    if (!at.sc.shots.length) S.sp.scenes = S.sp.scenes.filter(x => x !== at.sc);
    return changed(true);
  }
  if (act === 'redraw') {
    const note = await modal(t('redrawTitleQ', id), `
      <div class="note">${t('redrawNote')}</div>
      <textarea id="redrawNote" rows="4" dir="auto" placeholder="${esc(t('redrawPh'))}" aria-label="${esc(t('redrawPh'))}"></textarea>
      <div class="muted small">${t('enterHint')}</div>`,
    [{ label: t('draw'), cls: 'primary', value: d => $('#redrawNote', d).value.trim() }, { label: t('cancel'), cls: 'ghost', value: null }],
    { onOpen: d => $('#redrawNote', d).focus() });
    if (note === null) return;
    runSteps(paintSteps(), { shots: [id], note: note || undefined, force: !note, label: t('jobLabels').redraw(id) });
  }
}

/** The screenplay changed in the editor. Structural changes redraw the board; text edits only save. */
function changed(structural = false) {
  S.edit++;
  setSaveState('…');
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(() => flushSave().catch(fail), structural ? 50 : 900);
  if (structural) renderKeepScroll();
}
function renderKeepScroll() { const y = $('#main').scrollTop; renderProject(); $('#main').scrollTop = y; }

function setSaveState(v) { const el = $('#saveState'); if (!el) return; el.hidden = !v; el.textContent = v === '…' ? t('unsaved') : v; el.className = `chip ${v === '…' ? 'warn' : 'ok'}`; }

async function flushSave() {
  clearTimeout(S.saveTimer);
  if (S.saving) await S.saving.catch(() => {});
  if (!S.p || !S.sp || S.edit === S.saved) return;
  const seq = S.edit;
  S.saving = (async () => {
    const view = await api(`projects/${pid()}`, { method: 'PUT', body: { screenplay: S.sp } });
    S.saved = seq;
    S.p = view;
    if (S.edit === seq) S.sp = structuredClone(view.screenplay);
    refreshLive();
    setSaveState(S.edit === seq ? t('savedChip') : '…');
  })();
  try { await S.saving; } finally { S.saving = null; }
}

/** After a save or a finished job: update what the server computed (durations, badges, thumbs) without touching inputs. */
function refreshLive() {
  if (S.tab !== 'board' || !$('#tlWrap')) return;
  $('#tlWrap').innerHTML = timelineHTML();
  for (const card of $$('.shots .shot[data-shot]')) {
    const id = card.dataset.shot, s = S.p.status?.[id] ?? {}, r = row(id), sh = findShot(id)?.sh;
    if (!sh) continue;
    $('.dur', card).textContent = r ? `${fmt(r.D)}s` : '';
    $('.st', card).innerHTML = statusHTML(id, sh.kind);
    const fr = $('.frame', card);
    if (s.thumb && fr.style.backgroundImage !== `url("${s.thumb}")`) { fr.style.backgroundImage = `url('${s.thumb}')`; $('.ph', fr)?.remove(); if (!$('.play', fr)) fr.insertAdjacentHTML('afterbegin', '<div class="play" aria-hidden="true">▶</div>'); }
    $('.badges', card).innerHTML = frameBadgesHTML(id, sh.kind);
    $$('.wh-row', card).forEach((wr, i) => { const tw = r?.whispers?.[i]; $('.wh-time', wr).textContent = tw ? `${fmt(tw.start)}–${fmt(tw.end)} s` : ''; });
    for (const [cls, v] of [['.prompt-line', s.prompt], ['.critique-line', s.critique]]) {
      const el = $(cls, card);
      if (el) { el.hidden = !v; $('span', el).textContent = v ?? ''; }
    }
    if (S.edit === S.saved) card.classList.remove('dirty');
  }
}

// ---------------------------------------------------------------- tab 3: characters & look
function renderCastTab() {
  const sp = S.sp, tab = $('#tab'), portraits = S.p.castImages ?? {};
  tab.innerHTML = `
    <div class="room" style="margin-bottom:20px">
      <div class="card" style="display:flex;flex-direction:column;gap:12px">
        <label class="f">${t('filmTitle')}<input type="text" data-sp="title" dir="auto" value="${esc(sp.title)}"></label>
        <label class="f">${t('logline')}<textarea data-sp="logline" rows="2" dir="auto">${esc(sp.logline)}</textarea></label>
        <label class="f">${t('mood')}<select data-sp="mood">${opts(Object.keys(L('mood')), sp.mood, L('mood'))}</select></label>
        <label class="f">${t('artStyle')}<textarea data-sp="artStyle" rows="3" dir="ltr" style="text-align:left">${esc(sp.artStyle)}</textarea></label>
      </div>
      <div class="card" style="display:flex;flex-direction:column;gap:12px">
        <div class="f" id="palLbl">${t('palette')}</div>
        <div class="colors" role="group" aria-labelledby="palLbl">${Object.entries(sp.palette).map(([k, c]) => `<label><input type="color" data-pal="${k}" value="${esc(c)}">${esc(t('paletteNames')[k] ?? k)}</label>`).join('')}</div>
        <div class="note small">${t('paletteNote')}</div>
        ${sp.locations?.length ? `<div class="f">${t('places')}</div>${sp.locations.map((l, i) => `<label class="f small"><span dir="auto">${esc(l.name || l.id)}</span><textarea data-loc="${i}" rows="2" dir="ltr" style="text-align:left">${esc(l.look)}</textarea></label>`).join('')}` : ''}
      </div>
    </div>
    <div class="sb-head"><h2>${t('characters')}</h2>
      <div class="row">${S.p.options.consistentCast || picturesOn() ? '' : `<span class="chip warn">${t('castOff')}</span>`}<button class="btn" id="castRedraw" ${sp.cast.length ? '' : 'disabled'}>${t('redrawCast')}</button></div></div>
    ${S.p.castSheet && !picturesOn() ? `<div class="badged" style="margin-bottom:16px"><img class="cast-sheet" src="${esc(S.p.castSheet)}" alt="${esc(t('castSheetAlt'))}">${phBadge('big')}</div>` : ''}
    ${Object.keys(portraits).length ? `<div class="note small" style="margin-bottom:12px">${t('portraitsNote')}</div>` : ''}
    <div class="cast-grid">${sp.cast.map((c, i) => `
      <div class="card" style="display:flex;flex-direction:column;gap:10px">
        ${portraits[c.id] ? `<img src="${esc(portraits[c.id])}" alt="${esc(c.name)}" class="portrait">` : ''}
        <div class="row" style="flex-wrap:nowrap"><input type="text" data-c="${i}" data-ck="name" dir="auto" value="${esc(c.name)}" aria-label="${esc(t('characters'))}" style="font-weight:800;flex:1;min-width:0"><span class="chip" dir="ltr">${esc(c.id)}</span></div>
        <label class="f small">${t('lookLbl')}<textarea data-c="${i}" data-ck="look" rows="4" dir="ltr" style="text-align:left">${esc(c.look)}</textarea></label>
        <label class="f small">${t('personality')}<input type="text" data-c="${i}" data-ck="personality" dir="auto" value="${esc(c.personality)}"></label>
        <div class="row cast-kind">
          <label class="f small">${t('kind')}<select data-c="${i}" data-ck="kind">${opts(['human', 'being'], c.kind === 'being' ? 'being' : 'human', t('kinds'))}</select></label>
          ${c.kind === 'being' ? `<label class="f small">${t('beingColor')}<input type="color" data-c="${i}" data-ck="color" value="${esc(/^#[0-9a-f]{6}$/i.test(c.color ?? '') ? c.color : '#4fd1e8')}"></label>
          <label class="f small">${t('glyph')}<select data-c="${i}" data-ck="glyph">${opts(['arcs', 'rings', 'curls', 'dots', 'squares', 'mirror', 'echo', ''], c.glyph ?? '', t('glyphs'))}</select></label>` : ''}
        </div>
      </div>`).join('') || `<div class="muted">${t('noCast')}</div>`}</div>`;
  tab.addEventListener('input', e => {
    const el = e.target, sp = S.sp; // not the render-time copy: every autosave replaces S.sp with the server's
    if (el.dataset.sp) sp[el.dataset.sp] = el.value;
    else if (el.dataset.pal) sp.palette[el.dataset.pal] = el.value;
    else if (el.dataset.loc) sp.locations[el.dataset.loc].look = el.value;
    else if (el.dataset.c) sp.cast[el.dataset.c][el.dataset.ck] = el.value;
    else return;
    changed(el.dataset.ck === 'kind'); // a being gets its colour and glyph fields
  });
  $('#castRedraw').onclick = () => runSteps(['cast'], { force: true, label: t('jobLabels').cast });
}

// ---------------------------------------------------------------- tab 4: screening room
function renderRoom() {
  const p = S.p, st = p.status ?? {}, tab = $('#tab');
  const shots = allShots().map(x => x.sh), story = shots.filter(s => s.kind === 'shot'), spoken = shots.filter(s => s.narration);
  const c = (f, list) => list.filter(s => st[s.id]?.[f]).length;
  const stale = p.final && shots.some(s => !st[s.id]?.art || !st[s.id]?.voice || !st[s.id]?.clip);
  const shape = shapeCls();
  const castNeeded = S.sp.cast.length && (picturesOn() || p.options.consistentCast) ? 1 : 0;
  const castDone = picturesOn() ? (Object.keys(p.castImages ?? {}).length >= S.sp.cast.length ? 1 : 0) : (p.assets.cast ? 1 : 0);
  const pipes = [['🎙', c('voice', spoken), spoken.length], ['👥', castDone, castNeeded], [picturesOn() ? '🖼' : '🎨', c('art', story), story.length], ['🎞', c('clip', shots), shots.length], ['🏁', p.final ? 1 : 0, 1]];
  const placeholders = story.some(sh => placeholderShot(sh.id));
  tab.innerHTML = `
    <div class="row" style="justify-content:center;margin-bottom:14px">
      <div class="seg" id="roomMode" role="group"><button data-v="film" class="${p.final ? 'on' : ''}" aria-pressed="${!!p.final}" ${p.final ? '' : 'disabled'}>${t('film')}</button><button data-v="ani" class="${p.final ? '' : 'on'}" aria-pressed="${!p.final}">${t('livePreview')}</button></div>
    </div>
    <div class="badged screen-wrap ${shape}"><div class="screen ${shape}" id="screen"></div>${placeholders ? phBadge('big') : ''}</div>
    <div class="ani-bar" id="aniBar" style="max-width:${shape === 'v' ? 400 : shape === 'sq' ? 640 : 1000}px"></div>
    <div class="room" style="margin-top:22px">
      <div class="card" style="display:flex;flex-direction:column;gap:14px">
        <h3>${t('stages')}</h3>
        <div class="pipeline">${pipes.map(([i, a, b], k) => `<div class="pipe ${a >= b ? 'ok' : ''}"><div class="i">${i}</div><div class="k">${t('pipe')[k]}</div><div class="v">${b ? `${a}/${b}` : '—'}</div></div>`).join('')}</div>
        ${stale ? `<div class="note">${t('stale')}</div>` : ''}
        <div class="row"><button class="btn primary" id="roomMake">${p.final ? t('updateFilm') : t('makeFilm')}</button>
          <button class="btn ghost" id="roomForce" title="${esc(t('rerenderTitle'))}">${t('rerender')}</button></div>
      </div>
      <div class="card" style="display:flex;flex-direction:column;gap:14px">
        <h3>${t('download')}</h3>
        ${p.final ? `
          <div class="muted small">${t('secs', fmt(p.final.seconds))} · ${(p.final.size / 1048576).toFixed(1)} MB · ${new Date(p.final.at).toLocaleString(UI === 'ar' ? 'ar' : 'en-GB')}</div>
          <div class="downloads">
            <a class="btn primary" href="${esc(p.final.url)}&download">${t('mp4')}</a>
            <a class="btn" href="${esc(p.final.srtUrl)}?download">${t('srt')}</a>
            <a class="btn" href="${esc(p.final.thumbUrl)}&download">${t('thumb')}</a>
          </div>
          <div class="badged"><img src="${esc(p.final.thumbUrl)}" alt="${esc(t('thumb').replace(/^⬇\s*/, ''))}" class="thumb-img">${placeholders ? phBadge() : ''}</div>` : `<div class="muted empty">${t('notMade')}</div>`}
      </div>
    </div>`;
  const show = mode => {
    stopAnimatic();
    pickOne($$('#roomMode button'), $(`#roomMode [data-v=${mode}]`));
    const scr = $('#screen');
    if (mode === 'film') {
      scr.innerHTML = `<video src="${esc(p.final.url)}" controls playsinline preload="metadata" poster="${esc(p.final.thumbUrl)}"></video>`;
      $('video', scr).addEventListener('error', () => scr.insertAdjacentHTML('beforeend', `<div class="ov msg"><div class="note bad">${t('noPlay')}</div></div>`), { once: true });
      $('#aniBar').innerHTML = '';
    } else animaticReady(scr, $('#aniBar'), p.timeline.shots);
  };
  $('#roomMode').onclick = e => { const b = e.target.closest('button'); if (b && !b.disabled) show(b.dataset.v); };
  $('#roomMake').onclick = () => runSteps(S.meta.film, { label: t('jobLabels').film });
  $('#roomForce').onclick = () => runSteps(['render', 'assemble'], { force: true, label: t('jobLabels').rerender });
  show(p.final ? 'film' : 'ani');
}

// ---------------------------------------------------------------- animatic: the player chained shot by shot
const screenHTML = ph => `<div class="badged screen-wrap ${shapeCls()}"><div class="screen ${shapeCls()}" id="mScreen"></div>${ph ? phBadge('big') : ''}</div><div class="ani-bar" id="mBar"></div>`;

function openAnimatic() {
  const ph = allShots().some(x => x.sh.kind === 'shot' && placeholderShot(x.sh.id));
  modal(t('liveTitle', iso(S.sp.title)), screenHTML(ph),
    [{ label: t('close'), value: null }], { wide: true, onOpen: d => animaticReady($('#mScreen', d), $('#mBar', d), S.p.timeline.shots) });
}

function previewShot(id) {
  const r = row(id); if (!r) return;
  const s = S.p.status?.[id] ?? {}, probs = s.problems ?? [];
  modal(t('shotTitle', id, fmt(r.D)), `${screenHTML(r.kind === 'shot' && placeholderShot(id))}
    ${s.critique ? `<div class="note small">${s.score != null ? `${esc(t('score', fmt(s.score)))} · ` : ''}<b>${t('critique')}:</b> <span dir="auto">${esc(s.critique)}</span></div>` : ''}
    ${probs.length ? `<div class="note small">${t('autoNotes')}: <span dir="auto">${probs.map(esc).join(' · ')}</span></div>` : ''}`,
  [{ label: t('close'), value: null }], { wide: true, onOpen: d => animaticReady($('#mScreen', d), $('#mBar', d), [{ ...r, start: 0, T: 0 }], true) });
}

function animaticReady(screen, bar, rows, autoplay = false) {
  const total = rows.length ? rows[rows.length - 1].start + rows[rows.length - 1].D : 0;
  bar.innerHTML = rows.map(r => `<i style="flex:${Math.max(0.2, r.D - r.T)}"></i>`).join('');
  const cover = () => {
    screen.innerHTML = `<div class="ov"><div style="text-align:center"><div class="big">▶</div><div class="small" style="margin-top:6px">${mmss(total)}${rows.length > 1 ? ` · ${t('shotsN', rows.length)}` : ''}</div></div></div>`;
    $('.ov', screen).onclick = () => startAnimatic(screen, bar, rows, cover);
  };
  if (autoplay) startAnimatic(screen, bar, rows, cover); else cover();
}

function startAnimatic(screen, bar, rows, onEnd) {
  stopAnimatic();
  screen.innerHTML = '';
  const p = S.p, segs = $$('i', bar);
  const total = rows[rows.length - 1].start + rows[rows.length - 1].D;
  const items = rows.map((r, i) => ({ r, i, el: null, ready: false, started: false, played: false, audio: null, spoke: false }));
  const ctl = { raf: 0, t0: performance.now() + 400, items, onMsg: null };
  S.ani = ctl;
  const hasArt = r => r.kind !== 'shot' || !!(p.assets.art?.[r.id]?.file || p.assets.art?.[r.id]?.image);
  const play = it => { it.played = true; it.el.contentWindow.postMessage({ type: 'hakawati:play' }, '*'); };
  const mount = it => {
    const { r } = it;
    if (hasArt(r)) {
      const f = document.createElement('iframe');
      f.src = `/player.html?p=${pid()}&s=${encodeURIComponent(r.id)}&mode=wait&captions=${p.options.captions ? 1 : 0}`;
      it.el = f;
    } else {
      const d = document.createElement('div');
      d.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;text-align:center;padding:8%;background:repeating-linear-gradient(45deg,#0d1018,#0d1018 12px,#10141e 12px,#10141e 24px);color:var(--ink2)';
      const sh = findShot(r.id)?.sh;
      d.innerHTML = `<div><div class="chip warn" style="margin-bottom:10px">${esc(t('noArtShot', r.id))}</div><div style="font-size:18px;font-weight:700" dir="auto">${esc(sh?.narration || sh?.visual || '')}</div></div>`;
      it.el = d; it.ready = true;
    }
    it.el.style.opacity = '0';
    it.el.style.zIndex = String(it.i + 1);
    screen.append(it.el);
    const v = p.assets.voice?.[r.id];
    if (r.voiceDur && v?.file) { it.audio = new Audio(fileUrl(v.file)); it.audio.preload = 'auto'; }
    it.whispers = (r.whispers ?? []).filter(w => w.file).map(w => ({ at: r.start + (Number(w.start) || 0), audio: Object.assign(new Audio(fileUrl(w.file)), { preload: 'auto' }), played: false }));
  };
  ctl.onMsg = e => {
    const it = items.find(x => x.el?.contentWindow && x.el.contentWindow === e.source);
    if (it && e.data?.type === 'hakawati:ready') { it.ready = true; if (it.started && !it.played) play(it); }
  };
  addEventListener('message', ctl.onMsg);
  const tick = () => {
    const now = (performance.now() - ctl.t0) / 1000;
    for (const it of items) {
      const { r } = it;
      if (!it.el && !it.done && now > r.start - 2.5) mount(it);
      if (it.el && !it.started && now >= r.start) {
        it.started = true;
        const prevT = it.i ? items[it.i - 1].r.T : 0;
        it.el.style.transition = `opacity ${prevT > 0.05 ? prevT : 0}s linear`;
        it.el.style.opacity = '1';
        if (it.ready && !it.played && it.el.contentWindow) play(it);
      }
      if (it.audio && !it.spoke && now >= r.start + r.voiceStart) { it.spoke = true; it.audio.play().catch(() => {}); }
      for (const w of it.whispers ?? []) if (!w.played && now >= w.at) { w.played = true; w.audio.play().catch(() => {}); }
      if (it.el && now > r.start + r.D + 0.2 && it.i < items.length - 1) { it.el.remove(); it.el = null; it.done = true; }
      const seg = segs[it.i];
      if (seg) seg.className = now >= r.start + r.D - r.T ? 'past' : now >= r.start ? 'on' : '';
    }
    if (now >= total + 0.3) { stopAnimatic(); onEnd?.(); return; }
    ctl.raf = requestAnimationFrame(tick);
  };
  ctl.raf = requestAnimationFrame(tick);
}

function stopAnimatic() {
  const c = S.ani; if (!c) return;
  cancelAnimationFrame(c.raf);
  removeEventListener('message', c.onMsg);
  for (const it of c.items) { it.audio?.pause(); for (const w of it.whispers ?? []) w.audio.pause(); it.el?.remove(); }
  S.ani = null;
}

// ---------------------------------------------------------------- settings
const numIn = (id, label, v, min, max, step = 1) => `<label class="f">${label}<input type="number" id="${id}" min="${min}" max="${max}" step="${step}" value="${esc(v)}"></label>`;
const txtIn = (id, label, v, ph = '') => `<label class="f">${label}<input type="text" id="${id}" value="${esc(v)}" dir="ltr" placeholder="${esc(ph)}"></label>`;
const toggleIn = (id, label, on) => `<label class="toggle"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span class="sw" aria-hidden="true"></span>${label}</label>`;
/** A number field clamped to its own min/max; `def` when it is empty or not a number. */
const numOf = (el, def) => { const v = el.value.trim() === '' ? NaN : Number(el.value); return Number.isFinite(v) ? Math.min(Number(el.max || Infinity), Math.max(Number(el.min || -Infinity), v)) : def; };

async function openSettings(section) {
  let s;
  try { s = S.settings = await api('settings'); } catch (e) { return fail(e); }
  const d = $('#settings'), e = { doctorPasses: 2, ...s.engine }, im = { ...IMAGE_DEF, ...s.image }, vid = { ...VIDEO_DEF, ...s.video }, wh = { enabled: true, gain: -12, ...s.voice.whisper };
  const voiceSel = (lang, cur) => `<select data-voice="${lang}"><option selected>${esc(cur)}</option></select>`;
  const sec = (k, title, body) => `<section class="set-sec" id="set-${k}" aria-labelledby="set-${k}-h"><h3 id="set-${k}-h">${title}</h3>${body}</section>`;
  d.innerHTML = `
    <div class="dlg-h"><h2 id="setTitle">${t('settingsTitle')}</h2><button class="icon-btn" id="setX" aria-label="${esc(t('close'))}">✕</button></div>
    <div class="dlg-b">
      <nav class="set-nav">${Object.entries(t('sections')).map(([k, l]) => `<button type="button" class="chip click" data-sec="${k}">${l}</button>`).join('')}</nav>
      ${sec('engine', t('sections').engine, `
      <div class="note">${t('keyNote')}</div>
      <label class="f">${t('preset')}<select id="sPreset">${Object.entries(s.presets).map(([k, v]) => `<option value="${k}" ${k === e.preset ? 'selected' : ''}>${esc(styleLabel(v))}</option>`).join('')}</select></label>
      <div class="grid2">
        <label class="f">${t('protocol')}<select id="sProto">${['openai', 'anthropic', 'mock'].map(x => `<option ${x === e.protocol ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label class="f">${t('model')}<input type="text" id="sModel" list="sModels" value="${esc(e.model)}" dir="ltr"><datalist id="sModels"></datalist></label>
      </div>
      <label class="f">${t('baseUrl')}<input type="text" id="sBase" value="${esc(e.baseURL)}" dir="ltr" placeholder="https://…"></label>
      <div class="grid2">
        <label class="f">${t('apiKey')}<input type="password" id="sKey" value="" placeholder="${esc(e.hasKey ? t('keepKey', e.apiKey) : t('pasteKey'))}" dir="ltr" autocomplete="off"></label>
        <label class="f">${t('artModel')}<input type="text" id="sArt" value="${esc(e.artModel)}" dir="ltr" placeholder="${esc(t('artModelPh'))}"></label>
      </div>
      <div class="grid2">
        <label class="f"><span>${t('temperature', e.temperature)}</span><input type="range" id="sTemp" min="0" max="1.2" step="0.05" value="${e.temperature}"></label>
        ${numIn('sConc', t('painters'), e.concurrency, 1, 6)}
      </div>
      <div class="grid2">
        ${numIn('sDoc', t('doctorPasses'), e.doctorPasses, 0, 3)}
        <div class="muted small hint">${t('doctorNote')}</div>
      </div>
      <div class="row"><button class="btn" id="sTest">${t('test')}</button><span id="sTestOut" class="small muted" role="status"></span></div>
      <div id="sVision" class="small" role="status" hidden></div>`)}

      ${sec('pictures', t('pictures'), `
      <div class="note small">${t('picturesNote')}</div>
      <div class="seg" id="sPic" role="group" aria-labelledby="set-pictures-h"><button type="button" data-v="comfyui" class="${im.engine === 'comfyui' ? 'on' : ''}" aria-pressed="${im.engine === 'comfyui'}">${t('picComfy')}</button><button type="button" data-v="none" class="${im.engine !== 'comfyui' ? 'on' : ''}" aria-pressed="${im.engine !== 'comfyui'}">${t('picOff')}</button></div>
      <div id="sPicBox" class="stack" ${im.engine === 'comfyui' ? '' : 'hidden'}>
        <div class="grid2">
          <label class="f">${t('comfyUrl')}<input type="text" id="iUrl" value="${esc(im.url)}" dir="ltr"></label>
          <label class="f">${t('checkpoint')}<input type="text" id="iCkpt" list="iCkpts" value="${esc(im.checkpoint)}" dir="ltr" placeholder="RealVisXL_V5.0_Lightning_fp16.safetensors"><datalist id="iCkpts"></datalist></label>
        </div>
        <div class="grid2">
          ${numIn('iSteps', t('steps'), im.steps, 1, 60)}
          ${numIn('iCfg', t('cfg'), im.cfg, 1, 12, 0.1)}
          <label class="f">${t('sampler')}<select id="iSampler">${['dpmpp_sde', 'dpmpp_2m_sde', 'dpmpp_2m', 'euler', 'euler_ancestral', 'lcm'].map(x => `<option ${x === im.sampler ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
          <label class="f">${t('scheduler')}<select id="iSched">${['karras', 'sgm_uniform', 'normal', 'exponential', 'simple'].map(x => `<option ${x === im.scheduler ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        </div>
        <label class="f">${t('negative')}<textarea id="iNeg" rows="2" dir="ltr" style="text-align:left">${esc(im.negative)}</textarea></label>
        <div class="grid2">
          ${toggleIn('iIp', t('ipadapter'), im.ipadapter)}
          ${numIn('iIpW', t('ipWeight'), im.ipWeight, 0, 1.5, 0.05)}
        </div>
        <div class="grid2">
          ${numIn('iCand', t('candidates'), im.candidates, 1, 4)}
          <label class="f">${t('upscaler')}<input type="text" id="iUp" list="iUps" value="${esc(im.upscaler)}" dir="ltr" placeholder="4x-UltraSharp.pth"><datalist id="iUps"></datalist></label>
        </div>
        ${toggleIn('iCritic', t('critic'), im.critic)}
        <div class="grid2" id="iCriticBox">
          ${numIn('iMin', t('minScore'), im.minScore, 1, 10)}
          ${numIn('iRounds', t('maxRounds'), im.maxRounds, 1, 3)}
        </div>
        <div class="muted small">${t('criticNote')}</div>
        <div class="row"><button class="btn" id="iTest">${t('testComfy')}</button><span id="iTestOut" class="small muted" role="status"></span></div>
        <div id="iIpOut" class="small" role="status" hidden></div>
      </div>`)}

      ${sec('motion', t('motionTitle'), `
      <div class="note small">${t('motionNote')}</div>
      <div class="seg" id="vEngine" role="group" aria-labelledby="set-motion-h">${[['wan22', t('videoWan')], ['none', t('videoOff')]].map(([v, l]) => `<button type="button" data-v="${v}" class="${vid.engine === v ? 'on' : ''}" aria-pressed="${vid.engine === v}">${l}</button>`).join('')}</div>
      <div id="vBox" class="stack" ${vid.engine === 'wan22' ? '' : 'hidden'}>
        <div class="grid2">${txtIn('vUnet', t('unet'), vid.unet, VIDEO_DEF.unet)}${txtIn('vClip', t('clipModel'), vid.clip, VIDEO_DEF.clip)}</div>
        <div class="grid2">${txtIn('vVae', t('vae'), vid.vae, VIDEO_DEF.vae)}${numIn('vSteps', t('steps'), vid.steps, 1, 60)}</div>
        <div class="grid2">${numIn('vCfg', t('cfg'), vid.cfg, 1, 15, 0.5)}${numIn('vFps', t('clipFps'), vid.fps, 8, 60)}</div>
        <div class="grid2">${numIn('vSec', t('clipSeconds'), vid.seconds, 1, 10, 0.5)}</div>
      </div>
      ${toggleIn('vDepth', t('depth'), vid.depth)}`)}

      ${sec('narrator', t('narrator'), `
      <div class="grid2">
        ${toggleIn('sWhisper', t('whisperSound'), wh.enabled)}
        ${numIn('sWhGain', t('whisperGain'), wh.gain, -40, 0)}
      </div>
      <div class="grid2">${['ar', 'en', 'fr'].map(l => `<label class="f">${LANGS[l]}${voiceSel(l, s.voice[l])}</label>`).join('')}
        <label class="f">${t('ratePitch')}<div class="row" style="flex-wrap:nowrap"><input type="text" id="sRate" value="${esc(s.voice.rate)}" dir="ltr" aria-label="${esc(t('ratePitch'))} 1"><input type="text" id="sPitch" value="${esc(s.voice.pitch)}" dir="ltr" aria-label="${esc(t('ratePitch'))} 2"></div></label></div>`)}

      ${sec('filming', t('filming'), `
      <div class="grid2">
        <label class="f">${t('quality')}<select id="sQuality">${['720p', '1080p'].map(q => `<option ${q === s.render.quality ? 'selected' : ''}>${q}</option>`).join('')}</select></label>
        <label class="f">${t('fps')}<select id="sFps">${[24, 25, 30, 60].map(f => `<option ${f === Number(s.render.fps) ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
      </div>`)}
    </div>
    <div class="dlg-f"><button class="btn primary" id="sSave">${t('save')}</button><button class="btn ghost" id="sCancel">${t('cancel')}</button></div>`;
  const v = id => $(id, d).value.trim();
  const form = () => ({
    engine: { preset: v('#sPreset'), protocol: v('#sProto'), baseURL: v('#sBase'), model: v('#sModel'), artModel: v('#sArt'), apiKey: v('#sKey'), temperature: Number($('#sTemp', d).value), concurrency: numOf($('#sConc', d), 3), doctorPasses: numOf($('#sDoc', d), 2) },
    voice: { ...Object.fromEntries($$('[data-voice]', d).map(x => [x.dataset.voice, x.value])), rate: v('#sRate'), pitch: v('#sPitch'), whisper: { enabled: $('#sWhisper', d).checked, gain: numOf($('#sWhGain', d), wh.gain) } },
    render: { quality: v('#sQuality'), fps: Number(v('#sFps')) },
    image: { engine: $('#sPic .on', d).dataset.v, url: v('#iUrl'), checkpoint: v('#iCkpt'), steps: numOf($('#iSteps', d), 6), cfg: numOf($('#iCfg', d), 2),
      sampler: v('#iSampler'), scheduler: v('#iSched'), negative: v('#iNeg'), ipadapter: $('#iIp', d).checked, ipWeight: numOf($('#iIpW', d), 0.7),
      candidates: numOf($('#iCand', d), IMAGE_DEF.candidates), critic: $('#iCritic', d).checked, minScore: numOf($('#iMin', d), IMAGE_DEF.minScore), maxRounds: numOf($('#iRounds', d), IMAGE_DEF.maxRounds), upscaler: v('#iUp') },
    video: { engine: $('#vEngine .on', d).dataset.v, unet: v('#vUnet') || VIDEO_DEF.unet, clip: v('#vClip') || VIDEO_DEF.clip, vae: v('#vVae') || VIDEO_DEF.vae,
      steps: numOf($('#vSteps', d), VIDEO_DEF.steps), cfg: numOf($('#vCfg', d), VIDEO_DEF.cfg), fps: numOf($('#vFps', d), VIDEO_DEF.fps), seconds: numOf($('#vSec', d), VIDEO_DEF.seconds), depth: $('#vDepth', d).checked },
  });
  $('#sPreset', d).onchange = ev => { const pr = s.presets[ev.target.value]; $('#sProto', d).value = pr.protocol; $('#sBase', d).value = pr.baseURL; $('#sModel', d).value = pr.model; };
  $('#sTemp', d).oninput = ev => { $('#sTempV', d).textContent = ev.target.value; };
  bindSeg($('#sPic', d), val => { $('#sPicBox', d).hidden = val !== 'comfyui'; });
  bindSeg($('#vEngine', d), val => { $('#vBox', d).hidden = val !== 'wan22'; });
  d.onchange = ev => { const el = ev.target; if (el.type === 'number' && el.value !== '') el.value = numOf(el, el.value); }; // show the clamped value
  const criticBox = () => { for (const el of $$('#iCriticBox input', d)) el.disabled = !$('#iCritic', d).checked; };
  $('#iCritic', d).onchange = criticBox; criticBox();
  $('.set-nav', d).onclick = ev => { const b = ev.target.closest('[data-sec]'); if (b) $(`#set-${b.dataset.sec}`, d).scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const save = async () => { S.settings = await api('settings', { method: 'POST', body: form() }); renderEngineChip(); };
  const testInto = async (out, call) => {
    out.textContent = t('testing'); out.style.color = '';
    try { await save(); const r = await call(); if (!r.ok) throw new Error(r.error); out.style.color = 'var(--teal)'; return r; }
    catch (err) { out.textContent = `✗ ${err.message}`; out.style.color = 'var(--red)'; return null; }
  };
  $('#sTest', d).onclick = async () => {
    const out = $('#sTestOut', d), vis = $('#sVision', d), r = await testInto(out, () => api('settings/test', { method: 'POST' }));
    vis.hidden = !r || typeof r.vision !== 'boolean';
    if (!r) return;
    out.textContent = `✓ ${r.model}: “${r.reply}”${r.seconds ? ` (${fmt(r.seconds)} s)` : ''}${r.models?.length ? ` — ${t('modelsAvail', r.models.length)}` : ''}`;
    if (typeof r.vision === 'boolean') { vis.textContent = t('vision', r.vision); vis.className = `small ${r.vision ? 'ok-t' : 'warn-t'}`; }
    $('#sModels', d).innerHTML = (r.models ?? []).map(m => `<option value="${esc(m)}">`).join('');
  };
  $('#iTest', d).onclick = async () => {
    const out = $('#iTestOut', d), ip = $('#iIpOut', d), r = await testInto(out, () => api('image/test', { method: 'POST' }));
    ip.hidden = !r;
    if (!r) return;
    out.textContent = t('comfyOk', r);
    const suggest = (id, list) => { $(id, d).innerHTML = (list ?? []).map(m => `<option value="${esc(m)}">`).join(''); };
    suggest('#iCkpts', r.checkpoints); suggest('#iUps', r.upscalers);
    for (const [id, list] of [['#iSampler', r.samplers], ['#iSched', r.schedulers]]) { // what this ComfyUI really offers
      const el = $(id, d), cur = el.value;
      if (list?.length) el.innerHTML = [...new Set([...list, cur])].map(x => `<option ${x === cur ? 'selected' : ''}>${esc(x)}</option>`).join('');
    }
    const ck = $('#iCkpt', d), up = $('#iUp', d);
    if (r.checkpoint && r.checkpoint !== ck.value) ck.value = r.checkpoint; // the name ComfyUI resolved the typed one to
    else if (!ck.value && r.checkpoints?.length) ck.value = r.checkpoints.find(c => /lightning/i.test(c)) ?? r.checkpoints[0];
    if (r.upscaler && up.value && r.upscaler !== up.value) up.value = r.upscaler;
    ip.textContent = r.ipadapter ? t('ipOk') : r.ipadapterNodes ? t('ipMissing', (r.ipadapterMissing ?? []).join(', ')) : t('ipNo');
    ip.className = `small ${r.ipadapter ? 'ok-t' : 'warn-t'}`;
  };
  $('#sSave', d).onclick = ev => busy(ev.currentTarget, save).then(() => { d.close(); toast(t('settingsSaved')); if (S.p) renderKeepScroll(); }).catch(fail);
  $('#sCancel', d).onclick = $('#setX', d).onclick = () => d.close();
  d.onkeydown = ev => { if (ev.key === 'Enter' && ev.target.tagName === 'INPUT' && !ev.isComposing && !['checkbox', 'range', 'color'].includes(ev.target.type)) { ev.preventDefault(); $('#sSave', d).click(); } };
  d.showModal();
  if (section) $(`#set-${section}`, d)?.scrollIntoView({ block: 'start' });
  try { // voices load lazily (edge-tts --list-voices can take a few seconds the first time)
    S.voices ??= await api('voices');
    for (const sel of $$('[data-voice]', d)) {
      const cur = sel.value, list = S.voices.filter(x => x.lang === sel.dataset.voice);
      if (list.length) sel.innerHTML = list.map(x => `<option ${x.name === cur ? 'selected' : ''}>${esc(x.name)}</option>`).join('') + (list.some(x => x.name === cur) ? '' : `<option selected>${esc(cur)}</option>`);
    }
  } catch { /* keep the saved names */ }
}

// ---------------------------------------------------------------- job dock (SSE)
function setDock(open) { $('#dock').classList.toggle('collapsed', !open); document.body.classList.toggle('dock-open', open); $('#dockToggle').textContent = `${t('log')} ${open ? '▾' : '▴'}`; $('#dockToggle').setAttribute('aria-expanded', String(open)); }
$('#dockToggle').addEventListener('click', () => setDock($('#dock').classList.contains('collapsed')));
$('#stopBtn').addEventListener('click', () => { if (S.follow) api(`jobs/${S.follow}/stop`, { method: 'POST' }).catch(fail); });

function renderDock() {
  const j = S.follow ? S.jobs.get(S.follow) : null;
  const dock = $('#dock');
  dock.classList.remove('running', 'failed', 'done');
  if (!j) { $('#jobLabel').textContent = t('noJobs'); $('#jobProg').style.width = '0'; $('#jobBar').setAttribute('aria-valuenow', '0'); $('#jobStage').textContent = ''; $('#stopBtn').hidden = true; return; }
  const live = j.status === 'running' || j.status === 'queued';
  dock.classList.add(live ? 'running' : j.status === 'failed' ? 'failed' : 'done');
  const queued = [...S.jobs.values()].filter(x => x.status === 'queued').length;
  $('#jobLabel').textContent = jobText(j.label) + (queued && j.status === 'running' ? t('queuedMore', queued) : '');
  $('#jobLabel').title = $('#jobLabel').textContent;
  $('#jobProg').style.width = `${Math.round((j.progress ?? 0) * 100)}%`;
  $('#jobBar').setAttribute('aria-valuenow', String(Math.round((j.progress ?? 0) * 100)));
  $('#jobStage').textContent = j.status === 'failed' ? t('failedSt', j.error ?? '') : j.status === 'stopped' ? t('stoppedSt') : j.status === 'done' ? t('doneSt', mmss((j.endedAt - j.startedAt) / 1000)) : j.stage ?? '';
  $('#stopBtn').hidden = !live;
}

function logLine(line) {
  const el = $('#log');
  const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
  el.textContent += `${line}\n`;
  if (el.textContent.length > 200000) el.textContent = el.textContent.slice(-150000);
  if (atEnd) el.scrollTop = el.scrollHeight;
}

async function followJob(id) {
  if (S.follow === id) return;
  S.follow = id;
  $('#log').textContent = '';
  try { const j = await api(`jobs/${id}`); if (S.follow === id) { $('#log').textContent = ''; j.log.forEach(logLine); } } catch { /* gone */ }
  renderDock();
}

function connectEvents() {
  const es = new EventSource('/api/events');
  es.onmessage = async ev => {
    const m = JSON.parse(ev.data);
    if (m.type === 'hello') {
      S.jobs.clear();
      for (const j of m.jobs) S.jobs.set(j.id, j);
      const pick = m.jobs.find(j => j.status === 'running') ?? m.jobs[m.jobs.length - 1];
      if (pick) { S.follow = null; await followJob(pick.id); }
      renderDock();
    } else if (m.type === 'job') {
      const was = S.jobs.get(m.job.id);
      S.jobs.set(m.job.id, m.job);
      if (m.job.status === 'running' && S.follow !== m.job.id) { await followJob(m.job.id); if (!was || was.status !== 'running') setDock(true); }
      if (!S.follow) S.follow = m.job.id;
      if (m.job.status === 'failed' && S.follow === m.job.id) setDock(true);
      if ($('#busyChip')) $('#busyChip').hidden = !projectBusy();
      renderDock();
    } else if (m.type === 'log') {
      if (m.id === S.follow) logLine(m.line);
    } else if (m.type === 'project') {
      loadProjects().catch(() => {});
      if (S.p?.id === m.id) await reloadCurrent().catch(() => {});
      const j = [...S.jobs.values()].reverse().find(x => x.project === m.id);
      if (j?.status === 'done') toast(`✓ ${jobText(j.label)}`);
      if (j?.status === 'failed') toast(`✗ ${jobText(j.label)}: ${j.error ?? ''}`, 5000);
    }
  };
  es.onerror = () => { $('#jobLabel').textContent = t('reconnect'); };
}

/** A job touched the open project: take the server's view; keep unsaved edits in the editor. */
async function reloadCurrent() {
  await flushSave().catch(() => {});
  const view = await api(`projects/${pid()}`);
  const hadSp = !!S.sp;
  S.p = view;
  if (S.edit === S.saved) S.sp = view.screenplay ? structuredClone(view.screenplay) : null;
  if (!hadSp && S.sp) { location.hash = `#/p/${S.p.id}/board`; return; }
  if ($('#modal').open) return; // don't yank the animatic away mid-play
  if (S.tab === 'board' && hadSp && S.sp) { refreshLive(); return; }
  if (document.activeElement?.closest?.('#tab') && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return; // typing
  if (S.tab === 'story' || (S.tab === 'room' && S.ani)) return; // the story form only changes on "Save"
  renderKeepScroll();
}

addEventListener('beforeunload', e => { if (S.p && S.edit !== S.saved) { flushSave(); e.preventDefault(); } });

// ---------------------------------------------------------------- boot
(async () => {
  try {
    [S.meta, S.settings] = await Promise.all([api('meta'), api('settings')]);
    UI = S.settings.ui?.lang === 'ar' ? 'ar' : 'en';
    applyLanguage();
    renderEngineChip();
    await loadProjects();
    connectEvents();
    await route();
  } catch (e) {
    applyLanguage();
    $('#view').innerHTML = `<div class="hero"><div class="t">حكواتي</div><p class="note bad">${t('bootFail', e.message)}</p></div>`;
  }
})();

<div dir="rtl">

# استوديو حكواتي — التثبيت على الحاسوب المكتبي (Windows)

الجهاز المستهدف: Windows 10/11 بمعمارية x64، معالج i7-10700، بطاقة RTX 3060 Ti بذاكرة 8 GB، ذاكرة عشوائية 16 GB، قرص SSD على `E:`.
كل الأدوات هنا مجانية وتعمل محلياً. لا يحتاج الإنترنت إلا edge-tts (صوت الراوي) ومحرك النصوص (CodeCraft).

المسارات المعتمدة في هذا الدليل (يمكن تغييرها، لكن عندها غيّر المتغيرات في أعلى السكربتات أيضاً):

| المكوّن | المسار |
|---|---|
| استوديو حكواتي (هذا المستودع) | `E:\hakawati` |
| جذر ComfyUI المحمول | `E:\ComfyUI` (مجلد `ComfyUI_windows_portable` بعد فك الضغط وإعادة التسمية) |
| نماذج ComfyUI | `E:\ComfyUI\ComfyUI\models\…` |
| العُقد الإضافية | `E:\ComfyUI\ComfyUI\custom_nodes\…` |

المساحة: نحو 37 GB للنماذج + نحو 7 GB لـ ComfyUI + المشاريع. أبقِ **60 GB حرة على الأقل في E:**.

الرموز: **[v]** = تحقّقتُ منه من المصدر أثناء الكتابة (تشرين الأول 2026)؛ **[?]** = غير متحقَّق، من الذاكرة أو من قائمة طرف ثالث — راجعه في الصفحة نفسها.

## التثبيت التلقائي (المستحسن)

الملف `scripts\install-all.bat` ينفّذ كل خطوات هذا الدليل وحده. ويمكن تشغيله مراراً بأمان: ما اكتمل يُتخطّى، والتنزيل المنقطع يُستأنف.

1. افتح المستودع على GitHub ← *Code ← Download ZIP*، وفكّه في أي مكان (مثل `Downloads`). لا تحتاج منه إلا `scripts\install-all.bat` و`scripts\install-all.ps1`.
2. انقر نقراً مزدوجاً على `scripts\install-all.bat` (أو زر الفأرة الأيمن على `install-all.ps1` ← *Run with PowerShell*). **لا** تشغّله بصلاحيات المدير؛ فهو يطلب UAC حيث يلزم فقط (مثبّت Node وحزم winget وملف الترحيل).
3. ينفّذ 9 خطوات: (1) Node 22 وGit وPython 3.12 مع edge-tts و7-Zip وChrome (وEdge بديلاً) وffmpeg — عبر winget أو المثبّتات الرسمية، متخطياً الموجود؛ (2) فحص تعريف NVIDIA (ينبّه إن كان أقدم من R580 ويتابع)؛ (3) ملف الترحيل — إن كانت الذاكرة مع ملف الترحيل أقل من 48 GB يسأل `y/c/N` ويضبط 32768 MB على E: (أو C:)، **ويلزم إعادة التشغيل**؛ (4) `git clone https://github.com/houssam-soukieh/hakawati-studio2 E:\hakawati` (أو `git pull`) ثم `npm install` — إن كان المستودع خاصاً تظهر نافذة تسجيل دخول GitHub؛ (5) ComfyUI المحمول من آخر إصدار على GitHub ← `E:\ComfyUI`؛ (6) العقدتان الإضافيتان ومتطلباتهما ومدير ComfyUI؛ (7) ملفات النماذج التسعة في §5 (نحو 37 GB) مع الاستئناف والتحقق من الحجم وSHA256 (تأتي البصمة من ترويسة `X-Linked-Etag` في Hugging Face؛ فحص ملف 10 GB يستغرق 1–2 دقيقة)؛ (8) إعدادات الاستوديو: الصور = ComfyUI، النموذج = RealVisXL، IP-Adapter مفعّل — ويُحفظ مفتاح API الموجود كما هو، وتُنسخ النسخة السابقة إلى `settings.json.bak`؛ (9) يشغّل ComfyUI مؤقتاً، ويشغّل `check-setup.ps1`، ويطبع خلاصة ✓/✗ مع حجم ما نُزّل والأمر الدقيق لإعادة أي بند فشل.
4. كل شيء يُسجَّل في `E:\hakawati-install.log` (بترميز UTF-8؛ يعرض Notepad الأسطر العربية صحيحة، وقد لا تعرضها نافذة الطرفية).

الخيارات (تُضاف بعد اسم ملف `.bat` أو `.ps1`):

| الخيار | الأثر |
|---|---|
| `-DryRun` | يطبع كل إجراء ورابط دون تغيير شيء |
| `-OnlyModels` / `-SkipModels` / `-SkipWan` | النماذج فقط / كل شيء عدا النماذج / بلا ملفات Wan 2.2 الثلاثة (نحو 18.2 GB) |
| `-Steps 6` · `-Steps 1,4` · `-Steps 5-7` | تنفيذ هذه الخطوات وحدها |
| `-Proxy http://HOST:PORT` | يُمرَّر إلى curl وgit وpip وnpm وwinget |
| `-HfEndpoint https://hf-mirror.com` | مرآة Hugging Face. بدونه يجرّب السكربت `huggingface.co` أولاً، وإن فشل ينتقل تلقائياً إلى `hf-mirror.com` (ويضبط متغير المستخدم `HF_ENDPOINT` كي تستخدم عقد ComfyUI المرآة أيضاً) |
| `-Root D:\` | التثبيت على قرص آخر (`D:\hakawati` و`D:\ComfyUI`) |
| `-Yes` | الموافقة على سؤال ملف الترحيل |
| `-NoComfyTest` | لا يشغّل ComfyUI في الخطوة 9 |

اختُبر حتى الآن على Linux فقط بـ PowerShell 7 مقابل أدوات بديلة وخادم محلي يحاكي Hugging Face وGitHub (التشغيل التجريبي، التنزيل مع الاستئناف، عدم تطابق SHA256، نقل ملف من مجلد فرعي، دمج الإعدادات، تعذّر الوصول إلى المصدر)، وفُحص بـ PSScriptAnalyzer للتوافق مع Windows PowerShell 5.1. **لم يُشغَّل بعد على ويندوز حقيقي** (winget، مثبّتات MSI/EXE، UAC، ملف الترحيل، 7-Zip، تشغيل ComfyUI فعلياً) — التشغيل الأول على الحاسوب المكتبي هو الاختبار الحقيقي؛ أرسل ملف السجل إن فشلت خطوة.

بقية هذا الدليل هي الإجراء نفسه يدوياً.

---

## 0. قبل البدء

1. **تعريف NVIDIA من الفرع R580 أو أحدث.** نسخة ComfyUI المحمولة الحالية تأتي بـ PyTorch مبني على CUDA 13.0 ‏[v]. للتحقق:

</div>
<div dir="ltr">

```bat
nvidia-smi
```

</div>
<div dir="rtl">

   يجب أن يظهر في الترويسة `CUDA Version: 13.0` أو أعلى، وإلا فثبّت أحدث تعريف Game Ready أو Studio من موقع nvidia.com.

2. **Microsoft Visual C++ Redistributable x64** (يحتاجه PyTorch؛ ظهور خطأ `c10.dll` يعني أنه غير مثبت): https://aka.ms/vc14/vc_redist.x64.exe ‏[v].
3. **ملف الترحيل (Page file).** ذاكرة 16 GB لا تكفي Wan 2.2 (نموذج 10 GB + مرمّز نصوص 6.7 GB + النظام). من *خصائص النظام ← خيارات متقدمة ← الأداء ← الإعدادات ← خيارات متقدمة ← الذاكرة الظاهرية* اختر *يديره النظام* على قرص SSD، أو حجماً ثابتاً 32768 MB. بدونه يظهر الخطأ `The paging file is too small for this operation to complete` (os error 1455).

## 1. الأدوات الأساسية

ثبّتها بهذا الترتيب، وافتح بعد كل تثبيت نافذة طرفية **جديدة** كي يُقرأ PATH من جديد.

| الأداة | المصدر | خيارات التثبيت | التحقق |
|---|---|---|---|
| Node.js 22 LTS | https://nodejs.org/dist/latest-v22.x/ ← الملف `node-v22.*-x64.msi` | الافتراضي (يضيف نفسه إلى PATH) | `node -v` ← `v22.x.x` |
| Git for Windows | https://git-scm.com/downloads/win (64-bit) | الافتراضي | `git --version` |
| ffmpeg (بناء gyan.dev) | https://www.gyan.dev/ffmpeg/builds/ ← `ffmpeg-release-essentials.zip` | فكّه في `C:\ffmpeg` بحيث يوجد `C:\ffmpeg\bin\ffmpeg.exe`، ثم أضف `C:\ffmpeg\bin` إلى PATH **الخاص بالمستخدم** (*تحرير متغيرات البيئة لحسابك ← Path ← جديد*) | `ffmpeg -version` و`ffprobe -version` |
| Python 3.12 | https://www.python.org/downloads/release/python-31210/ ← *Windows installer (64-bit)* أي `python-3.12.10-amd64.exe` (هو آخر إصدار 3.12 له مُثبِّت لويندوز [v]؛ والإصدار 3.13 يعمل أيضاً) | فعّل **Add python.exe to PATH** في الشاشة الأولى | `python --version` ← `Python 3.12.10` |
| edge-tts | `python -m pip install -U edge-tts` | — | `python -m edge_tts --list-voices \| findstr ar-SY` ← يظهر `ar-SY-AmanyNeural` و`ar-SY-LaithNeural` |
| Google Chrome | https://www.google.com/chrome/ | الافتراضي | وجود `C:\Program Files\Google\Chrome\Application\chrome.exe` |
| 7-Zip (لفك أرشيف ComfyUI) | https://7-zip.org (64-bit x64) | الافتراضي | — |

ملاحظات:
- بناء ffmpeg الأساسي (essentials) يتضمن `libx264` ومرمّز AAC الداخلي، وهذا كل ما يستخدمه حكواتي (`libx264` و`aac` و`pcm_s16le`، والمرشحات `xfade` و`loudnorm` و`aevalsrc`).
- يجب أن يشير الأمر `python` إلى المفسّر الحقيقي لا إلى اختصار متجر مايكروسوفت. إن فتح `python` المتجرَ: *الإعدادات ← التطبيقات ← إعدادات التطبيقات المتقدمة ← أسماء الأوامر المستعارة للتطبيقات (App execution aliases)* وأوقف `python.exe` و`python3.exe`.
- يستدعي حكواتي `python -m edge_tts` و`ffmpeg` و`ffprobe` بأسمائها، فيجب أن تكون على PATH في الطرفية التي تشغّل الاستوديو.
- Chrome: تبحث Playwright عن `Google\Chrome\Application\chrome.exe` داخل `%LOCALAPPDATA%` ثم `%ProgramFiles%` ثم `%ProgramFiles(x86)%` ‏[v]. إن تعذّر تثبيت Chrome فمتصفح Microsoft Edge الموجود أصلاً في ويندوز يؤدي المهمة: اضبط `HAKAWATI_CHROME` (انظر §8).
- اختصارات اختيارية عبر winget (المعرّفات [?]، تحقّق منها بـ `winget search`): `winget install --id Git.Git -e`، `winget install --id Gyan.FFmpeg.Essentials -e`، `winget install --id Google.Chrome -e`، `winget install --id 7zip.7zip -e`.

## 2. استوديو حكواتي

</div>
<div dir="ltr">

```bat
cd /d E:\
git clone <repo-url> hakawati
cd /d E:\hakawati
npm install
```

</div>
<div dir="rtl">

لا يوجد عنوان مستودع بعد. إن لم يكن المستودع على GitHub فانسخ المجلد إلى `E:\hakawati` (دون `node_modules` و`.studio` و`projects`) ثم نفّذ `npm install` فيه. الاعتمادية الوحيدة هي `playwright-core`، وهي **لا** تنزّل متصفحاً بل تقود Chrome المثبّت.

تجربة سريعة بلا بطاقة رسومية ولا مفتاح (المحرك التجريبي `mock`):

</div>
<div dir="ltr">

```bat
node make.mjs new docs\test-story.txt --style shadow --aspect 16:9 --length 30
node make.mjs run <the id it printed> all
```

</div>
<div dir="rtl">

يُحفظ الفيلم في `E:\hakawati\projects\<id>\final\` (ملفات `.mp4` و`.srt` و`thumbnail.jpg`).

## 3. ComfyUI المحمول (NVIDIA)

1. نزّل الأرشيف الرسمي [v]:
   https://github.com/comfyanonymous/ComfyUI/releases/latest/download/ComfyUI_windows_portable_nvidia.7z
   (لبطاقات RTX 20 فما فوق؛ **لا** تأخذ النسخة `_cu126` فهي لبطاقات GTX 10).
   يحتوي حالياً على Python 3.13 مدمج وPyTorch لـ CUDA 13.0 ‏[v].
2. إن اعترض فك الضغط: زر الفأرة الأيمن على ملف `.7z` ← *خصائص* ← **إلغاء الحظر (Unblock)**.
3. فكّه بـ 7-Zip في `E:\` ثم أعد تسمية `E:\ComfyUI_windows_portable` إلى `E:\ComfyUI`. النتيجة:

</div>
<div dir="ltr">

```
E:\ComfyUI\python_embeded\python.exe
E:\ComfyUI\ComfyUI\main.py
E:\ComfyUI\ComfyUI\models\
E:\ComfyUI\update\update_comfyui.bat
E:\ComfyUI\run_nvidia_gpu.bat
```

</div>
<div dir="rtl">

4. حدّثه مرة قبل أول استخدام (وكلما احتاجت عقدةٌ نسخةً أحدث):

</div>
<div dir="ltr">

```bat
cd /d E:\ComfyUI\update
update_comfyui_stable.bat
```

</div>
<div dir="rtl">

   `update_comfyui_stable.bat` ينقلك إلى آخر إصدار موسوم، و`update_comfyui.bat` إلى آخر تعديل. لا تستخدم `update_comfyui_and_python_dependencies.bat` إلا إذا تعطلت حزم Python ‏[v].

5. **ComfyUI-Manager** (صار حزمة pip تُفعَّل بخيار تشغيل [v]):

</div>
<div dir="ltr">

```bat
cd /d E:\ComfyUI
python_embeded\python.exe -s -m pip install -r ComfyUI\manager_requirements.txt
```

</div>
<div dir="rtl">

   السكربت `scripts\start-comfyui.bat` يمرّر `--enable-manager`؛ وإن لم تكن الحزمة مثبتة يطبع ComfyUI أمر pip أعلاه ويُكمل التشغيل. أعد أمر pip بعد كل تحديث لـ ComfyUI (إصدار المدير مثبّت في ذلك الملف).
   الطريقة القديمة، فقط إن فشلت حزمة pip: `git clone https://github.com/ltdrdata/ComfyUI-Manager comfyui-manager` داخل `custom_nodes`، والتشغيل دون `--enable-manager`.

6. التشغيل الأول: انقر نقراً مزدوجاً على `E:\hakawati\scripts\start-comfyui.bat` (انظر §6)، وانتظر السطر `To see the GUI go to: http://127.0.0.1:8188`.

## 4. العُقد الإضافية

هاتان فقط. العُقد الإضافية تشغّل شيفرة Python حرّة داخل ComfyUI، فثبّتها من مستودعاتها الرسمية وحدها.

</div>
<div dir="ltr">

```bat
cd /d E:\ComfyUI\ComfyUI\custom_nodes
git clone https://github.com/cubiq/ComfyUI_IPAdapter_plus
git clone https://github.com/Fannovel16/comfyui_controlnet_aux
cd comfyui_controlnet_aux
install.bat
```

</div>
<div dir="rtl">

- **ComfyUI_IPAdapter_plus** (cubiq): لا يحتاج حزم Python إضافية. يوفّر العقدتين `IPAdapterUnifiedLoader` و`IPAdapter` اللتين يستخدمهما حكواتي لثبات ملامح الشخصيات (الإعداد `PLUS (high strength)`). المستودع في وضع «الصيانة فقط» منذ نيسان 2025 ‏[v].
- **comfyui_controlnet_aux** (Fannovel16): الملف `install.bat` يكتشف Python المحمول (`..\..\..\python_embeded\python.exe`) ويثبّت `requirements.txt` سطراً سطراً [v]، فلا يوقف فشلُ حزمة واحدة البقية. إن فشلت `mediapipe` على Python 3.13 ‏[?] فلا يضيع إلا معالج الوجوه MediaPipe؛ أما Depth Anything V2 فلا يحتاجها. العقدة المستخدمة: `DepthAnythingV2Preprocessor` (واسمها الظاهر "Depth Anything V2 - Relative") ‏[v].
- بديل: ComfyUI-Manager ← *Custom Nodes Manager* ← ابحث عن الاسمين ← Install.
- أعد تشغيل ComfyUI بعد التثبيت. للتحديث لاحقاً: `git pull` داخل كل مجلد (أو عبر المدير).

## 5. النماذج

ضع كل ملف **مباشرة** في المجلد المذكور (دون مجلد فرعي) وبالاسم **الحرفي** — فـ ComfyUI يعرض ملفات المجلدات الفرعية بصيغة `sub\name`، فتفشل مسارات العمل التي تذكر الاسم المجرد برسالة `Value not in list`. مدير النماذج في ComfyUI-Manager يحفظ Wan 2.2 في `diffusion_models\Wan2.2\` — انقله إلى الأعلى إن استخدمته.

كل المجلدات أدناه تحت `E:\ComfyUI\ComfyUI\models\`. الأحجام بالـ GB العشري كما يعرضها Hugging Face.

| # | الملف (الاسم الحرفي) | المجلد | الحجم | المصدر | الحالة |
|---|---|---|---|---|---|
| 1 | `RealVisXL_V5.0_Lightning_fp16.safetensors` | `checkpoints` | 6.94 GB | HF ‏[SG161222/RealVisXL_V5.0_Lightning](https://huggingface.co/SG161222/RealVisXL_V5.0_Lightning) · صفحة Civitai "RealVisXL V5.0" (civitai.com/models/139562 ‏[?]) | الاسم والحجم من قائمة نسخة مرآة؛ المسار الرسمي لم يُجلب [?] |
| 2 | `Juggernaut_RunDiffusionPhoto2_Lightning_4Steps.safetensors` | `checkpoints` | 7.11 GB | HF ‏[RunDiffusion/Juggernaut-XL-Lightning](https://huggingface.co/RunDiffusion/Juggernaut-XL-Lightning) · صفحة Civitai "Juggernaut XL" (civitai.com/models/133005 ‏[?]) | الاسم والحجم من القائمة الرسمية عبر البحث؛ لم يُجلب [?] |
| 3 | `ip-adapter-plus_sdxl_vit-h.safetensors` | `ipadapter` (أنشئه) | 848 MB | HF ‏[h94/IP-Adapter](https://huggingface.co/h94/IP-Adapter) داخل `sdxl_models/` | [v] |
| 4 | `CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors` | `clip_vision` | 2.53 GB | HF ‏h94/IP-Adapter، الملف `models/image_encoder/model.safetensors` — **نزّله ثم أعد تسميته** | [v] |
| 5 | `depth_anything_v2_vitl.pth` | تلقائي: `custom_nodes\comfyui_controlnet_aux\ckpts\depth-anything\Depth-Anything-V2-Large\` | 1.34 GB | تنزّله العقدة بنفسها عند أول استخدام من HF ‏`depth-anything/Depth-Anything-V2-Large` | [v] |
| 6 | `wan2.2_ti2v_5B_fp16.safetensors` | `diffusion_models` | 10.0 GB | HF ‏[Comfy-Org/Wan_2.2_ComfyUI_Repackaged](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged) داخل `split_files/diffusion_models/` | [v] |
| 7 | `umt5_xxl_fp8_e4m3fn_scaled.safetensors` | `text_encoders` | 6.74 GB | HF ‏Comfy-Org/Wan_2.1_ComfyUI_repackaged داخل `split_files/text_encoders/` (والملف نفسه في مستودع Wan 2.2 أيضاً) | [v] |
| 8 | `wan2.2_vae.safetensors` | `vae` | نحو 1.41 GB ‏[?] | HF ‏Comfy-Org/Wan_2.2_ComfyUI_Repackaged داخل `split_files/vae/` (نموذج 5B يحتاج **هذا** الـ VAE لا `wan_2.1_vae`) | الاسم والمجلد [v]؛ الحجم من مرآة [?] |
| 9 | `4x-UltraSharp.pth` | `upscale_models` | 67 MB | HF ‏Kim2091/UltraSharp · الصفحة: openmodeldb.info/models/4x-UltraSharp | [v] |

البند 4: المحمّل الموحّد IPAdapter Unified Loader يجد المرمّز بالتعبير `ViT.H.14.*s32B.b79K` والمحوّل بالتعبير `plus.sdxl.vit.h` ‏[v] — فاحفظ الأسماء كما هي تماماً.
البند 5: إن تعذّر الوصول إلى Hugging Face عند أول تشغيل للعقدة، فنزّل `https://huggingface.co/depth-anything/Depth-Anything-V2-Large/resolve/main/depth_anything_v2_vitl.pth` بنفسك إلى المجلد المذكور. النموذج الصغير (`depth_anything_v2_vits.pth`، نحو 99 MB) هو البديل الآمن ترخيصياً (انظر §11).

### أوامر التنزيل

في PowerShell؛ الأداة `curl.exe` مدمجة في Windows 10/11 (أما `curl` وحدها في PowerShell فأمر مختلف). الخيار `-C -` يستأنف التنزيل المنقطع: أعد تنفيذ السطر نفسه فحسب.

</div>
<div dir="ltr">

```powershell
$M  = "E:\ComfyUI\ComfyUI\models"
$HF = "https://huggingface.co"
function Get-Model($dest, $url) { curl.exe -L -C - --create-dirs -o "$M\$dest" $url }

Get-Model "checkpoints\RealVisXL_V5.0_Lightning_fp16.safetensors"          "$HF/SG161222/RealVisXL_V5.0_Lightning/resolve/main/RealVisXL_V5.0_Lightning_fp16.safetensors"
Get-Model "checkpoints\Juggernaut_RunDiffusionPhoto2_Lightning_4Steps.safetensors" "$HF/RunDiffusion/Juggernaut-XL-Lightning/resolve/main/Juggernaut_RunDiffusionPhoto2_Lightning_4Steps.safetensors"
Get-Model "ipadapter\ip-adapter-plus_sdxl_vit-h.safetensors"               "$HF/h94/IP-Adapter/resolve/main/sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors"
Get-Model "clip_vision\CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors"         "$HF/h94/IP-Adapter/resolve/main/models/image_encoder/model.safetensors"
Get-Model "diffusion_models\wan2.2_ti2v_5B_fp16.safetensors"                "$HF/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors"
Get-Model "text_encoders\umt5_xxl_fp8_e4m3fn_scaled.safetensors"            "$HF/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors"
Get-Model "vae\wan2.2_vae.safetensors"                                      "$HF/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan2.2_vae.safetensors"
Get-Model "upscale_models\4x-UltraSharp.pth"                                "$HF/Kim2091/UltraSharp/resolve/main/4x-UltraSharp.pth"
```

</div>
<div dir="rtl">

يكفي أحد نموذجَي SDXL للبدء؛ RealVisXL هو الافتراضي للأسلوب `photoreal`. إن أعاد رابطٌ ملف HTML صغيراً بدل الغيغابايتات فقد تغيّر المسار — افتح صفحة النموذج وخذ الملف من تبويب *Files and versions*.

### الذاكرة لكل نموذج (8 GB على البطاقة، 16 GB في الجهاز)

| النموذج | الحجم المحمَّل | هل يتسع في 3060 Ti | ملاحظات |
|---|---|---|---|
| نموذج SDXL Lightning (UNet + مرمّزا CLIP + VAE بدقة fp16) | ذروة نحو 6.5–7 GB عند 1344×768 ‏[?] | نعم | التحميل الأول من SSD بين 20 و40 ثانية، ثم يبقى في الذاكرة |
| + IP-Adapter Plus SDXL + CLIP-ViT-H | + نحو 1.5–2 GB ‏[?] | على الحد | يفرّغ ComfyUI جزءاً من UNet إلى الذاكرة العشوائية؛ الكلفة ثوانٍ لا نفاد ذاكرة |
| Depth Anything V2 Large | نحو 1 GB ‏[?] | نعم | الاستدلال بدقة 512 بكسل |
| 4x-UltraSharp | ‏67 MB + البلاطات | نعم | عقدة التكبير تقسّم الصورة إلى بلاطات 512 وتنصّفها عند نفاد الذاكرة [v] |
| Wan 2.2 TI2V-5B بدقة fp16 | أوزان 10.0 GB | **لا — تُبثّ بثّاً** | تُبثّ الأوزان من الذاكرة العشوائية (dynamic VRAM). اختياري: في عقدة *Load Diffusion Model* اضبط `weight_dtype = fp8_e4m3fn` فيصير نحو 5 GB (خسارة جودة طفيفة؛ معمارية Ampere لا تحسب بـ fp8، فالفائدة توفير ذاكرة فقط) |
| مرمّز النصوص umt5-xxl بدقة fp8 | 6.74 GB | لوقت قصير | يُستخدم لترميز الوصف ثم يُخلى |
| Wan 2.2 VAE | 1.41 GB | نعم | فك ترميز 121 إطاراً بدقة 1280×704 ثقيل؛ يعيد ComfyUI المحاولة بفك مُبلَّط عند نفاد الذاكرة [v] |

أغلق Chrome والألعاب أثناء عمل Wan. ذروة الذاكرة العشوائية لمهمة Wan تتجاوز 16 GB، لذا فملف الترحيل (§0.3) إلزامي.

## 6. سكربتات التشغيل

| السكربت | وظيفته |
|---|---|
| `scripts\start-comfyui.bat` | يشغّل `E:\ComfyUI` على `127.0.0.1:8188` |
| `scripts\start-studio.bat` | يشغّل الاستوديو (ويثبّت الحزم في المرة الأولى) ويفتح `http://127.0.0.1:4848`؛ وإن كان يعمل أصلاً يفتح المتصفح فقط |
| `scripts\check-setup.ps1` | جدول ✓/✗ للأدوات وComfyUI والعقد وملفات النماذج |
| `scripts\install-all.bat` / `.ps1` | المثبّت التلقائي (أول هذا الدليل) |

ينفّذ `start-comfyui.bat` الأمر التالي (المتغيرات في أعلى الملف):

</div>
<div dir="ltr">

```
python_embeded\python.exe -s ComfyUI\main.py --windows-standalone-build --listen 127.0.0.1 --port 8188 --disable-auto-launch --preview-method none --enable-manager
```

</div>
<div dir="rtl">

ملاحظات الخيارات [v، من الشيفرة المصدرية لـ ComfyUI، تشرين الأول 2026]:
- `--listen 127.0.0.1`: لا تستخدم `--listen` وحدها أبداً (فهي تربط على 0.0.0.0 وتكشف ComfyUI للشبكة المحلية).
- `--preview-method none`: بلا معاينات أثناء التوليد (توفير بسيط في الذاكرة والوقت؛ حكواتي لا يعرضها).
- **لم نضع `--lowvram` عمداً.** ComfyUI الحالي يفعّل *dynamic VRAM* افتراضياً على بطاقات NVIDIA مع PyTorch ‏2.8 فما فوق، فيبثّ أوزان Wan 2.2 تلقائياً، وفي هذا الوضع لا يفعل `--lowvram` شيئاً. ضعه في `EXTRA_FLAGS` فقط مع نسخة قديمة (يظهر في السجل `DynamicVRAM support requires Pytorch version 2.8`) أو إن بقي Wan ينفد من الذاكرة. الملاذ الأخير: `--novram`.
- `--reserve-vram 1.0` (في `EXTRA_FLAGS`) يُبقي 1 GB حرّاً لسطح المكتب وChrome إن ظهر نفاد ذاكرة أثناء تصوير الاستوديو.

## 7. فحص كل شيء

</div>
<div dir="ltr">

```bat
cd /d E:\hakawati
powershell -ExecutionPolicy Bypass -File scripts\check-setup.ps1
```

</div>
<div dir="rtl">

الخيارات: `-ComfyRoot E:\ComfyUI` و`-ComfyUrl http://127.0.0.1:8188` و`-Ascii` (يطبع OK/FAIL؛ وهو الافتراضي في نافذة الطرفية القديمة لأن خطوطها تخلو من ✓/✗) و`-Unicode`. شغّل ComfyUI أولاً ليُفحص تحميل العقد. رمز الخروج 0 يعني أن كل المطلوب موجود.

## 8. التشغيل الأول للاستوديو

1. شغّل `scripts\start-comfyui.bat` وانتظر سطر `To see the GUI`.
2. شغّل `scripts\start-studio.bat` فيفتح المتصفح `http://127.0.0.1:4848`. الواجهة بالإنجليزية افتراضياً، وزر **العربية** أسفل الشريط الجانبي يحوّلها إلى العربية (ويُحفظ الاختيار في الإعدادات).
3. انقر شارة المحرك (أسفل الشريط الجانبي) ← **⚙ المحرك والإعدادات**:
   - **المحرك الجاهز:** `CodeCraft (بوابة)` فتُملأ الحقول: البروتوكول `anthropic`، العنوان `https://codecraftapi.com`، النموذج `claude-opus-5.5`. الصق المفتاح في **المفتاح (API key)** ثم اضغط **🔌 اختبر الاتصال** (يحفظ أولاً ثم يختبر) فيظهر `✓ claude-opus-5.5: «جاهز ✓» (n ث) — N نموذجاً متاحاً` أو ما يعادلها. إن فشلت صيغة Anthropic فجرّب `CodeCraft (صيغة OpenAI)` (‏`https://codecraftapi.com/v1` والنموذج `gpt-5.5`). CodeCraft للنصوص فقط؛ الصور من ComfyUI.
   - **الصور (ComfyUI على بطاقتك الرسومية):** اختر **ComfyUI**، العنوان `http://127.0.0.1:8188`، ثم **🔌 اختبر ComfyUI** فيظهر `✓ ComfyUI <الإصدار> · NVIDIA GeForce RTX 3060 Ti 8 GB · N checkpoints · IP-Adapter ✓`. يُملأ حقل النموذج بأول ملف يحوي `Lightning`؛ واختر من القائمة إن شئت. القيم الافتراضية تناسب النموذجين: 6 خطوات، CFG ‏2، `dpmpp_sde` مع `karras` (لـ RealVisXL Lightning: ‏4–6 خطوات، CFG بين 1 و2، DPM++ SDE Karras ‏[?]؛ ولـ Juggernaut Lightning المدى نفسه [?]). فعّل **ثبات الوجوه عبر IP-Adapter** بقوة 0.7.
   - **الراوي:** العربية `ar-SY-LaithNeural` (الافتراضي)، الإنجليزية `en-US-AndrewMultilingualNeural`؛ تمتلئ القائمة من edge-tts خلال ثوانٍ.
   - **التصوير:** ‏720p و30 إطاراً/ث للمسودات، و1080p للنسخة النهائية.
   - **💾 حفظ.**
4. **＋ حكاية جديدة** ← الصق `docs\test-story.txt` ← الأسلوب **سينمائي واقعي**، الإطار 16:9، الطول 60 ث ← **🎬 اكتب السيناريو** ← عدّل في **لوحة اللقطات** ← **🎞 اصنع الفيلم** ← **قاعة العرض** ← نزّل MP4 والترجمة SRT والصورة المصغرة.

متغيرات البيئة (اضبطها في `start-studio.bat`، أو دائماً بـ `setx NAME "value"` ثم افتح طرفية جديدة):

| المتغير | الافتراضي | الاستخدام |
|---|---|---|
| `HAKAWATI_PORT` | `4848` | منفذ الاستوديو |
| `HAKAWATI_CHROME` | Chrome الذي تجده Playwright | المسار الكامل لمتصفح مبني على Chromium، مثل `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` |
| `HAKAWATI_NO_OPEN` | غير مضبوط | اضبطه على `1` كي لا يفتح الخادم المتصفح |

يُحفظ مفتاح API في `E:\hakawati\.studio\settings.json` وحده (وهو مستثنى من git)، ويظهر في المتصفح مقنّعاً. لا تشارك ذلك الملف.

## 9. الأزمنة المتوقعة على RTX 3060 Ti

**كلها تقديرات [?]** — مشتقة من أرقام RTX 4090 المنشورة ومن سرعة SDXL المعتادة على 3060 Ti، وليست مقيسة على هذا الجهاز. يطبع ComfyUI لكل مهمة `Prompt executed in N seconds`؛ استبدل هذه الأرقام بقياساتك.

| المهمة | التقدير |
|---|---|
| صورة أساسية SDXL Lightning بدقة 1344×768، ‏6 خطوات DPM++ SDE، بعد الإحماء | 5–8 ث |
| أول صورة بعد تشغيل ComfyUI (تحميل النموذج) | + 20–40 ث |
| + IP-Adapter Plus (مرجع الشخصية) | + 1–3 ث لكل صورة؛ + 5–10 ث عند أول استخدام |
| صورة مرجعية لشخصية 1024×1024 | 5–8 ث |
| خريطة عمق Depth Anything V2 Large | أقل من ثانية (أول مرة: تنزيل 1.34 GB ثم تحميل) |
| 4x-UltraSharp من 1344×768 إلى 5376×3072 | 5–15 ث |
| Wan 2.2 TI2V-5B بدقة 1280×704، ‏41 إطاراً (1.7 ث بمعدل 24)، ‏30 خطوة | 6–12 دقيقة |
| Wan 2.2 TI2V-5B بدقة 1280×704، ‏121 إطاراً (5 ث)، ‏30 خطوة | 25–45 دقيقة (فريق Wan يذكر أقل من 9 دقائق على RTX 4090 واحدة) |
| edge-tts لسطر سرد واحد | 1–3 ث (حسب الشبكة) |
| التصوير الإطاري في Chrome لدقيقة فيلم بدقة 720p و30 إطاراً | 1–1.5 دقيقة (على الحاسوب المحمول قيس 2.5 دقيقة لـ 55 ث) |
| فيلم واقعي 60 ث من 12 لقطة، بارالاكس فقط، بلا Wan | نحو 5–8 دقائق + زمن محرك النصوص |

الحجم الأصلي لـ Wan 2.2 هو 1280×704 وحتى 121 إطاراً بمعدل 24 ‏[v]. خصّص تحويل الصورة إلى فيديو للقطات الحركة القليلة؛ ومستوى البارالاكس يغطي الباقي.

## 10. حل المشكلات

| العَرَض (كما يُطبع) | السبب | الحل |
|---|---|---|
| `torch.OutOfMemoryError: CUDA out of memory` / `Allocation on device` | امتلاء ذاكرة البطاقة (Wan، أو SDXL مع IP-Adapter بينما يستخدم Chrome البطاقة) | أغلق تطبيقات البطاقة؛ أضف `--reserve-vram 1.0` إلى `EXTRA_FLAGS`؛ لـ Wan: إطارات أقل أو دقة أصغر أو `weight_dtype = fp8_e4m3fn`؛ مع نسخة قديمة أضف `--lowvram`؛ الملاذ الأخير `--novram` |
| `The paging file is too small for this operation to complete` (os error 1455) | نفاد الذاكرة العشوائية وملف الترحيل أثناء تحميل نموذج كبير | ملف الترحيل في §0.3، وأغلق التطبيقات الأخرى |
| نافذة ComfyUI تُغلق فوراً / خطأ `c10.dll` | تعريف قديم / مكتبة VC++ ناقصة | تعريف R580 فما فوق (`nvidia-smi` يُظهر CUDA 13.x)؛ ثبّت https://aka.ms/vc14/vc_redist.x64.exe |
| الاستوديو: `No image checkpoint chosen in Settings → Pictures` | حقل النموذج فارغ | الإعدادات ← الصور ← اختبر ComfyUI ← اختر نموذجاً |
| `CheckpointLoaderSimple: Value not in list ckpt_name: '…' not in [...]` | الاسم في الإعدادات ≠ الملف في `models\checkpoints` (خطأ إملائي، مجلد فرعي، تنزيل لم يكتمل) | اضغط اختبر ComfyUI واختر من القائمة؛ تحقق من حجم الملف؛ أعد تشغيل ComfyUI إن كانت القائمة قديمة |
| `IPAdapterUnifiedLoader: IPAdapter model not found.` | الملف `ipadapter\ip-adapter-plus_sdxl_vit-h.safetensors` غير موجود أو أُعيدت تسميته | §5 البند 3 |
| `IPAdapterUnifiedLoader: ClipVision model not found.` | المرمّز لم تُغيَّر تسميته (ما زال `model.safetensors`) | سمّه `CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors` في `clip_vision` |
| سجل الاستوديو: `IP-Adapter nodes are not installed in ComfyUI` | العقدة غير مثبتة أو فشل استيرادها | §4؛ ابحث في نافذة ComfyUI عن `IMPORT FAILED` |
| `ComfyUI is not answering at http://127.0.0.1:8188 (ECONNREFUSED)` | ComfyUI لا يعمل أو على منفذ آخر | شغّل `start-comfyui.bat`؛ طابِق العنوان في الإعدادات |
| `edge-tts: … No module named edge_tts` | edge-tts مثبت في نسخة Python أخرى | `python -m pip install -U edge-tts` بالأمر `python` نفسه |
| `edge-tts: … 403` / `WSServerHandshakeError` | إصدار edge-tts قديم أو ساعة النظام خاطئة (رمز الطلب مبني على الوقت) | `python -m pip install -U edge-tts`؛ زامِن ساعة ويندوز |
| `edge-tts: … NoAudioReceived` | اسم صوت خاطئ أو سطر فارغ | اختر الصوت من القائمة في الإعدادات |
| `Python was not found; run without arguments to install from the Microsoft Store` | اختصار المتجر يسبق Python الحقيقي | أوقف الأسماء المستعارة (§1) أو أعد التثبيت مع *Add python.exe to PATH* |
| `spawn ffmpeg ENOENT` / `'ffmpeg' is not recognized` | ffmpeg ليس على PATH | أضف `C:\ffmpeg\bin` إلى PATH وافتح طرفية جديدة |
| `Could not start Chrome: … Chromium distribution 'chrome' is not found at …` | Chrome غير مثبت في مكان قياسي | ثبّت Chrome، أو `setx HAKAWATI_CHROME "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"` ثم طرفية جديدة |
| `Error: listen EADDRINUSE: address already in use 127.0.0.1:4848` | الاستوديو يعمل أصلاً، أو برنامج آخر على 4848 | `start-studio.bat` يفتح المتصفح فقط إن كان الاستوديو؛ وإلا `netstat -ano \| findstr :4848` ثم `tasklist /fi "pid eq <PID>"`، أو `set HAKAWATI_PORT=4850` في `start-studio.bat` |
| `running scripts is disabled on this system` | سياسة التنفيذ في PowerShell | `powershell -ExecutionPolicy Bypass -File scripts\check-setup.ps1` |
| عقدة Depth Anything تتوقف / خطأ تنزيل | تعذّر الوصول إلى Hugging Face عند أول استخدام | نزّل `depth_anything_v2_vitl.pth` يدوياً (§5 البند 5) |
| `Value not in list: unet_name: 'wan2.2_ti2v_5B_fp16.safetensors'` | الملف في `diffusion_models\Wan2.2\` (من المدير) أو في مجلد خاطئ | انقله مباشرة إلى `diffusion_models` |

## 11. التراخيص (قبل نشر فيلم أو بيعه)

[?] = اقرأ بطاقة النموذج بنفسك؛ التراخيص تتغير.

| النموذج | الترخيص |
|---|---|
| Wan 2.2 TI2V-5B | Apache-2.0 ‏[?] |
| IP-Adapter ‏(h94) | Apache-2.0 ‏[?] |
| Depth Anything V2 **Small** | Apache-2.0 ‏[v، الملف التعريفي الرسمي عبر البحث] |
| Depth Anything V2 **Base/Large/Giant** | **CC-BY-NC-4.0 — غير تجاري** [v، الملف التعريفي الرسمي عبر البحث] |
| 4x-UltraSharp | **CC-BY-NC-SA-4.0 — غير تجاري** [v، OpenModelDB عبر البحث] |
| RealVisXL V5.0 Lightning | المصادر متعارضة (OpenRAIL++ مقابل CC-BY-NC-ND) ‏[?] |
| Juggernaut XL Lightning | ترخيص RunDiffusion ‏[?] |

أكّد المالك (2026-10-19) أن الإنتاج **غير تجاري**، لذا يبقى Depth Anything V2 Large و4x-UltraSharp. وإن تغيّر ذلك يوماً: استخدم Depth Anything V2 Small للعمق، واستبدل 4x-UltraSharp بنموذج تكبير ذي ترخيص متساهل، وتأكد من ترخيص نموذج SDXL.

## 12. سجل التحقق

تحقّقتُ منه أثناء الكتابة (2026-10-19) من الشيفرة المصدرية أو الصفحات الرسمية:
- رابط ComfyUI المحمول ومحتواه (Python 3.13 وCUDA 13.0) وسكربتات التحديث، والمدير كحزمة pip (`manager_requirements.txt` و`--enable-manager`)، وكل خيارات التشغيل، وقاعدة dynamic VRAM الخاصة بـ `--lowvram` — مستودع ComfyUI، الفرع `master`.
- تعابير أسماء الملفات في IPAdapter Unified Loader وأسماء الإعدادات ورسائل الخطأ — شيفرة `cubiq/ComfyUI_IPAdapter_plus`.
- العقدة `DepthAnythingV2Preprocessor` والملف الافتراضي `depth_anything_v2_vitl.pth` ومستودع التنزيل ومجلده وسلوك `install.bat` — شيفرة `Fannovel16/comfyui_controlnet_aux`.
- أسماء ملفات Wan 2.2 ‏5B ومجلداتها واختيار الـ VAE والحجم 1280×704 / 121 إطاراً — أمثلة ComfyUI ووثائق Comfy.
- روابط البنود 3 و4 و6 و7 و9 وأحجامها — قائمة `model-list.json` في ComfyUI-Manager.
- مسارات البحث عن Chrome — `playwright-core` 1.64.1 في هذا المستودع.

غير متحقَّق (مُعلَّم بـ [?]): البنود 1 و2 و8 (تعذّر جلب Hugging Face من بيئة العمل؛ الأسماء من نتائج البحث)، أرقام صفحات Civitai، معرّفات winget، كل أرقام الذاكرة والأزمنة، الإعدادات الموصى بها للنموذجين، `mediapipe` على Python 3.13، والتراخيص المعلّمة بـ [?].

</div>

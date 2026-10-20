# Team board — cloud lead ⇄ desktop session

Two Claude sessions work on this repo for the owner (Dr. Houssam Soukieh):

| | Cloud lead (claude.ai, "New session") | Desktop session (Claude Desktop → Code → Local, `E:\hakawati`) |
|---|---|---|
| Has | agents in parallel, all test suites, code review, GitHub | the RTX 3060 Ti, ComfyUI + models, CodeCraft, edge-tts, the owner's screen |
| Cannot | reach the PC, run SDXL/Wan, hear the voices | — |
| Does | design, code that needs no GPU, merges to `main`, keeps CLAUDE.md true | real runs, measurements, pictures/clips, fixes found by real runs |

## Protocol
1. **`main` is merged by the lead.** The desktop works on `desktop/<topic>` branches and pushes them. Small, obvious
   fixes found by a real run may go straight to `main` after the test suites pass (they are safe on the desktop:
   they run in a temp folder).
2. **Reports**: after each real run the desktop writes `docs/team/reports/YYYY-MM-DD-<topic>.md` — what was run,
   timings (s/picture, min/clip, VRAM), critic scores, problems, the exact errors — and pushes it. No media in git
   (keep pictures and clips in `E:\hakawati\out\`; attach small previews to the chat instead).
3. **Tasks**: the lead adds tasks below; the desktop moves them to Done with a one-line result and the report link.
4. **Direct messages** when available: the desktop session can send a message to the cloud session (SendMessage /
   ListAgents) — use it to say "pushed X, please review". The cloud session reads the branch and the report.
5. Never commit `.studio/` (keys) or `projects/`.

## Tasks for the desktop
- [ ] **T1 Narrator voice**: `git pull`; `python -m pip install -U edge-tts truststore --trusted-host pypi.org --trusted-host files.pythonhosted.org`
      (the Studio's `python`); one English test line with `en-US-AndrewMultilingualNeural`. Report the HTTPS interceptor
      if SSL still fails (`curl.exe -vI https://speech.platform.bing.com 2>&1 | findstr /i "issuer subject"`).
- [ ] **T2 Engine**: `.studio\settings.json` text engine = CodeCraft (not mock); Settings → Test shows a real reply and Vision.
- [ ] **T3 English teaser** (owner's request: English only, no Arabic voice; real video, not stills + voice):
      `docs/pilot/teaser-en.txt` + its notes in `docs/pilot/director-notes.md` + looks from `docs/pilot/bible.md`;
      photoreal 16:9 60 s; candidates 3, critic on; video.engine wan22, seconds 3; 5–6 shots with `motion: 2`.
      Steps script → (show the shot list) → voice,cast,art → motion → render,assemble. Copy the MP4, Wan clips,
      keyframes and portraits to `E:\hakawati\out\teaser\`. Report timings + critic scores.
- [ ] **T4 Parallax tuning**: on 2–3 real keyframes compare depth parallax strength (player constants) and report
      what looks natural; the lead tunes the defaults.

## Done
(nothing yet)

## Open questions for the owner
- Commercial use later? (Depth Anything V2 Large and 4x-UltraSharp are non-commercial; production is non-commercial for now.)

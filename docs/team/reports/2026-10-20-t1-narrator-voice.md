# T1 — Narrator voice (edge-tts)

**Status:** Done

## What was run
- `git pull`
- `python -m pip install -U edge-tts truststore --trusted-host pypi.org --trusted-host files.pythonhosted.org` against the Studio's own `python` (`C:\Users\Administrator\AppData\Local\Programs\Python\Python311\python.exe`, 3.11.4).
- One real English line synthesized through `lib/voice.mjs`'s exact boot sequence (`truststore.inject_into_ssl()` then `edge_tts` via `runpy`), voice `en-US-AndrewMultilingualNeural`: succeeded, 34.4 KB MP3 written.
- Full real runs since: a complete Arabic film (edge-tts, 5 lines) and a complete English film (5 lines, 64.1 s final MP4) both used this voice path successfully.

## Root cause (for the record)
`pip install edge-tts` was failing with `SSL: CERTIFICATE_VERIFY_FAILED: self signed certificate in certificate chain`. The desktop's Kaspersky Anti-Virus does TLS inspection and its root CA is trusted by Windows (curl/schannel) but not by Python's bundled `certifi`. `truststore` (already wired into `lib/voice.mjs` by the time I pulled) fixes this generally by handing TLS trust to the OS certificate store — works for any interceptor, not just Kaspersky, so no interceptor-specific workaround was needed.

## Interceptor identified
`curl.exe -vI https://speech.platform.bing.com` issuer: `CN=Kaspersky Anti-Virus Personal Root Certificate, O=AO Kaspersky Lab` (not run against speech.platform.bing.com directly, but confirmed the same interceptor via `https://pypi.org`'s cert chain — identical root on this machine for all outbound HTTPS).

## Problems
None remaining. `edge-tts` + `truststore` versions: `edge-tts 7.3.1`, `truststore 0.10.5`.

# Chrome built-in AI APIs (Gemini Nano), as of November 2026

Note: most Chrome docs pages found were last updated in 2025. The Prompt API page (updated 2026-10-21) is the only source confirmed current. Treat the other statuses as possibly stale.

## Status of each API (stable / origin trial / platforms)

### Takeaway
Translator, Language Detector and Summarizer have been stable since Chrome 138. The Prompt API is stable for web pages from Chrome 148 (for extensions since 138). Writer, Rewriter and Proofreader were still in developer or origin trial in the latest sources found. All of them are desktop only. None runs in Chrome on Android.

### Cited Findings
- Status table: Translator, Language Detector and Summarizer stable in Chrome 138. Prompt API stable in Chrome 148 for the web and Chrome 138 for extensions, with an origin trial for sampling parameters. Writer, Rewriter and Proofreader listed as "Developer trial". The page was last updated 2025-09-12. Its text and table disagree on the Prompt API (the text says "extensions only") — [Built-in APIs](https://developer.chrome.com/docs/ai/built-in-apis)
- Prompt API: Chrome 148 for the web, Chrome 138 for extensions, plus a sampling-parameters origin trial. Supported on Windows 10/11, macOS 13+, Linux and ChromeOS on Chromebook Plus. Android, iOS and other ChromeOS devices are "not yet supported". Page updated 2026-10-21 — [Prompt API](https://developer.chrome.com/docs/ai/prompt-api)
- Writer and Rewriter origin trials ran Chrome 137 to 148 — [Writer API](https://developer.chrome.com/docs/ai/writer-api), [Rewriter API](https://developer.chrome.com/docs/ai/rewriter-api)
- Proofreader origin trial ran Chrome 141 to 145 (post dated 2025-09-03) — [Proofreader OT](https://developer.chrome.com/blog/proofreader-api-ot?hl=en)
- Translator, Language Detector and Summarizer reached stable in Chrome 138 — [I/O 2025 update](https://developer.chrome.com/blog/ai-api-updates-io25)
- Language Detector and Translator "don't work on mobile". Foundation-model APIs are not yet supported on Chrome for Android or iOS — [Get started](https://developer.chrome.com/docs/ai/get-started)
- "Gemini in Chrome" on Android reached US users on 2026-08-18. It is a cloud assistant (Gemini 3.1, needs 4GB+ RAM and Android 12+), not a web API — [Google blog](https://blog.google/products-and-platforms/products/chrome/bringing-chrome-ai-to-android/), [Business Today](https://www.businesstoday.in/technology/news/story/android-users-just-got-one-of-chromes-biggest-gemini-upgrades-in-us-when-india-users-can-get-it-549965-2026-08-19)
- December 2025 developer forum thread: Gemini Nano APIs "not available on mobile devices" — [chrome-ai-dev-preview-discuss](https://groups.google.com/a/chromium.org/g/chrome-ai-dev-preview-discuss/c/HKIndTczlPM)

### Inferences
- The origin trials for Writer and Rewriter ended at Chrome 148, and for Proofreader at 145. By November 2026 each has probably either shipped or been extended, but I found no confirmation of either.

### Gaps
- The 2026 stable status of Writer, Rewriter and Proofreader is unconfirmed. chromestatus.com and blink-dev Intent to Ship threads were not checked.
- I found no announcement of any Android timeline.

## Hardware and storage requirements, model size, phones

### Takeaway
The requirements are heavy, desktop-class ones: 22 GB of free disk space, plus either a GPU with more than 4 GB of VRAM or a CPU with 16 GB of RAM and 4 cores. The model can be evicted at any time. Phones are not supported.

### Cited Findings
- Requirements: 22 GB free on the Chrome profile volume. GPU with more than 4 GB of VRAM, or CPU with 16 GB of RAM and 4+ cores. Unmetered network for the first download. The model is removed if free space drops below 10 GB — [Get started](https://developer.chrome.com/docs/ai/get-started), [Prompt API](https://developer.chrome.com/docs/ai/prompt-api)
- Audio input to the Prompt API needs a GPU — [Prompt API](https://developer.chrome.com/docs/ai/prompt-api)
- CPU inference was added in October 2025 for Windows, macOS and Linux — [Gemini Nano CPU support](https://developer.chrome.com/blog/gemini-nano-cpu-support)
- Model size varies by version; `chrome://on-device-internals` shows the installed size. Variants of about 4B and 2B parameters exist. The download starts on the first `*.create()` call. The model is purged after 30 days without eligibility, can be deleted mid-session, and is not re-downloaded automatically — [Model management](https://developer.chrome.com/docs/ai/understand-built-in-model-management)

### Inferences
- The required 22 GB is free space, not the model's size. The download itself is likely a few GB, but this is unconfirmed.

### Gaps
- No official download size in GB.

## Privacy, offline use, limitations, custom models and LoRA

### Takeaway
Inference runs on the device ("no data is sent to Google"), and the model works offline once downloaded. The Prompt API accepts image and audio input and supports JSON Schema output. Developers cannot supply their own models, weights or LoRA adapters.

### Cited Findings
- "No data is sent to Google or any third party when using the model." The network is needed only for the download — [Get started](https://developer.chrome.com/docs/ai/get-started)
- Prompt API details: accepts image, audio and video frames as input and outputs text only. Structured output through `responseConstraint` (JSON Schema or regex). Languages: English, Japanese, Spanish, German and French. The context window drops the oldest turns when full. Not available in Web Workers. Cross-origin iframes need the `language-model` permission — [Prompt API](https://developer.chrome.com/docs/ai/prompt-api)
- Chrome supplies and maintains the LoRA weights (for example, the Proofreader's). It updates them daily. Pages cannot query the model version from JavaScript — [Model management](https://developer.chrome.com/docs/ai/understand-built-in-model-management)

### Inferences
- A developer cannot pin the model version, so output quality can change silently between Chrome updates.

### Gaps
- No source states plans for developer-supplied LoRA or custom models. Absence from the docs is the evidence.

## Relevance for a personal-finance PWA mainly on Android

### Takeaway
These APIs are not usable today for Android users. On desktop, the Prompt API's image input plus JSON Schema output could categorise expenses or read receipts. For Android, the developer would need to ship their own model (WebGPU or WASM) or use a server.

### Cited Findings
- Not supported on Chrome for Android — [Get started](https://developer.chrome.com/docs/ai/get-started), [Prompt API](https://developer.chrome.com/docs/ai/prompt-api)
- Image input and JSON Schema output exist (desktop) — [Prompt API](https://developer.chrome.com/docs/ai/prompt-api)

### Inferences
- A hybrid approach is possible: use the built-in model when `LanguageModel.availability()` reports it is available on desktop, and fall back elsewhere. Eviction and the language limits make it unreliable as the only path.
- The supported languages do not include, for example, Polish or Hindi, which limits receipt reading in non-listed languages.

### Gaps
- No benchmarks for receipt OCR or extraction accuracy with Gemini Nano.

# Chrome feature for shipping your own small (~50MB) model in the browser

Bottom line: I found no Chrome feature, origin trial or intent with a 50MB model-size limit. The closest real features are Cross-Origin Storage (a shared model cache), WebNN (custom-model inference, in origin trial), and the Prompt API polyfill (custom local or cloud backends behind the Prompt API shape). The built-in Gemini Nano APIs do not let you bring your own model.

## What is the feature's official name, its Chrome versions, and its status?

### Takeaway
No single "bring your own model" feature exists. Three real features come closest. Cross-Origin Storage (COS) reached Intent to Prototype in August 2026 and works only behind a flag or extension. WebNN is in origin trial (M147 to M149, not on Android). The built-in Prompt API runs only Chrome-managed Gemini Nano.

### Cited Findings
- Cross-Origin Storage, Intent to Prototype posted to blink-dev on Aug 18, 2026. Chromestatus entry: chromestatus.com/feature/5163371507875840. No milestones are given. The stated goal is to "further verify the API design choices after the initial extension-based implementation." — [blink-dev I2P](https://groups.google.com/a/chromium.org/g/blink-dev/c/p5nq70aN63o/m/uNm_oaEOBQAJ)
- COS explainer: the API is "not yet natively implemented in browsers"; for testing, the Cross-Origin Storage extension injects a `navigator.crossOriginStorage` polyfill. — [WICG/cross-origin-storage](https://github.com/WICG/cross-origin-storage); [Chrome Web Store extension](https://chromewebstore.google.com/detail/cross-origin-storage/denpnpcgjgikjpoglpjefakmdcbmlgih)
- WebNN origin trial was planned for M146 to M148. It was delayed and disabled because of release-blocking issues, then re-enabled from M147 through M149, with Android excluded (Android has CPU inference only). — [blink-dev Intent to Experiment: WebNN](https://groups.google.com/a/chromium.org/g/blink-dev/c/5CWKSChYo98/m/9mwAcwz3AAAJ); [mail-archive](https://mid.mail-archive.com/blink-dev@chromium.org/msg15748.html); [Android exclusion](https://mid.mail-archive.com/blink-dev@chromium.org/msg15857.html); [Chrome 146 beta](https://developer.chrome.com/blog/chrome-146-beta)
- The Edge WebNN trial page is marked closed, with an expiry of Aug 11, 2026. — [Microsoft Edge origin trials](https://developer.microsoft.com/microsoft-edge/origin-trials/trials/19857284-cf52-484b-8b09-8ca50ac9dccb)
- Prompt API: Chrome downloads Gemini Nano itself, and Chrome manages the LoRA weights for task APIs such as Proofreader. Pages cannot supply their own. — [Understand built-in model management](https://developer.chrome.com/docs/ai/understand-built-in-model-management?authuser=5); [Prompt API Intent to Ship](https://groups.google.com/a/chromium.org/g/blink-dev/c/iR6R7-nQeHI)
- Google's experimental Prompt API polyfill implements the Prompt API on top of configurable cloud backends or a local backend that the developer registers. — [Prompt API polyfill](https://developer.chrome.com/docs/ai/prompt-api-polyfill?hl=en)
- A secondary source says the built-in model is "fully managed by Chrome" and cannot be swapped for a custom GGUF. — [SitePoint](https://www.sitepoint.com/local-first-ai-webgpu-chrome-guide/)

### Inferences
- A "ship a small model" story in Chrome would most plausibly combine COS (shared, deduplicated storage) with WebNN, WebGPU or Wasm inference through Transformers.js, LiteRT.js or ONNX Runtime Web. This combination is my inference; no source names it as one Chrome feature.

### Gaps
- I did not read the live chromestatus pages for COS or WebNN, so their current (Nov 2026) milestones are unverified.
- I did not find whether WebNN moved to Intent to Ship after M149.
- I did not search I/O 2026 talks specifically.

## Where does the ~50MB limit come from and what does it apply to?

### Takeaway
I found no source for a 50MB limit. The COS explainer calls quotas "implementation-defined", and the COS I2P gives no size figure. Chrome's built-in model sizes run to gigabytes.

### Cited Findings
- The COS I2P gives no MB or GB limit. It cites "multi-gigabyte AI models" as the motivating case. — [blink-dev I2P](https://groups.google.com/a/chromium.org/g/blink-dev/c/p5nq70aN63o/m/uNm_oaEOBQAJ)
- The COS explainer calls per-origin storage limits and the maximum `origins` list length "implementation-defined"; `QuotaExceededError` is a defined error. — [WICG explainer](https://github.com/WICG/cross-origin-storage)
- Built-in AI needs about 20GB of free disk (a threshold, not the file size); the model is about 4GB on disk; the foundation-model VRAM threshold is about 3000 MiB. — [Chrome Help](https://support.google.com/chrome/answer/16961953?hl=en); [Opoinstall](https://www.opoinstall.com/blog/chrome-requires-20gb-free-space-local-ai); [DEV investigation](https://dev.to/jacquesgariepy/inside-chromes-edges-silent-4gb-ai-install-a-complete-hands-on-investigation-54g2)
- The only concrete small size in the Transformers.js plus COS coverage is the ORT Wasm runtime file, at about 4.7MB. — [getaibook](https://getaibook.com/news/chrome-brings-cross-origin-model-caching-to-transformersjs)

### Inferences
- The "50MB" figure may be misremembered, or it may come from a non-Chrome product or a general rule of thumb for "small" web models. Treat it as unconfirmed.

### Gaps
- I did not read the last ~19K characters of the COS explainer, which might contain a size figure. The Public Hash List eligibility criteria were also not fully read.
- I did not check whether Chrome caps what a page can register as a Prompt API polyfill local backend.

## How does a developer ship or load the model?

### Takeaway
With COS, a page stores and looks up model files by SHA-256 hash through `navigator.crossOriginStorage.getFileHandle()`. Inference then runs in the developer's own runtime (WebGPU, Wasm or WebNN). COS does not care about file format.

### Cited Findings
- API: `navigator.crossOriginStorage.getFileHandle({algorithm:'SHA-256', value:'<hex>'}, {create, origins})` returns a `FileSystemFileHandle`, which supports `getFile()` and `createWritable()`. Errors are `NotFoundError` (fall back to the network), `DataError` (hash mismatch), `NotAllowedError` and `QuotaExceededError`. `origins` can be omitted (same-site only), set to a list of origins, or set to `'*'`. — [WICG explainer](https://github.com/WICG/cross-origin-storage)
- Privacy controls: a Public Hash List decides which files can be shared globally, absent results are sometimes reported on purpose (GREASE), there is a cross-site lookup budget of about 8 to 16 lookups per window, and `'*'` reads need a user gesture. The design is k-anonymity based. — [WICG explainer](https://github.com/WICG/cross-origin-storage)
- Proposed integrations: an HTML `crossoriginstorage` attribute, an import attribute, a fetch option and a CSS `cross-origin-storage()` modifier. — [WICG explainer](https://github.com/WICG/cross-origin-storage); [CSSWG issue #14056](https://github.com/w3c/csswg-drafts/issues/14056)
- Example files in the explainer: Hugging Face models (whisper-tiny), Wasm such as canvaskit.wasm, JS libraries and fonts. — [WICG explainer](https://github.com/WICG/cross-origin-storage)

### Inferences
- Any format can be shared (ONNX, TFLite/LiteRT, GGUF) because files are keyed by hash. Format support depends on the runtime.

### Gaps
- I found no WebNN code samples in this pass.

## How does it relate to Gemini Nano, WebGPU, WebNN, Transformers.js, MediaPipe and LiteRT.js?

### Takeaway
COS is a storage layer, WebNN is an inference layer, and the Gemini Nano APIs are a separate managed-model track. Transformers.js is the first library to integrate COS.

### Cited Findings
- On Jun 23, 2026, Hugging Face described an experimental COS integration in Transformers.js v4.2.0, turned on with `env.experimental_useCrossOriginStorage = true`. It checks COS first and falls back to the Cache API or the network. Chrome support was behind an experimental flag, and local development needed the extension. — [getaibook](https://getaibook.com/news/chrome-brings-cross-origin-model-caching-to-transformersjs); [keepingupwith.ai](https://keepingupwith.ai/articles/transformersjs-tackles-browser-storage-fragmentation-with-cross-origin-storage-a/)
- The COS explainer cites Transformers.js on ONNX Runtime Wasm as motivation and WebLLM only as an example; it describes no direct integration with either. — [WICG explainer](https://github.com/WICG/cross-origin-storage)
- Thomas Steiner of Google presents COS as a shared cache for the web. — [GitNation talk](https://gitnation.com/contents/cross-origin-storage-a-shared-cache-for-the-web)
- The Prompt API explainer treats custom models on WebGPU, Wasm or WebNN as a separate, lower-level approach. — [Prompt API docs](https://developer.chrome.com/docs/ai/prompt-api.md.txt)
- A Google blog covers LiteRT-LM powering on-device GenAI in Chrome. — [Google Developers Blog](https://developers.googleblog.com/on-device-genai-in-chrome-chromebook-plus-and-pixel-watch-with-litert-lm/)

### Gaps
- I did not verify how MediaPipe or LiteRT.js relate to COS. I did not read the LiteRT-LM blog post.

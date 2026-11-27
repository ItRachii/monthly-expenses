# Runtimes and small (<~50MB) models for in-browser ML in Chrome (as of Nov 2026)

## Which runtimes work, and how do they cache models?

### Takeaway
The practical runtimes in late 2026 are Transformers.js v4 (on ONNX Runtime Web), Google's LiteRT.js (replacing TensorFlow.js for `.tflite`), MediaPipe Tasks for ready-made tasks, and WebLLM for chat LLMs. WebGPU is the main accelerator. WebNN is still only an origin trial, and Android is excluded from it. Caching uses browser storage (Cache API, OPFS) through each library's own helpers. None of the sources documents OPFS use by any runtime in detail.

### Cited Findings
- **Transformers.js v4** preview on npm since Feb 9, 2026. It has a new C++ WebGPU runtime built with the ONNX Runtime team and about 200 architectures. A ModelRegistry API lists a pipeline's files, checks cache status and clears cached artifacts. `env.useWasmCache` caches the WASM runtime files for offline use after the first load. — [HF blog](https://huggingface.co/blog/transformersjs-v4)
- Transformers.js v4 benchmarks: about 4x faster BERT embeddings (via MultiHeadAttention), about 10% smaller bundles, and `transformers.web.js` 53% smaller. The standalone `@huggingface/tokenizers` is 8.8kB gzipped. — [HF blog](https://huggingface.co/blog/transformersjs-v4)
- v4.3 reportedly added structured output and WebGPU support for Safari 26+. Plain `npm install` reportedly still resolves to v3.x, so v4 needs the `@next` tag. Both claims come from secondary sources and should be checked. — [newreleases.io 4.3.0](https://newreleases.io/project/github/huggingface/transformers.js/release/4.3.0); [GitHub releases](https://github.com/huggingface/transformers.js/releases)
- **LiteRT.js** was announced on July 9, 2026 and is positioned as the successor to TensorFlow.js for `.tflite` models. Its backends are CPU via XNNPACK (multi-thread, relaxed SIMD), GPU via ML Drift on WebGPU, and NPU via WebNN (experimental). Packages are `@litertjs/core` and `@litertjs/tfjs-interop`. — [Google Developers Blog](https://developers.googleblog.com/en/litertjs-googles-high-performance-web-ai-inference/); [LiteRT web docs](https://developers.google.com/edge/litert/web)
- LiteRT.js claims up to 3x faster than other web runtimes on classical vision and audio models, measured on an M4 MacBook Pro. It claims 5–60x speedups for GPU or NPU over CPU. Its demos are YOLO26, Depth-Anything-V2, Real-ESRGAN and EmbeddingGemma search. — [Google Developers Blog](https://developers.googleblog.com/en/litertjs-googles-high-performance-web-ai-inference/)
- **MediaPipe Tasks (web)**: the Text Classifier's recommended model is MobileBERT, with BERT tokenization metadata included. A smaller average-word-embedding classifier is lighter and faster but less accurate. — [MediaPipe text classifier](https://developers.google.com/edge/mediapipe/solutions/text/text_classifier)
- **WebLLM** runs MLC-compiled models on WebGPU. MLC builds of SmolLM2-135M-Instruct exist in q0f16, q4f16_1 and q4f32_1. — [HF mlc-ai](https://huggingface.co/mlc-ai/SmolLM2-135M-Instruct-q0f16-MLC); [WebLLM paper](https://arxiv.org/html/2412.15803v1)
- **WebNN**: the Chrome origin trial was delayed several times and now runs from M147 to M149. Android is excluded because its implementation is immature (CPU only so far). — [blink-dev](https://groups.google.com/a/chromium.org/g/blink-dev/c/5CWKSChYo98); [mail-archive](https://mid.mail-archive.com/blink-dev@chromium.org/msg15857.html)
- **Storage rules**:
  - Storage is best-effort by default. `navigator.storage.persist()` requests persistence, and web.dev advises against calling it on page load. — [MDN](https://developer.mozilla.org/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria); [web.dev persistent storage](https://web.dev/articles/persistent-storage)
  - Chromium evicts the least recently used origin first when disk runs low. Chrome lets one origin use up to 60% of disk. — [web.dev storage](https://web.dev/articles/storage-for-the-web)
  - Over-quota Cache API writes reject with QuotaExceededError. — [MDN](https://developer.mozilla.org/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
  - Safari caps script-writable storage at 7 days, including the Cache API and IndexedDB. Home-screen PWAs are exempt. — [web.dev storage](https://web.dev/articles/storage-for-the-web)

### Inferences
- For classifiers, embeddings and Whisper, Transformers.js v4 has the widest catalogue. LiteRT.js or MediaPipe are better for vision/audio `.tflite` models and Google-supplied tasks. WebLLM is only worth it for generative chat, and it needs WebGPU.
- A model of 50MB or less fits comfortably in Chrome's quota. Call `persist()` after the user does something meaningful, so the model is not evicted on low-storage phones.
- A PWA's service worker can precache models (Cache API) to work offline. On iOS, offline use is only reliable when the app is installed to the home screen.

### Gaps
- I found no official doc on whether Transformers.js v4 or WebLLM store model weights in the Cache API, IndexedDB or OPFS. From memory (not verified here): Transformers.js has used the Cache API by default and WebLLM offers Cache API or IndexedDB.
- I found no official statement that Transformers.js v4 is a stable release rather than a preview.
- I did not verify current MediaPipe Tasks web release notes or the status of TensorFlow.js maintenance.

## Which concrete models fit under ~50MB, and what are they good for?

### Takeaway
Embeddings (MiniLM, about 23MB int8) and MobileBERT-class classifiers (about 28MB quantized) fit easily. Whisper-tiny at int8 is about 40–60MB, which is at the limit. SmolLM2-135M at 4-bit is near the limit. It is usable for simple text generation and extraction but not for reasoning.

### Cited Findings
- **all-MiniLM-L6-v2** (Xenova ONNX) sizes: fp32 90.4MB, fp16 45.3MB, int8 23MB. It is used for sentence embeddings, semantic search and similarity. — [HF repo files](https://huggingface.co/Xenova/all-MiniLM-L6-v2/tree/main/onnx)
- **MobileBERT text classifier** (MediaPipe): over 100MB unquantized, about 28MB after quantization in the Model Maker tutorial. — [MediaPipe customization](https://developers.google.com/edge/mediapipe/solutions/customization/text_classifier)
- **Whisper-tiny int8 ONNX**: a community fine-tune is about 60MB total (about 10MB encoder and about 50MB merged decoder), loaded with `dtype: "q8"`. — [HF whisper-tiny-uz-onnx](https://huggingface.co/davron112/whisper-tiny-uz-onnx)
- **SmolLM2-135M**: VRAM estimates for 4-bit range from 0.1–0.4GB for weights, plus KV cache. These come from third-party calculators and conflict with each other. — [llmrun.dev](https://llmrun.dev/model/huggingfacetb-smollm2-135m-instruct)
- One report says the mobile browser capped WebGPU buffers at 128MB when running SmolLM2-360M, which forced a shorter context. — [DEV](https://dev.to/garciadiazjaime/running-language-models-directly-in-the-browser-2c3e)

### Inferences
- An expense app could use MiniLM embeddings to suggest categories by similarity to past expenses, or a fine-tuned small classifier. Both fit under 25MB.
- Receipt OCR is better done by dedicated OCR or vision models than by tiny LLMs.

### Gaps
- I could not find an official size for Xenova/whisper-tiny q8. From memory it is about 40MB, but that is unverified.
- I did not verify file sizes for the MLC SmolLM2-135M q4f16 build.
- I did not verify sizes for MediaPipe's prebuilt `bert_classifier.tflite` or the text embedder.

## Load time, memory and performance: mid-range Android vs desktop

### Takeaway
Desktop WebGPU runs MiniLM embeddings in tens of milliseconds, against hundreds of milliseconds on WASM. I found no reliable published benchmarks for mid-range Android phones.

### Cited Findings
- all-MiniLM-L6-v2 at sequence length 512, batch size 1, Chrome 122:
  - Mac: about 386ms on WASM vs about 23.8ms on WebGPU.
  - Windows: about 507ms vs about 45.7ms.
  - These are community runs from early 2024, so the data is old and predates v4. — [HF benchmark discussions](https://huggingface.co/spaces/Xenova/webgpu-embedding-benchmark/discussions/4); [#1](https://huggingface.co/spaces/Xenova/webgpu-embedding-benchmark/discussions/1)
- LiteRT.js says results vary with GPU, thermal throttling and drivers. — [Google Developers Blog](https://developers.googleblog.com/en/litertjs-googles-high-performance-web-ai-inference/)
- Mobile WebGPU buffer cap of 128MB reported (see above). — [DEV](https://dev.to/garciadiazjaime/running-language-models-directly-in-the-browser-2c3e)

### Inferences
- Short inputs (expense descriptions under 32 tokens) cost far less than the 512-token benchmark. Running a 23MB int8 MiniLM on WASM is likely fast enough even on phones, but this is untested.
- Downloading is the main load cost. About 23MB is a few seconds on 4G, and after that it loads from cache.

### Gaps
- I found no mid-range Android numbers for load time, memory or latency. The best way to get them is to run the HF WebGPU embedding benchmark Space on target devices.

## Support on Android Chrome, iOS Safari and desktop; offline PWA use

### Takeaway
WebGPU now ships in every major browser: Chrome desktop, Chrome Android 12+ on Qualcomm/ARM GPUs, and Safari 26 on iOS and macOS. WASM works everywhere as the fallback. WebNN is not available for production use.

### Cited Findings
- Chrome 121 enabled WebGPU by default on Android 12+ with Qualcomm or ARM GPUs. Chrome 127 added an experimental OpenGL ES backend for devices without Vulkan 1.1. Chrome 146 (Feb 2026) added an opt-in compatibility mode on OpenGL ES 3.1. — [Chrome 121](https://developer.chrome.com/blog/new-in-webgpu-121); [Chrome 127](https://developer.chrome.com/blog/new-in-webgpu-127); [Chrome 146](https://developer.chrome.com/blog/new-in-webgpu-146)
- WebGPU is shipped and on by default in Safari 26 on macOS, iOS, iPadOS and visionOS (GA in September 2025). — [web.dev](https://web.dev/blog/webgpu-supported-major-browsers); [gpuweb status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status)
- WebNN is an origin trial (M147–M149) on desktop Chrome and Edge, with Android excluded. — [blink-dev](https://groups.google.com/a/chromium.org/g/blink-dev/c/5CWKSChYo98)
- Safari's 7-day storage cap does not apply to home-screen PWAs. — [web.dev storage](https://web.dev/articles/storage-for-the-web)

### Inferences
- Ship the WASM path as the baseline and detect WebGPU to speed it up. A model of 25MB or less keeps this realistic for all users.

### Gaps
- I found no current 2026 list of Android devices with WebGPU.
- I did not verify how reliable iOS Safari's WASM and WebGPU are with larger (50MB or more) models under memory pressure.

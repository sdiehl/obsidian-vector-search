let iframe: HTMLIFrameElement | null = null;
let ready = false;
let loading = false;
let loadError: string | null = null;
let statusMessage = "";
let modelLoaded = false;
let loadedModelName = "";
let pendingId = 0;
const pending = new Map<number, { resolve: (v: number[]) => void; reject: (e: Error) => void }>();

export function getStatusMessage(): string {
  return statusMessage;
}

// The iframe runs transformers.js in a pure browser context (no Node APIs),
// so onnxruntime-web correctly uses the WASM backend.
const IFRAME_SCRIPT = `
<html><body><script type="module">
let pipeline = null;

async function loadModel(model) {
  const { pipeline: createPipeline, env } = await import(
    'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3'
  );
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  // Disable WASM threading. SharedArrayBuffer is not available in
  // Obsidian's Electron context (requires COOP/COEP headers).
  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.numThreads = 1;
    env.backends.onnx.wasm.proxy = false;
  }
  pipeline = await createPipeline('feature-extraction', model, { dtype: 'q8' });
}

async function embed(text) {
  const out = await pipeline(text, { pooling: 'mean', normalize: true });
  return Array.from(out.data);
}

window.addEventListener('message', async (e) => {
  if (!e.data || typeof e.data !== 'object' || !e.data.method) return;
  const { id, method, args } = e.data;
  try {
    let result;
    if (method === 'load') {
      await loadModel(args.model);
      result = { ok: true };
    } else if (method === 'embed') {
      result = await embed(args.text);
    } else {
      return;
    }
    parent.postMessage({ id, result }, '*');
  } catch (err) {
    parent.postMessage({ id, error: err.message }, '*');
  }
});
parent.postMessage({ id: 0, result: { ready: true } }, '*');
<\/script></body></html>
`;

function ensureIframe(): HTMLIFrameElement {
  if (iframe) return iframe;
  iframe = document.createElement("iframe");
  iframe.style.display = "none";
  iframe.sandbox.add("allow-scripts", "allow-same-origin");
  iframe.srcdoc = IFRAME_SCRIPT;
  document.body.appendChild(iframe);
  return iframe;
}

function sendToIframe(method: string, args: Record<string, any>): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = ++pendingId;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Model loading timed out (60s). Check your network connection."));
    }, 60_000);
    pending.set(id, {
      resolve: (v: any) => { clearTimeout(timeout); resolve(v); },
      reject: (e: Error) => { clearTimeout(timeout); reject(e); },
    });
    iframe!.contentWindow!.postMessage({ id, method, args }, "*");
  });
}

function setupMessageHandler(): void {
  window.addEventListener("message", (e: MessageEvent) => {
    if (!e.data || typeof e.data !== "object" || typeof e.data.id === "undefined") return;
    const { id, result, error } = e.data;
    if (id === 0 && result?.ready) {
      ready = true;
      return;
    }
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (error) {
      p.reject(new Error(error));
    } else {
      p.resolve(result);
    }
  });
}

let handlerInstalled = false;

export async function embedQuery(
  text: string,
  model = "Xenova/all-MiniLM-L6-v2",
): Promise<number[]> {
  if (loading) {
    throw new Error(statusMessage || "Model is loading...");
  }
  if (loadError) {
    const err = loadError;
    loadError = null;
    throw new Error(err);
  }

  if (!handlerInstalled) {
    setupMessageHandler();
    handlerInstalled = true;
  }

  const fr = ensureIframe();

  if (!ready) {
    loading = true;
    statusMessage = "Initializing runtime...";
    // Wait for iframe ready signal
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (ready) { clearInterval(check); resolve(); }
      }, 100);
      setTimeout(() => { clearInterval(check); resolve(); }, 5000);
    });
  }

  if (!fr.contentWindow) {
    loading = false;
    throw new Error("Failed to initialize embedding runtime");
  }

  if (!ready) {
    loading = false;
    throw new Error("Embedding runtime failed to initialize");
  }

  if (!modelLoaded || loadedModelName !== model) {
    try {
      statusMessage = "Loading embedding model (first time may download ~23MB)...";
      loading = true;
      await sendToIframe("load", { model });
      modelLoaded = true;
      loadedModelName = model;
      loading = false;
      statusMessage = "";
    } catch (e: any) {
      loading = false;
      loadError = e.message;
      statusMessage = "";
      throw e;
    }
  }

  statusMessage = "Embedding query...";
  const result = await sendToIframe("embed", { text });
  statusMessage = "";
  return result as number[];
}

export function resetEmbedder(): void {
  if (iframe) {
    iframe.remove();
    iframe = null;
  }
  ready = false;
  loading = false;
  loadError = null;
  statusMessage = "";
  modelLoaded = false;
  loadedModelName = "";
  pending.clear();
}

export function isModelLoaded(): boolean {
  return ready && !loading;
}

export function isModelLoading(): boolean {
  return loading;
}

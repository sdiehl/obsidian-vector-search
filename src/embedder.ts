let pipelineInstance: any = null;
let currentModel: string | null = null;
let loading = false;
let loadError: string | null = null;

export async function embedQuery(
  text: string,
  model = "Xenova/all-MiniLM-L6-v2",
): Promise<number[]> {
  if (pipelineInstance && currentModel !== model) {
    pipelineInstance = null;
    currentModel = null;
  }
  if (!pipelineInstance && !loading) {
    loading = true;
    loadError = null;
    try {
      const { pipeline } = await import("@huggingface/transformers");
      pipelineInstance = await pipeline("feature-extraction", model, {
        dtype: "q8",
      });
      currentModel = model;
    } catch (e: any) {
      loadError = e.message || "Failed to load embedding model";
      loading = false;
      throw e;
    }
    loading = false;
  }
  if (loading) {
    throw new Error("Model is still loading, please wait...");
  }
  if (loadError) {
    throw new Error(loadError);
  }
  const output = await pipelineInstance(text, {
    pooling: "mean",
    normalize: true,
  });
  return Array.from(output.data as Float32Array);
}

export function resetEmbedder(): void {
  pipelineInstance = null;
  currentModel = null;
  loadError = null;
}

export function isModelLoaded(): boolean {
  return pipelineInstance !== null;
}

export function isModelLoading(): boolean {
  return loading;
}

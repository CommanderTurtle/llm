export type Backend = 'wasm' | 'webgpu' | 'auto';
export interface Parameters {
  textDetLimitSideLen?: number;
  textDetLimitType?: 'min' | 'max';
  textDetMaxSideLimit?: number;
  textDetThresh?: number;
  textDetBoxThresh?: number;
  textDetUnclipRatio?: number;
  textRecScoreThresh?: number;
}
export interface WorkerOptions {
  backend?: Backend;
  numThreads?: number;
  timeoutMs?: number;
  modelPath?: string | URL;
  runtimePath?: string | URL;
  workerPath?: string | URL;
  parameters?: Parameters;
  signal?: AbortSignal;
  logger?: (message: { status: string; progress: number }) => void;
}
export interface RecognizeOptions {
  rectangle?: { left: number; top: number; width: number; height: number };
  signal?: AbortSignal;
  maxPixels?: number;
  asciiPunctuation?: boolean;
  parameters?: Parameters;
}
export interface Box { x0: number; y0: number; x1: number; y1: number }
export interface Item {
  text: string;
  confidence: number;
  polygon: [number, number][];
  bbox: Box;
  cy: number;
  height: number;
}
export interface Line { text: string; confidence: number; bbox: Box; items: Item[]; words: never[] }
export interface Runtime { requestedBackend: Backend; detProvider: string; recProvider: string; webgpuAvailable: boolean }
export interface Result {
  data: {
    text: string;
    confidence: number;
    lines: Line[];
    items: Item[];
    words: never[];
    blocks: { paragraphs: { lines: Line[] }[] }[];
    image: { width: number; height: number };
    metrics: { detMs: number; recMs: number; totalMs: number; detectedBoxes: number; recognizedCount: number };
    runtime: Runtime;
    engine: 'PP-OCRv6';
    geometryLevel: 'line';
  };
}
export type ImageInput = Blob | ImageData | ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas | ArrayBuffer | ArrayBufferView | string | URL;
export interface WorkerAPI {
  recognize(input: ImageInput, options?: RecognizeOptions, output?: { text?: boolean; blocks?: boolean }): Promise<Result>;
  setParameters(parameters: Parameters): Promise<Parameters>;
  getInitializationSummary(): { backend: Backend; webgpuAvailable: boolean; detProvider: string; recProvider: string; elapsedMs: number; pipelineConfigWarnings: string[]; assets: { url: string; bytes: number }[] };
  terminate(): Promise<void>;
}
export function createWorker(options?: WorkerOptions): Promise<WorkerAPI>;
export function createWorker(languages: string | string[], options?: WorkerOptions): Promise<WorkerAPI>;
export function createWorker(languages?: string | string[], oem?: 1, options?: WorkerOptions): Promise<WorkerAPI>;
export function recognize(input: ImageInput, languages?: string | string[], options?: WorkerOptions): Promise<Result>;
declare const api: { createWorker: typeof createWorker; recognize: typeof recognize };
export default api;

/**
 * IPC 契约 — 通道名、推送事件、window.api 的类型都在这一个文件里定义。
 * preload 与 main 都从这里取通道名，杜绝魔法字符串漂移。
 */
import type {
  AnalysisResult,
  AppSettings,
  ASRResult,
  CustomPrompt,
  ModelDownloadProgress,
  ModelStatus,
  Result,
  SessionStats,
} from './types';

export const IpcChannels = {
  // 设置
  GetSettings: 'settings:get',
  SaveSettings: 'settings:save',
  OpenSettingsWindow: 'settings:open-window',

  // Prompt 编辑器
  OpenPromptEditorWindow: 'prompt:open-window',
  GetCustomPrompt: 'prompt:get',
  SaveCustomPrompt: 'prompt:save',

  // 窗口
  CloseCurrentWindow: 'window:close',

  // 语音识别
  InitASR: 'asr:init',
  FeedAudio: 'asr:feed',
  StopASR: 'asr:stop',

  // LLM
  TestLLMConnection: 'llm:test',

  // 词库分析
  AnalyzeText: 'lexicon:analyze',

  // 模型管理
  GetModelStatus: 'model:get-status',
  DownloadModel: 'model:download',
  ModelDownloadProgress: 'model:download-progress',

  // 文件保存
  SaveFile: 'file:save',

  // AI 反馈
  GetRealtimeFeedback: 'ai:feedback',
  GetFinalReport: 'ai:report',
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];

export interface FinalReportInput {
  fullText: string;
  stats: SessionStats;
}

/**
 * preload 通过 contextBridge 暴露给渲染进程的 API（window.api）。
 * 渲染进程侧的类型由 src/renderer/global.d.ts 注入。
 */
export interface IpcApi {
  // 设置
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<Result<void>>;
  openSettings(): Promise<void>;

  // Prompt 编辑器
  openPromptEditor(): Promise<void>;
  getCustomPrompt(): Promise<CustomPrompt | null>;
  saveCustomPrompt(data: CustomPrompt): Promise<Result<void>>;

  // 窗口
  closeWindow(): Promise<void>;

  // 语音识别
  initASR(): Promise<Result<void>>;
  feedAudio(samples: Float32Array): Promise<ASRResult | null>;
  stopASR(): Promise<{ finalText: string }>;

  // 词库分析
  analyzeText(text: string): Promise<AnalysisResult | null>;

  // 模型管理
  getModelStatus(): Promise<ModelStatus>;
  downloadModel(): Promise<Result<void>>;
  onModelDownloadProgress(callback: (progress: ModelDownloadProgress) => void): void;
  removeModelDownloadProgressListener(): void;

  // AI 反馈
  getRealtimeFeedback(text: string): Promise<Result<string>>;
  getFinalReport(input: FinalReportInput): Promise<Result<string>>;
  testLLMConnection(settings: AppSettings): Promise<Result<void>>;

  // 文件保存
  saveFile(content: string, filename: string): Promise<Result<string>>;
}

/**
 * 领域模型 — 主进程 / 预加载 / 渲染进程共享。
 * 只放纯类型与常量，不 import electron 运行时，保证渲染进程也能安全引用。
 */

// ---------------------------------------------------------------------------
// 词库
// ---------------------------------------------------------------------------

export interface EmotionEntry {
  category: string;
  subcategory: string;
  intensity: number;
  polarity: string;
}

export interface EmotionLexicon {
  _meta?: Record<string, unknown>;
  emotions: Record<string, EmotionEntry>;
}

// ---------------------------------------------------------------------------
// 文本分析
// ---------------------------------------------------------------------------

export interface WordHit {
  word: string;
  position: number;
}

export interface VagueWordHit extends WordHit {
  alternatives: string[];
}

export interface EmotionWordHit extends WordHit {
  category: string;
  subcategory: string;
  intensity: number;
  polarity: string;
}

export type SuggestionType = 'vague' | 'filler' | 'hedge';

export interface Suggestion {
  type: SuggestionType;
  original?: string;
  alternatives?: string[];
  message: string;
}

export interface AnalysisResult {
  totalWords: number;
  fillers: WordHit[];
  hedges: WordHit[];
  vagueWords: VagueWordHit[];
  emotionWords: EmotionWordHit[];
  /** 表达密度，0-100 */
  density: number;
  suggestions: Suggestion[];
}

// ---------------------------------------------------------------------------
// 一次训练会话的统计（传给 AI 报告）
// ---------------------------------------------------------------------------

export interface SessionStats {
  fillers: number;
  hedges: number;
  vagueWords: number;
  totalWords: number;
  duration: number;
}

// ---------------------------------------------------------------------------
// 语音识别
// ---------------------------------------------------------------------------

export interface ASRResult {
  text: string;
  isFinal: boolean;
}

// ---------------------------------------------------------------------------
// 应用设置（per-provider 可辨识联合）
// ---------------------------------------------------------------------------

export type Provider = 'openai' | 'deepseek' | 'ollama' | 'custom';

interface ProviderSettingsBase {
  model: string;
}

export interface OpenAISettings extends ProviderSettingsBase {
  kind: 'openai';
  apiKey: string;
}

export interface DeepSeekSettings extends ProviderSettingsBase {
  kind: 'deepseek';
  apiKey: string;
}

export interface OllamaSettings extends ProviderSettingsBase {
  kind: 'ollama';
  /** 本地服务地址，如 http://localhost:11434 */
  ollamaUrl: string;
}

export interface CustomSettings extends ProviderSettingsBase {
  kind: 'custom';
  apiKey: string;
  /** OpenAI 兼容协议 BASE URL，如 https://api.example.com/v1 */
  baseUrl: string;
}

export type ProviderSettings =
  | OpenAISettings
  | DeepSeekSettings
  | OllamaSettings
  | CustomSettings;

export interface AppSettings {
  provider: Provider;
  providers: Record<Provider, ProviderSettings>;
}

// ---------------------------------------------------------------------------
// 自定义训练规则
// ---------------------------------------------------------------------------

export interface CustomPrompt {
  goals: string;
  customRules: string;
  styleRef: string;
  customWords: string;
}

// ---------------------------------------------------------------------------
// ASR 模型管理
// ---------------------------------------------------------------------------

export interface ModelStatus {
  installed: boolean;
  /** 实际找到模型的目录（已安装时非空） */
  modelDir: string | null;
  /** 缺失的文件名 */
  missingFiles: string[];
  /** 是否正在下载中 */
  downloading: boolean;
}

export interface ModelDownloadProgress {
  /** 当前正在下载的文件名 */
  current: string;
  /** 当前文件进度 0-100 */
  percent: number;
  /** 全部完成 */
  done: boolean;
}

// ---------------------------------------------------------------------------
// 通用结果（IPC 返回值）
// ---------------------------------------------------------------------------

export type Result<T> =
  | { success: true; data: T }
  | { success: false; error: string };

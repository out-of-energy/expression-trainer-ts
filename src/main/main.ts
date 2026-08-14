/**
 * 主进程入口
 * 负责窗口生命周期、IPC handler 注册、设置持久化。
 */
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
} from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { initASR, feedAudio, stopRecognition } from '../lib/asr';
import { loadLexicon, analyzeText } from '../lib/lexicon';
import { sendFeedback, sendReport, testConnection } from '../lib/ai-feedback';
import { downloadModel, getModelStatus, resolveModelDir } from '../lib/model-manager';
import { IpcChannels } from '../shared/ipc';
import type { FinalReportInput } from '../shared/ipc';
import type {
  AnalysisResult,
  AppSettings,
  ASRResult,
  CustomPrompt,
  ModelStatus,
  Provider,
  ProviderSettings,
  Result,
} from '../shared/types';

// 覆盖应用显示名称（菜单栏、Dock、任务栏、窗口标题）
app.setName('宇宙无敌表达训练');

let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let promptEditorWindow: BrowserWindow | null = null;
let asrReady = false;

/** 用户可写模型目录（下载目标） */
function userModelsDir(): string {
  return path.join(app.getPath('userData'), 'models');
}

/** 项目自带/打包模型目录（只读兼容） */
function bundledModelsDir(): string {
  return path.join(app.getAppPath(), 'models');
}

// ---------------------------------------------------------------------------
// 设置持久化（JSON 边界：运行时校验 + 旧版结构迁移）
// ---------------------------------------------------------------------------

const PROVIDERS: readonly Provider[] = ['openai', 'deepseek', 'ollama', 'custom'];

function defaultSettings(): AppSettings {
  return {
    provider: 'deepseek',
    providers: {
      openai: { kind: 'openai', apiKey: '', model: 'gpt-4o-mini' },
      deepseek: { kind: 'deepseek', apiKey: '', model: 'deepseek-v4-flash' },
      ollama: { kind: 'ollama', ollamaUrl: 'http://localhost:11434', model: 'qwen2.5:7b' },
      custom: { kind: 'custom', apiKey: '', baseUrl: '', model: '' },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isProvider(value: unknown): value is Provider {
  return typeof value === 'string' && (PROVIDERS as readonly string[]).includes(value);
}

/** 校验 providers 对象是否已是带 kind 的最新形状 */
function hasProviderKind(providers: Record<string, unknown>): boolean {
  return PROVIDERS.every((key) => {
    const entry = providers[key];
    return isRecord(entry) && isProvider(entry.kind);
  });
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** 把单个 provider 的持久化字段解析为可辨识联合的变体 */
function parseProviderSettings(kind: Provider, raw: Record<string, unknown>): ProviderSettings {
  switch (kind) {
    case 'openai':
      return { kind, apiKey: str(raw.apiKey), model: str(raw.model, 'gpt-4o-mini') };
    case 'deepseek':
      return { kind, apiKey: str(raw.apiKey), model: str(raw.model, 'deepseek-v4-flash') };
    case 'ollama':
      return { kind, ollamaUrl: str(raw.ollamaUrl, 'http://localhost:11434'), model: str(raw.model, 'qwen2.5:7b') };
    case 'custom':
      return { kind, apiKey: str(raw.apiKey), baseUrl: str(raw.baseUrl ?? raw.customEndpoint), model: str(raw.customModel ?? raw.model) };
  }
}

/** 解析任意 JSON 为 AppSettings，兼容两种旧版结构 */
function parseSettings(raw: unknown, provider: Provider): AppSettings {
  const obj = isRecord(raw) ? raw : {};
  const settings = defaultSettings();
  settings.provider = provider;

  // 旧版扁平结构：{ provider, apiKey, model, ollamaUrl, customEndpoint, customModel }
  if (!isRecord(obj.providers)) {
    const defaults = defaultSettings();
    settings.providers[provider] = parseProviderSettings(provider, obj);

    const ollamaUrl = str(obj.ollamaUrl);
    if (ollamaUrl) {
      settings.providers.ollama = { kind: 'ollama', ollamaUrl, model: defaults.providers.ollama.model };
    }

    const baseUrl = str(obj.customEndpoint) || str(obj.baseUrl);
    const customModel = str(obj.customModel);
    if (baseUrl || customModel) {
      settings.providers.custom = {
        kind: 'custom',
        apiKey: str(obj.apiKey),
        baseUrl,
        model: customModel || defaults.providers.custom.model,
      };
    }
    return settings;
  }

  // 新版 per-provider（可能缺 kind）
  for (const key of PROVIDERS) {
    const entry = obj.providers[key];
    if (isRecord(entry)) {
      settings.providers[key] = parseProviderSettings(key, entry);
    }
  }
  return settings;
}

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings(): AppSettings {
  const settingsPath = getSettingsPath();
  if (!existsSync(settingsPath)) return defaultSettings();

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(settingsPath, 'utf-8'));
  } catch {
    return defaultSettings();
  }

  const obj = isRecord(raw) ? raw : {};
  const provider = isProvider(obj.provider) ? obj.provider : 'deepseek';

  // 结构不是最新形状（缺 providers 或缺 kind）→ 解析后回写规范化结果
  const providersRaw = isRecord(obj.providers) ? obj.providers : undefined;
  const needsMigration = !providersRaw || !hasProviderKind(providersRaw);

  const settings = parseSettings(obj, provider);
  if (needsMigration) saveSettings(settings);
  return settings;
}

function saveSettings(settings: AppSettings): void {
  writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2));
}

// ---------------------------------------------------------------------------
// 自定义训练规则持久化
// ---------------------------------------------------------------------------

function getCustomPromptPath(): string {
  return path.join(app.getPath('userData'), 'custom-prompt.json');
}

function loadCustomPrompt(): CustomPrompt | null {
  const p = getCustomPromptPath();
  if (!existsSync(p)) return null;

  try {
    const raw: unknown = JSON.parse(readFileSync(p, 'utf-8'));
    if (!isRecord(raw)) return null;
    return {
      goals: str(raw.goals),
      customRules: str(raw.customRules),
      styleRef: str(raw.styleRef),
      customWords: str(raw.customWords),
    };
  } catch {
    return null;
  }
}

function saveCustomPrompt(data: CustomPrompt): void {
  writeFileSync(getCustomPromptPath(), JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// 窗口
// ---------------------------------------------------------------------------

function createMainWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#000000',
    title: '宇宙无敌表达训练',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = win;

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.setFullScreenable(true);

  win.on('closed', () => {
    mainWindow = null;
  });
}

function createPromptEditorWindow(): void {
  if (promptEditorWindow) {
    promptEditorWindow.focus();
    return;
  }

  const win = new BrowserWindow({
    width: 720,
    height: 700,
    resizable: true,
    backgroundColor: '#1a1a1a',
    titleBarStyle: 'hiddenInset',
    parent: mainWindow ?? undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  promptEditorWindow = win;

  win.loadFile(path.join(__dirname, 'renderer', 'prompt-editor.html'));

  win.on('closed', () => {
    promptEditorWindow = null;
  });
}

function createSettingsWindow(): void {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  const win = new BrowserWindow({
    width: 600,
    height: 500,
    resizable: false,
    backgroundColor: '#1a1a1a',
    titleBarStyle: 'hiddenInset',
    parent: mainWindow ?? undefined,
    modal: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWindow = win;

  win.loadFile(path.join(__dirname, 'renderer', 'settings.html'));

  win.on('closed', () => {
    settingsWindow = null;
  });
}

// ---------------------------------------------------------------------------
// App 生命周期
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  // macOS 需要显式创建应用菜单，否则菜单栏显示默认的 "Electron"
  const appMenuTemplate: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(appMenuTemplate));

  loadLexicon();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// 设置相关
ipcMain.handle(IpcChannels.GetSettings, (): AppSettings => loadSettings());

ipcMain.handle(IpcChannels.SaveSettings, (_event, settings: AppSettings): Result<void> => {
  saveSettings(settings);
  return { success: true, data: undefined };
});

ipcMain.handle(IpcChannels.OpenSettingsWindow, () => {
  createSettingsWindow();
});

// Prompt 编辑器相关
ipcMain.handle(IpcChannels.OpenPromptEditorWindow, () => {
  createPromptEditorWindow();
});

ipcMain.handle(IpcChannels.GetCustomPrompt, (): CustomPrompt | null => loadCustomPrompt());

ipcMain.handle(IpcChannels.SaveCustomPrompt, (_event, data: CustomPrompt): Result<void> => {
  saveCustomPrompt(data);
  return { success: true, data: undefined };
});

ipcMain.handle(IpcChannels.CloseCurrentWindow, (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

// 语音识别相关 - Web Audio 方案
ipcMain.handle(IpcChannels.InitASR, async (): Promise<Result<void>> => {
  const modelDir = resolveModelDir(userModelsDir(), bundledModelsDir());
  if (!modelDir) {
    return { success: false, error: '语音模型未加载，请先在设置页加载' };
  }
  try {
    await initASR(modelDir);
    asrReady = true;
    return { success: true, data: undefined };
  } catch (error) {
    return { success: false, error: toErrorMessage(error) };
  }
});

ipcMain.handle(IpcChannels.FeedAudio, (_event, samplesArray: number[]): ASRResult | null => {
  if (!asrReady) return null;
  const samples = new Float32Array(samplesArray);
  return feedAudio(samples);
});

ipcMain.handle(IpcChannels.StopASR, (): { finalText: string } => {
  const finalText = stopRecognition();
  asrReady = false;
  return { finalText };
});

// LLM 连通性测试
ipcMain.handle(IpcChannels.TestLLMConnection, (_event, settings: AppSettings) =>
  testConnection(settings),
);

// 词库分析
ipcMain.handle(IpcChannels.AnalyzeText, (_event, text: string): AnalysisResult | null =>
  analyzeText(text),
);

// ASR 模型管理
ipcMain.handle(IpcChannels.GetModelStatus, (): ModelStatus =>
  getModelStatus(userModelsDir(), bundledModelsDir()),
);

ipcMain.handle(IpcChannels.DownloadModel, async (): Promise<Result<void>> => {
  try {
    await downloadModel(userModelsDir(), (progress) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(IpcChannels.ModelDownloadProgress, progress);
        }
      }
    });
    return { success: true, data: undefined };
  } catch (error) {
    return { success: false, error: toErrorMessage(error) };
  }
});

// 文件保存
ipcMain.handle(
  IpcChannels.SaveFile,
  async (_event, content: string, filename: string): Promise<Result<string>> => {
    const options = {
      title: '保存报告',
      defaultPath: path.join(app.getPath('desktop'), filename),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    };
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options);

    if (!result.canceled && result.filePath) {
      writeFileSync(result.filePath, content, 'utf-8');
      return { success: true, data: result.filePath };
    }
    return { success: false, error: '已取消' };
  },
);

// AI 反馈（传入 customPrompt）
ipcMain.handle(IpcChannels.GetRealtimeFeedback, async (_event, text: string): Promise<Result<string>> => {
  const settings = loadSettings();
  const customPrompt = loadCustomPrompt();
  try {
    const feedback = await sendFeedback(text, settings, customPrompt);
    return { success: true, data: feedback };
  } catch (error) {
    return { success: false, error: toErrorMessage(error) };
  }
});

ipcMain.handle(IpcChannels.GetFinalReport, async (_event, input: FinalReportInput): Promise<Result<string>> => {
  const settings = loadSettings();
  const customPrompt = loadCustomPrompt();
  try {
    const report = await sendReport(input.fullText, input.stats, settings, customPrompt);
    return { success: true, data: report };
  } catch (error) {
    return { success: false, error: toErrorMessage(error) };
  }
});

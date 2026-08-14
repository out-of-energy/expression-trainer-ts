/**
 * 预加载脚本
 * 通过 contextBridge 暴露类型化 API（window.api）给渲染进程。
 */
import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels } from './shared/ipc';
import type { IpcApi } from './shared/ipc';

const api: IpcApi = {
  // 设置
  getSettings: () => ipcRenderer.invoke(IpcChannels.GetSettings),
  saveSettings: (settings) => ipcRenderer.invoke(IpcChannels.SaveSettings, settings),
  openSettings: () => ipcRenderer.invoke(IpcChannels.OpenSettingsWindow),

  // Prompt 编辑器
  openPromptEditor: () => ipcRenderer.invoke(IpcChannels.OpenPromptEditorWindow),
  getCustomPrompt: () => ipcRenderer.invoke(IpcChannels.GetCustomPrompt),
  saveCustomPrompt: (data) => ipcRenderer.invoke(IpcChannels.SaveCustomPrompt, data),

  // 窗口
  closeWindow: () => ipcRenderer.invoke(IpcChannels.CloseCurrentWindow),

  // 语音识别
  initASR: () => ipcRenderer.invoke(IpcChannels.InitASR),
  feedAudio: (samples) => ipcRenderer.invoke(IpcChannels.FeedAudio, Array.from(samples)),
  stopASR: () => ipcRenderer.invoke(IpcChannels.StopASR),

  // 词库分析
  analyzeText: (text) => ipcRenderer.invoke(IpcChannels.AnalyzeText, text),

  // 模型管理
  getModelStatus: () => ipcRenderer.invoke(IpcChannels.GetModelStatus),
  downloadModel: () => ipcRenderer.invoke(IpcChannels.DownloadModel),
  onModelDownloadProgress: (callback) => {
    ipcRenderer.on(IpcChannels.ModelDownloadProgress, (_event, progress) => callback(progress));
  },
  removeModelDownloadProgressListener: () => {
    ipcRenderer.removeAllListeners(IpcChannels.ModelDownloadProgress);
  },

  // AI 反馈
  getRealtimeFeedback: (text) => ipcRenderer.invoke(IpcChannels.GetRealtimeFeedback, text),
  getFinalReport: (input) => ipcRenderer.invoke(IpcChannels.GetFinalReport, input),
  testLLMConnection: (settings) => ipcRenderer.invoke(IpcChannels.TestLLMConnection, settings),

  // 文件保存
  saveFile: (content, filename) => ipcRenderer.invoke(IpcChannels.SaveFile, content, filename),
};

contextBridge.exposeInMainWorld('api', api);

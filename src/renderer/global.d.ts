/**
 * 为渲染进程注入 window.api 的类型。
 * 类型定义来自 src/shared/ipc.ts，保证与 preload 暴露的 API 一致。
 */
import type { IpcApi } from '../shared/ipc';

declare global {
  interface Window {
    api: IpcApi;
  }
}

export {};

/**
 * ASR 模型管理
 * 负责模型路径解析、状态查询、从 hf-mirror 下载模型文件。
 */
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import path, { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';
import type { ModelDownloadProgress, ModelStatus } from '../shared/types';

export const ASR_MODEL_SUBDIR = 'sherpa-onnx-streaming-paraformer-zh';
export const ASR_MODEL_FILES = ['encoder.onnx', 'decoder.onnx', 'tokens.txt'] as const;

const DOWNLOAD_BASE =
  'https://hf-mirror.com/csukuangfj/sherpa-onnx-streaming-paraformer-zh/resolve/main';

let downloading = false;

/**
 * 查找已安装的模型目录：userData 优先，项目自带 models 兜底。
 * 都找不到返回 null。
 */
export function resolveModelDir(userModelsDir: string, bundledModelsDir: string): string | null {
  for (const root of [userModelsDir, bundledModelsDir]) {
    const dir = path.join(root, ASR_MODEL_SUBDIR);
    if (ASR_MODEL_FILES.every((file) => existsSync(path.join(dir, file)))) {
      return dir;
    }
  }
  return null;
}

export function getModelStatus(userModelsDir: string, bundledModelsDir: string): ModelStatus {
  const modelDir = resolveModelDir(userModelsDir, bundledModelsDir);
  if (modelDir) {
    return { installed: true, modelDir, missingFiles: [], downloading };
  }

  const canonical = path.join(userModelsDir, ASR_MODEL_SUBDIR);
  const missingFiles = ASR_MODEL_FILES.filter((file) => !existsSync(path.join(canonical, file)));
  return { installed: false, modelDir: null, missingFiles: [...missingFiles], downloading };
}

async function downloadFile(
  url: string,
  dest: string,
  current: string,
  onProgress: (progress: ModelDownloadProgress) => void,
): Promise<void> {
  const tmp = `${dest}.part`;
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`下载失败 (HTTP ${response.status}): ${url}`);
  }

  const total = Number(response.headers.get('content-length')) || 0;
  mkdirSync(dirname(dest), { recursive: true });

  const nodeStream = Readable.fromWeb(response.body as unknown as ReadableStream<Uint8Array>);
  let received = 0;
  let lastPercent = -1;
  nodeStream.on('data', (chunk: Buffer) => {
    received += chunk.length;
    if (total > 0) {
      const percent = Math.min(100, Math.round((received / total) * 100));
      if (percent !== lastPercent) {
        lastPercent = percent;
        onProgress({ current, percent, done: false });
      }
    }
  });

  try {
    await pipeline(nodeStream, createWriteStream(tmp));
    renameSync(tmp, dest);
    onProgress({ current, percent: 100, done: false });
  } catch (error) {
    if (existsSync(tmp)) rmSync(tmp, { force: true });
    throw error;
  }
}

/** 下载全部模型文件到 userData/models（并发只允许一次） */
export async function downloadModel(
  userModelsDir: string,
  onProgress: (progress: ModelDownloadProgress) => void = () => {},
): Promise<void> {
  if (downloading) {
    throw new Error('模型正在下载中，请稍候');
  }
  downloading = true;
  try {
    const modelDir = path.join(userModelsDir, ASR_MODEL_SUBDIR);
    for (const file of ASR_MODEL_FILES) {
      await downloadFile(`${DOWNLOAD_BASE}/${file}`, path.join(modelDir, file), file, onProgress);
    }
    onProgress({ current: '', percent: 100, done: true });
  } finally {
    downloading = false;
  }
}

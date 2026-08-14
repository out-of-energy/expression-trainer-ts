/**
 * 语音识别模块 - 基于 sherpa-onnx-node
 * 使用 streaming recognizer 实现实时中文语音识别。
 * 录音通过渲染进程 Web Audio API 采集，音频数据经 IPC 传入。
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { OnlineRecognizer, OnlineStream } from 'sherpa-onnx-node';
import type { ASRResult } from '../shared/types';

const MODELS_DIR = path.join(__dirname, '..', 'models');
const MODEL_SUBDIR = 'sherpa-onnx-streaming-paraformer-bilingual-zh-en';
const REQUIRED_MODEL_FILES = ['encoder.int8.onnx', 'decoder.int8.onnx', 'tokens.txt'] as const;

let recognizer: OnlineRecognizer | null = null;
let stream: OnlineStream | null = null;
let isRunning = false;

/** 检查模型文件是否存在 */
function checkModels(): void {
  const modelDir = path.join(MODELS_DIR, MODEL_SUBDIR);
  for (const file of REQUIRED_MODEL_FILES) {
    if (!existsSync(path.join(modelDir, file))) {
      throw new Error(
        `模型文件未找到: ${file}\n` +
        `请确认 models/${MODEL_SUBDIR}/ 目录下有完整的模型文件`,
      );
    }
  }
}

/** 初始化 ASR 引擎 */
export async function initASR(): Promise<void> {
  if (recognizer) {
    // 已初始化，重置 stream 即可
    stream = recognizer.createStream();
    isRunning = true;
    console.log('[ASR] 重用已有引擎，创建新 stream');
    return;
  }

  checkModels();

  const modelDir = path.join(MODELS_DIR, MODEL_SUBDIR);

  const config = {
    featConfig: {
      sampleRate: 16000,
      featureDim: 80,
    },
    modelConfig: {
      paraformer: {
        encoder: path.join(modelDir, 'encoder.int8.onnx'),
        decoder: path.join(modelDir, 'decoder.int8.onnx'),
      },
      tokens: path.join(modelDir, 'tokens.txt'),
      numThreads: 2,
      provider: 'cpu',
      debug: false,
    },
    decodingMethod: 'greedy_search',
    maxActivePaths: 4,
    enableEndpoint: true,
    rule1MinTrailingSilence: 2.4,
    rule2MinTrailingSilence: 1.2,
    rule3MinUtteranceLength: 20,
  };

  recognizer = new OnlineRecognizer(config);
  stream = recognizer.createStream();
  isRunning = true;

  console.log('[ASR] 识别引擎初始化完成');
}

/**
 * 接收渲染进程发来的音频数据进行识别
 * @param samples 16kHz 单声道音频采样
 */
export function feedAudio(samples: Float32Array): ASRResult | null {
  if (!isRunning || !stream || !recognizer) return null;

  // sherpa-onnx-node API: acceptWaveform({ samples, sampleRate })
  stream.acceptWaveform({ samples, sampleRate: 16000 });

  while (recognizer.isReady(stream)) {
    recognizer.decode(stream);
  }

  const result = recognizer.getResult(stream);
  const text = (result.text || '').trim();
  const isEndpoint = recognizer.isEndpoint(stream);

  if (isEndpoint && text) {
    recognizer.reset(stream);
    return { text, isFinal: true };
  } else if (text) {
    return { text, isFinal: false };
  }

  return null;
}

/** 停止识别，返回最后的未确认文本 */
export function stopRecognition(): string {
  isRunning = false;

  let finalText = '';
  if (stream && recognizer) {
    stream.inputFinished();
    while (recognizer.isReady(stream)) {
      recognizer.decode(stream);
    }
    const result = recognizer.getResult(stream);
    finalText = (result.text || '').trim();
    stream = null;
  }

  console.log('[ASR] 停止录制');
  return finalText;
}

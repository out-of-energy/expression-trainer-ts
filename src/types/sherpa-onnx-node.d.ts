/**
 * sherpa-onnx-node 类型声明（原生模块不随包附带 .d.ts）。
 * 仅覆盖本项目用到的 streaming ASR API。
 */
declare module 'sherpa-onnx-node' {
  export interface OnlineRecognizerConfig {
    featConfig: {
      sampleRate: number;
      featureDim: number;
    };
    modelConfig: {
      paraformer: {
        encoder: string;
        decoder: string;
      };
      tokens: string;
      numThreads: number;
      provider: string;
      debug: boolean;
    };
    decodingMethod: string;
    maxActivePaths: number;
    enableEndpoint: boolean;
    rule1MinTrailingSilence: number;
    rule2MinTrailingSilence: number;
    rule3MinUtteranceLength: number;
  }

  export interface Waveform {
    samples: Float32Array;
    sampleRate: number;
  }

  export interface OnlineRecognizerResult {
    text: string;
  }

  export class OnlineStream {
    acceptWaveform(waveform: Waveform): void;
    inputFinished(): void;
  }

  export class OnlineRecognizer {
    constructor(config: OnlineRecognizerConfig);
    createStream(): OnlineStream;
    isReady(stream: OnlineStream): boolean;
    decode(stream: OnlineStream): void;
    isEndpoint(stream: OnlineStream): boolean;
    reset(stream: OnlineStream): void;
    getResult(stream: OnlineStream): OnlineRecognizerResult;
  }
}

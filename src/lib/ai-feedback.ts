/**
 * AI 反馈模块 - 支持多后端
 * 支持 DeepSeek / OpenAI / Ollama / 自定义 OpenAI 兼容接口
 */
import { getRealtimePrompt, getReportPrompt } from './prompts';
import type {
  AppSettings,
  CustomPrompt,
  Provider,
  Result,
  SessionStats,
} from '../shared/types';

// 各后端的 API 配置
const PROVIDER_ENDPOINTS: Record<'openai' | 'deepseek', string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/v1/chat/completions',
};

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

/** 解析后的运行时配置（把 per-provider 设置归一化成一次 API 调用所需字段） */
export interface ResolvedProviderConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  provider: Provider;
}

/**
 * 从 AppSettings 解析当前选中 provider 的运行配置。
 * 通过可辨识联合（kind）分发，每个分支只访问该 provider 自己的字段。
 */
export function resolveProviderConfig(settings: AppSettings): ResolvedProviderConfig {
  const selected = settings.providers[settings.provider];

  switch (selected.kind) {
    case 'openai':
      return {
        endpoint: PROVIDER_ENDPOINTS.openai,
        apiKey: selected.apiKey,
        model: selected.model || 'gpt-4o-mini',
        provider: 'openai',
      };
    case 'deepseek':
      return {
        endpoint: PROVIDER_ENDPOINTS.deepseek,
        apiKey: selected.apiKey,
        model: selected.model || 'deepseek-v4-flash',
        provider: 'deepseek',
      };
    case 'ollama':
      return {
        endpoint: `${selected.ollamaUrl || 'http://localhost:11434'}/v1/chat/completions`,
        apiKey: 'ollama', // Ollama 不需要真实 key 但接口需要这个字段
        model: selected.model || 'qwen2.5:7b',
        provider: 'ollama',
      };
    case 'custom': {
      const base = selected.baseUrl.replace(/\/+$/, '');
      return {
        endpoint: base ? `${base}/chat/completions` : '',
        apiKey: selected.apiKey,
        model: selected.model,
        provider: 'custom',
      };
    }
  }
}

interface CallAPIOptions {
  maxTokens?: number;
  temperature?: number;
  /** 关闭思考模式（deepseek v4 系列专用，短回复任务更稳更快） */
  disableThinking?: boolean;
}

/** 发送请求到 OpenAI 兼容接口 */
async function callAPI(
  endpoint: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  options: CallAPIOptions = {},
): Promise<string> {
  const { maxTokens = 200, temperature = 0.7, disableThinking = false } = options;

  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature,
  };
  if (disableThinking) {
    body.thinking = { type: 'disabled' };
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API 请求失败 (${response.status}): ${error}`);
  }

  const data: { choices: Array<{ message: { content: string } }> } = await response.json();
  return data.choices[0]!.message.content;
}

/** 发送实时反馈请求，返回反馈文本 */
export async function sendFeedback(
  text: string,
  settings: AppSettings,
  customPrompt: CustomPrompt | null,
): Promise<string> {
  const config = resolveProviderConfig(settings);
  const prompt = getRealtimePrompt(text, null, customPrompt);

  const messages: ChatMessage[] = [
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user },
  ];

  return callAPI(config.endpoint, config.apiKey, config.model, messages, {
    maxTokens: 150,
    disableThinking: config.provider === 'deepseek',
  });
}

/** 发送结束报告请求，返回报告文本 */
export async function sendReport(
  fullText: string,
  stats: SessionStats,
  settings: AppSettings,
  customPrompt: CustomPrompt | null,
): Promise<string> {
  const config = resolveProviderConfig(settings);
  const prompt = getReportPrompt(fullText, stats, customPrompt);

  const messages: ChatMessage[] = [
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user },
  ];

  return callAPI(config.endpoint, config.apiKey, config.model, messages, { maxTokens: 8192 });
}

/** 测试 LLM 连通性：发送一条极简请求验证配置是否可用 */
export async function testConnection(settings: AppSettings): Promise<Result<void>> {
  const config = resolveProviderConfig(settings);
  if (!config.endpoint) {
    return { success: false, error: '端点地址未配置' };
  }

  const messages: ChatMessage[] = [{ role: 'user', content: 'OK' }];

  try {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        max_tokens: 2,
        temperature: 0,
      }),
    });

    if (!response.ok) {
      const error = await response.text().catch(() => '未知错误');
      return { success: false, error: `API 请求失败 (${response.status}): ${error}` };
    }

    return { success: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `连接失败: ${message}` };
  }
}

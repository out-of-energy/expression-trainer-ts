/**
 * 设置页逻辑
 */
import { getElement } from './dom';
import type { AppSettings, Provider } from '../shared/types';

interface ModelOption {
  value: string;
  label: string;
}

interface ProviderFormConfig {
  needsKey: boolean;
  keyHint?: string;
  models: ModelOption[];
}

const PROVIDER_CONFIG: Record<Provider, ProviderFormConfig> = {
  openai: {
    needsKey: true,
    keyHint: '在 platform.openai.com 获取',
    models: [
      { value: 'gpt-4o-mini', label: 'GPT-4o Mini（推荐）' },
      { value: 'gpt-4o', label: 'GPT-4o' },
      { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
    ],
  },
  deepseek: {
    needsKey: true,
    keyHint: '在 platform.deepseek.com 获取',
    models: [
      { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash（推荐）' },
      { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
    ],
  },
  ollama: {
    needsKey: false,
    models: [
      { value: 'qwen2.5:7b', label: 'Qwen 2.5 7B（推荐）' },
      { value: 'llama3.1:8b', label: 'Llama 3.1 8B' },
      { value: 'mistral:7b', label: 'Mistral 7B' },
    ],
  },
  custom: {
    needsKey: true,
    keyHint: '自定义 API Key',
    models: [],
  },
};

class SettingsPage {
  private providerSelect = getElement<HTMLSelectElement>('provider');
  private apikeyInput = getElement<HTMLInputElement>('apikey');
  private apikeyHint = getElement('apikey-hint');
  private modelSelect = getElement<HTMLSelectElement>('model');
  private ollamaUrlInput = getElement<HTMLInputElement>('ollama-url');
  private customBaseUrlInput = getElement<HTMLInputElement>('custom-base-url');
  private customModelInput = getElement<HTMLInputElement>('custom-model');
  private btnSave = getElement<HTMLButtonElement>('btn-save');
  private btnCancel = getElement<HTMLButtonElement>('btn-cancel');
  private saveSuccess = getElement('save-success');
  private connectionError = getElement('connection-error');

  private groupApikey = getElement('group-apikey');
  private groupOllama = getElement('group-ollama');
  private groupCustom = getElement('group-custom');
  private groupCustomModel = getElement('group-custom-model');

  private settings: AppSettings | null = null;

  constructor() {
    this.bindEvents();
    this.loadSettings();
  }

  private bindEvents(): void {
    this.providerSelect.addEventListener('change', () => this.onProviderChange());
    this.btnSave.addEventListener('click', () => this.save());
    this.btnCancel.addEventListener('click', () => window.close());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') window.close();
    });
  }

  private async loadSettings(): Promise<void> {
    this.settings = await window.api.getSettings();
    this.providerSelect.value = this.settings.provider;

    // 先填充模型列表再加载字段值
    this.onProviderChange();
  }

  /** 加载指定 provider 的配置到表单字段 */
  private loadProviderFields(provider: Provider): void {
    // 清空所有条件字段，避免切换 provider 时残留旧值
    this.apikeyInput.value = '';
    this.ollamaUrlInput.value = 'http://localhost:11434';
    this.customBaseUrlInput.value = '';
    this.customModelInput.value = '';
    this.modelSelect.value = '';

    const cfg = this.settings?.providers[provider];
    if (!cfg) return;

    switch (cfg.kind) {
      case 'openai':
      case 'deepseek':
        this.apikeyInput.value = cfg.apiKey;
        this.modelSelect.value = cfg.model;
        break;
      case 'ollama':
        this.ollamaUrlInput.value = cfg.ollamaUrl;
        this.modelSelect.value = cfg.model;
        break;
      case 'custom':
        this.apikeyInput.value = cfg.apiKey;
        this.customBaseUrlInput.value = cfg.baseUrl;
        this.customModelInput.value = cfg.model;
        break;
    }
  }

  private onProviderChange(): void {
    const provider = this.providerSelect.value as Provider;
    const config = PROVIDER_CONFIG[provider];

    // 显示/隐藏条件字段
    this.groupApikey.classList.toggle('visible', config.needsKey);
    this.groupOllama.classList.toggle('visible', provider === 'ollama');
    this.groupCustom.classList.toggle('visible', provider === 'custom');
    this.groupCustomModel.classList.toggle('visible', provider === 'custom');

    // 更新 key 提示
    if (config.keyHint) {
      this.apikeyHint.textContent = config.keyHint;
    }

    // 填充模型列表
    this.modelSelect.innerHTML = '';
    if (config.models.length > 0) {
      for (const m of config.models) {
        const opt = document.createElement('option');
        opt.value = m.value;
        opt.textContent = m.label;
        this.modelSelect.appendChild(opt);
      }
      this.modelSelect.parentElement!.style.display = '';
    } else {
      this.modelSelect.parentElement!.style.display = 'none';
    }

    // 切换后加载该 provider 保存的配置到表单字段
    this.loadProviderFields(provider);
  }

  private async save(): Promise<void> {
    const provider = this.providerSelect.value as Provider;

    // 隐藏上次的错误提示
    this.connectionError.classList.remove('show');
    this.connectionError.textContent = '';

    // 先获取完整 settings（包含所有 provider 的独立配置）
    const settings = await window.api.getSettings();
    settings.provider = provider;

    // 只更新当前 provider 的配置
    switch (provider) {
      case 'openai':
        settings.providers.openai = {
          kind: 'openai',
          apiKey: this.apikeyInput.value.trim(),
          model: this.modelSelect.value,
        };
        break;
      case 'deepseek':
        settings.providers.deepseek = {
          kind: 'deepseek',
          apiKey: this.apikeyInput.value.trim(),
          model: this.modelSelect.value,
        };
        break;
      case 'ollama':
        settings.providers.ollama = {
          kind: 'ollama',
          ollamaUrl: this.ollamaUrlInput.value.trim(),
          model: this.modelSelect.value,
        };
        break;
      case 'custom':
        settings.providers.custom = {
          kind: 'custom',
          apiKey: this.apikeyInput.value.trim(),
          baseUrl: this.customBaseUrlInput.value.trim(),
          model: this.customModelInput.value.trim(),
        };
        break;
    }

    await window.api.saveSettings(settings);

    // 更新缓存，让下次切换 provider 时能看到最新值
    this.settings = settings;

    // 测试连通性
    this.btnSave.textContent = '⏳ 测试连接中...';
    this.btnSave.classList.add('loading');
    const result = await window.api.testLLMConnection(settings);

    if (result.success) {
      this.btnSave.textContent = '保存设置';
      this.btnSave.classList.remove('loading');
      this.saveSuccess.classList.add('show');
      setTimeout(() => {
        window.close();
      }, 800);
    } else {
      this.btnSave.textContent = '保存设置';
      this.btnSave.classList.remove('loading');
      this.connectionError.textContent = '⚠️ 大模型测试连接失败，请核对后重试!';
      this.connectionError.classList.add('show');
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new SettingsPage();
});

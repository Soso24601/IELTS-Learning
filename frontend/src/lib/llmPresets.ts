/** 大模型预设：前端展示用的常量（后端只保存 provider/baseUrl/model/key）。 */

export type LLMProvider = 'deepseek' | 'openai' | 'gemini';

export interface LLMProviderMeta {
  provider: LLMProvider;
  label: string;
  hint: string;
  defaultBaseUrl: string;
  defaultModel: string;
  keyPlaceholder: string;
}

export const LLM_PROVIDERS: LLMProviderMeta[] = [
  {
    provider: 'deepseek',
    label: 'DeepSeek（推荐）',
    hint: '便宜好用，在 platform.deepseek.com 申请 Key',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    keyPlaceholder: 'sk-…',
  },
  {
    provider: 'openai',
    label: '自定义（OpenAI 兼容）',
    hint: '适用于 Kimi / 智谱 / 通义千问 等任何兼容接口',
    defaultBaseUrl: '',
    defaultModel: '',
    keyPlaceholder: '填入该服务商的 API Key',
  },
];

export function metaOf(provider: LLMProvider): LLMProviderMeta {
  return LLM_PROVIDERS.find((p) => p.provider === provider) || LLM_PROVIDERS[0];
}

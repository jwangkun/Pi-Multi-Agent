/**
 * Unified LLM Provider Configuration
 *
 * All providers use the OpenAI-compatible protocol.
 * Configure via environment variables or pass directly:
 *
 *   LLM_API_KEY   - API key
 *   LLM_BASE_URL  - Base URL (e.g. https://api.deepseek.com)
 *   LLM_MODEL     - Model name (e.g. deepseek-chat)
 */

export interface LLMProviderConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

/** Mutable defaults — updated at runtime when provider switches */
export const LLM_DEFAULTS: { baseURL: string; model: string } = {
  baseURL: process.env.LLM_BASE_URL || 'https://api.deepseek.com',
  model: process.env.LLM_MODEL || 'deepseek-chat',
};

/** Called by server when LLM config changes at runtime */
export function updateLLMDefaults(baseURL: string, model: string): void {
  LLM_DEFAULTS.baseURL = baseURL;
  LLM_DEFAULTS.model = model;
}

/**
 * Build a full LLMProviderConfig, falling back to mutable defaults.
 */
export function resolveLLMConfig(
  apiKey: string,
  baseURL?: string,
  model?: string,
): LLMProviderConfig {
  return {
    apiKey,
    baseURL: baseURL || LLM_DEFAULTS.baseURL,
    model: model || LLM_DEFAULTS.model,
  };
}

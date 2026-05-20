import type { AIService, ChatMessage, ChatOptions } from '../types.js';

const DEFAULT_MODEL = 'google/gemini-2.0-flash-exp:free';

interface OpenRouterChunk {
  choices?: Array<{
    delta?: {
      content?: string;
    };
  }>;
}

export class OpenRouterService implements AIService {
  name = 'openrouter';
  private apiKey: string;
  private defaultModel: string;

  constructor(apiKey: string, defaultModel?: string) {
    this.apiKey = apiKey;
    this.defaultModel = defaultModel ?? DEFAULT_MODEL;
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<AsyncIterable<string>> {
    const model = options?.model ?? this.defaultModel;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://zero-gravity.local',
        'X-Title': 'ZeroGravity Agent',
      },
      body: JSON.stringify({
        model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.max_tokens ?? 2048,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`[OpenRouter] Error ${response.status}: ${errorBody}`);
    }

    if (!response.body) {
      throw new Error('[OpenRouter] La respuesta no tiene body stream.');
    }

    return this.streamTokens(response.body);
  }

  private async *streamTokens(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Procesar líneas SSE completas
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') return;

          try {
            const parsed = JSON.parse(data) as OpenRouterChunk;
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              yield delta;
            }
          } catch {
            // Línea SSE no parseable, ignorar
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async healthCheck(): Promise<{ up: boolean; message?: string; latency?: number }> {
    const start = Date.now();
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://zero-gravity.local',
          'X-Title': 'ZeroGravity Agent',
        },
        body: JSON.stringify({
          model: this.defaultModel,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          stream: false,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Error ${response.status}: ${errorBody}`);
      }

      return {
        up: true,
        latency: Date.now() - start,
      };
    } catch (error: any) {
      return {
        up: false,
        message: error.message,
        latency: Date.now() - start,
      };
    }
  }
}

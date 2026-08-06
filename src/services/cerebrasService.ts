import Cerebras from '@cerebras/cerebras_cloud_sdk';
import type { AIService, ChatMessage, ChatOptions } from '../types.js';

const DEFAULT_MODEL = 'qwen-3-235b-a22b-instruct-2507';

interface CerebrasStreamChunk {
  choices: Array<{
    delta?: {
      content?: string | null;
    };
  }>;
}

export class CerebrasService implements AIService {
  name = 'cerebras';
  private client: Cerebras;

  constructor(apiKey: string) {
    this.client = new Cerebras({ apiKey });
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<AsyncIterable<string>> {
    const model = options?.model ?? DEFAULT_MODEL;

    const stream = await this.client.chat.completions.create({
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      model,
      stream: true,
      max_completion_tokens: options?.max_tokens ?? 20000,
      temperature: options?.temperature ?? 0.7,
      top_p: 0.8,
    }, { signal: options?.abortSignal });

    return (async function* () {
      for await (const chunk of stream as AsyncIterable<CerebrasStreamChunk>) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) yield delta;
      }
    })();
  }

  async healthCheck(): Promise<{ up: boolean; message?: string; latency?: number }> {
    const start = Date.now();
    try {
      await this.client.chat.completions.create({
        messages: [{ role: 'user', content: 'ping' }],
        model: DEFAULT_MODEL,
        max_completion_tokens: 1,
      });
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

import Groq from 'groq-sdk';
import type { AIService, ChatMessage, ChatOptions } from '../types.js';

const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

export class GroqService implements AIService {
  name = 'groq';
  private client: Groq;

  constructor(apiKey: string) {
    this.client = new Groq({ apiKey });
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<AsyncIterable<string>> {
    const model = options?.model ?? DEFAULT_MODEL;

    const stream = await this.client.chat.completions.create({
      model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      temperature: options?.temperature ?? 0.6,
      max_completion_tokens: options?.max_tokens ?? 4096,
      top_p: 1,
      stream: true,
      stop: null,
    });

    return (async function* () {
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) yield delta;
      }
    })();
  }

  async healthCheck(): Promise<{ up: boolean; message?: string; latency?: number }> {
    const start = Date.now();
    try {
      await this.client.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [{ role: 'user', content: 'ping' }],
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

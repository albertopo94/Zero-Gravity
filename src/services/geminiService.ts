import { GoogleGenerativeAI } from '@google/generative-ai';
import type { AIService, ChatMessage, ChatOptions } from '../types.js';

const DEFAULT_MODEL = 'gemini-2.0-flash';

export class GeminiService implements AIService {
  name = 'gemini';
  private client: GoogleGenerativeAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenerativeAI(apiKey);
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<AsyncIterable<string>> {
    const model = this.client.getGenerativeModel({
      model: options?.model ?? DEFAULT_MODEL,
    });

    // Separar system prompt del historial
    const systemMessage = messages.find((m) => m.role === 'system');
    const chatMessages = messages.filter((m) => m.role !== 'system');

    // Convertir al formato de Gemini
    const history = chatMessages.slice(0, -1).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const lastMessage = chatMessages[chatMessages.length - 1];

    const chat = model.startChat({
      history,
      ...(systemMessage && {
        systemInstruction: { role: 'system', parts: [{ text: systemMessage.content }] },
      }),
      generationConfig: {
        temperature: options?.temperature ?? 0.7,
        maxOutputTokens: options?.max_tokens ?? 4096,
      },
    });

    const result = await chat.sendMessageStream(lastMessage.content);

    return (async function* () {
      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) yield text;
      }
    })();
  }

  async healthCheck(): Promise<{ up: boolean; message?: string; latency?: number }> {
    const start = Date.now();
    try {
      const model = this.client.getGenerativeModel({ model: DEFAULT_MODEL });
      await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
        generationConfig: { maxOutputTokens: 1 },
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

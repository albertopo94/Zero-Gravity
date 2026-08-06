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

    // Find the first system message (the system prompt)
    const firstSystemIndex = messages.findIndex((m) => m.role === 'system');
    const systemMessage = firstSystemIndex !== -1 ? messages[firstSystemIndex] : undefined;

    // The rest of the messages form the chat messages (excluding the first system message)
    const chatMessages = firstSystemIndex !== -1 
      ? messages.filter((_, idx) => idx !== firstSystemIndex)
      : messages;

    if (chatMessages.length === 0) {
      throw new Error('Cannot start chat without user or assistant messages');
    }

    // Convert to Gemini history, mapping intermediate system messages to 'user'
    const mappedHistory = chatMessages.slice(0, -1).map((m) => {
      if (m.role === 'system') {
        return {
          role: 'user' as const,
          content: `[System/Tool Output: ${m.content}]`,
        };
      }
      return m;
    });

    // Merge consecutive messages of the same role to ensure they strictly alternate
    const history: { role: 'user' | 'model'; parts: { text: string }[] }[] = [];
    for (const m of mappedHistory) {
      const geminiRole = m.role === 'assistant' ? 'model' : 'user';
      if (history.length > 0 && history[history.length - 1].role === geminiRole) {
        history[history.length - 1].parts[0].text += '\n\n' + m.content;
      } else {
        history.push({
          role: geminiRole,
          parts: [{ text: m.content }],
        });
      }
    }

    // Google Gemini API requires the history history list to start with a 'user' role.
    // Clean up any leading 'model' messages from history to prevent 400 Bad Request errors.
    while (history.length > 0 && history[0].role === 'model') {
      history.shift();
    }

    const lastMessage = chatMessages[chatMessages.length - 1];
    let lastMessageContent = lastMessage.content;
    if (lastMessage.role === 'system') {
      lastMessageContent = `[System/Tool Output: ${lastMessage.content}]`;
    }

    // If the last message in history has role 'user', merge it into the lastMessageContent
    // to ensure the history ends with 'model' (or is empty) and alternates with the outgoing 'user' message.
    let finalLastMessageContent = lastMessageContent;
    if (history.length > 0 && history[history.length - 1].role === 'user') {
      const lastUserHistoryItem = history.pop();
      if (lastUserHistoryItem) {
        finalLastMessageContent = lastUserHistoryItem.parts[0].text + '\n\n' + finalLastMessageContent;
      }
    }

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

    const result = await chat.sendMessageStream(finalLastMessageContent, {
      signal: options?.abortSignal,
    });

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

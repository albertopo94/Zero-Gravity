import type { TTSService, HealthStatus } from '../types.js';

export class ElevenLabsService implements TTSService {
  name = 'elevenlabs';
  private apiKey: string;
  private voiceId: string;

  constructor(apiKey: string, voiceId?: string) {
    this.apiKey = apiKey;
    this.voiceId = voiceId || '21m00Tcm4TlvDq8ikWAM';
  }

  async synthesize(text: string): Promise<Buffer> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}`, {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
          'Content-Type': 'application/json',
          accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`ElevenLabs API error (${response.status})`);
      }

      const buffer = await response.arrayBuffer();
      return Buffer.from(buffer);
    } catch (error: any) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/voices`, {
        method: 'GET',
        headers: {
          'xi-api-key': this.apiKey,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`ElevenLabs Health check failed (${response.status})`);
      }

      return {
        up: true,
        latency: Date.now() - start,
      };
    } catch (error: any) {
      clearTimeout(timeoutId);
      const isTimeout = error.name === 'AbortError' || error.message?.toLowerCase().includes('timeout') || error.message?.toLowerCase().includes('abort');
      return {
        up: false,
        message: isTimeout ? 'Timeout' : error.message || 'Error desconocido',
        latency: Date.now() - start,
      };
    }
  }
}

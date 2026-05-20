import Groq from 'groq-sdk';
import { AssemblyAI } from 'assemblyai';
import { DeepgramClient } from '@deepgram/sdk';
import type { TranscriptionProvider, HealthStatus } from '../types.js';

// ─── Proveedores ────────────────────────────────────────────

export class GroqTranscriptionService implements TranscriptionProvider {
  name = 'groq-whisper';
  private client: Groq;

  constructor(apiKey: string) {
    this.client = new Groq({ apiKey });
  }

  async transcribe(audioBuffer: Buffer, filename: string): Promise<string> {
    const safeName = filename.replace('.oga', '.ogg').replace(/^.*\//, '') || 'voice.ogg';
    const file = new File([new Uint8Array(audioBuffer)], safeName, { type: 'audio/ogg' });

    const result = await this.client.audio.transcriptions.create({
      file,
      model: 'whisper-large-v3-turbo',
      language: 'es',
      response_format: 'text',
    });

    return typeof result === 'string' ? result.trim() : String(result).trim();
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      // Usamos una llamada mínima para verificar la API Key
      await this.client.models.list();
      return { up: true, latency: Date.now() - start };
    } catch (error) {
      return { 
        up: false, 
        message: error instanceof Error ? error.message : String(error),
        latency: Date.now() - start 
      };
    }
  }
}

export class AssemblyTranscriptionService implements TranscriptionProvider {
  name = 'assemblyai';
  private client: AssemblyAI;

  constructor(apiKey: string) {
    this.client = new AssemblyAI({ apiKey });
  }

  async transcribe(audioBuffer: Buffer): Promise<string> {
    const result = await this.client.transcripts.transcribe({
      audio: audioBuffer,
      language_detection: true,
    });

    if (result.status === 'error') {
      throw new Error(`AssemblyAI error: ${result.error}`);
    }

    return (result.text ?? '').trim();
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      // Verificamos conectividad básica
      await fetch('https://api.assemblyai.com/v2/transcript', {
        headers: { Authorization: (this.client as any).apiKey }
      });
      return { up: true, latency: Date.now() - start };
    } catch (error) {
      return { up: false, message: String(error), latency: Date.now() - start };
    }
  }
}

export class DeepgramTranscriptionService implements TranscriptionProvider {
  name = 'deepgram';
  private client: DeepgramClient;

  constructor(apiKey: string) {
    this.client = new DeepgramClient(apiKey);
  }

  async transcribe(audioBuffer: Buffer): Promise<string> {
    const { result } = await this.client.listen.prerecorded.transcribeFile(audioBuffer, {
      model: 'nova-3',
      language: 'es',
      smart_format: true,
    });

    const transcript = result?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
    return (transcript ?? '').trim();
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      await this.client.manage.getProjects();
      return { up: true, latency: Date.now() - start };
    } catch (error) {
      return { up: false, message: String(error), latency: Date.now() - start };
    }
  }
}

// ─── Router de Transcripción ────────────────────────────────

export class TranscriptionRouter {
  private providers: TranscriptionProvider[] = [];
  private statusMap: Map<string, HealthStatus> = new Map();
  private currentIndex = 0;

  constructor(providers: TranscriptionProvider[]) {
    this.providers = providers;
  }

  async checkAllHealth(): Promise<Record<string, HealthStatus>> {
    const results = await Promise.all(
      this.providers.map(async (p) => {
        const status = await p.healthCheck();
        this.statusMap.set(p.name, status);
        return { name: p.name, status };
      })
    );

    const report: Record<string, HealthStatus> = {};
    for (const res of results) {
      report[res.name] = res.status;
    }
    return report;
  }

  async transcribe(audioBuffer: Buffer, filename: string): Promise<{ text: string; provider: string }> {
    const healthyProviders = this.providers.filter(p => this.statusMap.get(p.name)?.up !== false);

    if (healthyProviders.length === 0) {
      throw new Error('[Transcription] No hay proveedores de transcripción disponibles o sanos.');
    }

    const startIndex = this.currentIndex % healthyProviders.length;

    for (let i = 0; i < healthyProviders.length; i++) {
      const index = (startIndex + i) % healthyProviders.length;
      const provider = healthyProviders[index];

      try {
        const text = await provider.transcribe(audioBuffer, filename);
        if (text) {
          this.currentIndex = (index + 1) % healthyProviders.length;
          return { text, provider: provider.name };
        }
      } catch (error) {
        console.warn(`[Transcription] Fallo con ${provider.name}, intentando siguiente...`);
      }
    }

    throw new Error('[Transcription] Todos los proveedores fallaron al intentar transcribir.');
  }
}

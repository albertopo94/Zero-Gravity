import Groq from 'groq-sdk';
import { AssemblyAI } from 'assemblyai';
import { DeepgramClient } from '@deepgram/sdk';

// ─── Interfaces ─────────────────────────────────────────────

interface TranscriptionProvider {
  name: string;
  transcribe: (audioBuffer: Buffer, filename: string) => Promise<string>;
}

// ─── Proveedores ────────────────────────────────────────────

function createGroqProvider(): TranscriptionProvider | null {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const client = new Groq({ apiKey });

  return {
    name: 'groq-whisper',
    async transcribe(audioBuffer: Buffer, filename: string): Promise<string> {
      const safeName = filename.replace('.oga', '.ogg').replace(/^.*\//, '') || 'voice.ogg';
      const file = new File([new Uint8Array(audioBuffer)], safeName, { type: 'audio/ogg' });

      const result = await client.audio.transcriptions.create({
        file,
        model: 'whisper-large-v3-turbo',
        language: 'es',
        response_format: 'text',
      });

      return typeof result === 'string' ? result.trim() : String(result).trim();
    },
  };
}

function createAssemblyProvider(): TranscriptionProvider | null {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) return null;

  const client = new AssemblyAI({ apiKey });

  return {
    name: 'assemblyai',
    async transcribe(audioBuffer: Buffer): Promise<string> {
      const result = await client.transcripts.transcribe({
        audio: audioBuffer,
        language_detection: true,
      });

      if (result.status === 'error') {
        throw new Error(`AssemblyAI error: ${result.error}`);
      }

      return (result.text ?? '').trim();
    },
  };
}

function createDeepgramProvider(): TranscriptionProvider | null {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) return null;

  const deepgram = new DeepgramClient(apiKey);

  return {
    name: 'deepgram',
    async transcribe(audioBuffer: Buffer): Promise<string> {
      const { result } = await deepgram.listen.prerecorded.transcribeFile(audioBuffer, {
        model: 'nova-3',
        language: 'es',
        smart_format: true,
      });

      const transcript = result?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
      return (transcript ?? '').trim();
    },
  };
}

// ─── Router de Transcripción ────────────────────────────────

let providers: TranscriptionProvider[] = [];
let currentIndex = 0;

export function initTranscriptionProviders(): string[] {
  providers = [];

  const groq = createGroqProvider();
  if (groq) providers.push(groq);

  const assembly = createAssemblyProvider();
  if (assembly) providers.push(assembly);

  const deepgram = createDeepgramProvider();
  if (deepgram) providers.push(deepgram);

  return providers.map((p) => p.name);
}

/**
 * Transcribe audio con round-robin y fallback.
 * Rota entre proveedores y si uno falla, pasa al siguiente.
 */
export async function transcribeAudio(audioBuffer: Buffer, filename: string): Promise<{ text: string; provider: string }> {
  if (providers.length === 0) {
    throw new Error('[Transcription] No hay proveedores de transcripción configurados.');
  }

  const startIndex = currentIndex;

  for (let i = 0; i < providers.length; i++) {
    const index = (startIndex + i) % providers.length;
    const provider = providers[index];

    try {
      console.log(`[Transcription] Intentando con ${provider.name}...`);
      const text = await provider.transcribe(audioBuffer, filename);

      if (text) {
        // Avanzar round-robin para la próxima llamada
        currentIndex = (index + 1) % providers.length;
        console.log(`[Transcription] Éxito con ${provider.name}: "${text.substring(0, 60)}..."`);
        return { text, provider: provider.name };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[Transcription] Fallo con ${provider.name}: ${msg}`);
    }
  }

  throw new Error('[Transcription] Todos los proveedores fallaron.');
}

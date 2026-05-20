// ─── Mensajes de chat ───────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  abortSignal?: AbortSignal;
}

// ─── Servicio de IA ─────────────────────────────────────────

export interface HealthStatus {
  up: boolean;
  message?: string;
  latency?: number;
}

export interface AIService {
  name: string;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<AsyncIterable<string>>;
  healthCheck(): Promise<HealthStatus>;
}

// ─── Servicio de Transcripción ──────────────────────────────

export interface TranscriptionProvider {
  name: string;
  transcribe(audioBuffer: Buffer, filename: string): Promise<string>;
  healthCheck(): Promise<HealthStatus>;
}

// ─── Servicio de Síntesis de Voz (TTS) ──────────────────────

export interface TTSService {
  name: string;
  synthesize(text: string): Promise<Buffer>;
  healthCheck(): Promise<HealthStatus>;
}

// ─── Herramientas ───────────────────────────────────────────

export interface ToolResult {
  success: boolean;
  data: string;
}

export interface Tool {
  name: string;
  description: string;
  execute(): ToolResult;
}

// ─── Configuración del agente ───────────────────────────────

export interface AgentConfig {
  maxIterations: number;
  allowedUserIds: number[];
  dbPath: string;
}

// ─── Resultado del AI Router ────────────────────────────────

export interface AIRouterResult {
  stream: AsyncIterable<string>;
  provider: string;
}

// ─── Registro de logs ───────────────────────────────────────

export interface InteractionLog {
  userId: number;
  prompt: string;
  response: string;
  provider: string;
  timestamp: string;
}

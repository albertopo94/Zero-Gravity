import { expect, test, describe } from "bun:test";
import { GroqTranscriptionService, TranscriptionRouter } from "./transcriptionService";

describe("GroqTranscriptionService", () => {
  test("should be instantiated", () => {
    const service = new GroqTranscriptionService("fake-key");
    expect(service).toBeDefined();
    expect(service.name).toBe("groq-whisper");
  });
});

describe("TranscriptionRouter", () => {
  const mockProvider = (name: string, up: boolean) => ({
    name,
    transcribe: async () => "transcribed text",
    healthCheck: async () => ({ up, latency: 10 })
  });

  test("should filter out down providers", async () => {
    const p1 = mockProvider("p1", true);
    const p2 = mockProvider("p2", false);
    const router = new TranscriptionRouter([p1, p2] as any);
    
    await router.checkAllHealth();
    const result = await router.transcribe(Buffer.from(""), "test.ogg");
    
    expect(result.provider).toBe("p1");
  });

  test("should rotate between healthy providers", async () => {
    const p1 = mockProvider("p1", true);
    const p2 = mockProvider("p2", true);
    const router = new TranscriptionRouter([p1, p2] as any);
    
    await router.checkAllHealth();
    
    const r1 = await router.transcribe(Buffer.from(""), "test.ogg");
    expect(r1.provider).toBe("p1");
    
    const r2 = await router.transcribe(Buffer.from(""), "test.ogg");
    expect(r2.provider).toBe("p2");
  });
});

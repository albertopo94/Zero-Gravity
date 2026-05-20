import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { ElevenLabsService } from "./elevenlabsService.js";

describe("ElevenLabsService", () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchCalls: { url: string; options: any }[] = [];
  let mockResponseStatus = 200;
  let mockResponseBody: any = null;
  let mockResponseHeaders = new Headers();
  let mockFetchError: Error | null = null;
  let mockDelayMs = 0;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchCalls = [];
    mockResponseStatus = 200;
    mockResponseBody = null;
    mockResponseHeaders = new Headers();
    mockFetchError = null;
    mockDelayMs = 0;

    globalThis.fetch = async (url: string | URL | Request, options?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : (url as any).url ?? url.toString();
      fetchCalls.push({ url: urlStr, options });

      if (mockDelayMs > 0) {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(resolve, mockDelayMs);
          if (options?.signal) {
            options.signal.addEventListener("abort", () => {
              clearTimeout(timeout);
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          }
        });
      }

      if (options?.signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }

      if (mockFetchError) {
        throw mockFetchError;
      }

      return {
        ok: mockResponseStatus >= 200 && mockResponseStatus < 300,
        status: mockResponseStatus,
        statusText: mockResponseStatus === 200 ? "OK" : "Error",
        headers: mockResponseHeaders,
        arrayBuffer: async () => {
          if (mockResponseBody instanceof Buffer) {
            return mockResponseBody.buffer;
          }
          return new ArrayBuffer(0);
        },
        json: async () => {
          return mockResponseBody || {};
        },
        text: async () => {
          return JSON.stringify(mockResponseBody || {});
        }
      } as Response;
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("should be instantiated correctly", () => {
    const service = new ElevenLabsService("fake-api-key", "fake-voice-id");
    expect(service).toBeDefined();
    expect(service.name).toBe("elevenlabs");
  });

  test("should synthesize text successfully", async () => {
    const service = new ElevenLabsService("fake-api-key", "fake-voice-id");
    const fakeAudioBuffer = Buffer.from("mock-audio-data");
    mockResponseBody = fakeAudioBuffer;
    mockResponseStatus = 200;

    const result = await service.synthesize("Hello world");
    
    expect(result).toBeDefined();
    expect(result.toString()).toBe("mock-audio-data");
    expect(fetchCalls.length).toBe(1);
    
    const call = fetchCalls[0];
    expect(call.url).toContain("v1/text-to-speech/fake-voice-id");
    expect(call.options.method).toBe("POST");
    expect(call.options.headers["xi-api-key"]).toBe("fake-api-key");
    
    const body = JSON.parse(call.options.body);
    expect(body.text).toBe("Hello world");
  });

  test("should throw an error for 401 unauthorized", async () => {
    const service = new ElevenLabsService("wrong-key");
    mockResponseStatus = 401;
    mockResponseBody = { detail: { status: "invalid_api_key", message: "Invalid API key" } };

    expect(service.synthesize("Hello world")).rejects.toThrow("ElevenLabs API error (401)");
  });

  test("should throw an error for 429 quota exceeded", async () => {
    const service = new ElevenLabsService("fake-key");
    mockResponseStatus = 429;
    mockResponseBody = { detail: { status: "quota_exceeded", message: "Quota exceeded" } };

    expect(service.synthesize("Hello world")).rejects.toThrow("ElevenLabs API error (429)");
  });

  test("should healthCheck successfully", async () => {
    const service = new ElevenLabsService("fake-key");
    mockResponseStatus = 200;
    mockResponseBody = { voices: [] };

    const status = await service.healthCheck();
    
    expect(status.up).toBe(true);
    expect(status.latency).toBeDefined();
    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0].url).toContain("v1/voices");
  });

  test("should healthCheck return down when status is not ok", async () => {
    const service = new ElevenLabsService("fake-key");
    mockResponseStatus = 500;
    mockResponseBody = { detail: { message: "Internal Server Error" } };

    const status = await service.healthCheck();
    
    expect(status.up).toBe(false);
    expect(status.message).toContain("ElevenLabs Health check failed (500)");
  });

  test("should abort synthesis after 10s timeout", async () => {
    const service = new ElevenLabsService("fake-key");
    mockDelayMs = 12000; // longer than 10s
    mockResponseStatus = 200;
    mockResponseBody = Buffer.from("audio");

    // Since we mock delay, if it times out, it should reject with abort
    const start = Date.now();
    try {
      await service.synthesize("hello");
      // If it doesn't fail, force a failure
      expect(true).toBe(false);
    } catch (err: any) {
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(11000); // Should abort around 10s
      expect(err.name).toBe("AbortError");
    }
  }, 15000);

  test("should abort healthCheck after 5s timeout", async () => {
    const service = new ElevenLabsService("fake-key");
    mockDelayMs = 7000; // longer than 5s
    mockResponseStatus = 200;
    mockResponseBody = { voices: [] };

    const status = await service.healthCheck();
    expect(status.up).toBe(false);
    expect(status.message).toContain("Timeout");
  }, 10000);
});

import { expect, test, describe, beforeAll, afterAll, beforeEach } from "bun:test";
import { runAgentLoop } from "./agentLoop.js";
import { initDatabase, closeDatabase, setupTables, getDatabase } from "./memory/database.js";
import { AIRouter } from "./router/aiRouter.js";
import { toolRegistry } from "./tools/getCurrentTime.js";
import type { AIService, ChatMessage } from "./types.js";

// Helper to create an AsyncIterable stream of tokens
function createStream(tokens: string[]): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const token of tokens) {
        yield token;
      }
    }
  };
}

// Helper to create an AsyncIterable that throws an error
function createErrorStream(): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator]() {
      yield "Beginning of stream...";
      throw new Error("Stream connection lost");
    }
  };
}

describe("runAgentLoop - Truncation and Stream Error Handling", () => {
  let originalTursoUrl: string | undefined;
  let originalTursoToken: string | undefined;

  beforeAll(async () => {
    // Isolate from production Turso cloud
    originalTursoUrl = process.env.TURSO_DATABASE_URL;
    originalTursoToken = process.env.TURSO_AUTH_TOKEN;
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;

    // Initialize an in-memory SQLite database
    const db = initDatabase(":memory:");
    await setupTables();
    
    // Clear tables of any leftover persistent data from physical :memory: file
    await db.execute("DELETE FROM messages");
    await db.execute("DELETE FROM logs");
  });

  beforeEach(async () => {
    const db = getDatabase();
    await db.execute("DELETE FROM messages");
    await db.execute("DELETE FROM logs");
  });

  afterAll(() => {
    closeDatabase();
    if (originalTursoUrl !== undefined) process.env.TURSO_DATABASE_URL = originalTursoUrl;
    if (originalTursoToken !== undefined) process.env.TURSO_AUTH_TOKEN = originalTursoToken;
  });

  test("should truncate tool output exceeding 4000 characters", async () => {
    // Register a tool that returns a huge payload
    const longPayload = "A".repeat(5000);
    toolRegistry.set("test_long_tool", {
      name: "test_long_tool",
      description: "Returns a very long string",
      execute: () => ({ success: true, data: longPayload })
    });

    let secondIterationHistory: ChatMessage[] = [];

    // Create a mock AIService
    const mockService: AIService = {
      name: "mock-ai",
      healthCheck: async () => ({ up: true }),
      chat: async (messages) => {
        // Capture the messages at each step
        if (messages.some(m => m.content.includes("Resultado de test_long_tool"))) {
          secondIterationHistory = messages;
          return createStream(["Success processed tool output"]);
        }
        return createStream(["[TOOL: test_long_tool]"]);
      }
    };

    const router = new AIRouter([mockService]);
    await router.checkAllHealth();

    const response = await runAgentLoop(1, "Run the test", router, 3);
    
    // Clean up registry
    toolRegistry.delete("test_long_tool");

    // Expect the final response to be processed
    expect(response).toContain("Success processed tool output");

    // Verify the system message containing the tool result in history was truncated
    const toolResultMessage = secondIterationHistory.find(m => m.role === "system" && m.content.includes("Resultado de test_long_tool"));
    expect(toolResultMessage).toBeDefined();
    
    const content = toolResultMessage!.content;
    expect(content.length).toBeLessThan(5000);
    expect(content).toContain("[Salida truncada por límite de contexto]");
    expect(content.endsWith("[Salida truncada por límite de contexto]")).toBe(true);
  });

  test("should handle chat stream errors gracefully and not crash", async () => {
    // Create a mock AIService that throws an error inside the stream loop
    const mockService: AIService = {
      name: "broken-ai",
      healthCheck: async () => ({ up: true }),
      chat: async () => {
        return createErrorStream();
      }
    };

    const router = new AIRouter([mockService]);
    await router.checkAllHealth();

    // Executing the loop should not throw and return a graceful message
    const response = await runAgentLoop(2, "Hello", router, 3);
    expect(response).toContain("⚠️ Hubo un error de conexión con la IA. Por favor, intenta de nuevo.");
  });

  test("should handle chat method calling errors gracefully and not crash", async () => {
    // Create a mock AIService that throws an error on chat invocation
    const mockService: AIService = {
      name: "crashing-ai",
      healthCheck: async () => ({ up: true }),
      chat: async () => {
        throw new Error("API Limit Exceeded");
      }
    };

    const router = new AIRouter([mockService]);
    await router.checkAllHealth();

    // Executing the loop should not throw and return a graceful message
    const response = await runAgentLoop(3, "Hello", router, 3);
    expect(response).toContain("⚠️ Hubo un error de conexión con la IA. Por favor, intenta de nuevo.");
  });

  test("should persist intermediate tool calls and system outputs in the database", async () => {
    toolRegistry.set("test_persist_tool", {
      name: "test_persist_tool",
      description: "A tool for persistence test",
      execute: () => ({ success: true, data: "Persisted output data" })
    });

    const mockService: AIService = {
      name: "mock-ai-persist",
      healthCheck: async () => ({ up: true }),
      chat: async (messages) => {
        if (messages.some(m => m.content.includes("Persisted output data"))) {
          return createStream(["Final response from LLM"]);
        }
        return createStream(["[TOOL: test_persist_tool]"]);
      }
    };

    const router = new AIRouter([mockService]);
    await router.checkAllHealth();

    const response = await runAgentLoop(4, "Test persistence", router, 3);
    toolRegistry.delete("test_persist_tool");

    expect(response).toContain("Final response from LLM");

    // Retrieve database messages directly using getSmartHistory
    const { getSmartHistory } = await import("./memory/memoryStore.js");
    const history = await getSmartHistory(4, 20000);

    // Verify all messages are in the history
    expect(history.length).toBe(4); // User -> Tool call (assistant) -> Tool output (system) -> Final response (assistant)
    expect(history[0].role).toBe("user");
    expect(history[0].content).toBe("Test persistence");

    expect(history[1].role).toBe("assistant");
    expect(history[1].content).toBe("[TOOL: test_persist_tool]");

    expect(history[2].role).toBe("system");
    expect(history[2].content).toContain("Resultado de test_persist_tool: Persisted output data");

    expect(history[3].role).toBe("assistant");
    expect(history[3].content).toBe("Final response from LLM");
  });

  test("should bypass tool execution on final iteration and return fallback response", async () => {
    let executed = false;
    toolRegistry.set("test_bypass_tool", {
      name: "test_bypass_tool",
      description: "Should not be executed",
      execute: () => {
        executed = true;
        return { success: true, data: "Should not run" };
      }
    });

    const mockService: AIService = {
      name: "mock-ai-bypass",
      healthCheck: async () => ({ up: true }),
      chat: async () => {
        return createStream(["[TOOL: test_bypass_tool]"]);
      }
    };

    const router = new AIRouter([mockService]);
    await router.checkAllHealth();

    const response = await runAgentLoop(5, "Test bypass", router, 1);
    toolRegistry.delete("test_bypass_tool");

    expect(executed).toBe(false);
    expect(response).toContain("Che, me quedé corto de intentos tratando de procesar eso. ¿Me lo podés preguntar de otra forma?");
  });

  test("should serialize concurrent agent loop calls for the same user", async () => {
    const executionOrder: string[] = [];

    const mockService: AIService = {
      name: "mock-ai-concurrency",
      healthCheck: async () => ({ up: true }),
      chat: async (messages) => {
        const userMsg = [...messages].reverse().find(m => m.role === 'user')?.content;
        executionOrder.push(`start-${userMsg}`);
        await new Promise(resolve => setTimeout(resolve, 50));
        executionOrder.push(`end-${userMsg}`);
        return createStream(["Done"]);
      }
    };

    const router = new AIRouter([mockService]);
    await router.checkAllHealth();

    const p1 = runAgentLoop(6, "Msg1", router, 1);
    const p2 = runAgentLoop(6, "Msg2", router, 1);

    await Promise.all([p1, p2]);

    expect(executionOrder).toEqual([
      "start-Msg1",
      "end-Msg1",
      "start-Msg2",
      "end-Msg2"
    ]);
  });
});

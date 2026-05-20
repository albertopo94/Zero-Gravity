import type { AIService, AIRouterResult, ChatMessage, ChatOptions, HealthStatus } from '../types.js';

export class AIRouter {
  private providers: AIService[];
  private currentIndex = 0;
  private statusMap: Map<string, HealthStatus> = new Map();

  constructor(providers: AIService[]) {
    if (providers.length === 0) {
      throw new Error('[AIRouter] Se necesita al menos un proveedor de IA.');
    }
    this.providers = providers;
  }

  /**
   * Ejecuta el health check de todos los proveedores en paralelo.
   */
  async checkAllHealth(): Promise<Record<string, HealthStatus>> {
    const results = await Promise.all(
      this.providers.map(async (provider) => {
        try {
          const status = await provider.healthCheck();
          this.statusMap.set(provider.name, status);
          return { name: provider.name, status };
        } catch (error) {
          const status: HealthStatus = {
            up: false,
            message: error instanceof Error ? error.message : String(error),
          };
          this.statusMap.set(provider.name, status);
          return { name: provider.name, status };
        }
      })
    );

    const report: Record<string, HealthStatus> = {};
    for (const { name, status } of results) {
      report[name] = status;
    }
    return report;
  }

  /**
   * Round-robin: rota al siguiente proveedor saludable en cada llamada.
   * Si el proveedor seleccionado falla, intenta los demás antes de rendirse.
   */
  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<AIRouterResult> {
    const healthyProviders = this.providers.filter((p) => this.statusMap.get(p.name)?.up === true);

    if (healthyProviders.length === 0) {
      throw new Error('[AIRouter] No hay proveedores de IA disponibles (todos están DOWN o no se ha verificado su estado).');
    }

    let lastError: Error | null = null;
    const total = healthyProviders.length;

    for (let attempt = 0; attempt < total; attempt++) {
      // Asegurar que el índice esté dentro del rango de proveedores saludables
      const provider = healthyProviders[this.currentIndex % total];
      this.currentIndex = (this.currentIndex + 1) % total;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      const start = performance.now();

      try {
        console.log(`[AIRouter] Usando: ${provider.name}`);
        const stream = await provider.chat(messages, { ...options, abortSignal: controller.signal });

        clearTimeout(timeoutId);
        const latency = (performance.now() - start) / 1000;
        console.log(`[AIRouter] Respuesta de ${provider.name} recibida en ${latency.toFixed(2)}s`);

        return { stream, provider: provider.name };
      } catch (error) {
        clearTimeout(timeoutId);
        lastError = error instanceof Error ? error : new Error(String(error));

        if (lastError.name === 'AbortError' || lastError.message.toLowerCase().includes('abort')) {
          console.error(`[AIRouter] Timeout de 20s alcanzado para ${provider.name}`);
        } else {
          console.error(`[AIRouter] Error con ${provider.name}: ${lastError.message}`);
        }
      }
    }

    throw new Error(
      `[AIRouter] Todos los proveedores saludables fallaron. Último error: ${lastError?.message ?? 'desconocido'}`
    );
  }

  /**
   * Lista los proveedores registrados.
   */
  getProviders(): string[] {
    return this.providers.map((p) => p.name);
  }
}

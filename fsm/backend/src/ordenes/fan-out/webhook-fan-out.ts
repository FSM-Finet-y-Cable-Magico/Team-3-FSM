import { Logger } from '@nestjs/common';
import type { FanOutCierre, PayloadCierre } from './fan-out-cierre.js';

interface Destino {
  nombre: string;
  url: string;
  apiKey?: string;
}

/**
 * Envía el payload del cierre por HTTP POST a los destinos configurados
 * (`CIERRE_WEBHOOK_G1_URL`, `CIERRE_WEBHOOK_G8_URL`). Reintenta ante 5xx / error
 * de red con backoff. Nunca lanza: un fallo se registra y G1/G8 reconcilian por
 * el GET.
 */
export class WebhookFanOut implements FanOutCierre {
  readonly nombre = 'webhook';
  private readonly logger = new Logger(WebhookFanOut.name);

  constructor(private readonly destinos: Destino[]) {}

  async notificar(payload: PayloadCierre): Promise<void> {
    await Promise.all(this.destinos.map((d) => this.enviar(d, payload)));
  }

  private async enviar(destino: Destino, payload: PayloadCierre): Promise<void> {
    const maxIntentos = 3;
    for (let intento = 1; intento <= maxIntentos; intento++) {
      try {
        const res = await fetch(destino.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(destino.apiKey ? { 'X-API-KEY': destino.apiKey } : {}),
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(8000),
        });

        if (res.ok) {
          this.logger.log(`cierre ${payload.id_ot} → ${destino.nombre}: OK`);
          return;
        }
        // 4xx = discrepancia de negocio, no se reintenta (G1 la registra como ajuste).
        if (res.status < 500) {
          this.logger.warn(
            `cierre ${payload.id_ot} → ${destino.nombre}: HTTP ${res.status}, no se reintenta`,
          );
          return;
        }
        this.logger.warn(
          `cierre ${payload.id_ot} → ${destino.nombre}: HTTP ${res.status} (intento ${intento}/${maxIntentos})`,
        );
      } catch (e) {
        this.logger.warn(
          `cierre ${payload.id_ot} → ${destino.nombre}: ${(e as Error).message} (intento ${intento}/${maxIntentos})`,
        );
      }

      if (intento < maxIntentos) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** (intento - 1)));
      }
    }
    this.logger.error(
      `cierre ${payload.id_ot} → ${destino.nombre}: agotados los reintentos. Queda para reconciliación por GET.`,
    );
  }
}

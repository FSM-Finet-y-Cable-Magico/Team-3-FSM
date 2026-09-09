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
 *
 * La URL admite el marcador `{id_ot}`, que se reemplaza por la OT de cada envío.
 * Hace falta porque G1 recibe el cierre en
 * `POST /api/integraciones/ordenes/{id_ot}/cierre`: el número va en la ruta, no
 * solo en el cuerpo. Sin esto, la variable de entorno se mandaría literal y
 * todos los cierres irían a parar a una ruta con llaves.
 *
 * Una URL sin el marcador se usa tal cual, que es como quedó G8.
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
        const res = await fetch(this.urlDe(destino, payload), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(destino.apiKey ? { 'X-API-KEY': destino.apiKey } : {}),
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(8000),
        });

        if (res.ok) {
          // Un 200 no significa que todo salio bien. G1 confirmo el 8-sept-2026
          // que responde `{ success, data }` con un `estado_proceso` que puede
          // ser PROCESADO o PROCESADO_CON_DISCREPANCIAS, y en el segundo caso
          // trae `discrepancias` con el detalle --por ejemplo, una serie que en
          // su inventario no existe. Antes se registraba como "OK" a secas y
          // esas discrepancias eran invisibles de nuestro lado.
          await this.registrarRespuesta(destino, payload, res);
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

  /**
   * Lee la respuesta de un destino y registra lo que informe.
   *
   * Es best-effort a proposito: el cierre ya esta guardado y el fan-out no lo
   * bloquea. Si el cuerpo no es el esperado --otro grupo, otra version-- se
   * registra el exito y se sigue; fallar aca convertiria un cierre correcto en
   * un error por culpa de un formato de respuesta.
   */
  /**
   * Resuelve `{id_ot}` en la URL del destino. Se codifica el valor aunque hoy
   * sea siempre un entero: la URL viene de configuración y no de nosotros.
   */
  private urlDe(destino: Destino, payload: PayloadCierre): string {
    return destino.url.replace(/\{id_ot\}/g, encodeURIComponent(String(payload.id_ot)));
  }

  private async registrarRespuesta(
    destino: Destino,
    payload: PayloadCierre,
    res: Response,
  ): Promise<void> {
    const prefijo = `cierre ${payload.id_ot} → ${destino.nombre}`;
    try {
      const cuerpo = (await res.json()) as {
        data?: {
          estado_proceso?: string;
          discrepancias?: unknown;
          duplicado?: boolean;
          srv?: string;
        };
      };
      const d = cuerpo?.data;
      if (!d) {
        this.logger.log(`${prefijo}: OK`);
        return;
      }

      // `discrepancias` llega como objeto cuando hay una y como arreglo vacio
      // cuando no hay ninguna: se normaliza antes de contar.
      const lista = Array.isArray(d.discrepancias)
        ? d.discrepancias
        : d.discrepancias
          ? [d.discrepancias]
          : [];

      if (lista.length > 0) {
        // WARN y no LOG: es lo unico de todo el fan-out que pide que alguien
        // mire. Una serie que el inventario no reconoce se corrige a mano.
        this.logger.warn(
          `${prefijo}: ${d.estado_proceso ?? 'PROCESADO_CON_DISCREPANCIAS'} · ` +
            `${lista.length} discrepancia(s): ${JSON.stringify(lista)}`,
        );
        return;
      }

      const extras = [
        d.duplicado ? 'ya estaba procesado' : null,
        d.srv ? `SRV ${d.srv}` : null,
      ].filter(Boolean);
      this.logger.log(
        `${prefijo}: ${d.estado_proceso ?? 'OK'}${extras.length ? ' · ' + extras.join(' · ') : ''}`,
      );
    } catch {
      this.logger.log(`${prefijo}: OK (respuesta no interpretable)`);
    }
  }

}

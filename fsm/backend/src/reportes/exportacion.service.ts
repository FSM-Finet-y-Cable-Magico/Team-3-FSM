import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { Reporte, ReporteComparativo } from './reportes.service.js';

export interface ArchivoExportado {
  nombre: string;
  contentType: string;
  contenido: Buffer;
}

/**
 * RF-40 / CU-46: convierte un reporte ya construido en .xlsx o PDF.
 *
 * Recibe el `Reporte` armado, no consulta nada. Es lo que hace que valga para
 * los cuatro tipos --diario, on-demand, semanal y mensual-- sin repetir codigo:
 * el CU dice "exportar CUALQUIER reporte generado", y eso solo se cumple si la
 * exportacion no sabe de donde salio.
 */
@Injectable()
export class ExportacionService {
  /**
   * `Reporte_FSM_FiNet_2026-04.xlsx`, como fija CU-46.
   *
   * El nombre de la empresa se limpia de todo lo que no sea letra o numero: va
   * en una cabecera HTTP y en el sistema de archivos del que descarga, y un
   * nombre con comillas o barras rompe las dos cosas.
   */
  nombreArchivo(r: Reporte, extension: string) {
    const empresa = (r.empresa.nombre ?? 'empresa').normalize('NFD').replace(/[^A-Za-z0-9]+/g, '');
    const periodo = r.periodo.etiqueta.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    return `Reporte_FSM_${empresa}_${periodo}.${extension}`;
  }

  async aExcel(r: Reporte): Promise<ArchivoExportado> {
    const libro = new ExcelJS.Workbook();
    libro.creator = 'FSM';
    libro.created = new Date(r.generado_en);

    const resumen = libro.addWorksheet('Resumen');
    resumen.columns = [{ width: 34 }, { width: 16 }, { width: 10 }];
    this.encabezado(resumen, r);
    resumen.addRow([]);
    resumen.addRow(['Indicador', 'Cantidad']).font = { bold: true };
    for (const [k, v] of [
      ['OT completadas', r.totales.ot_completadas],
      ['Instalaciones', r.totales.instalaciones],
      ['Reparaciones', r.totales.reparaciones],
      ['Otras', r.totales.otras],
      ['Canceladas en el período', r.totales.canceladas],
    ] as [string, number][]) {
      resumen.addRow([k, v]);
    }

    this.hojaConteo(libro, 'Fallas por categoría', ['Categoría', 'Cantidad', '%'], r.fallas_por_categoria);

    const tec = libro.addWorksheet('Por técnico');
    tec.columns = [{ width: 34 }, { width: 14 }, { width: 22 }];
    tec.addRow(['Técnico', 'Completadas', 'Tiempo promedio (h)']).font = { bold: true };
    for (const f of r.por_tecnico) {
      // "No aplica" y no 0: sin ordenes cerradas no hay promedio.
      tec.addRow([f.tecnico, f.completadas, f.tiempo_promedio_horas ?? 'No aplica']);
    }
    if (r.por_tecnico.length === 0) tec.addRow(['Sin actividad registrada en el período']);

    const mat = libro.addWorksheet('Materiales');
    mat.columns = [{ width: 34 }, { width: 14 }, { width: 34 }];
    mat.addRow(['Material', 'Cantidad', 'Técnico']).font = { bold: true };
    for (const m of r.materiales) {
      mat.addRow([m.material, m.cantidad, '']);
      for (const t of m.por_tecnico) mat.addRow(['', t.cantidad, t.tecnico]);
    }
    if (r.materiales.length === 0) mat.addRow(['Sin actividad registrada en el período']);

    if (r.instalaciones_por_plan) {
      this.hojaConteo(libro, 'Instalaciones por plan', ['Plan', 'Cantidad', '%'], r.instalaciones_por_plan);
    }

    if (r.clientes_recurrentes) {
      const rec = libro.addWorksheet('Clientes recurrentes');
      rec.columns = [{ width: 34 }, { width: 16 }, { width: 30 }];
      rec.addRow(['Cliente', 'Reparaciones', 'OT asociadas']).font = { bold: true };
      for (const c of r.clientes_recurrentes) {
        rec.addRow([c.cliente, c.reparaciones, c.ots.map((n) => `#${n}`).join(', ')]);
      }
      if (r.clientes_recurrentes.length === 0) {
        rec.addRow(['Sin actividad registrada en el período']);
      }
    }

    const contenido = Buffer.from(await libro.xlsx.writeBuffer());
    return {
      nombre: this.nombreArchivo(r, 'xlsx'),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      contenido,
    };
  }

  async aPdf(r: Reporte): Promise<ArchivoExportado> {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const trozos: Buffer[] = [];
    doc.on('data', (t: Buffer) => trozos.push(t));
    // Se espera el 'end' del stream: `doc.end()` no vacia el buffer de forma
    // sincrona, asi que devolver antes daria un PDF truncado.
    const listo = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(trozos)));
      doc.on('error', reject);
    });

    doc.fontSize(16).text(`Reporte ${r.periodo.etiqueta}`, { continued: false });
    doc.moveDown(0.2);
    doc.fontSize(10).fillColor('#555')
       .text(`${r.empresa.nombre ?? 'Empresa'} · generado el ${new Date(r.generado_en).toLocaleString('es-CL')}`);
    if (r.filtros.id_tecnico) doc.text(`Filtrado por técnico #${r.filtros.id_tecnico}`);
    doc.fillColor('#000').moveDown();

    this.tablaPdf(doc, 'Resumen', ['Indicador', 'Cantidad'], [
      ['OT completadas', String(r.totales.ot_completadas)],
      ['Instalaciones', String(r.totales.instalaciones)],
      ['Reparaciones', String(r.totales.reparaciones)],
      ['Otras', String(r.totales.otras)],
      ['Canceladas en el período', String(r.totales.canceladas)],
    ]);

    this.tablaPdf(doc, 'Fallas por categoría', ['Categoría', 'Cantidad', '%'],
      r.fallas_por_categoria.map((f) => [f.etiqueta, String(f.cantidad), `${f.pct ?? 0}%`]));

    this.tablaPdf(doc, 'Rendimiento por técnico', ['Técnico', 'Completadas', 'Promedio (h)'],
      r.por_tecnico.map((f) => [f.tecnico, String(f.completadas), f.tiempo_promedio_horas?.toString() ?? 'No aplica']));

    this.tablaPdf(doc, 'Consumo de materiales', ['Material', 'Cantidad'],
      r.materiales.map((m) => [m.material, String(m.cantidad)]));

    if (r.instalaciones_por_plan) {
      this.tablaPdf(doc, 'Instalaciones por plan', ['Plan', 'Cantidad', '%'],
        r.instalaciones_por_plan.map((p) => [p.etiqueta, String(p.cantidad), `${p.pct ?? 0}%`]));
    }

    if (r.clientes_recurrentes) {
      this.tablaPdf(doc, 'Clientes con fallas recurrentes', ['Cliente', 'Reparaciones', 'OT'],
        r.clientes_recurrentes.map((c) => [c.cliente, String(c.reparaciones), c.ots.map((n) => `#${n}`).join(' ')]));
    }

    doc.end();
    return {
      nombre: this.nombreArchivo(r, 'pdf'),
      contentType: 'application/pdf',
      contenido: await listo,
    };
  }

  /** RF-41 / CU-47: el comparativo, con una columna por empresa. */
  async comparativoAExcel(c: ReporteComparativo): Promise<ArchivoExportado> {
    const libro = new ExcelJS.Workbook();
    libro.creator = 'FSM';
    libro.created = new Date(c.generado_en);

    const h = libro.addWorksheet('Comparación');
    const empresas = c.reportes.map((r) => r.empresa.nombre ?? `Empresa ${r.empresa.id_empresa}`);
    h.columns = [{ width: 32 }, ...empresas.map(() => ({ width: 22 }))];
    h.addRow([`Comparativo ${c.periodo.etiqueta}`]).font = { bold: true, size: 14 };
    h.addRow([`Generado el ${new Date(c.generado_en).toLocaleString('es-CL')}`]);
    h.addRow([]);
    h.addRow(['Métrica', ...empresas]).font = { bold: true };
    for (const m of c.comparacion) {
      h.addRow([
        m.unidad ? `${m.metrica} (${m.unidad})` : m.metrica,
        // "No aplica" y no cero: sin OT cerradas no hay un promedio.
        ...m.valores.map((v) => (v.valor == null ? 'No aplica' : v.valor)),
      ]);
    }

    return {
      nombre: `Comparativo_FSM_${c.periodo.etiqueta.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      contenido: Buffer.from(await libro.xlsx.writeBuffer()),
    };
  }

  async comparativoAPdf(c: ReporteComparativo): Promise<ArchivoExportado> {
    const doc = new PDFDocument({ size: 'A4', margin: 48, layout: 'landscape' });
    const trozos: Buffer[] = [];
    doc.on('data', (t: Buffer) => trozos.push(t));
    const listo = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(trozos)));
      doc.on('error', reject);
    });

    const empresas = c.reportes.map((r) => r.empresa.nombre ?? `Empresa ${r.empresa.id_empresa}`);
    doc.fontSize(16).text(`Comparativo ${c.periodo.etiqueta}`);
    doc.moveDown(0.2).fontSize(10).fillColor('#555')
       .text(`Generado el ${new Date(c.generado_en).toLocaleString('es-CL')}`);
    doc.fillColor('#000').moveDown();

    this.tablaPdf(doc, 'Métricas', ['Métrica', ...empresas],
      c.comparacion.map((m) => [
        m.unidad ? `${m.metrica} (${m.unidad})` : m.metrica,
        ...m.valores.map((v) => (v.valor == null ? 'No aplica' : String(v.valor))),
      ]));

    doc.end();
    return {
      nombre: `Comparativo_FSM_${c.periodo.etiqueta.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')}.pdf`,
      contentType: 'application/pdf',
      contenido: await listo,
    };
  }

  // ---------------------------------------------------------------------------

  private encabezado(hoja: ExcelJS.Worksheet, r: Reporte) {
    hoja.addRow([`Reporte ${r.periodo.etiqueta}`]).font = { bold: true, size: 14 };
    hoja.addRow([r.empresa.nombre ?? 'Empresa']);
    hoja.addRow([`Generado el ${new Date(r.generado_en).toLocaleString('es-CL')}`]);
  }

  private hojaConteo(
    libro: ExcelJS.Workbook,
    titulo: string,
    cabeceras: string[],
    filas: { etiqueta: string; cantidad: number; pct?: number }[],
  ) {
    const h = libro.addWorksheet(titulo);
    h.columns = [{ width: 34 }, { width: 14 }, { width: 10 }];
    h.addRow(cabeceras).font = { bold: true };
    for (const f of filas) h.addRow([f.etiqueta, f.cantidad, `${f.pct ?? 0}%`]);
    if (filas.length === 0) h.addRow(['Sin actividad registrada en el período']);
  }

  private tablaPdf(doc: PDFKit.PDFDocument, titulo: string, cabeceras: string[], filas: string[][]) {
    // Salto de pagina si no entra ni el titulo con un par de filas: partir una
    // tabla dejando el encabezado solo al pie se lee muy mal.
    if (doc.y > doc.page.height - 140) doc.addPage();

    doc.moveDown(0.6).fontSize(12).fillColor('#1F3864').text(titulo);
    doc.moveDown(0.3).fontSize(9).fillColor('#000');

    if (filas.length === 0) {
      doc.fillColor('#666').text('Sin actividad registrada en el período').fillColor('#000');
      return;
    }

    const anchos = this.anchos(cabeceras.length, doc.page.width - 96);
    this.filaPdf(doc, cabeceras, anchos, true);
    for (const f of filas) {
      if (doc.y > doc.page.height - 70) {
        doc.addPage();
        this.filaPdf(doc, cabeceras, anchos, true);
      }
      this.filaPdf(doc, f, anchos, false);
    }
  }

  /** La primera columna se lleva el espacio sobrante: es la que trae los nombres. */
  private anchos(columnas: number, total: number) {
    if (columnas === 1) return [total];
    const resto = 80;
    return [total - resto * (columnas - 1), ...Array(columnas - 1).fill(resto)];
  }

  private filaPdf(doc: PDFKit.PDFDocument, celdas: string[], anchos: number[], cabecera: boolean) {
    const y = doc.y;
    let x = 48;
    doc.font(cabecera ? 'Helvetica-Bold' : 'Helvetica');
    celdas.forEach((c, i) => {
      doc.text(c, x, y, { width: anchos[i] - 6, ellipsis: true, lineBreak: false });
      x += anchos[i];
    });
    doc.y = y + 14;
  }
}

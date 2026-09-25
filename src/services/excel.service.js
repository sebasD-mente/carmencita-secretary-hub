import ExcelJS from 'exceljs';
import { GenerateExcelActionSchema } from '../validators/actions.schema.js';

export class ExcelService {
  /**
   * Genera un archivo Excel (.xlsx) con formato ejecutivo elegante y limpio.
   * @param {Object} options
   * @param {string} options.title - Título principal del reporte
   * @param {string} [options.sheetName] - Nombre de la pestaña
   * @param {Array<{header: string, key: string, width?: number}>} options.columns - Definición de columnas
   * @param {Array<Object>} options.rows - Filas con los datos
   * @param {string} [options.summary] - Breve nota o resumen opcional al pie
   * @returns {Promise<{ buffer: Buffer, fileName: string, mimeType: string }>}
   */
  async generateExcelFile(options) {
    const validated = GenerateExcelActionSchema.parse({
      action: 'GENERATE_EXCEL',
      ...options,
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Carmencita Secretary Hub (Deko Labs)';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet(validated.sheetName || 'Reporte', {
      views: [{ showGridLines: true }],
    });

    // 1. Título Ejecutivo Principal
    sheet.mergeCells(1, 1, 1, validated.columns.length);
    const titleCell = sheet.getCell(1, 1);
    titleCell.value = `📊 ${validated.title.toUpperCase()}`;
    titleCell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F4E78' }, // Azul marino ejecutivo
    };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(1).height = 32;

    // Fila vacía de respiro
    sheet.getRow(2).height = 10;

    // 2. Encabezados de Columnas (Fila 3)
    const headerRow = sheet.getRow(3);
    headerRow.height = 24;

    validated.columns.forEach((col, idx) => {
      const cell = headerRow.getCell(idx + 1);
      cell.value = col.header;
      cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF2F5597' }, // Azul pizarra
      };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD9D9D9' } },
        bottom: { style: 'medium', color: { argb: 'FFFFFFFF' } },
        left: { style: 'thin', color: { argb: 'FFD9D9D9' } },
        right: { style: 'thin', color: { argb: 'FFD9D9D9' } },
      };
    });

    // 3. Inserción de Datos (Fila 4 en adelante)
    validated.rows.forEach((row, rowIndex) => {
      const dataRow = sheet.getRow(rowIndex + 4);
      dataRow.height = 20;
      const isEven = rowIndex % 2 === 0;

      validated.columns.forEach((col, colIndex) => {
        const cell = dataRow.getCell(colIndex + 1);
        const val = row[col.key] !== undefined ? row[col.key] : '';
        if (typeof val === 'string' && val.startsWith('=')) {
          cell.value = { formula: val.slice(1) };
        } else {
          cell.value = val;
        }
        cell.font = { name: 'Calibri', size: 10 };
        cell.alignment = {
          vertical: 'middle',
          horizontal: typeof val === 'number' ? 'right' : 'left',
        };

        // Formato para números / montos si aplica
        if (typeof val === 'number') {
          cell.numFmt = Number.isInteger(val) ? '#,##0' : '#,##0.00';
        }

        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: isEven ? 'FFFFFFFF' : 'FFF2F2F2' }, // Zebra striping
        };

        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE0E0E0' } },
          bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
          left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
          right: { style: 'thin', color: { argb: 'FFE0E0E0' } },
        };
      });
    });

    // 4. Resumen / Metadatos al pie si existen
    if (validated.summary) {
      const footerRowNum = validated.rows.length + 5;
      sheet.mergeCells(footerRowNum, 1, footerRowNum, validated.columns.length);
      const footerCell = sheet.getCell(footerRowNum, 1);
      footerCell.value = `Nota: ${validated.summary} (Generado por Carmencita Hub - ${new Date().toLocaleDateString('es-GT')})`;
      footerCell.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF595959' } };
      sheet.getRow(footerRowNum).height = 18;
    }

    // 5. Ajuste Dinámico de Ancho de Columnas
    validated.columns.forEach((col, colIdx) => {
      let maxLen = col.header.length;
      validated.rows.forEach((r) => {
        const str = String(r[col.key] ?? '');
        if (str.length > maxLen) maxLen = str.length;
      });
      const targetWidth = col.width || Math.max(maxLen + 4, 12);
      sheet.getColumn(colIdx + 1).width = Math.min(targetWidth, 50);
    });

    const uint8Array = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.from(uint8Array);

    const safeTitle = validated.title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9_-]/g, '_')
      .slice(0, 35);
    const fileName = `${new Date().toISOString().slice(0, 10)}_${safeTitle}.xlsx`;

    return {
      buffer,
      fileName,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }
}

export const excelService = new ExcelService();
export const generateExcelFile = (options) => excelService.generateExcelFile(options);

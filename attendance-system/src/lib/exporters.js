const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

async function sendXlsx(res, { filename, sheet, columns, rows }) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  ws.columns = columns.map((c) => ({ header: c.label, key: c.key, width: c.xw || 14 }));
  rows.forEach((r) => ws.addRow(r));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F1B2D' } };
  head.height = 22;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}

function sendPdf(res, { filename, title, subtitle, columns, rows }) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
  doc.pipe(res);

  const x0 = 36;
  const usable = doc.page.width - 72;
  const total = columns.reduce((a, c) => a + c.w, 0);
  const widths = columns.map((c) => (c.w / total) * usable);

  doc.font('Helvetica-Bold').fontSize(16).fillColor('#0f1b2d').text(title, x0, 36);
  doc.font('Helvetica').fontSize(9).fillColor('#5b6573').text(subtitle, x0, doc.y + 2);
  let y = doc.y + 14;

  const header = () => {
    doc.rect(x0, y, usable, 20).fill('#0f1b2d');
    let x = x0;
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8.5);
    columns.forEach((c, i) => { doc.text(c.label, x + 4, y + 6, { width: widths[i] - 8, lineBreak: false }); x += widths[i]; });
    y += 20;
  };
  header();

  rows.forEach((r, ri) => {
    if (y > doc.page.height - 60) { doc.addPage(); y = 36; header(); }
    if (ri % 2) doc.rect(x0, y, usable, 18).fill('#f1f3f6');
    let x = x0;
    doc.fillColor('#1a1a1a').font('Helvetica').fontSize(8.5);
    columns.forEach((c, i) => { doc.text(String(r[c.key] ?? ''), x + 4, y + 5, { width: widths[i] - 8, lineBreak: false, ellipsis: true }); x += widths[i]; });
    y += 18;
  });
  if (!rows.length) doc.fillColor('#5b6573').fontSize(10).text('No records for the selected filters.', x0, y + 12);
  doc.end();
}

module.exports = { sendXlsx, sendPdf };

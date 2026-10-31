// Builds the Office and Markdown templates from the templates.* texts of
// en.json and es.json (Step 06c). Run: npm run templates. Development only.
//
// The generated files live in templates/builtin/<lang>/ and templates/blank/
// and are committed. Run this again whenever a templates.* text changes.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import ExcelJS from "exceljs";
import pptxgen from "pptxgenjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const LANGS = ["en", "es"];

function templatesOf(lang) {
  const file = join(root, "src", "i18n", "locales", `${lang}.json`);
  return JSON.parse(readFileSync(file, "utf8")).templates;
}

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  console.log(relative(root, path).replace(/\\/g, "/"));
}

function paragraph(text, options = {}) {
  return new Paragraph({ children: [new TextRun({ text, ...options })] });
}

function blankParagraph() {
  return new Paragraph({});
}

function section(children) {
  return { children };
}

function letterDocument(t) {
  const letter = t.letter;
  return new Document({
    creator: "Adperastra",
    title: letter.name,
    sections: [
      section([
        paragraph(letter.yourName, { bold: true }),
        paragraph(letter.yourAddress),
        paragraph(letter.date),
        blankParagraph(),
        paragraph(letter.recipientName),
        paragraph(letter.recipientAddress),
        blankParagraph(),
        paragraph(letter.greeting),
        paragraph(letter.body),
        blankParagraph(),
        paragraph(letter.closing),
        paragraph(letter.yourName),
      ]),
    ],
  });
}

function reportDocument(t) {
  const report = t.report;
  const children = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(report.title)] }),
    paragraph(report.byline),
  ];
  for (const key of ["summary", "introduction", "findings", "conclusions"]) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(report[key])] }));
    children.push(paragraph(report.placeholder));
  }
  return new Document({ creator: "Adperastra", title: report.name, sections: [section(children)] });
}

function budgetWorkbook(t) {
  const budget = t.budget;
  const book = new ExcelJS.Workbook();
  book.creator = "Adperastra";
  const sheet = book.addWorksheet(budget.sheet);
  [24, 14, 14, 14].forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  const headers = [budget.category, budget.planned, budget.actual, budget.difference];
  headers.forEach((text, index) => {
    const cell = sheet.getCell(1, index + 1);
    cell.value = text;
    cell.font = { bold: true };
  });
  const categories = ["housing", "food", "transport", "utilities", "other"];
  categories.forEach((key, index) => {
    const row = index + 2;
    sheet.getCell(row, 1).value = budget[key];
    sheet.getCell(row, 2).value = 0;
    sheet.getCell(row, 3).value = 0;
    sheet.getCell(row, 4).value = { formula: `B${row}-C${row}` };
  });
  const total = categories.length + 2;
  sheet.getCell(total, 1).value = budget.total;
  sheet.getCell(total, 2).value = { formula: "SUM(B2:B6)" };
  sheet.getCell(total, 3).value = { formula: "SUM(C2:C6)" };
  sheet.getCell(total, 4).value = { formula: "SUM(D2:D6)" };
  for (let column = 1; column <= 4; column += 1) {
    sheet.getCell(total, column).font = { bold: true };
  }
  for (let row = 2; row <= total; row += 1) {
    for (let column = 2; column <= 4; column += 1) {
      sheet.getCell(row, column).numFmt = "#,##0.00";
    }
  }
  return book;
}

function invoiceWorkbook(t) {
  const invoice = t.invoice;
  const book = new ExcelJS.Workbook();
  book.creator = "Adperastra";
  const sheet = book.addWorksheet(invoice.sheet);
  [32, 12, 14, 14].forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  const title = sheet.getCell("A1");
  title.value = invoice.title;
  title.font = { bold: true, size: 16 };
  sheet.getCell("A3").value = invoice.number;
  sheet.getCell("A4").value = invoice.date;
  sheet.getCell("A5").value = invoice.billTo;
  // B3 to B5 stay empty: the user fills them in.
  const headers = [invoice.description2, invoice.quantity, invoice.unitPrice, invoice.amount];
  headers.forEach((text, index) => {
    const cell = sheet.getCell(7, index + 1);
    cell.value = text;
    cell.font = { bold: true };
  });
  for (let row = 8; row <= 12; row += 1) {
    sheet.getCell(row, 4).value = { formula: `B${row}*C${row}` };
  }
  sheet.getCell("C14").value = invoice.subtotal;
  sheet.getCell("D14").value = { formula: "SUM(D8:D12)" };
  sheet.getCell("C15").value = invoice.tax;
  sheet.getCell("D15").value = 0;
  sheet.getCell("C16").value = invoice.total;
  sheet.getCell("D16").value = { formula: "D14+D15" };
  sheet.getCell("D16").font = { bold: true };
  for (let row = 8; row <= 16; row += 1) {
    for (let column = 3; column <= 4; column += 1) {
      sheet.getCell(row, column).numFmt = "#,##0.00";
    }
  }
  return book;
}

function meetingNotes(t) {
  const meeting = t.meeting;
  const lines = [
    `# ${meeting.title}`,
    "",
    `**${meeting.date}:** `,
    `**${meeting.attendees}:** `,
    "",
    `## ${meeting.agenda}`,
    "",
    "1. ",
    "",
    `## ${meeting.notes}`,
    "",
    "",
    `## ${meeting.actions}`,
    "",
    `- [ ] ${meeting.actionItem}`,
  ];
  return `${lines.join("\n")}\n`;
}

function presentation(t) {
  const deck = t.presentation;
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Adperastra";
  pptx.title = deck.name;
  const first = pptx.addSlide();
  first.addText(deck.title, { x: 0.6, y: 2.4, w: 12, h: 1.2, fontSize: 40, bold: true });
  first.addText(deck.byline, { x: 0.6, y: 3.7, w: 12, h: 0.6, fontSize: 20 });
  const second = pptx.addSlide();
  second.addText(deck.agenda, { x: 0.6, y: 0.5, w: 12, h: 0.9, fontSize: 32, bold: true });
  second.addText(
    [deck.topic1, deck.topic2, deck.topic3].map((text) => ({ text, options: { bullet: true } })),
    { x: 0.9, y: 1.6, w: 11, h: 3, fontSize: 24 },
  );
  const third = pptx.addSlide();
  third.addText(deck.thanks, { x: 0.6, y: 2.6, w: 12, h: 1.2, fontSize: 40, bold: true });
  third.addText(deck.questions, { x: 0.6, y: 3.9, w: 12, h: 0.6, fontSize: 24 });
  return pptx;
}

async function writeBuiltin(lang, t) {
  const dir = join(root, "templates", "builtin", lang);
  write(join(dir, "letter.docx"), await Packer.toBuffer(letterDocument(t)));
  write(join(dir, "report.docx"), await Packer.toBuffer(reportDocument(t)));
  write(join(dir, "budget.xlsx"), Buffer.from(await budgetWorkbook(t).xlsx.writeBuffer()));
  write(join(dir, "invoice.xlsx"), Buffer.from(await invoiceWorkbook(t).xlsx.writeBuffer()));
  write(join(dir, "meeting-notes.md"), meetingNotes(t));
  const deck = await presentation(t).write({ outputType: "nodebuffer" });
  write(join(dir, "presentation.pptx"), Buffer.from(deck));
}

async function writeBlank() {
  const dir = join(root, "templates", "blank");
  const document = new Document({ sections: [section([blankParagraph()])] });
  write(join(dir, "blank.docx"), await Packer.toBuffer(document));
  const book = new ExcelJS.Workbook();
  book.addWorksheet("Sheet1");
  write(join(dir, "blank.xlsx"), Buffer.from(await book.xlsx.writeBuffer()));
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";
  pptx.addSlide();
  const deck = await pptx.write({ outputType: "nodebuffer" });
  write(join(dir, "blank.pptx"), Buffer.from(deck));
}

for (const lang of LANGS) {
  await writeBuiltin(lang, templatesOf(lang));
  // The pseudo-locale uses the English files.
}
await writeBlank();

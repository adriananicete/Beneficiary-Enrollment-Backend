import PDFDocument from "pdfkit";
import { fileURLToPath } from "url";

// The Certificate of Coverage — the "Confirmation of Insurance Cover" page the
// employee receives with their credentials.
//
// This file only draws. It takes strings that are already formatted and knows
// nothing about the database, so the layout can be tested without a pool and
// the formatting (amounts, the date, the address) can be tested without a PDF.
// certificateService.js does the reading and the shaping.
//
// Every coordinate below was taken from md/Certificate-of-Coverage-74.pdf, the
// format the business asked for, by reading its content stream rather than by
// measuring a screenshot. That file was produced by PDFKit in Arial Narrow; this
// one uses Liberation Sans Narrow, which is metric-compatible — the same advance
// widths, so every line breaks where the original breaks.
//
// Arial Narrow was not used because it is a licensed Microsoft face and the TTF
// would have to be committed. Liberation Sans Narrow is GPLv2 with an explicit
// exception for documents that embed it (assets/fonts/, licence alongside), and
// 1.07.x is the last line that ships the Narrow cut — 2.x dropped it.

const font = (file) =>
  fileURLToPath(new URL(`../../assets/fonts/${file}`, import.meta.url));

const FONTS = {
  regular: font("LiberationSansNarrow-Regular.ttf"),
  bold: font("LiberationSansNarrow-Bold.ttf"),
  italic: font("LiberationSansNarrow-Italic.ttf"),
  boldItalic: font("LiberationSansNarrow-BoldItalic.ttf"),
};

const LEFT = 48;
const RIGHT = 564;
const WIDTH = RIGHT - LEFT;

// The two-column label/value table. Rows are 18 high except the address, which
// is given room for a second line whether or not it needs one.
const INFO_DIVIDER = 198;
const INFO_TEXT_INSET = 6;
const INFO_VALUE_X = 206;
const INFO_MIN_ROW = 18;
const INFO_ADDRESS_ROW = 26;

const COVERAGE_DIVIDER = 378;
const COVERAGE_AMOUNT_X = 386;
const COVERAGE_ROW = 16;

// Dependents: the name and relationship columns are fixed, and the amount
// columns share whatever is left, one per benefit that carries an amount.
const DEPENDENT_COLUMNS = [LEFT, 208, 283];
const DEPENDENT_ROW = 15;

const HEADER_ROW = 18;
const TABLE_GAP = 12;

// The signatory block is centred on 437.5, half a point left of the right
// column's middle. Odd, but it is what the example measures.
const SIGNATORY_LEFT = 312;
const SIGNATORY_RIGHT = 563;
const SIGNATORY_WIDTH = SIGNATORY_RIGHT - SIGNATORY_LEFT;

// 235, not the 252 the page would suggest. Every line of the example's legal
// text breaks where it does only for a width between 234.65 and 235.28 — the
// longest line that fits and the shortest that overflows — so this is measured
// rather than chosen. PDFKit counts the trailing space of a line's last word
// when deciding whether it fits, which is why the range sits a space-width
// above the lines' printed length.
const COLUMN_WIDTH = 235;
const RIGHT_COLUMN = 312;
const LEGAL_SIZE = 7.3;
const NOTICE_SIZE = 7;

// The signatory's name and title are printed as text today. The image slot
// above them is filled only when certificateService hands over a signature —
// see CERTIFICATE_SIGNATURE_PATH in env.js.
export const SIGNATORY = {
  name: "JOSEPH AUGUSTIN L. TANGCO",
  title: "President & CEO",
};

// The legal copy, verbatim from the approved example — including "inquiries or
// complains", and the missing full stop after "Policyholder". It is the
// insurer's wording and is not ours to correct in passing.
const INSURER = "Philippine Life Financial Assurance Corporation";

const LEFT_COLUMN_TEXT = [
  {
    heading: "INSURANCE BENEFIT.",
    body: "The Insurer shall pay the benefits as determined in accordance with the provisions of the Policy immediately upon the receipt and approval of due proof of loss.",
    gapAfter: 4,
  },
  {
    heading: "BENEFICIARY.",
    body: "An Insured shall have the right to designate anybody, not disqualified by law, as his beneficiary or beneficiaries, and may at anytime, designate new beneficiary or beneficiaries by filing through the Policyholder a properly completed written request on a form satisfactory to the Insurer. Such change shall take effect only when recorded in writing by the Insurer at its Home Office but without prejudice to the Insurer on any payment made before receipt of such notice.",
    gapAfter: 4,
  },
  {
    body: "The indemnity for the loss of life of an Insured shall be payable to his designated beneficiary or beneficiaries, if surviving; or if there be no beneficiaries designated or surviving at the death of the Insured, to the surviving class of the following classes of successive preference beneficiaries:",
    indent: 12,
    gapAfter: 4,
  },
  { body: "the Insured's:", offset: 14, gapAfter: 2 },
  { body: "1. widow or widower", offset: 24, gapAfter: 2 },
  { body: "2. surviving children born to or legally adopted by the member", offset: 24 },
];

const RIGHT_COLUMN_TEXT = [
  { body: "3. surviving parents", offset: 24, gapAfter: 2 },
  { body: "4. surviving brothers and sisters", offset: 24, gapAfter: 2 },
  { body: "5. executors and administrators", offset: 24, gapAfter: 8 },
  {
    body: "If there be two or more beneficiaries, they shall share equally on the proceeds unless otherwise specified by the Insured. All other indemnities under the Policy shall be payable to the Insured.",
    indent: 12,
    gapAfter: 4,
  },
  {
    heading: "NOTICE OF CLAIM.",
    body: "Written notice of claim must be given to the Insurer within thirty (30) days after the occurrence or commencement of any loss covered by the Policy or as soon thereafter as is reasonably possible. Failure to comply within the time provided shall not invalidate nor reduce the claim if it is given as soon as was reasonably possible.",
    gapAfter: 4,
  },
  {
    heading: "AVAILABILITY OF THE POLICY.",
    body: "The Policy shall be kept in the main office and in the custody of an officer of the Policyholder. It will be available to the Insureds for their inspection during regular business hours of the Policyholder",
  },
];

const NOTICE_LABEL = "IMPORTANT NOTICE. ";
const NOTICE_TEXT =
  "The Insurance Commission, with offices in Manila, Cebu and Davao, is the government office in charge of the enforcement of all laws related to insurance and has supervision over insurance providers and intermediaries. It is ready at all times to assist the general public in matters pertaining to insurance. For any inquiries or complains, please contact the Public Assistance and Mediation Division (PAMD) of the Insurance Commission at 1071 United Nations Ave., Ermita, Manila with telephone numbers +632-5238461 to 70 and with email address pubassist@insurance.gov.ph. The official website of the Insurance Commission is www.insurance.gov.ph";

// Form identifiers printed at the foot of the page.
const FORM_CODE = "NBCOCPFC588P00120180702";
const FORM_VERSION = "GTLP2012v01";

const box = (doc, x, y, width, height) =>
  doc.lineWidth(1).rect(x, y, width, height).stroke();

const line = (doc, x1, y1, x2, y2) =>
  doc.moveTo(x1, y1).lineTo(x2, y2).stroke();

const centered = (doc, text, left, right, y) =>
  doc.text(text, left, y, { width: right - left, align: "center" });

const drawHeader = (doc, { policyNo, companyName, groupPolicyNo }) => {
  doc.fillColor("black").font("regular").fontSize(10);
  doc.text(`No.   ${policyNo}`, LEFT, 40, { width: WIDTH, align: "right" });

  doc.font("bold").fontSize(13);
  centered(doc, "CONFIRMATION OF INSURANCE COVER", LEFT, RIGHT, 60);

  // Indented on the left only: x 68, running to the table's right edge.
  doc.font("bold").fontSize(8.5).text(`${INSURER} `, 68, 84, {
    width: RIGHT - 68,
    align: "justify",
    continued: true,
  });

  doc
    .font("italic")
    .text(
      `(herein called the Insurer), hereby confirms that the Insured named below is accepted for coverage under ${companyName} with Group Policy No. ${groupPolicyNo} (herein referred to as the Policy). The details of the insurance coverage are as specified below:`,
      { align: "justify" },
    );

  return doc.y + 6;
};

const drawInfoTable = (doc, top, data) => {
  const rows = [
    ["Principal Insured", data.insuredName, INFO_MIN_ROW],
    ["Address", data.address, INFO_ADDRESS_ROW],
    ["Period of Coverage", data.coverageDate, INFO_MIN_ROW],
    ["Premium", data.premium, INFO_MIN_ROW],
  ];

  const valueWidth = RIGHT - INFO_VALUE_X - INFO_TEXT_INSET;
  let y = top;

  for (const [label, value, minHeight] of rows) {
    doc.font("italic").fontSize(8);
    const height = Math.max(minHeight, doc.heightOfString(value, { width: valueWidth }) + 8);

    box(doc, LEFT, y, WIDTH, height);
    line(doc, INFO_DIVIDER, y, INFO_DIVIDER, y + height);

    doc.font("boldItalic").text(label, LEFT + INFO_TEXT_INSET, y + 4, {
      width: INFO_DIVIDER - LEFT - INFO_TEXT_INSET * 2,
    });
    doc.font("italic").text(value, INFO_VALUE_X, y + 4, { width: valueWidth });

    y += height;
  }

  return y;
};

const drawCoverageTable = (doc, top, coverages) => {
  const bottom = top + HEADER_ROW + COVERAGE_ROW * coverages.length;

  box(doc, LEFT, top, WIDTH, bottom - top);
  line(doc, LEFT, top + HEADER_ROW, RIGHT, top + HEADER_ROW);
  line(doc, COVERAGE_DIVIDER, top, COVERAGE_DIVIDER, bottom);

  doc.font("boldItalic").fontSize(8);
  centered(doc, "Type of Coverage", LEFT, COVERAGE_DIVIDER, top + 5);
  centered(doc, "Amount of Insurance", COVERAGE_DIVIDER, RIGHT, top + 5);

  doc.font("italic");
  coverages.forEach(({ label, amount }, index) => {
    const y = top + HEADER_ROW + COVERAGE_ROW * index + 4;

    centered(doc, label, LEFT, COVERAGE_DIVIDER, y);
    doc.text(amount, COVERAGE_AMOUNT_X, y, { width: RIGHT - COVERAGE_AMOUNT_X - 8 });
  });

  return bottom;
};

const dependentEdges = (amountColumns) => {
  const first = DEPENDENT_COLUMNS[DEPENDENT_COLUMNS.length - 1];
  const share = (RIGHT - first) / Math.max(amountColumns, 1);

  const edges = [...DEPENDENT_COLUMNS];
  for (let i = 1; i < amountColumns; i++) edges.push(first + share * i);
  edges.push(RIGHT);

  return edges;
};

// The amounts sit two points left of their column's centre in the example,
// while the name and relationship are centred exactly. Reproduced as a cell
// four points narrower on the right, amount columns only.
const cellWidth = (edges, i) =>
  edges[i + 1] - edges[i] - (i >= DEPENDENT_COLUMNS.length - 1 ? 4 : 0);

const drawDependentsTable = (doc, top, { dependentColumns, dependents }) => {
  const headers = ["Dependents", "Relationship", ...dependentColumns];
  const edges = dependentEdges(dependentColumns.length);

  doc.font("italic").fontSize(8);
  const oneLine = doc.currentLineHeight(true);

  // A row grows only if a cell wraps, and then by exactly the extra lines. At
  // 8pt the name column takes about forty characters, so an ordinary name
  // keeps the example's 15.
  const rowHeights = dependents.map((dependent) => {
    const cells = [dependent.name, dependent.relationship, ...dependent.amounts];
    const tallest = Math.max(
      ...cells.map((cell, i) => doc.heightOfString(cell, { width: cellWidth(edges, i) })),
    );
    return DEPENDENT_ROW + Math.max(0, tallest - oneLine);
  });

  const bottom = top + HEADER_ROW + rowHeights.reduce((sum, h) => sum + h, 0);

  box(doc, LEFT, top, WIDTH, bottom - top);
  line(doc, LEFT, top + HEADER_ROW, RIGHT, top + HEADER_ROW);
  for (const x of edges.slice(1, -1)) line(doc, x, top, x, bottom);

  doc.font("boldItalic");
  headers.forEach((header, i) => centered(doc, header, edges[i], edges[i + 1], top + 5));

  doc.font("italic");
  let y = top + HEADER_ROW;
  dependents.forEach((dependent, row) => {
    const cells = [dependent.name, dependent.relationship, ...dependent.amounts];
    cells.forEach((cell, i) => centered(doc, cell, edges[i], edges[i] + cellWidth(edges, i), y + 3));
    y += rowHeights[row];
  });

  return bottom;
};

// The space between the dependents table and the signatory's name is where the
// signature goes. Without one the name sits exactly where the example has it.
const drawSignatory = (doc, tableBottom, signatureImage) => {
  const nameTop = tableBottom + 46;

  if (signatureImage) {
    const slotWidth = 160;
    const slotHeight = 36;

    doc.image(signatureImage, SIGNATORY_LEFT + (SIGNATORY_WIDTH - slotWidth) / 2, nameTop - slotHeight - 2, {
      fit: [slotWidth, slotHeight],
      align: "center",
      valign: "bottom",
    });
  }

  doc.fillColor("black").font("bold").fontSize(9.5);
  centered(doc, SIGNATORY.name, SIGNATORY_LEFT, SIGNATORY_RIGHT, nameTop);

  doc.font("italic").fontSize(8.5);
  centered(doc, SIGNATORY.title, SIGNATORY_LEFT, SIGNATORY_RIGHT, nameTop + 12);

  return nameTop + 26;
};

// One column of the legal text. Paragraphs are placed one under the other with
// the example's own spacing, rather than flowed with PDFKit's `columns` option,
// because the example breaks between the columns at a fixed point — after the
// second successive beneficiary — and uses indents a flowed column cannot.
const drawColumn = (doc, x, top, paragraphs) => {
  let y = top;

  for (const { heading, body, indent = 0, offset = 0, gapAfter = 0 } of paragraphs) {
    const options = { width: COLUMN_WIDTH - offset, align: "justify", indent };

    doc.fontSize(LEGAL_SIZE);

    if (heading) {
      doc.font("boldItalic").text(`${heading} `, x + offset, y, { ...options, continued: true });
      doc.font("italic").text(body, options);
    } else {
      doc.font("italic").text(body, x + offset, y, options);
    }

    y = doc.y + gapAfter;
  }

  return y;
};

const drawNotice = (doc, top) => {
  line(doc.lineWidth(0.75), LEFT, top, RIGHT, top);

  doc.font("italic").fontSize(NOTICE_SIZE);
  const labelWidth = doc.widthOfString(NOTICE_LABEL);
  const labelHeight = doc.currentLineHeight(true);

  doc.rect(LEFT - 2, top + 4, labelWidth + 4, labelHeight + 4).fill("black");

  doc.fillColor("white").text(NOTICE_LABEL, LEFT, top + 6, {
    width: WIDTH,
    align: "justify",
    continued: true,
  });
  doc.fillColor("black").text(NOTICE_TEXT, { align: "justify" });

  return doc.y;
};

const drawFooter = (doc, top) => {
  doc.font("regular").fontSize(NOTICE_SIZE).text(FORM_CODE, LEFT, top);

  doc.lineWidth(0.75).rect(494, top - 3, 70, 16).stroke();
  centered(doc, FORM_VERSION, 494, RIGHT, top);
};

// Resolves to the finished PDF as a Buffer — the shape the Graph attachment
// wants, base64-encoded by the sender.
//
// `data` is fully formatted by certificateService.buildCertificateData:
//   policyNo, groupPolicyNo, companyName, insuredName, address, coverageDate,
//   premium, coverages [{ label, amount }], dependentColumns [header],
//   dependents [{ name, relationship, amounts [] }], signatureImage (Buffer|null)
export const renderCertificate = (data) =>
  new Promise((resolve, reject) => {
    // The bottom margin is small on purpose. PDFKit starts a new page when text
    // runs past it, and ten beneficiaries with a two-line address still end
    // above 772 — the certificate is one page, and a second one holding the
    // tail of the legal text would be worse than a tight margin.
    const doc = new PDFDocument({
      size: "LETTER",
      margins: { top: 40, bottom: 20, left: LEFT, right: LEFT },
      info: { Title: "Confirmation of Insurance Cover" },
    });

    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      for (const [name, path] of Object.entries(FONTS)) doc.registerFont(name, path);

      const infoTop = drawHeader(doc, data);
      const coverageTop = drawInfoTable(doc, infoTop, data);
      const dependentsTop = drawCoverageTable(doc, coverageTop, data.coverages) + TABLE_GAP;
      const tableBottom = drawDependentsTable(doc, dependentsTop, data);
      const legalTop = drawSignatory(doc, tableBottom, data.signatureImage);

      const leftBottom = drawColumn(doc, LEFT, legalTop, LEFT_COLUMN_TEXT);
      const rightBottom = drawColumn(doc, RIGHT_COLUMN, legalTop, RIGHT_COLUMN_TEXT);

      const noticeBottom = drawNotice(doc, Math.max(leftBottom, rightBottom) + 10);
      drawFooter(doc, noticeBottom + 6);

      doc.end();
    } catch (error) {
      reject(error);
    }
  });

export default { renderCertificate };

import zlib from "zlib";

// Reads a one-page PDFKit document back into the things it draws: every text
// run with its position, face and size, and every rectangle and line.
//
// Text in a PDFKit file is not searchable as it stands. Fonts are embedded as
// Identity-H, so a run is a string of glyph ids, and each font's ToUnicode map
// is what turns those back into characters. That is all this does — enough to
// assert what a certificate says and where, with no dependency added.
//
// Positions are in points from the top-left corner. A text run's `y` is its
// baseline. Inside a run, `|` marks a break PDFKit made for kerning or for
// justified word spacing, so the same line of text reads identically whenever
// it is laid out identically.

const round = (value) => Math.round(value * 100) / 100;

const objectsOf = (text) => {
  const objects = new Map();
  for (const match of text.matchAll(/(\d+) 0 obj\s*([\s\S]*?)endobj/g))
    objects.set(Number(match[1]), { start: match.index, body: match[2] });
  return objects;
};

const streamOf = (buffer, text, objects, id) => {
  const object = objects.get(id);
  const marker = text.indexOf("stream", object.start);

  let start = marker + "stream".length;
  if (text[start] === "\r") start++;
  if (text[start] === "\n") start++;

  const dictionary = object.body.slice(0, object.body.indexOf("stream"));
  const length = Number(dictionary.match(/\/Length (\d+)/)[1]);
  const raw = buffer.subarray(start, start + length);

  return (/FlateDecode/.test(dictionary) ? zlib.inflateSync(raw) : raw).toString("latin1");
};

const hexToString = (hex) =>
  String.fromCharCode(...hex.match(/.{4}/g).map((code) => parseInt(code, 16)));

const unicodeMapOf = (cmap) => {
  const map = {};

  for (const [, glyph, unicode] of cmap.matchAll(/<([0-9a-f]{4})>\s*<([0-9a-f]+)>/gi))
    map[glyph.toLowerCase()] = hexToString(unicode);

  for (const [, low, high, list] of cmap.matchAll(/<([0-9a-f]{4})>\s*<([0-9a-f]{4})>\s*\[([^\]]*)\]/gi)) {
    const values = [...list.matchAll(/<([0-9a-f]+)>/gi)].map((m) => hexToString(m[1]));
    for (let code = parseInt(low, 16), i = 0; code <= parseInt(high, 16); code++, i++)
      map[code.toString(16).padStart(4, "0")] = values[i];
  }

  return map;
};

// "LiberationSansNarrow-BoldItalic" and "ArialNarrow-BoldItalic" both read as
// "BoldItalic", so a document drawn in either face can be compared.
const faceOf = (baseFont) => baseFont.replace(/^.*Narrow-?/, "") || "Regular";

export const pdfRuns = (buffer) => {
  const text = buffer.toString("latin1");
  const objects = objectsOf(text);

  const resources = objects.get(Number(text.match(/\/Resources (\d+) 0 R/)[1])).body;
  const fonts = {};

  for (const [, name, ref] of resources.matchAll(/\/(F\d+) (\d+) 0 R/g)) {
    const body = objects.get(Number(ref)).body;
    fonts[name] = {
      face: faceOf(body.match(/\/BaseFont \/\w+\+([\w-]+)/)[1]),
      map: unicodeMapOf(streamOf(buffer, text, objects, Number(body.match(/\/ToUnicode (\d+) 0 R/)[1]))),
    };
  }

  const pageHeight = Number(text.match(/\/MediaBox \[0 0 [\d.]+ ([\d.]+)\]/)[1]);
  const content = streamOf(buffer, text, objects, Number(text.match(/\/Contents (\d+) 0 R/)[1]));

  const runs = [];
  let font;
  let size;
  let x;
  let y;

  for (const line of content.split("\n")) {
    let m;

    if ((m = line.match(/^1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/))) {
      x = Number(m[1]);
      y = pageHeight - Number(m[2]);
    } else if ((m = line.match(/^\/(F\d+) ([\d.]+) Tf/))) {
      font = fonts[m[1]];
      size = Number(m[2]);
    } else if (line.endsWith("TJ")) {
      const chunks = [...line.matchAll(/<([0-9a-f]+)>/gi)].map((chunk) =>
        chunk[1].match(/.{4}/g).map((glyph) => font.map[glyph.toLowerCase()] ?? "?").join(""),
      );
      runs.push({ x: round(x), y: round(y), font: font.face, size, text: chunks.join("|") });
    } else if ((m = line.match(/^([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) re$/))) {
      runs.push({ rect: m.slice(1).map((value) => round(Number(value))) });
    } else if ((m = line.match(/^([\d.-]+) ([\d.-]+) (m|l)$/))) {
      runs.push({ [m[3]]: [round(Number(m[1])), round(Number(m[2]))] });
    }
  }

  return runs;
};

// The printed text with every space and break removed, for asserting that
// something is on the page without caring where. A `|` can stand for a space
// (justification) or for nothing (kerning, as in "T|agapo"), and the two cannot
// be told apart — so both sides of a comparison drop them. Pass the needle
// through `compact` too.
export const compact = (value) => String(value).replace(/[\s|]/g, "");

export const pdfText = (buffer) =>
  compact(
    pdfRuns(buffer)
      .filter((run) => run.text !== undefined)
      .map((run) => run.text)
      .join(""),
  );

export const pageCount = (buffer) =>
  (buffer.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;

export default { pdfRuns, pdfText, compact, pageCount };

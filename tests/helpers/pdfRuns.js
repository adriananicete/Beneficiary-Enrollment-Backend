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
// The page's decoded drawing commands, for the things pdfRuns does not read —
// images, which carry no text and are neither a rectangle nor a line.
export const contentStream = (buffer) => {
  const text = buffer.toString("latin1");

  return streamOf(
    buffer,
    text,
    objectsOf(text),
    Number(text.match(/\/Contents (\d+) 0 R/)[1]),
  );
};

// A PDF transformation matrix [a b c d e f] applied after another: `cm`
// concatenates onto whatever is already in force.
const concat = ([a, b, c, d, e, f], [A, B, C, D, E, F]) => [
  a * A + b * C,
  a * B + b * D,
  c * A + d * C,
  c * B + d * D,
  e * A + f * C + E,
  e * B + f * D + F,
];

// The fill opacity an ExtGState name stands for, read from the object it
// points at. 1 when the page never set one.
const opacityOf = (text, objects, name) => {
  const ref = text.match(new RegExp(`/${name} (\\d+) 0 R`));
  const ca = ref && objects.get(Number(ref[1])).body.match(/\/ca ([\d.]+)/);
  return ca ? Number(ca[1]) : 1;
};

// Walks the page's drawing commands keeping the graphics state, so every image
// and every text block can be reported with the transformation and opacity in
// force when it was drawn. pdfRuns cannot do this and does not need to: it
// reads text by its own matrix, which PDFKit always writes in full.
//
// An image cannot be read that way. Its own matrix is only its size and offset;
// the rotation and translation that place a watermark tile are written before
// it, in `cm` operators that `q` and `Q` save and restore. The mark and every
// tile paint the same image object, so without this they are indistinguishable.
//
// Positions are points from the top-left corner, as in pdfRuns. `x` and `top`
// are the corner of the smallest upright box around the image, `right` and
// `bottom` the opposite corner, `angle` its tilt in degrees (negative rises to
// the right), and `at` where in the content stream it was drawn.
const walk = (buffer) => {
  const text = buffer.toString("latin1");
  const objects = objectsOf(text);
  const pageHeight = Number(text.match(/\/MediaBox \[0 0 [\d.]+ ([\d.]+)\]/)[1]);
  const content = contentStream(buffer);

  const images = [];
  const textBlocks = [];
  const saved = [];
  let state = { matrix: [1, 0, 0, 1, 0, 0], opacity: 1 };
  let at = 0;

  for (const line of content.split("\n")) {
    const op = line.trim();
    let m;

    if (op === "q") saved.push(state);
    else if (op === "Q") state = saved.pop();
    else if ((m = op.match(/^(\S+) (\S+) (\S+) (\S+) (\S+) (\S+) cm$/)))
      state = { ...state, matrix: concat(m.slice(1).map(Number), state.matrix) };
    else if ((m = op.match(/^\/(\w+) gs$/)))
      state = { ...state, opacity: opacityOf(text, objects, m[1]) };
    else if (op === "BT") textBlocks.push({ at, opacity: state.opacity });
    else if ((m = op.match(/^\/(I\d+) Do$/))) {
      const [a, b, c, d, e, f] = state.matrix;
      const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => [
        a * u + c * v + e,
        pageHeight - (b * u + d * v + f),
      ]);
      const xs = corners.map(([x]) => x);
      const ys = corners.map(([, y]) => y);

      images.push({
        image: m[1],
        x: round(Math.min(...xs)),
        top: round(Math.min(...ys)),
        right: round(Math.max(...xs)),
        bottom: round(Math.max(...ys)),
        width: round(Math.hypot(a, b)),
        height: round(Math.hypot(c, d)),
        // `|| 0` because an upright image computes -0, which strict equality
        // tells apart from 0.
        angle: round((Math.atan2(-b, a) * 180) / Math.PI) || 0,
        opacity: state.opacity,
        at,
      });
    }

    at += line.length + 1;
  }

  return { images, textBlocks, content };
};

export const imagePaints = (buffer) => walk(buffer).images;

export const textBlocks = (buffer) => walk(buffer).textBlocks;

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

export default { pdfRuns, pdfText, compact, pageCount, contentStream, imagePaints, textBlocks };

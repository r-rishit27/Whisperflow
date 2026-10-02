/**
 * Renders a synthetic prescription PNG for testing /api/parse.
 *
 *   node scripts/fixtures/make-prescription.mjs <out.png>
 *
 * It is seeded with known answers: every Indian shorthand the parser must
 * handle, a duplicate (Dolo and Crocin are both paracetamol) and a known
 * interaction (ibuprofen with low-dose aspirin).
 */
import sharp from "sharp";

const out = process.argv[2] ?? "prescription.png";

const lines = [
  ["Rx", 34, "bold"],
  ["1. Tab Dolo 650        1-0-1  x 5 days   PC", 26],
  ["2. Tab Telma 40        OD   AC   (continue)", 26],
  ["3. Tab Crocin 500      TDS  x 3 days", 26],
  ["4. Tab Ecosprin 75     HS", 26],
  ["5. Tab Brufen 400      101  x 5 days  after food", 26],
];

const body = lines
  .map(([text, size, weight], i) =>
    `<text x="60" y="${210 + i * 62}" font-family="Courier New, monospace" font-size="${size}" font-weight="${weight ?? "normal"}" fill="#1a1a1a">${text}</text>`,
  )
  .join("\n");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="640">
  <rect width="100%" height="100%" fill="#fbfaf5"/>
  <text x="60" y="70" font-family="Georgia, serif" font-size="30" font-weight="bold" fill="#0b3d5c">Dr. A. Sharma, MBBS MD</text>
  <text x="60" y="105" font-family="Arial" font-size="20" fill="#333">General Physician · Hyderabad</text>
  <line x1="60" y1="125" x2="940" y2="125" stroke="#0b3d5c" stroke-width="2"/>
  <text x="60" y="160" font-family="Arial" font-size="20" fill="#333">Patient: Mrs. Lakshmi, 72 F          Date: 02/10/2026</text>
  ${body}
  <text x="640" y="600" font-family="Georgia, serif" font-size="22" font-style="italic" fill="#0b3d5c">Dr. A. Sharma</text>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile(out);
console.log(`wrote ${out}`);

/**
 * Post-process a .docx blob to apply Word's native picture effect "Beveled Matte"
 * (soft round bevel + matte material). The docx/md-to-docx stack does not expose
 * picture-effect presets; this injects the DrawingML so Word shows the effect.
 */

import JSZip from "jszip";

const DOCX_DOCUMENT_PATH = "word/document.xml";

/** DrawingML fragment: 3D bevel preset (soft round) + matte material – "Beveled Matte" style. EMU values ~190500 for visible bevel (per OOXML examples). */
const BEVEL_MATTE_FRAGMENT = `<a:sp3d prstMaterial="matte"><a:bevelT w="190500" h="190500" prst="softRound"/><a:bevelB w="190500" h="190500" prst="softRound"/></a:sp3d>`;

/**
 * Injects the bevel-matte picture effect into every picture shape in document.xml.
 * Inserts DrawingML <a:sp3d> (with bevel presets) before each </*:spPr> so Word
 * applies the native "Beveled Matte" style when the document is opened.
 */
function injectBevelIntoDocumentXml(xml: string): string {
  // Closing tag with prefix (e.g. </pic:spPr> or </p:spPr>).
  let out = xml.replace(/<\/(\w+):spPr>/g, (_match, prefix) => `${BEVEL_MATTE_FRAGMENT}</${prefix}:spPr>`);
  // Unprefixed closing tag (e.g. </spPr> when default ns is used).
  out = out.replace(/<\/spPr>/g, `${BEVEL_MATTE_FRAGMENT}</spPr>`);
  return out;
}

/**
 * Applies Word's "Beveled Matte" picture effect to all pictures in the docx.
 * Returns a new Blob; does not mutate the original.
 */
export async function applyWordPictureBevelToDocx(docxBlob: Blob): Promise<Blob> {
  const zip = await JSZip.loadAsync(docxBlob);
  const documentEntry = zip.file(DOCX_DOCUMENT_PATH);
  if (!documentEntry) return docxBlob;

  const xml = await documentEntry.async("string");
  const hasPictureShapes = /spPr/.test(xml);
  const modifiedXml = injectBevelIntoDocumentXml(xml);
  if (hasPictureShapes && modifiedXml.indexOf('prstMaterial="matte"') === -1) {
    console.warn("[docx bevel] Picture shape(s) found but bevel was not inserted; document may use unexpected XML format.");
  }
  zip.file(DOCX_DOCUMENT_PATH, modifiedXml, { binary: false });

  return zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

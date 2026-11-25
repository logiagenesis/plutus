// Loads the PDF builder. If the tab was open across a deploy, the old chunk file no longer
// exists and the import fails; we retry once, then tell the user to refresh instead of failing silently.
export async function loadPdf(): Promise<typeof import("./pdf")> {
  try {
    return await import("./pdf");
  } catch {
    try {
      return await import("./pdf");
    } catch (e) {
      throw new Error("Not sent: the PDF builder could not load (Plutus was probably updated while this tab was open). Refresh the page with Ctrl+Shift+R and send again. Details: " + (e instanceof Error ? e.message : String(e)));
    }
  }
}

export function pdfToBase64(doc: { output: (t: "arraybuffer") => ArrayBuffer }): string {
  const buf = new Uint8Array(doc.output("arraybuffer"));
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

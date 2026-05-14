import { zipSync, strToU8 } from "fflate";

export interface ZipEntry {
  name: string;
  content: string;
}

export function buildZip(entries: ZipEntry[]): Blob {
  const map: Record<string, Uint8Array> = {};
  for (const e of entries) {
    map[e.name] = strToU8(e.content);
  }
  const zipped = zipSync(map);
  // Copy into a fresh ArrayBuffer so the Blob's BlobPart type checks
  // (lib.dom Uint8Array generic disallows ArrayBufferLike here).
  const buf = new ArrayBuffer(zipped.byteLength);
  new Uint8Array(buf).set(zipped);
  return new Blob([buf], { type: "application/zip" });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

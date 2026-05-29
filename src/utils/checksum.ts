export async function sha256Hex(input: string | Buffer): Promise<string> {
  const raw: Uint8Array =
    typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  // crypto.subtle.digest requires a plain ArrayBuffer-backed view; slice() always returns ArrayBuffer
  const data = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

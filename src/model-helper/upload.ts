/** Bounded helper-output upload (Step 07d transport, used by 07g).
 *
 * Bodies never travel through JSON. Every chunk is at most 1 MiB and is
 * posted to the reservation the parent created before the request. The
 * child cannot choose an output id, path or size. */

export interface OutputReservation {
  output_id: string;
  token_url: string;
  upload_token: string;
  max_bytes: number;
}

export const MAX_UPLOAD_CHUNK = 1024 * 1024;

/** Incremental SHA-256, only for the transport manifest. The scene itself
 * is hashed with BLAKE3 by the native parent before publication. */
export class Sha256 {
  private readonly state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private readonly buffer = new Uint8Array(64);
  private buffered = 0;
  private total = 0;

  update(bytes: Uint8Array): void {
    this.total += bytes.length;
    let offset = 0;
    if (this.buffered > 0) {
      const take = Math.min(64 - this.buffered, bytes.length);
      this.buffer.set(bytes.subarray(0, take), this.buffered);
      this.buffered += take;
      offset += take;
      if (this.buffered === 64) {
        this.compress(this.buffer, 0);
        this.buffered = 0;
      }
    }
    while (offset + 64 <= bytes.length) {
      this.compress(bytes, offset);
      offset += 64;
    }
    if (offset < bytes.length) {
      this.buffer.set(bytes.subarray(offset), 0);
      this.buffered = bytes.length - offset;
    }
  }

  hex(): string {
    const final = new Uint8Array(this.buffered < 56 ? 64 : 128);
    final.set(this.buffer.subarray(0, this.buffered));
    final[this.buffered] = 0x80;
    const bits = this.total * 8;
    const view = new DataView(final.buffer);
    view.setUint32(final.length - 8, Math.floor(bits / 0x1_0000_0000), false);
    view.setUint32(final.length - 4, bits >>> 0, false);
    for (let offset = 0; offset < final.length; offset += 64) this.compress(final, offset);
    return Array.from(this.state, (word) => word.toString(16).padStart(8, "0")).join("");
  }

  private compress(chunk: Uint8Array, offset: number): void {
    const words = new Uint32Array(64);
    const view = new DataView(chunk.buffer, chunk.byteOffset + offset, 64);
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(index * 4, false);
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotate(words[index - 15], 7) ^ rotate(words[index - 15], 18) ^ (words[index - 15] >>> 3);
      const s1 = rotate(words[index - 2], 17) ^ rotate(words[index - 2], 19) ^ (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = this.state;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + choice + SHA256_K[index] + words[index]) >>> 0;
      const s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    this.state[0] = (this.state[0] + a) >>> 0;
    this.state[1] = (this.state[1] + b) >>> 0;
    this.state[2] = (this.state[2] + c) >>> 0;
    this.state[3] = (this.state[3] + d) >>> 0;
    this.state[4] = (this.state[4] + e) >>> 0;
    this.state[5] = (this.state[5] + f) >>> 0;
    this.state[6] = (this.state[6] + g) >>> 0;
    this.state[7] = (this.state[7] + h) >>> 0;
  }
}

function rotate(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Upload one bounded body and return its manifest fields. */
export async function uploadOutput(
  reservation: OutputReservation,
  bytes: Uint8Array,
  fetchImpl: typeof fetch = fetch,
): Promise<{ output_id: string; mime: string; byte_len: number; sha256: string }> {
  if (!Number.isSafeInteger(reservation.max_bytes) || bytes.byteLength > reservation.max_bytes) {
    throw new Error("special_view.too_large");
  }
  const hash = new Sha256();
  hash.update(bytes);
  const sha256 = hash.hex();
  for (let offset = 0; offset < bytes.length; offset += MAX_UPLOAD_CHUNK) {
    const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + MAX_UPLOAD_CHUNK));
    const response = await fetchImpl(reservation.token_url, {
      method: "POST",
      headers: {
        "X-Adp-Upload-Token": reservation.upload_token,
        "X-Adp-Offset": String(offset),
        "Content-Type": "application/octet-stream",
      },
      body: new Uint8Array(chunk).buffer,
    });
    if (!response.ok) throw new Error("helper.failed");
  }
  const response = await fetchImpl(reservation.token_url, {
    method: "POST",
    headers: {
      "X-Adp-Upload-Token": reservation.upload_token,
      "X-Adp-Offset": String(bytes.length),
      "X-Adp-Final-Length": String(bytes.length),
      "X-Adp-Sha256": sha256,
      "Content-Type": "application/octet-stream",
    },
    body: new Uint8Array(0),
  });
  if (!response.ok) throw new Error("helper.failed");
  return { output_id: reservation.output_id, mime: "", byte_len: bytes.length, sha256 };
}

export { toHex };

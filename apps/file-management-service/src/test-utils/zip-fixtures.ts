import * as fs from 'node:fs';
import archiver from 'archiver';

/** Write a ZIP holding `entries` (name -> content) at `dest`. */
export async function writeZip(
  dest: string,
  entries: Record<string, Buffer | string>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(dest);
    const arc = archiver('zip', { zlib: { level: 9 } });
    arc.pipe(out);
    for (const [name, content] of Object.entries(entries)) {
      arc.append(Buffer.isBuffer(content) ? content : Buffer.from(content), {
        name,
      });
    }
    out.on('close', () => resolve());
    arc.on('error', reject);
    void arc.finalize();
  });
}

/**
 * Rewrite every uncompressed size the archive declares (central directory,
 * local headers and data descriptors) to `declared`, leaving the compressed
 * data intact: the archive then lies about how much its entries inflate to.
 */
export function lieAboutSizes(buf: Buffer, declared: number): Buffer {
  const out = Buffer.from(buf);
  for (let i = 0; i + 4 <= out.length; i++) {
    const sig = out.readUInt32LE(i);
    if (sig === 0x02014b50 && i + 28 <= out.length) {
      out.writeUInt32LE(declared, i + 24);
    } else if (sig === 0x04034b50 && i + 26 <= out.length) {
      if (out.readUInt32LE(i + 22) !== 0) out.writeUInt32LE(declared, i + 22);
    } else if (sig === 0x08074b50 && i + 16 <= out.length) {
      out.writeUInt32LE(declared, i + 12);
    }
  }
  return out;
}

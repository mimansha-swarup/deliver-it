/*
 * The map's files ship twice: as they are, and gzipped beside them (`.geojson.gz`, written by
 * the build, see vite.config.ts). The map is 14.7 MB as it is and 1 MB gzipped, and not every host
 * compresses a .geojson file on the way, so a first visit could wait on 15 MB. The game asks for
 * the gzipped copy and unpacks it itself. A host that unpacks it on the way, or one without the
 * copy (the dev server answers with the page instead), gets the plain file.
 */

/** The gzip header's first two bytes. */
const GZIP = [0x1f, 0x8b]

function isGzip(bytes: Uint8Array) {
  return bytes[0] === GZIP[0] && bytes[1] === GZIP[1]
}

/** Whether the bytes start like a JSON object, past any spaces. */
function looksLikeJson(bytes: Uint8Array) {
  for (const byte of bytes.subarray(0, 64)) {
    if (byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09 || byte === 0xef || byte === 0xbb || byte === 0xbf) continue
    return byte === 0x7b
  }
  return false
}

async function gunzip(bytes: Uint8Array): Promise<ArrayBuffer> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).arrayBuffer()
}

/**
 * A data file's JSON bytes: the gzipped copy if there is one, unpacked, or else the file as it
 * is. `download` fetches one address and returns its bytes (so the loader can count them).
 */
export async function fetchPackedData(url: string, download: (url: string) => Promise<ArrayBuffer> = plainDownload): Promise<ArrayBuffer> {
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const packed = new Uint8Array(await download(`${url}.gz`))
      if (isGzip(packed)) return await gunzip(packed)
      if (looksLikeJson(packed)) return packed.buffer as ArrayBuffer
    } catch {
      // No gzipped copy: the plain file below.
    }
  }
  return download(url)
}

async function plainDownload(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return response.arrayBuffer()
}

/** A data file's JSON, parsed, by `fetchPackedData`. */
export async function fetchPackedJson<T>(url: string): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await fetchPackedData(url))) as T
}

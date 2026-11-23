// Inline HTML assets are gzip + base64: the page inflates them with the
// browser's own DecompressionStream, so nothing is fetched and the
// base64 alphabet cannot terminate the script element holding it.
import { gzipSync, gunzipSync } from 'node:zlib'

/** @param {string} text */
export const pack = (text) => gzipSync(Buffer.from(String(text), 'utf8'), { level: 9 }).toString('base64')
/** @param {string} packed */
export const unpack = (packed) => gunzipSync(Buffer.from(String(packed), 'base64')).toString('utf8')

// Replaces @likec4/generators/likec4 (and its zod schemas): only LSP code actions
// (model-change) and LikeC4.generateLikeC4 print DSL text; the engine calls neither.
import { unavailable } from './unavailable.mjs'

export const generate = unavailable('@likec4/generators generate')
export const print = unavailable('@likec4/generators print')
export const indent = unavailable('@likec4/generators indent')
export const withctx = unavailable('@likec4/generators withctx')
// A namespace read inside those same functions only (ops.views..., ops.props...).
export const ops = new Proxy({}, { get: (_target, key) => unavailable(`@likec4/generators ops.${String(key)}`)() })

// Small lexical scanner shared by source diagnostics and view orientation.
// Positions always refer to the original source; strings/comments never affect braces.
import { KINDS } from '../core/vocab.js'

const kinds = new Set(KINDS)

export function scan(source) {
  const tokens = []
  const stack = []
  let line = 0
  for (let i = 0; i < source.length;) {
    const c = source[i]
    if (/\s/.test(c)) {
      if (c === '\n') line++
      i++
      continue
    }
    if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++
      continue
    }
    if (c === '/' && source[i + 1] === '*') {
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i++] === '\n') line++
      }
      i = Math.min(source.length, i + 2)
      continue
    }
    const start = i
    const atLine = line
    let type = 'symbol'
    let value = ''
    if (c === "'" || c === '"') {
      type = 'string'
      i++
      while (i < source.length) {
        const ch = source[i++]
        if (ch === '\n') line++
        if (ch === c) break
        if (ch === '\\' && i < source.length) {
          const escaped = source[i++]
          if (escaped === '\n') line++
          value += escaped
        } else value += ch
      }
    } else if (/[A-Za-z_]/.test(c)) {
      type = 'word'
      while (i < source.length && /\w/.test(source[i])) value += source[i++]
    } else if (source.startsWith('->', i)) {
      value = '->'
      i += 2
    } else {
      value = c
      i++
    }
    const token = { type, value, start, end: i, line: atLine, parent: stack.at(-1) ?? null }
    const index = tokens.length
    tokens.push(token)
    if (type === 'symbol' && value === '{') stack.push(index)
    else if (type === 'symbol' && value === '}' && stack.length) {
      const open = stack.pop()
      tokens[open].close = index
      token.open = open
    }
  }
  return tokens
}

const word = (token, value) => token?.type === 'word' && (value === undefined || token.value === value)
const symbol = (token, value) => token?.type === 'symbol' && token.value === value

/** Index fully qualified declarations, relations and view blocks in one lexical pass. */
function indexDeclarations(tokens) {
  const scopes = new Map()
  const declarations = new Map()
  const byName = new Map()
  const viewRoots = new Set()
  const views = []
  const viewIds = new Set()
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.parent === null && symbol(tokens[i + 1], '{')) {
      if (word(t, 'model')) scopes.set(i + 1, '')
      if (word(t, 'views')) viewRoots.add(i + 1)
    }
    if (word(t) && scopes.has(t.parent)) {
      let name
      let open
      if (symbol(tokens[i + 1], '=') && word(tokens[i + 2]) && kinds.has(tokens[i + 2].value)) {
        name = t.value
        open = i + 3
      } else if (kinds.has(t.value) && word(tokens[i + 1]) && tokens[i + 1].parent === t.parent
        && !symbol(tokens[i - 1], '->') && !symbol(tokens[i - 1], '.') && !symbol(tokens[i + 2], '=')) {
        name = tokens[i + 1].value
        open = i + 2
      }
      if (name !== undefined) {
        const scope = scopes.get(t.parent)
        const id = scope ? scope + '.' + name : name
        // LikeC4 accepts positional title, description and technology strings,
        // in either `id = kind` or `kind id` declarations, even across lines.
        while (tokens[open]?.type === 'string') open++
        const block = symbol(tokens[open], '{') ? open : null
        const declaration = { id, token: t, block }
        declarations.set(id, declaration)
        if (!byName.has(name)) byName.set(name, declaration)
        if (block !== null) scopes.set(block, id)
        i = open - 1
        continue
      }
    }
    if (word(t, 'view') && viewRoots.has(t.parent) && word(tokens[i + 1])) {
      let open = i + 2
      while (open < tokens.length && tokens[open].parent === t.parent && !symbol(tokens[open], '{') && !symbol(tokens[open], '}')) open++
      if (symbol(tokens[open], '{') && tokens[open].close !== undefined) {
        views.push(open)
        viewIds.add(tokens[i + 1].value)
      }
    }
  }

  return { scopes, declarations, byName, views, viewIds }
}

function refAt(tokens, start, step) {
  if (!word(tokens[start])) return null
  let value = tokens[start].value
  let i = start + step
  while (symbol(tokens[i], '.') && word(tokens[i + step])) {
    value = step > 0 ? value + '.' + tokens[i + step].value : tokens[i + step].value + '.' + value
    i += 2 * step
  }
  return { value, next: i }
}
function resolve(declarations, ref, scope) {
  if (ref === 'this') return scope
  for (let at = scope; at; at = at.includes('.') ? at.slice(0, at.lastIndexOf('.')) : '') {
    if (declarations.has(at + '.' + ref)) return at + '.' + ref
  }
  return ref
}

function collectRelations(tokens, scopes, declarations) {
  const relations = []
  for (let i = 0; i < tokens.length; i++) {
    const arrow = tokens[i]
    if (!symbol(arrow, '->') || !scopes.has(arrow.parent)) continue
    let fromAt = i - 1
    let kind = null
    let line = arrow.line
    // The lexer keeps punctuation separate: -[async]-> ends in ] then ->.
    // Resolve the source before the full typed arrow, not before its last token.
    if (symbol(tokens[i - 1], ']') && word(tokens[i - 2]) && symbol(tokens[i - 3], '[') && symbol(tokens[i - 4], '-')) {
      kind = tokens[i - 2].value
      fromAt = i - 5
      line = tokens[i - 4].line
    }
    const from = refAt(tokens, fromAt, -1)
    const to = refAt(tokens, i + 1, 1)
    if (!from || !to) continue
    const scope = scopes.get(arrow.parent)
    let title = tokens[to.next]?.type === 'string' ? tokens[to.next].value : ''
    if (symbol(tokens[to.next], '{')) {
      const block = to.next
      for (let j = block + 1; j < (tokens[block].close ?? block); j++) {
        if (tokens[j].parent === block && word(tokens[j], 'title') && tokens[j + 1]?.type === 'string') title = tokens[j + 1].value
      }
    }
    relations.push({ source: resolve(declarations, from.value, scope), target: resolve(declarations, to.value, scope), title, kind, line })
  }
  return relations
}

/** Index fully qualified declarations, relations and view blocks in one lexical pass. */
export function sourceIndex(source) {
  const tokens = scan(source)
  const { scopes, declarations, byName, views, viewIds } = indexDeclarations(tokens)
  const relations = collectRelations(tokens, scopes, declarations)
  return {
    tokens,
    views,
    viewIds,
    lineOf(id) {
      return (declarations.get(id) ?? byName.get(id.split('.').pop()))?.token.line ?? 0
    },
    relationLine(relation) {
      const matches = (r) => r.source === relation.source && r.target === relation.target && r.title === relation.title
      const exact = relations.find((r) => matches(r) && r.kind === (relation.kind ?? null))
      return (exact ?? relations.find(matches) ?? relations.find((r) => r.title === relation.title))?.line ?? 0
    },
  }
}

/** Closing-brace offsets of real views without an explicit autoLayout rule. */
export function orientationPoints(source) {
  const { tokens, views } = sourceIndex(source)
  return views.filter((open) => !tokens.slice(open + 1, tokens[open].close).some((t) => t.parent === open && word(t, 'autoLayout')))
    .map((open) => tokens[tokens[open].close].start)
}

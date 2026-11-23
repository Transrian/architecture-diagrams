// SKILL.md rewritten for the MCP server: the tools replace the script.

const TOOLS = `## Tools
Pass absolute paths to \`.c4\` files.
- \`render\` validates the diagram and writes its HTML page.
- \`check\` validates only, writing nothing.
- \`serve\` follows the file live on a localhost page, while this server runs.
- \`guide\` returns the file and format rules below.`

const WORKFLOW = `## Workflow
1. Write or edit the file with your normal file tools.
2. After every save, call \`render\` on it. It returns a \`[diagram]\` verdict. On "does not parse" or "refused", fix the file and call it again: no HTML is written until the diagram is valid. "Advice" lines do not block.
3. When valid, it writes \`<file without .c4>.html\` and returns its \`file://\` link: give the user that link. It is a snapshot: call \`render\` again after each change.
4. For live viewing while you work, call \`serve\` once and give the user its URL (the page follows the file).
Do not spend time opening the HTML yourself; the verdict is the check.`

/** SKILL.md split into its title and intro, then its `## ` sections by heading. */
export function skillSections(text) {
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, '')
  const [head, ...rest] = body.split(/^(?=## )/m)
  const sections = new Map(rest.map((part) => [part.slice(3, part.indexOf('\n')).trim(), part.trim()]))
  for (const name of ['Command', 'Files', 'Workflow', 'Format']) if (!sections.has(name)) throw new Error(`SKILL.md: missing section "## ${name}"`)
  return { head: head.trim(), sections }
}

/** The skill rewritten for MCP: its Command and Workflow sections name the tools instead of the script. */
export function mcpTexts(skill) {
  const { head, sections } = skillSections(skill)
  const guide = [sections.get('Files'), sections.get('Format')].join('\n\n')
  return { guide, instructions: [head, TOOLS, sections.get('Files'), WORKFLOW, sections.get('Format')].join('\n\n') }
}

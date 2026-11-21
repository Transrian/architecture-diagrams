/** Agent-facing format guide, shared without importing the diagram engine. */
export function formatGuide(o = {}) {
  const {
    button = 'one button in the tab',
    maker = 'The plugin makes',
    merger = 'the plugin merges',
    context = 'conversation',
  } = o
  return `Shape: a hierarchy, never a flat list.
- Each top-level group is a schema: ${button}. Unrelated subjects are separate schemas.
- At most 7 children per group and 6 levels (schema > up to 4 nested groups > leaf). When a group would get more, add an intermediate group by function (entry, apps, inference, storage, monitoring…), not only by host.
- Only \`person\` and \`external\` may stay at the root, outside a schema. Docs and data go inside the schema they belong to.
- ${maker} one view per group: the schema view (its button) and a drill-down view per nested group (the user unfolds a group in place with a click, or zooms into it). Do not write views, except a \`dynamic view\` for a numbered flow.
- Short labels with real names (files, services, hosts): title ≤ 32 chars, description ≤ 80, technology ≤ 40, relation label ≤ 30. Why, numbers, commits and test results go in \`metadata\`, shown when the user clicks.
- Draw relations between the most precise elements; ${merger} them at higher levels ("3 links").
- No limit on the total: a whole platform can hold hundreds of elements, since the user sees one level at a time. Remove what the ${context} no longer needs.

Syntax: the file starts with the line \`// diagram v1\`, then LikeC4: only \`model { }\` (plus \`views { }\` for dynamic views). Kinds and tags are predeclared — never write a \`specification\` block.
- kinds: system (a schema or a group), machine (host, VM, cluster), service (process, container, API), component (module, file, pipeline stage), data (database, index, topic, bucket, dataset), doc, person, external, hardware (GPU, disk)
- Icons are automatic: from \`technology\` (set it to the product's usual name: 'PostgreSQL', 'Apache Kafka', 'Snowflake'), else the title; cloud services ('Lambda', 'Functions') resolve inside a group named after the vendor (AWS, Azure, GCP). \`icon none\` removes one; \`icon aws:lambda\` (sets aws, azure, gcp, tech, bootstrap) forces one. Never spend time looking for an icon.
- state tags, on elements and relations: #planned (will change) #doing #done #impacted (not changed, but affected) #deviation (differs from the plan) #blocked #waiting (needs the user) #frozen — one state per element; marks #new #removed combine with a state (e.g. #done #new). An element changed before and planned again takes its next state; history goes in metadata.
- metadata: \`why\`, \`decided\` ('agent' or 'user'), \`proof\` (commit, command, test) have a meaning; any other key (lot, count…) is shown as is. A #deviation needs \`why\` and \`decided\`.
- One statement per line. Tags come FIRST inside the braces, before description/technology/metadata.
- Ids: letters, digits, underscore; not a keyword (model, views, view, include, style, element…). Reference nested elements as parent.child.
- Relationship: \`a -> b 'label'\` (never between an element and its own parent or child); with a tag: \`a -> b 'label' {\` newline \`#done\` newline \`}\`.
- Titles in the user's language.

Example:
// diagram v1
model {
  customer = person 'Customer'
  shop = system 'Web shop' {
    front = system 'Frontend' {
      cart = component 'Cart.tsx' {
        #planned
      }
      checkout = system 'Checkout' {
        form = component 'PaymentForm.tsx' {
          description 'card fields, 3-D Secure'
        }
        client = component 'payments.ts' {
          #doing
          metadata {
            proof 'vitest 44/44'
          }
        }
        form -> client 'card token'
      }
      checkout.client -> cart 'order paid'
    }
    api = system 'Backend' {
      orders = service 'orders-api' {
        technology 'FastAPI'
      }
    }
    front.checkout.client -> api.orders 'POST /orders'
  }
  customer -> shop.front.checkout.form 'pays'
}
`
}

/** DSH prompt: keep the default guide and surrounding text byte-for-byte stable. */
export function promptText(loc) {
  return `# Conversation diagram

This conversation can own a live architecture diagram, drawn in the diagram tab of the right sidebar ("Diagram"; localized). It shows how a system is built, as nested groups the user zooms into one level at a time, and, through state tags, which parts your work changes.

When to draw:
- The user asks for a diagram, schema or map: draw it.
- Your plan or analysis spans several components and the links between them, or so many changes that text alone makes them hard to picture: draw it before changing anything, then keep the states current while you work.
- Anything simpler (a question, a one-file fix, a small change): do not draw. Do not draw either when the user says they do not want one.
Once this conversation has a diagram, keep it current when your work changes what it shows.
The diagram is not a log: no task boxes, no proof boxes, no history. Progress shows only as states on architecture elements; detail goes in metadata.

File: ${loc.file}
${loc.isSub ? `You are a subagent: this diagram belongs to the root conversation and other agents write to it too. Re-read it right before each edit and change only the elements your own work touches.\n` : ''}Edit it with your normal file tools. After each save a "[diagram]" note is appended to the tool result: fix syntax errors and refusals right away (a refused diagram is not kept). When you present the plan or explain the system, link the diagram file in your message, [Diagram](<${loc.file}>) with the label in the user's language: a click opens the interactive tab.

${formatGuide()}`
}

/** A portable Agent Skills document; command discovery belongs to the CLI. */
export function skillText({ cli = 'dsh-diagram' } = {}) {
  return `---
name: dsh-diagram
description: Draw or update an interactive architecture diagram — nested groups the user zooms into, with work-state tags (planned, doing, done…) — as a LikeC4 text file, rendered to a self-contained HTML page. Use when the user asks for a diagram, schema or map of a system, or when a plan spans several components and the links between them.
---
<!-- generated by dsh-diagram -->
# Architecture diagram

An interactive architecture diagram shows how a system is built, as nested groups the user zooms into one level at a time. State tags show which parts your work changes. The same diagram is rendered to a self-contained HTML page with semantic zoom, details and version history, without network access.

When to draw:
- The user asks for a diagram, schema or map: draw it.
- Your plan or analysis spans several components and the links between them, or so many changes that text alone makes them hard to picture: draw it before changing anything, then keep the states current while you work.
- Anything simpler (a question, a one-file fix, a small change): do not draw. Do not draw either when the user says they do not want one.
Once a subject has a diagram, keep it current when your work changes what it shows.
The diagram is not a log: no task boxes, no proof boxes, no history. Progress shows only as states on architecture elements; detail goes in metadata.

## Files
- One diagram per subject: \`.diagram/<short-kebab-topic>.c4\` at the workspace root. Before creating one, list \`.diagram/*.c4\` and continue an existing diagram on the same subject.
- \`.diagram/\` ignores itself in git (the CLI writes its \`.gitignore\`).

## Workflow
1. Write or edit the file with your normal file tools.
2. After every save, run: \`${cli} render <file>\`
   It prints a \`[diagram]\` verdict. On "does not parse" or "refused", fix the file and run it again: no HTML is written until the diagram is valid.
3. When valid, it writes \`<file without .c4>.html\` and prints its path. Give the user that path as a \`file://\` link. It is a snapshot: re-run \`render\` after each change.
4. For live viewing while you work, the user can run \`${cli} serve <file>\` and keep the page open (it follows the file; verdicts print in that terminal).
Do not spend time opening the HTML yourself; the verdict is the check.

${formatGuide({
    button: 'one button at the top of the page',
    maker: 'The viewer makes',
    merger: 'the viewer merges',
    context: 'subject',
  })}`
}

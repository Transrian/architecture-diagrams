// DSH-only adapter. The standalone viewer and engine sources live in a lazy
// data chunk: opening the tab must not download a second React or engine.
import { assembleHtml, CURRENT } from './html.js'
import { iconsOf, groupByShard, shardFile } from './iconrules.js'

export function makeHtmlExporter(loader) {
  return async ({ text, name = 'diagram' }) => {
    const [assets, engine] = await Promise.all([
      loader.async('./client.export-html.js'),
      loader.async('./client.likec4.js'),
    ])
    // Compute the whole model, not the visible/unfolded portion. This also
    // gathers the icons of groups the user has not visited yet.
    const result = await engine.compute(text)
    if (result.legacy || result.errors?.length || !result.views?.length) throw new Error('No valid diagram to export')
    const ids = groupByShard(iconsOf(result))
    const icons = {}
    await Promise.all([...ids].map(async ([n, needed]) => {
      const module = await loader.async('./' + shardFile(n))
      const pack = module?.default ?? module
      const selected = {}
      for (const id of needed) if (pack?.[id]) selected[id] = pack[id]
      icons[n] = selected
    }))
    return assembleHtml({ name, files: { [CURRENT]: text }, icons, bundle: assets.bundle, engine: assets.engine })
  }
}

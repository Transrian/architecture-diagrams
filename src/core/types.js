// @ts-check
// Serializable engine data and display-only viewer geometry. No runtime exports.
/**
 * @typedef {{x: number, y: number, width: number, height: number}} Rect
 * @typedef {{s: number, tx: number, ty: number}} Cam
 * @typedef {{w: number, h: number}} Size
 * @typedef {{id: string, parent: string|null, depth: number, kind: string,
 *   title: string, description: string, technology: string, icon?: string|null,
 *   metadata: Record<string, string>, tags: string[], state?: string,
 *   marks: string[], children: string[]}} Element
 * @typedef {{id: string, source: string, target: string, title: string,
 *   kind: string|null, metadata: Record<string, string>, tags: string[],
 *   state?: string, marks: string[]}} Relation
 * @typedef {{icon: string|null, how: string}} IconResolution
 * @typedef {{elements: Record<string, Element>, order: string[],
 *   relations: Record<string, Relation>, views: ModelView[],
 *   icons?: Record<string, IconResolution>}} Model
 * @typedef {{id: string, type?: string, viewOf?: string|null, title?: string|null}} ModelView
 * @typedef {Element & Rect & {unfold?: boolean, expanded?: boolean,
 *   drill?: string, hidden?: number, assumedCount?: number, level?: number,
 *   inEdges?: string[], outEdges?: string[]}} ViewNode
 * @typedef {{id: string, source: string, target: string, relations?: string[],
 *   points: number[][], labelBBox?: Rect,
 *   relationList?: {sourceId: string, targetId: string}[]}} ViewEdge
 * @typedef {{id: string, title?: string, viewOf?: string|null,
 *   _type?: string, generated?: boolean, inPlace?: boolean,
 *   bounds: Rect, nodes: ViewNode[], edges: ViewEdge[]}} View
 * @typedef {{id: string, view: View, parent: string|null, frame: ViewNode|null,
 *   box: ViewNode|null, kids: Map<string, string>}} Entry
 * @typedef {{N: Rect, F: Rect, fc: number, bc: number, b0: number, f0: number, rho: number, inPlace: boolean}} Geometry
 * @typedef {{root: Entry, entries: Map<string, Entry>, geoms: Map<string, Geometry>}} Tree
 * @typedef {{model: Model, views: View[], viewOfElement: Record<string, string>}} Result
 * @typedef {{elements: Record<string, number>, relations: Record<string, number>}} Trace
 * @typedef {{nodes: Record<string, number>, edges: Record<string, number>, hidden: string[]}} TraceProjection
 * @typedef {{added: number, changed: number, moved: number, removed: number}} ChangeCounts
 * @typedef {{own: ChangeCounts, total: ChangeCounts, fields: string[],
 *   from: string|null, removedElements: Element[], changedRecord?: ChangedRecord<Element>}} Change
 * @typedef {{from: string, to: string, before: Element, after: Element}} MovedRecord
 * @typedef {{beforeCount: number, afterCount: number,
 *   elements: {added: Element[], removed: Element[], moved: MovedRecord[], changed: ChangedRecord<Element>[]},
 *   relations: {added: Relation[], removed: Relation[], changed: ChangedRecord<Relation>[]}}} ModelDiff
 * @typedef {{nodes: Record<string, Change>, counts: ChangeCounts & {
 *   relations: {added: number, changed: number, removed: number}}, removed: Element[],
 *   unplaced: Element[], relations: ModelDiff['relations']}} Changes
 */
/**
 * @template T
 * @typedef {{id: string, before: T, after: T, fields: string[]}} ChangedRecord
 */
export {}

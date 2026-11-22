import { V } from './theme.js'

export const CSS = `
.dshd-root{display:flex;flex-direction:column;height:100%;min-height:0;background:${V('bg-base')};color:${V('label-primary')};font-size:13px}
.dshd-bar{display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid ${V('border-l1')};flex-wrap:wrap}
.dshd-views{display:flex;gap:4px;flex-wrap:wrap;flex:1;min-width:0}
.dshd-btn{appearance:none;border:1px solid ${V('border-l1')};background:${V('bg-layer-1')};color:${V('label-primary')};border-radius:999px;padding:3px 10px;font:inherit;font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap}
.dshd-btn:hover{border-color:${V('border-l2')}}
.dshd-btn[aria-pressed=true]{background:${V('label-primary')};color:${V('bg-base')};border-color:${V('label-primary')}}
.dshd-btn:disabled{opacity:.4;cursor:default}
.dshd-btn.dshd-flow{border-style:dashed}
.dshd-icon{padding:3px 7px}
.dshd-dl{display:inline-flex;align-items:center;gap:4px}
.dshd-time{display:flex;align-items:center;gap:4px;color:${V('label-secondary')};font-size:12px}
.dshd-time input{width:110px;accent-color:${V('brand-primary')}}
.dshd-crumbs{display:flex;align-items:center;gap:4px;padding:5px 12px;font-size:12px;color:${V('label-secondary')};border-bottom:1px solid ${V('border-l1')};flex-wrap:wrap}
.dshd-crumbs button{appearance:none;border:0;background:none;padding:1px 4px;border-radius:4px;font:inherit;color:${V('label-secondary')};cursor:pointer}
.dshd-crumbs button:hover{background:${V('bg-layer-1')};color:${V('label-primary')}}
.dshd-hint{margin-left:auto;opacity:.75;font-size:11px}
.dshd-crumbs b{color:${V('label-primary')};font-weight:600;padding:1px 4px}
.dshd-stage{position:relative;flex:1;min-height:0;overflow:hidden;cursor:grab;touch-action:none}
.dshd-stage.dshd-drag{cursor:grabbing}
.dshd-stage svg{display:block;width:100%;height:100%;user-select:none;-webkit-user-select:none}
.dshd-msg{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:24px;text-align:center;color:${V('label-secondary')}}
.dshd-msg b{color:${V('label-primary')};font-size:14px}
.dshd-err{margin:6px 10px 0;padding:6px 10px;border-radius:8px;border:1px solid ${V('state-warn-primary')};color:${V('label-primary')};font-size:12px;max-height:96px;overflow:auto}
button.dshd-err{appearance:none;background:none;font:inherit;font-size:12px;text-align:left;display:block;width:calc(100% - 20px);box-sizing:border-box;cursor:pointer}
.dshd-err code{display:block;color:${V('label-secondary')};white-space:pre-wrap;font-size:11px}
.dshd-sub{padding:4px 10px;font-size:11px;color:${V('label-secondary')}}
.dshd-legend{display:flex;gap:10px;flex-wrap:wrap;padding:6px 10px;border-top:1px solid ${V('border-l1')};color:${V('label-secondary')};font-size:11px}
.dshd-legend span{display:inline-flex;align-items:center;gap:4px}
.dshd-dot{width:10px;height:10px;border-radius:3px;border:1.5px solid currentColor;background:color-mix(in srgb, currentColor 25%, transparent);display:inline-block}
.dshd-detail{position:absolute;right:10px;bottom:10px;max-width:min(360px,calc(100% - 20px));max-height:calc(100% - 20px);overflow:auto;background:${V('bg-overlay')};border:1px solid ${V('border-l2')};border-radius:10px;padding:10px 12px;box-shadow:0 6px 24px rgba(0,0,0,.18);font-size:12px;cursor:default}
.dshd-detail h4{margin:0 22px 4px 0;font-size:13px}
.dshd-detail p{margin:4px 0;color:${V('label-secondary')};white-space:pre-wrap}
.dshd-detail dl{display:grid;grid-template-columns:auto 1fr;gap:2px 8px;margin:6px 0 0}
.dshd-detail dt{color:${V('label-secondary')}}
.dshd-detail dd{margin:0;white-space:pre-wrap;min-width:0;overflow-wrap:anywhere}
.dshd-detail ul{margin:4px 0 0;padding-left:16px}
.dshd-detail .dshd-x{position:absolute;top:6px;right:8px;border:0;background:none;color:${V('label-secondary')};cursor:pointer;font-size:14px}
.dshd-detail .dshd-btn{margin-top:8px}
.dshd-pill{display:inline-block;border-radius:999px;padding:0 7px;font-size:11px;border:1px solid currentColor;margin-left:6px}
@keyframes dshd-ants{to{stroke-dashoffset:-24}}
.dshd-run{stroke-dasharray:8 4;animation:dshd-ants 1.2s linear infinite}
.dshd-edge-line{stroke-dasharray:var(--dshd-edge-pattern,none)}
.dshd-edge-run{stroke-dasharray:var(--dshd-edge-pattern,8 4);animation:dshd-ants 1.2s linear infinite}
@media (prefers-reduced-motion: reduce){.dshd-run,.dshd-edge-run{animation:none}.dshd-edge-run{stroke-dasharray:var(--dshd-edge-pattern,none)}}
.dshd-sr-only{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}
.dshd-root :focus-visible{outline:2px solid ${V('label-primary')};outline-offset:3px}
.dshd-stage:focus-visible{outline-offset:-3px}
.dshd-halo{pointer-events:none}
.dshd-node,.dshd-edge{cursor:pointer}
.dshd-node:hover .dshd-shape{stroke-width:4}
.dshd-edge:hover path{stroke-width:4}
.dshd-chip{cursor:pointer}
.dshd-chip:hover rect{filter:brightness(1.15)}
.dshd-busy{font-size:11px;color:${V('label-secondary')}}
.dshd-changes{padding:6px 10px;font-size:11px;border-bottom:1px solid ${V('border-l2')};max-height:190px;overflow:auto;flex-shrink:0}
.dshd-changes p{margin:4px 0}
.dshd-comparison-controls{display:flex;flex-wrap:wrap;gap:8px}
.dshd-comparison-controls select{font:inherit;color:${V('label-primary')};background:${V('bg-layer-1')};border:1px solid ${V('border-l2')};border-radius:4px;padding:3px;max-width:100%}
.dshd-muted{color:${V('label-secondary')}}
.dshd-node-changes{border-top:1px solid ${V('border-l2')};margin-top:8px;padding-top:4px}
.dshd-node-changes h5{font-size:12px;margin:4px 0}
.dshd-node-changes li{overflow-wrap:anywhere}
.dshd-trace{padding:6px 10px;font-size:11px;border-bottom:1px solid ${V('border-l2')};max-height:150px;overflow:auto;flex-shrink:0}
.dshd-trace>div{display:inline;margin-right:8px}
.dshd-trace ul{padding-left:18px;margin:4px 0}
.dshd-trace details{margin-top:4px}
.dshd-sub{overflow-wrap:anywhere}
.dshd-workspace{position:relative;display:flex;flex:1;min-height:0;min-width:0}
.dshd-outline{position:absolute;inset:0;background:${V('bg-base')};overflow:auto;z-index:3}
.dshd-outline ul,.dshd-search ul{list-style:none;padding:0;margin:0}
.dshd-panel-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px}
.dshd-tree-row{display:flex;align-items:center;gap:6px;min-height:32px;cursor:pointer;padding-right:8px}
.dshd-tree-row:hover,.dshd-outline [role=treeitem]:focus-visible>.dshd-tree-row{background:${V('bg-layer-2')}}
.dshd-tree-row small{margin-left:auto;color:${V('label-secondary')};white-space:nowrap}
.dshd-tree-toggle{appearance:none;background:none;border:0;color:inherit;width:22px;padding:0;flex-shrink:0;font:inherit;cursor:pointer}
.dshd-outline [role=treeitem]:focus{outline:none}
.dshd-search{max-height:38%;min-height:48px;overflow:auto;border-bottom:1px solid ${V('border-l2')};flex-shrink:0}
.dshd-search input{min-width:0;flex:1;border:1px solid ${V('border-l2')};border-radius:6px;padding:6px 8px;color:${V('label-primary')};background:${V('bg-layer-1')};font:inherit}
.dshd-search li{padding:7px 12px;cursor:pointer}
.dshd-search li[aria-selected=true]{background:${V('bg-layer-2')}}
.dshd-search small{display:block;color:${V('label-secondary')};overflow-wrap:anywhere;margin-top:2px}
.dshd-search p{padding:0 12px;color:${V('label-secondary')}}
@keyframes dshd-reveal{0%,100%{opacity:0;stroke-width:3}40%{opacity:1;stroke-width:9}}
.dshd-reveal{pointer-events:none;animation:dshd-reveal 1.2s ease-out 2 forwards}
@media(prefers-reduced-motion:reduce){.dshd-reveal{animation:none;stroke-width:4}}
`

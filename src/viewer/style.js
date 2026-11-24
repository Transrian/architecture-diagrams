import { V, GROUP_COLOR } from './theme.js'

export const CSS = `
.archd-root{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;background:${V('bg-base')};color:${V('label-primary')};font-size:13px}
.archd-bar{display:flex;align-items:center;gap:4px 10px;padding:4px 10px;border-bottom:1px solid ${V('border-l1')};flex-wrap:wrap}
.archd-views{display:flex;align-items:center;gap:2px;flex:1 1 auto;min-width:0;overflow-x:auto;overflow-y:hidden;scrollbar-width:thin}
.archd-views>*{flex-shrink:0}
.archd-tab{appearance:none;display:inline-flex;flex-direction:column;align-items:center;border:0;border-bottom:2px solid transparent;border-radius:4px 4px 0 0;background:none;color:${V('label-secondary')};font:inherit;font-size:12px;line-height:18px;padding:3px 8px 1px;cursor:pointer;white-space:nowrap}
.archd-tab::after{content:attr(data-label);font-weight:600;height:0;overflow:hidden;visibility:hidden}
.archd-tab:hover{color:${V('label-primary')};background:${V('bg-interactive')}}
.archd-tab[aria-current=true]{color:${V('label-primary')};font-weight:600;border-bottom-color:${V('brand-primary')}}
.archd-sep{width:1px;height:16px;margin:0 6px;background:${V('border-l2')}}
.archd-tools{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap;flex:0 1 auto;min-width:0;margin-left:auto}
.archd-tool{display:inline-flex;align-items:center;justify-content:center;gap:5px}
.archd-btn{appearance:none;border:1px solid ${V('border-l1')};background:${V('bg-layer-1')};color:${V('label-primary')};border-radius:999px;padding:3px 10px;font:inherit;font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap}
.archd-btn:hover{border-color:${V('brand-primary')};background:${V('bg-interactive')}}
.archd-btn[aria-pressed=true]{background:${V('bg-interactive')};border-color:${V('brand-primary')};color:${V('label-primary')}}
.archd-btn:disabled{opacity:.4;cursor:default}
.archd-icon{padding:3px 7px;min-width:30px}
.archd-versions{display:inline-flex;align-items:center;gap:4px;padding:0 0 0 6px;border:1px solid ${V('border-l1')};border-radius:999px;background:${V('bg-layer-1')}}
.archd-versions .archd-btn{border-color:transparent;padding-top:2px;padding-bottom:2px}
.archd-versions .archd-btn[aria-pressed=true]{border-color:${V('brand-primary')}}
.archd-time{display:flex;align-items:center;gap:4px;color:${V('label-secondary')};font-size:12px}
.archd-time input{width:90px;accent-color:${V('brand-primary')}}
.archd-compact .archd-time input{width:64px}
.archd-crumbs{display:flex;align-items:center;gap:4px;padding:5px 12px;font-size:12px;color:${V('label-secondary')};border-bottom:1px solid ${V('border-l1')};flex-wrap:wrap}
.archd-crumbs button{appearance:none;border:0;background:none;padding:1px 4px;border-radius:4px;font:inherit;color:${V('label-secondary')};cursor:pointer}
.archd-crumbs button:hover{background:${V('bg-layer-1')};color:${V('label-primary')}}
.archd-crumbs button.archd-leave{margin-left:auto;border:1px solid ${V('border-l1')};border-radius:999px;padding:1px 9px;color:${V('label-primary')}}
.archd-crumbs b{color:${V('label-primary')};font-weight:600;padding:1px 4px}
.archd-stage{position:relative;flex:1;min-height:0;overflow:hidden;cursor:grab;touch-action:none}
.archd-stage.archd-drag{cursor:grabbing}
.archd-stage svg{display:block;width:100%;height:100%;user-select:none;-webkit-user-select:none}
.archd-msg{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:24px;text-align:center;color:${V('label-secondary')}}
.archd-msg b{color:${V('label-primary')};font-size:14px}
.archd-err{margin:6px 10px 0;padding:6px 10px;border-radius:8px;border:1px solid ${V('state-warn-primary')};color:${V('label-primary')};font-size:12px;max-height:96px;overflow:auto}
.archd-note{display:flex;align-items:center;gap:8px}
.archd-note>span{flex:1;min-width:0}
.archd-refused{border-color:${V('border-l2')}}
.archd-err code{display:block;color:${V('label-secondary')};white-space:pre-wrap;font-size:11px}
.archd-sub{padding:4px 10px;font-size:11px;color:${V('label-secondary')}}
.archd-legend{display:flex;align-items:center;gap:4px 10px;flex-wrap:wrap;padding:4px 10px;border-top:1px solid ${V('border-l1')};color:${V('label-secondary')};font-size:11px}
.archd-legend span{display:inline-flex;align-items:center;gap:4px}
.archd-legend-items{display:contents}
.archd-legend-items[hidden]{display:none}
.archd-btn.archd-legend-toggle{display:inline-flex;align-items:center;gap:4px;font-size:11px;line-height:16px;padding:1px 8px;color:${V('label-secondary')}}
.archd-dot{width:10px;height:10px;border-radius:3px;border:1.5px solid currentColor;background:color-mix(in srgb, currentColor 25%, transparent);display:inline-block}
.archd-detail{position:absolute;right:10px;bottom:10px;max-width:min(360px,calc(100% - 20px));max-height:calc(100% - 20px);overflow:auto;background:${V('bg-overlay')};border:1px solid ${V('border-l2')};border-radius:10px;padding:10px 12px;box-shadow:0 6px 24px rgba(0,0,0,.18);font-size:12px;cursor:default}
.archd-detail h4{margin:0 26px 4px 0;font-size:13px}
.archd-detail p{margin:4px 0;color:${V('label-secondary')};white-space:pre-wrap}
.archd-detail dl{display:grid;grid-template-columns:auto 1fr;gap:2px 8px;margin:6px 0 0}
.archd-detail dt{color:${V('label-secondary')}}
.archd-detail dd{margin:0;white-space:pre-wrap;min-width:0;overflow-wrap:anywhere}
.archd-detail ul{margin:4px 0 0;padding-left:16px}
.archd-x{appearance:none;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:24px;height:24px;padding:0;border:0;border-radius:6px;background:none;color:${V('label-secondary')};font:inherit;font-size:16px;line-height:1;cursor:pointer}
.archd-x:hover{background:${V('bg-interactive')};color:${V('label-primary')}}
.archd-detail>.archd-x{position:absolute;top:5px;right:5px}
.archd-detail>.archd-btn{margin-top:8px}
.archd-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.archd-trace-modes{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;margin-top:8px}
.archd-trace-label{color:${V('label-secondary')}}
.archd-segmented{display:inline-flex;border:1px solid ${V('border-l1')};border-radius:999px;overflow:hidden}
.archd-segmented .archd-btn{border:0;border-radius:0;border-left:1px solid ${V('border-l1')}}
.archd-segmented .archd-btn:first-child{border-left:0}
.archd-segmented .archd-btn[aria-pressed=true]{box-shadow:inset 0 -2px ${V('brand-primary')}}
.archd-pill{display:inline-block;white-space:nowrap;flex-shrink:0;border-radius:999px;padding:0 7px;font-size:11px;border:1px solid currentColor;margin-left:6px}
@keyframes archd-ants{to{stroke-dashoffset:-24}}
.archd-run{stroke-dasharray:8 4;animation:archd-ants 1.2s linear infinite}
.archd-edge-line{stroke-dasharray:var(--archd-edge-pattern,none)}
.archd-edge-run{stroke-dasharray:var(--archd-edge-pattern,8 4);animation:archd-ants 1.2s linear infinite}
@media (prefers-reduced-motion: reduce){.archd-run,.archd-edge-run{animation:none}.archd-edge-run{stroke-dasharray:var(--archd-edge-pattern,none)}}
.archd-sr-only{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}
.archd-root :focus-visible{outline:2px solid ${V('label-primary')};outline-offset:3px}
.archd-tab:focus-visible{outline-offset:-2px}
.archd-stage:focus-visible{outline-offset:-3px}
.archd-stage:not(.archd-keyboard):focus-visible{outline:none}
.archd-halo{pointer-events:none}
.archd-node,.archd-edge{cursor:pointer}
.archd-node:hover .archd-shape{stroke-width:4}
.archd-edge:hover path{stroke-width:4}
.archd-chip{cursor:pointer}
.archd-chip:hover rect{filter:brightness(1.15)}
.archd-busy{position:absolute;top:8px;left:8px;z-index:4;pointer-events:none;padding:2px 9px;border-radius:999px;border:1px solid ${V('border-l2')};background:${V('bg-overlay')};font-size:11px;color:${V('label-secondary')}}
.archd-help{position:absolute;top:8px;right:8px;z-index:6;box-sizing:border-box;width:min(400px,calc(100% - 16px));max-height:calc(100% - 16px);overflow:auto;padding:0 12px 10px;background:${V('bg-overlay')};border:1px solid ${V('border-l2')};border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.18);font-size:12px}
.archd-help:focus{outline:none}
.archd-help .archd-panel-head{padding:6px 0 2px}
.archd-help h5{margin:8px 0 4px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:${V('label-secondary')}}
.archd-help dl{display:grid;grid-template-columns:minmax(0,46%) 1fr;gap:4px 10px;margin:0}
.archd-help dt{color:${V('label-primary')}}
.archd-help dd{margin:0;color:${V('label-secondary')}}
.archd-help kbd{font:inherit;font-size:11px;padding:0 5px;border:1px solid ${V('border-l2')};border-bottom-width:2px;border-radius:4px;background:${V('bg-layer-1')};white-space:nowrap}
.archd-changes{padding:6px 10px;font-size:11px;border-bottom:1px solid ${V('border-l2')};max-height:190px;overflow:auto;flex-shrink:0}
.archd-changes p{margin:4px 0}
.archd-comparison-controls{display:flex;flex-wrap:wrap;gap:8px}
.archd-comparison-controls select{font:inherit;color:${V('label-primary')};background:${V('bg-layer-1')};border:1px solid ${V('border-l2')};border-radius:4px;padding:3px;max-width:100%}
.archd-muted{color:${V('label-secondary')}}
.archd-node-changes{border-top:1px solid ${V('border-l2')};margin-top:8px;padding-top:4px}
.archd-node-changes h5{font-size:12px;margin:4px 0}
.archd-node-changes li{overflow-wrap:anywhere}
.archd-trace{padding:6px 10px;font-size:11px;border-bottom:1px solid ${V('border-l2')};max-height:150px;overflow:auto;flex-shrink:0}
.archd-trace>div{display:inline;margin-right:8px}
.archd-trace ul{padding-left:18px;margin:4px 0}
.archd-trace details{margin-top:4px}
.archd-sub{overflow-wrap:anywhere}
.archd-workspace{position:relative;display:flex;flex:1;min-height:0;min-width:0}
.archd-area{position:relative;display:flex;flex:1;min-height:0;min-width:0}
.archd-outline{position:absolute;inset:0;background:${V('bg-base')};overflow:auto;z-index:3}
.archd-outline ul,.archd-search ul{list-style:none;padding:0;margin:0}
.archd-panel-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px}
.archd-tree-row{display:flex;align-items:center;gap:6px;min-height:32px;cursor:pointer;padding-right:8px}
.archd-tree-row:hover,.archd-outline [role=treeitem]:focus-visible>.archd-tree-row{background:${V('bg-interactive')}}
.archd-outline [aria-current=location]>.archd-tree-row{background:color-mix(in srgb, ${GROUP_COLOR} 14%, ${V('bg-base')});box-shadow:inset 3px 0 ${GROUP_COLOR}}
.archd-outline [aria-current=location]>.archd-tree-row .archd-tree-title{color:color-mix(in srgb, ${GROUP_COLOR} 55%, ${V('label-primary')});font-weight:600}
.archd-tree-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.archd-tree-row>[aria-hidden=true]{flex-shrink:0}
.archd-tree-row small{margin-left:auto;color:${V('label-secondary')};white-space:nowrap}
.archd-tree-toggle{appearance:none;background:none;border:0;color:inherit;width:22px;padding:0;flex-shrink:0;font:inherit;cursor:pointer}
.archd-outline [role=treeitem]:focus{outline:none}
.archd-outline [role=treeitem]:focus-visible>.archd-tree-row{outline:2px solid ${V('brand-primary')};outline-offset:-2px}
.archd-explorer{display:flex;flex-direction:column;min-height:0;min-width:0;background:${V('bg-base')};z-index:4}
.archd-explorer.archd-overlay{position:absolute;inset:0}
.archd-explorer.archd-docked{position:relative;flex:0 0 320px;width:320px;border-right:1px solid ${V('border-l1')}}
.archd-explorer>.archd-panel-head{border-bottom:1px solid ${V('border-l1')}}
.archd-explorer .archd-search,.archd-explorer .archd-outline-embedded{flex:1;min-height:0;overflow:auto}
.archd-outline.archd-outline-embedded{position:static;inset:auto;z-index:auto}
.archd-explorer input::-webkit-search-cancel-button{-webkit-appearance:none;appearance:none;display:none}
.archd-explorer input{min-width:0;flex:1;border:1px solid ${V('border-l2')};border-radius:6px;padding:6px 8px;color:${V('label-primary')};background:${V('bg-layer-1')};font:inherit}
.archd-search li{padding:7px 12px;cursor:pointer}
.archd-search li[aria-selected=true]{background:${V('bg-interactive')};box-shadow:inset 3px 0 ${V('brand-primary')}}
.archd-search small{display:block;color:${V('label-secondary')};overflow-wrap:anywhere;margin-top:2px}
.archd-search p{padding:0 12px;color:${V('label-secondary')}}
.archd-search p.archd-more{font-style:italic}
.archd-detail.archd-sheet{left:0;right:0;bottom:0;max-width:none;max-height:45%;border-radius:10px 10px 0 0;border-left:0;border-right:0;border-bottom:0}
@keyframes archd-reveal{0%,100%{opacity:0;stroke-width:3}40%{opacity:1;stroke-width:9}}
.archd-reveal{pointer-events:none;animation:archd-reveal 1.2s ease-out 2 forwards}
@media(prefers-reduced-motion:reduce){.archd-reveal{animation:none;stroke-width:4}}
`

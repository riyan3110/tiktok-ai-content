from pathlib import Path

index_path = Path('public/index.html')
html = index_path.read_text()
old_heading = '<section class="hero" id="studio"><div><span class="eyebrow">CONTENT STUDIO</span><h1>Buat konten yang<br><em>layak dihentikan.</em></h1><p>Rancang carousel TikTok, tinjau hasilnya, lalu kirim sebagai draft dalam satu alur kerja.</p></div>'
new_heading = '<section class="hero" id="studio"><div><span class="eyebrow">CONTENT STUDIO</span><h1>Text Content</h1><p>Rancang carousel TikTok, tinjau hasilnya, lalu kirim sebagai draft dalam satu alur kerja.</p></div>'
assert old_heading in html, 'Text Content hero marker not found'
html = html.replace(old_heading, new_heading, 1)
index_path.write_text(html)

css_path = Path('public/style.css')
css = css_path.read_text()
marker = '/* Text Content responsive layout */'
assert marker not in css, 'responsive layout patch already present'
css += r'''

/* Text Content responsive layout */
#legacy-studio{width:100%;min-width:0}
#legacy-studio .hero{align-items:center;gap:32px;margin-bottom:24px;padding:12px 0 8px}
#legacy-studio .hero h1{max-width:none;margin:10px 0 10px;font-size:clamp(2.25rem,4vw,4rem);line-height:1;letter-spacing:-.045em}
#legacy-studio .hero p{max-width:760px}
#legacy-studio .content-layout{width:100%;min-width:0}
#legacy-studio .actions,#legacy-studio #editor,#legacy-studio #schedule-dashboard,#legacy-studio .history-section,#legacy-studio .trend-reference{min-width:0}
#legacy-studio .actions{width:100%}
#legacy-studio .asset-attachment,#legacy-studio .selected-assets{min-width:0}
#legacy-studio .asset-attachment button{max-width:100%}

@media(min-width:1024px){
  #legacy-studio .content-layout{grid-template-columns:minmax(420px,.9fr) minmax(0,1.6fr);grid-template-areas:"trends trends" "actions editor" "schedule schedule" "history history";align-items:start}
  #legacy-studio .content-layout:has(#editor.hidden){grid-template-columns:minmax(0,1fr);grid-template-areas:"trends" "actions" "schedule" "history"}
  #legacy-studio .content-layout:has(#editor.hidden) .actions{max-width:none}
  #legacy-studio .actions{padding:28px}
  #legacy-studio .trend-reference,#legacy-studio #schedule-dashboard,#legacy-studio .history-section{padding:26px 28px}
}

@media(max-width:1023px){
  #legacy-studio .hero{display:block;margin-bottom:18px;padding:8px 0}
  #legacy-studio .hero h1{font-size:clamp(2rem,8vw,3rem)}
  #legacy-studio .hero-stat{width:100%;max-width:520px;margin-top:18px}
  #legacy-studio .content-layout{grid-template-columns:minmax(0,1fr);grid-template-areas:"trends" "actions" "editor" "schedule" "history"}
}

@media(max-width:767px){
  .page-content:has(#legacy-studio:not(.hidden)){width:calc(100% - 20px);padding-top:18px}
  body:has(#legacy-studio:not(.hidden)) .topbar{padding-inline:10px}
  body:has(#legacy-studio:not(.hidden)) .topbar-title{min-width:0;margin-left:8px}
  body:has(#legacy-studio:not(.hidden)) .topbar-title strong{font-size:.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  body:has(#legacy-studio:not(.hidden)) .topbar-actions{gap:5px}
  #legacy-studio .hero{padding:4px 2px 10px}
  #legacy-studio .hero h1{margin:6px 0 8px;font-size:2.1rem;letter-spacing:-.04em}
  #legacy-studio .hero p{font-size:.9rem;line-height:1.55}
  #legacy-studio .hero-stat{display:none}
  #legacy-studio .actions,#legacy-studio #editor,#legacy-studio #schedule-dashboard,#legacy-studio .history-section,#legacy-studio .trend-reference{padding:16px;border-radius:14px}
  #legacy-studio .trend-summary{gap:14px}
  #legacy-studio .trend-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));width:100%;gap:8px}
  #legacy-studio .trend-actions button{width:100%;min-width:0}
  #legacy-studio .trend-actions .danger{grid-column:1/-1}
  #legacy-studio .background-heading button{width:100%}
  #legacy-studio .background-options{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
  #legacy-studio .background-upload-option{grid-column:auto}
  #legacy-studio .background-upload-option .background-swatch{aspect-ratio:1.45}
  #legacy-studio .segment-options{grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}
  #legacy-studio .segment-options span{min-height:52px;padding:7px 5px;font-size:.76rem;line-height:1.2}
  #legacy-studio .option-grid{gap:12px}
  #legacy-studio .generate-row{align-items:stretch}
  #legacy-studio .generate-row>button{width:100%}
  #legacy-studio .asset-attachment{padding:14px}
  #legacy-studio .job{gap:10px}
}

@media(max-width:380px){
  #legacy-studio .segment-options{grid-template-columns:1fr}
  #legacy-studio .trend-actions{grid-template-columns:1fr}
  #legacy-studio .trend-actions .danger{grid-column:auto}
}
'''
css_path.write_text(css)

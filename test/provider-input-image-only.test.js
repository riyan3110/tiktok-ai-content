const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=path=>fs.readFileSync(path,'utf8');
test('credential fields remain editable while provider actions are pending',()=>{
 const script=read('public/ai-providers-simple.js');
 assert.match(script,/inputmode="url" autocapitalize="none"/);
 assert.match(script,/AbortSignal\.timeout\(30000\)/);
 assert.match(script,/input\[type="checkbox"\].*node\.disabled = busy/);
 assert.doesNotMatch(script,/button, #simple-provider-root input'\)/);
 assert.match(script,/if \(keyInput\.value\.trim\(\) === apiKey\)/);
});
test('fallback checkbox is excluded from full width mobile fields and has fixed dimensions',()=>{
 assert.match(read('public/provider-mobile-host-fix.js'),/input:not\(\[type="checkbox"\]\)/);
 const script=read('public/ai-providers-simple.js');
 assert.match(script,/max-width:20px!important/);
 assert.match(script,/max-height:20px!important/);
});
test('Studio offers image, batch and history while home advertises image generation only',()=>{
 const html=read('public/index.html');
 assert.doesNotMatch(html,/data-studio-type="video"|Generate image dan video/);
 for(const mode of ['image','batch','history'])assert.ok(html.includes(`data-studio-type="${mode}"`));
 assert.doesNotMatch(read('public/floating-chat-theme.js'),/Generate image\/video/);
 assert.match(read('public/content-studio.js'),/\['image','batch','history'\]\.includes\(next\)/);
});

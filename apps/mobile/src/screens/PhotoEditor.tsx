import { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { fromBase64, toBase64, type OutgoingFile } from '@meetme/core';
import { useBack } from '../ui';

/**
 * Edit a photo before sending, like WhatsApp: rotate, crop, draw and add text. The editor is a canvas page in the
 * app's own WebView (no extra library, nothing loads from the network); the photo stays in memory and comes back
 * as a JPEG.
 */
const PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
*{box-sizing:border-box;-webkit-user-select:none;user-select:none}html,body{margin:0;height:100%;background:#05070c;color:#fff;font:15px system-ui,sans-serif;overflow:hidden}
#bar{display:flex;gap:6px;align-items:center;padding:10px;padding-top:max(10px,env(safe-area-inset-top))}
#bar button{background:rgba(255,255,255,.12);color:#fff;border:0;border-radius:18px;padding:8px 12px;font-size:14px}
#bar button.on{background:#2455d8}#bar .grow{flex:1}#done{background:#16a34a!important;font-weight:600}
#colors{display:none;justify-content:center;gap:10px;padding:4px}#colors.show{display:flex}
#colors b{width:28px;height:28px;border-radius:50%;border:2px solid rgba(255,255,255,.4);display:block}#colors b.on{border-color:#fff;transform:scale(1.15)}
#stage{position:absolute;top:110px;bottom:60px;left:0;right:0;display:flex;align-items:center;justify-content:center}
canvas{max-width:100%;max-height:100%;touch-action:none}
#hint{position:absolute;bottom:0;left:0;right:0;text-align:center;padding:16px;color:#9ca3af;font-size:13px}
#textbox{display:none;position:absolute;top:110px;left:12px;right:12px;gap:8px}#textbox.show{display:flex}
#textbox input{flex:1;font-size:16px;padding:10px;border-radius:10px;border:0}
#textbox button{border:0;border-radius:10px;padding:0 14px;background:#2455d8;color:#fff;font-size:15px}
</style></head><body>
<div id="bar"><button id="cancel">✕</button><span class="grow"></span><button data-t="crop">Crop</button><button id="rot">⟳</button><button data-t="draw">Draw</button><button data-t="text">Text</button><button id="undo">Undo</button><button id="done">Done</button></div>
<div id="colors"></div><div id="textbox"><input id="tin" maxlength="80" placeholder="Text on the photo"><button id="tadd">Add</button></div>
<div id="stage"><canvas id="c"></canvas></div><div id="hint"></div>
<script>
var post=function(m){window.ReactNativeWebView.postMessage(JSON.stringify(m))};
var COLORS=['#ffffff','#101828','#f04438','#fdb022','#12b76a','#2e90fa','#9e77ed'],color=COLORS[2];
var img=null,rot=0,crop=null,strokes=[],tool=null,drag=null,draft=null,textAt=null;
var c=document.getElementById('c'),ctx=c.getContext('2d');
function W(){return rot%2?img.height:img.width}function H(){return rot%2?img.width:img.height}
function view(){return tool==='crop'?{x:0,y:0,w:W(),h:H()}:(crop||{x:0,y:0,w:W(),h:H()})}
function paint(g,a,w,h){var k=w/a.w;g.save();g.fillStyle='#fff';g.fillRect(0,0,w,h);g.scale(k,k);g.translate(-a.x,-a.y);
 g.save();g.translate(W()/2,H()/2);g.rotate(rot*Math.PI/2);g.drawImage(img,-img.width/2,-img.height/2);g.restore();
 strokes.forEach(function(s){if(s.kind==='draw'){g.strokeStyle=s.color;g.lineWidth=s.width;g.lineCap=g.lineJoin='round';g.beginPath();
  s.points.forEach(function(p,i){i?g.lineTo(p[0],p[1]):g.moveTo(p[0],p[1])});g.stroke()}else{g.font='600 '+s.size+'px system-ui,sans-serif';
  g.textAlign='center';g.textBaseline='middle';g.lineWidth=s.size/8;g.strokeStyle=s.color==='#101828'?'#fff':'#101828';g.strokeText(s.text,s.x,s.y);g.fillStyle=s.color;g.fillText(s.text,s.x,s.y)}});
 g.restore()}
function draw(){if(!img)return;var st=document.getElementById('stage'),a=view(),k=Math.min(st.clientWidth/a.w,st.clientHeight/a.h,1);
 c.width=Math.round(a.w*k);c.height=Math.round(a.h*k);paint(ctx,a,c.width,c.height);var b=draft||(tool==='crop'?crop:null);
 if(b){ctx.save();ctx.fillStyle='rgba(0,0,0,.5)';ctx.beginPath();ctx.rect(0,0,c.width,c.height);ctx.rect(b.x*k,b.y*k,b.w*k,b.h*k);ctx.fill('evenodd');ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.strokeRect(b.x*k,b.y*k,b.w*k,b.h*k);ctx.restore()}
 document.getElementById('hint').textContent=tool==='crop'?'Drag over the part to keep':tool==='draw'?'Draw with your finger':tool==='text'?'Tap where the text goes':'';
 document.querySelectorAll('[data-t]').forEach(function(b){b.className=b.dataset.t===tool?'on':''});
 document.getElementById('colors').className=(tool==='draw'||tool==='text')?'show':''}
function at(e){var r=c.getBoundingClientRect(),a=view(),t=e.touches?e.touches[0]:e;return[a.x+(t.clientX-r.left)/r.width*a.w,a.y+(t.clientY-r.top)/r.height*a.h]}
function down(e){if(!img)return;var p=at(e);e.preventDefault();
 if(tool==='text'){textAt=p;document.getElementById('textbox').className='show';document.getElementById('tin').focus();return}
 if(tool==='draw'){var s={kind:'draw',color:color,width:Math.max(4,view().w/120),points:[p]};strokes.push(s);drag={start:p,stroke:s}}else if(tool==='crop')drag={start:p}}
function move(e){if(!drag)return;e.preventDefault();var p=at(e);if(drag.stroke){drag.stroke.points.push(p)}else{var s=drag.start,x=Math.max(0,Math.min(s[0],p[0])),y=Math.max(0,Math.min(s[1],p[1]));
 draft={x:x,y:y,w:Math.min(W(),Math.max(s[0],p[0]))-x,h:Math.min(H(),Math.max(s[1],p[1]))-y}}draw()}
function up(){drag=null;if(tool==='crop'&&draft&&draft.w>20&&draft.h>20){crop=draft;tool=null}draft=null;draw()}
c.addEventListener('touchstart',down,{passive:false});c.addEventListener('touchmove',move,{passive:false});c.addEventListener('touchend',up);
c.addEventListener('mousedown',down);c.addEventListener('mousemove',move);c.addEventListener('mouseup',up);
document.querySelectorAll('[data-t]').forEach(function(b){b.onclick=function(){tool=tool===b.dataset.t?null:b.dataset.t;draw()}});
document.getElementById('rot').onclick=function(){rot=(rot+1)%4;crop=null;strokes=[];draw()};
document.getElementById('undo').onclick=function(){if(strokes.length)strokes.pop();else crop=null;draw()};
document.getElementById('cancel').onclick=function(){post({type:'cancel'})};
document.getElementById('tadd').onclick=function(){var t=document.getElementById('tin').value.trim();if(t&&textAt)strokes.push({kind:'text',color:color,size:Math.max(28,view().w/12),x:textAt[0],y:textAt[1],text:t});
 document.getElementById('tin').value='';document.getElementById('textbox').className='';textAt=null;draw()};
var cl=document.getElementById('colors');COLORS.forEach(function(x){var b=document.createElement('b');b.style.background=x;b.onclick=function(){color=x;cl.querySelectorAll('b').forEach(function(y){y.className=''});b.className='on'};if(x===color)b.className='on';cl.appendChild(b)});
document.getElementById('done').onclick=function(){if(!img)return;var a=crop||{x:0,y:0,w:W(),h:H()},k=Math.min(1,1600/Math.max(a.w,a.h)),o=document.createElement('canvas');
 o.width=Math.round(a.w*k);o.height=Math.round(a.h*k);paint(o.getContext('2d'),a,o.width,o.height);var u=o.toDataURL('image/jpeg',.85);post({type:'done',data:u.slice(u.indexOf(',')+1)})};
function load(m){var i=new Image();i.onload=function(){img=i;draw()};i.onerror=function(){post({type:'cancel'})};i.src='data:'+m.mime+';base64,'+m.data}
function onmsg(e){try{var m=JSON.parse(e.data);if(m.type==='load')load(m)}catch(_){}}
document.addEventListener('message',onmsg);window.addEventListener('message',onmsg);window.addEventListener('resize',draw);post({type:'ready'});
</script></body></html>`;

export function PhotoEditor({ file, onDone, onCancel }: { file: OutgoingFile; onDone: (f: OutgoingFile) => void; onCancel: () => void }) {
  useBack(onCancel);
  const ref = useRef<WebView<{}>>(null);
  const [loading, setLoading] = useState(true);
  const onMessage = (e: WebViewMessageEvent) => {
    let m: { type: string; data?: string };
    try {
      m = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (m.type === 'ready') {
      ref.current?.postMessage(JSON.stringify({ type: 'load', mime: file.mime, data: toBase64(file.data) }));
      setLoading(false);
    } else if (m.type === 'cancel') onCancel();
    else if (m.type === 'done' && m.data) {
      onDone({ name: `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.jpg`, mime: 'image/jpeg', data: fromBase64(m.data) });
    }
  };
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#05070c' }]}>
      <WebView
        ref={ref}
        source={{ html: PAGE, baseUrl: 'about:blank' }}
        originWhitelist={['about:blank']}
        onShouldStartLoadWithRequest={(r) => r.url === 'about:blank'}
        onMessage={onMessage}
        javaScriptEnabled
        cacheEnabled={false}
        incognito
        allowFileAccess={false}
        setSupportMultipleWindows={false}
        scrollEnabled={false}
        style={{ flex: 1, backgroundColor: '#05070c' }}
      />
      {loading && (
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
          <ActivityIndicator color="#fff" />
        </View>
      )}
    </View>
  );
}

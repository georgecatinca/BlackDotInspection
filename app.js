/* BlackDotInspection V3 BETA: demonstrator, nu sistem metrologic validat. */
'use strict';
const $=id=>document.getElementById(id);
const video=$('camera'),overlay=$('overlay'),view=$('view'),oc=overlay.getContext('2d');
const W=320,H=240; overlay.width=W;overlay.height=H;
const frame=document.createElement('canvas');frame.width=W;frame.height=H;
const fc=frame.getContext('2d',{willReadFrequently:true});
let stream=null,timer=null,auto=false,drawMode=null,drawStart=null;
let pieceRect={x:60,y:25,w:200,h:190};
let markRect={x:141,y:103,w:38,h:34};
let emptyRef=null,pieceRef=null,markRef=null,absentRef=null;
let total=0,ok=0,nok=0,lastDecision='',machine='WAIT',seen=0,gone=0,arrivedAt=0;
let lastFrame=null,lastFrameTime=0;
const settings=['pieceTh','match','tol','size'];
let recentScore=null;
function say(msg){$('log').textContent=msg;}
function status(msg,cls='idle'){$('result').textContent=msg;$('result').className='result '+cls;}
function count(){total=ok+nok;$('total').textContent=total;$('ok').textContent=ok;$('nok').textContent=nok;}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function normRect(r){const x=clamp(Math.round(r.x),0,W-2),y=clamp(Math.round(r.y),0,H-2);return {x,y,w:clamp(Math.round(r.w),2,W-x),h:clamp(Math.round(r.h),2,H-y)};}
function setting(id){return Number($(id).value);}
function updateSettings(){settings.forEach(id=>$(id+'Out').textContent=$(id).value);$('mode').textContent=$('anywhere').checked?'Oriunde':'Poziție fixă';drawOverlay();}
function drawOverlay(){oc.clearRect(0,0,W,H);function box(r,color,label){oc.strokeStyle=color;oc.lineWidth=2;oc.strokeRect(r.x,r.y,r.w,r.h);oc.fillStyle=color;oc.font='bold 11px sans-serif';oc.fillText(label,r.x+2,Math.max(12,r.y-4));}box(pieceRect,'#38bdf8','PIESĂ / CĂUTARE');box(markRect,'#facc15','BULINĂ');if(drawStart&&drawStart.end){const x=Math.min(drawStart.x,drawStart.end.x),y=Math.min(drawStart.y,drawStart.end.y);const w=Math.abs(drawStart.x-drawStart.end.x),h=Math.abs(drawStart.y-drawStart.end.y);box({x,y,w,h},'#f472b6','NOU');}}
function capture(){if(!stream||!video.videoWidth)return null;fc.fillStyle='#000';fc.fillRect(0,0,W,H);const a=video.videoWidth/video.videoHeight,b=W/H;let dw,dh,x,y;if(a>b){dw=W;dh=W/a;x=0;y=(H-dh)/2;}else{dh=H;dw=H*a;y=0;x=(W-dw)/2;}fc.drawImage(video,x,y,dw,dh);const rgba=fc.getImageData(0,0,W,H).data;const gray=new Uint8Array(W*H);for(let i=0,k=0;i<rgba.length;i+=4,k++)gray[k]=Math.round(.299*rgba[i]+.587*rgba[i+1]+.114*rgba[i+2]);return gray;}
function extract(img,r,outW=0,outH=0){r=normRect(r);outW=outW||r.w;outH=outH||r.h;const out=new Array(outW*outH);for(let j=0;j<outH;j++){const sy=clamp(Math.floor(r.y+(j+.5)*r.h/outH),0,H-1);for(let i=0;i<outW;i++){const sx=clamp(Math.floor(r.x+(i+.5)*r.w/outW),0,W-1);out[j*outW+i]=img[sy*W+sx];}}return out;}
const PW=64,PH=64;
function avgDiff(a,b){if(!a||!b||a.length!==b.length)return Infinity;let sum=0;for(let i=0;i<a.length;i++)sum+=Math.abs(a[i]-b[i]);return sum/a.length;}
function correlation(a,b){if(!a||!b||a.length!==b.length)return -1;let ma=0,mb=0;for(let i=0;i<a.length;i++){ma+=a[i];mb+=b[i];}ma/=a.length;mb/=b.length;let num=0,va=0,vb=0;for(let i=0;i<a.length;i++){let da=a[i]-ma,db=b[i]-mb;num+=da*db;va+=da*da;vb+=db*db;}if(va<1||vb<1)return -1;return num/Math.sqrt(va*vb);}
function calState(){let s=[];if(!emptyRef)s.push('bandă goală');if(!pieceRef)s.push('piesă');if(!markRef)s.push('bulină prezentă');if(!absentRef)s.push('bulină absentă');$('cal').textContent=s.length?'Lipsesc: '+s.join(', '):'Completă';}
function getPieceInfo(img){if(!emptyRef||!pieceRef)return null;const patch=extract(img,pieceRect,PW,PH);let de=avgDiff(patch,emptyRef),dp=avgDiff(patch,pieceRef),sep=avgDiff(emptyRef,pieceRef);$('diff').textContent=de.toFixed(1)+' / etalon '+sep.toFixed(1);if(sep<6)return {present:false,invalid:true};let threshold=sep*setting('pieceTh')/100;return {present:de>Math.max(3,threshold)&&dp<de*1.25,de,dp,sep};}
const TW=24,TH=24;
function patchAt(img,x,y,w,h){return extract(img,{x,y,w,h},TW,TH);}
function evaluateMark(img){if(!markRef||!absentRef)return null;
const tol=setting('tol'),sizeTol=setting('size')/100;
const scaleFactors=sizeTol===0?[1]:[1-sizeTol,1,1+sizeTol];let best={score:-2,x:0,y:0,w:0,h:0};
const anywhere=$('anywhere').checked;
const region=anywhere?pieceRect:{x:Math.max(0,markRect.x-tol),y:Math.max(0,markRect.y-tol),w:markRect.w+2*tol,h:markRect.h+2*tol};
for(const factor of scaleFactors){const w=clamp(Math.round(markRect.w*factor),8,110),h=clamp(Math.round(markRect.h*factor),8,110);let xMin=clamp(region.x,0,W-w),xMax=clamp(region.x+region.w-w,0,W-w),yMin=clamp(region.y,0,H-h),yMax=clamp(region.y+region.h-h,0,H-h);
if(!anywhere){xMin=clamp(markRect.x-tol,0,W-w);xMax=clamp(markRect.x+tol,0,W-w);yMin=clamp(markRect.y-tol,0,H-h);yMax=clamp(markRect.y+tol,0,H-h);}
const step=anywhere?4:Math.max(1,Math.floor(tol/4)+1);
function probe(x,y){const candidate=patchAt(img,x,y,w,h);const score=correlation(candidate,markRef);if(score>best.score)best={score,x,y,w,h,candidate};}
for(let y=yMin;y<=yMax;y+=step)for(let x=xMin;x<=xMax;x+=step)probe(x,y);
if(anywhere&&best.score>-1){const bx=best.x,by=best.y;for(let y=Math.max(yMin,by-4);y<=Math.min(yMax,by+4);y++)for(let x=Math.max(xMin,bx-4);x<=Math.min(xMax,bx+4);x++)probe(x,y);}
}
const absentScore=correlation(best.candidate,absentRef);
let valid=best.score>=setting('match');
if(!anywhere&&absentScore>=best.score-0.05)valid=false;
$('score').textContent=best.score.toFixed(3)+' / absent '+absentScore.toFixed(3);
recentScore=best;return {valid,...best,absentScore};}
function inspect(img,automatic=false){if(!img){say('Camera nu oferă imagine.');return;}if(!markRef||!absentRef){status('NECALIBRAT','warning');say('Calibrează întâi bulina prezentă și absentă.');return;}const test=evaluateMark(img);if(!test){say('Verificare indisponibilă.');return;}
const uncertain=test.score>=setting('match')-0.06&&!test.valid;
if(test.valid){status('OK – BULINĂ PREZENTĂ','okresult');lastDecision='OK';if(automatic){ok++;count();}}
else{status(uncertain?'NOK – VERIFICARE NECESARĂ':'NOK – BULINĂ LIPSĂ / INCORECTĂ',uncertain?'warning':'nokresult');lastDecision='NOK';if(automatic){nok++;count();}}
say((automatic?'Automat: ':'Manual: ')+lastDecision+' · scor '+test.score.toFixed(3)+(uncertain?' · rezultat nesigur, clasificat NOK':''));return test;}
function loop(){const img=capture();if(!img)return;lastFrame=img;lastFrameTime=Date.now();if(!auto)return;
const info=getPieceInfo(img);if(!info){say('Pentru AUTO calibrează banda goală și piesa prezentă.');stopAuto();return;}if(info.invalid){status('CALIBRARE PIESĂ SLABĂ','warning');return;}
$('belt').textContent=info.present?'Piesă vizibilă':'Fundal / fără piesă';
if(machine==='WAIT'){
if(info.present){seen++;if(seen>=2){machine='ARRIVED';arrivedAt=Date.now();seen=0;status('PIESĂ DETECTATĂ','running');}}else seen=0;
}else if(machine==='ARRIVED'){
if(!info.present){machine='WAIT';seen=0;status('PIESĂ PLECATĂ PREA REPEDE','warning');say('Piesa nu a rămas suficient pentru analiză; verificați viteza.');}
else if(Date.now()-arrivedAt>=180){inspect(img,true);machine='LOCKED';gone=0;}
}else if(machine==='LOCKED'){
if(!info.present){gone++;if(gone>=2){machine='WAIT';gone=0;seen=0;status('AȘTEPTARE PIESĂ','idle');}}
else gone=0;
}}
async function startCamera(){if(stream)return;if(!navigator.mediaDevices?.getUserMedia){status('HTTPS NECESAR','nokresult');return;}$('start').disabled=true;try{stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}}});video.srcObject=stream;await video.play();$('hint').textContent='Trasează zonele după ce pornește camera';status('CAMERA ACTIVĂ','running');timer=setInterval(loop,110);say('Camera pornită. Configurează cele două zone și calibrările.');}catch(e){status('EROARE CAMERA','nokresult');say(e.name+': '+e.message);$('start').disabled=false;}}
function stopAuto(){auto=false;machine='WAIT';seen=0;gone=0;$('automatic').textContent='AUTO INSPECT: OFF';$('automatic').className='purple';}
function stopCamera(){stopAuto();if(timer){clearInterval(timer);timer=null;}if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}video.pause();video.srcObject=null;$('start').disabled=false;status('CAMERA OPRITĂ','idle');}
function calibration(kind){if(auto){say('Oprește AUTO înainte de calibrare.');return;}const img=capture();if(!img){say('Pornește camera întâi.');return;}if(kind==='empty'){emptyRef=extract(img,pieceRect,PW,PH);say('Referința BENZII GOALE salvată.');}if(kind==='piece'){pieceRef=extract(img,pieceRect,PW,PH);say('Referința PIESEI PREZENTE salvată.');}if(kind==='mark'){markRef=patchAt(img,markRect.x,markRect.y,markRect.w,markRect.h);say('Modelul BULINĂ PREZENTĂ salvat.');}if(kind==='absent'){absentRef=patchAt(img,markRect.x,markRect.y,markRect.w,markRect.h);say('Modelul BULINĂ ABSENTĂ salvat.');}calState();}
function setRegion(kind){if(auto){say('Oprește AUTO ca să modifici zonele.');return;}drawMode=kind;$('hint').textContent=kind==='piece'?'Trasează pe imagine zona de detectare a piesei':'Trasează un dreptunghi strâns în jurul bulinei';}
function toPoint(e){const r=overlay.getBoundingClientRect();return {x:clamp(Math.round((e.clientX-r.left)*W/r.width),0,W-1),y:clamp(Math.round((e.clientY-r.top)*H/r.height),0,H-1)};}
overlay.addEventListener('pointerdown',e=>{if(!drawMode)return;overlay.setPointerCapture(e.pointerId);const p=toPoint(e);drawStart={...p,end:p};drawOverlay();});
overlay.addEventListener('pointermove',e=>{if(!drawStart)return;drawStart.end=toPoint(e);drawOverlay();});
overlay.addEventListener('pointerup',e=>{if(!drawStart)return;const p=toPoint(e),x=Math.min(drawStart.x,p.x),y=Math.min(drawStart.y,p.y),w=Math.abs(drawStart.x-p.x),h=Math.abs(drawStart.y-p.y);if(w<8||h<8){say('Trasează un dreptunghi mai mare.');drawStart=null;drawOverlay();return;}const r=normRect({x,y,w,h});if(drawMode==='piece'){pieceRect=r;emptyRef=null;pieceRef=null;}else{markRect=r;markRef=null;absentRef=null;}drawMode=null;drawStart=null;drawOverlay();calState();say('Zonă mutată. Recalibrează referințele corespunzătoare.');});
$('start').onclick=startCamera;$('stop').onclick=stopCamera;$('setPiece').onclick=()=>setRegion('piece');$('setMark').onclick=()=>setRegion('mark');$('calEmpty').onclick=()=>calibration('empty');$('calPiece').onclick=()=>calibration('piece');$('calMark').onclick=()=>calibration('mark');$('calNoMark').onclick=()=>calibration('absent');
$('manual').onclick=()=>inspect(capture(),false);
$('automatic').onclick=()=>{if(auto){stopAuto();say('AUTO oprit.');return;}if(!emptyRef||!pieceRef||!markRef||!absentRef){say('Lipsesc calibrări. Urmărește lista de la Calibrare.');calState();return;}auto=true;machine='WAIT';seen=0;gone=0;$('automatic').textContent='AUTO INSPECT: ON';$('belt').textContent='Monitorizare';say('AUTO pornit: fiecare piesă numărată o singură dată după detectarea sosirii.');};
$('reset').onclick=()=>{if(!confirm('Resetezi contoarele OK/NOK/TOTAL?'))return;ok=0;nok=0;count();say('Contoare resetate.');};
$('anywhere').onchange=updateSettings;settings.forEach(id=>$(id).addEventListener('input',updateSettings));
$('save').onclick=()=>{try{localStorage.setItem('blackdot_v3',JSON.stringify({pieceRect,markRect,emptyRef,pieceRef,markRef,absentRef,ok,nok,values:Object.fromEntries(settings.map(id=>[id,$(id).value])),anywhere:$('anywhere').checked}));say('Setări și contoare salvate în acest browser pe acest iPhone.');}catch(e){say('Nu s-a putut salva: '+e.message);}};
try{const s=JSON.parse(localStorage.getItem('blackdot_v3')||'null');if(s){pieceRect=normRect(s.pieceRect||pieceRect);markRect=normRect(s.markRect||markRect);emptyRef=s.emptyRef||null;pieceRef=s.pieceRef||null;markRef=s.markRef||null;absentRef=s.absentRef||null;ok=s.ok||0;nok=s.nok||0;$('anywhere').checked=!!s.anywhere;settings.forEach(id=>{if(s.values&&s.values[id]!==undefined)$(id).value=s.values[id];});say('Setările anterioare au fost încărcate.');}}catch(e){say('Setările salvate nu au putut fi citite.');}
window.addEventListener('pagehide',stopCamera);document.addEventListener('visibilitychange',()=>{if(document.hidden&&stream)stopAuto();});
count();calState();updateSettings();drawOverlay();

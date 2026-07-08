/* ============================================================
   Module: Utils
   責務: throttle/debounce/geometry
   ============================================================ */
const Utils=(() => {
  function throttle(fn,ms){let last=0,tid=null;return(...a)=>{const now=Date.now();const rem=ms-(now-last);if(rem<=0){clearTimeout(tid);last=now;fn(...a);}else{clearTimeout(tid);tid=setTimeout(()=>{last=Date.now();fn(...a);},rem);}};  }
  function debounce(fn,ms){let tid=null;return(...a)=>{clearTimeout(tid);tid=setTimeout(()=>fn(...a),ms);};}
  function safeKey(s){
    /* V3.15: 非ASCII(日本語等)が全て'_'に潰れ、同じ長さのファイル名同士でキーが衝突し
       別PDFの書き込みデータが復元される問題を修正 — フルネームのハッシュを付与して一意化 */
    let h=5381;for(let i=0;i<s.length;i++)h=(((h<<5)+h)^s.charCodeAt(i))>>>0;
    return s.replace(/[^a-zA-Z0-9._-]/g,'_').substring(0,80)+'_'+h.toString(36);
  }
  /* 点からセグメントへの最短距離 */
  function distPtSeg(px,py,ax,ay,bx,by){
    const dx=bx-ax,dy=by-ay,len2=dx*dx+dy*dy;
    if(len2===0)return Math.hypot(px-ax,py-ay);
    const t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/len2));
    return Math.hypot(px-(ax+t*dx),py-(ay+t*dy));
  }
  function ptInPoly(px,py,poly){
    let inside=false;
    for(let i=0,j=poly.length-1;i<poly.length;j=i++){
      const[xi,yi]=poly[i],[xj,yj]=poly[j];
      if(((yi>py)!==(yj>py))&&(px<(xj-xi)*(py-yi)/(yj-yi)+xi))inside=!inside;
    }
    return inside;
  }
  function strokeBBox(s){
    if(!s||s.type==='eraser')return null;
    if(s.points){const xs=s.points.map(p=>p[0]),ys=s.points.map(p=>p[1]);return{x1:Math.min(...xs),y1:Math.min(...ys),x2:Math.max(...xs),y2:Math.max(...ys)};}
    /* v16: text bbox削除 */
    return{x1:Math.min(s.x1,s.x2),y1:Math.min(s.y1,s.y2),x2:Math.max(s.x1,s.x2),y2:Math.max(s.y1,s.y2)};
  }
  /* v60: isPalmContact 閾値を25→45pxに緩和
     iPad指タッチ: 20〜35px / 手のひら: 60〜100px
     25pxは正常な指タッチも拒否していたため45pxに変更 */
  function isPalmContact(t){
    if(!t)return false;
    if(t.touchType==='stylus'||t.pointerType==='pen')return false;
    const rx=t.radiusX||t.width/2||0,ry=t.radiusY||t.height/2||0;
    if(!rx&&!ry)return false;
    return rx>45&&ry>45; /* v60: OR→AND に変更 + 閾値45px。両軸超過時のみ手のひら判定 */
  }
  /* v16: text/shapeもフィルタ (読込時に無視) */
  const _VALID_TYPES=new Set(['pen','hl','eraser']);
  function pruneEraserStrokes(strks){
    const r={};
    for(const[pg,arr]of Object.entries(strks||{})){
      const f=(arr||[]).filter(s=>_VALID_TYPES.has(s.type));
      if(f.length)r[pg]=f;
    }
    return r;
  }
  function cloneStrokes(strks){
    return typeof structuredClone==='function'?structuredClone(strks):JSON.parse(JSON.stringify(strks));
  }
  /* PDF座標変換ヘルパー (v6新規) */
  /* PDF user space → canvas pixel: t = viewport.transform = [a,b,c,d,e,f] */
  function pdfToCanvas(px,py,t){return{x:t[0]*px+t[2]*py+t[4],y:t[1]*px+t[3]*py+t[5]};}
  /* canvas pixel → PDF user space (inverse) */
  function canvasToPdf(cx,cy,t){const det=t[0]*t[3]-t[1]*t[2];return{x:(t[3]*(cx-t[4])-t[2]*(cy-t[5]))/det,y:(t[0]*(cy-t[5])-t[1]*(cx-t[4]))/det};}
  /* viewport.transform からスケール係数を取得 */
  function getVPScale(t){return Math.sqrt(Math.abs(t[0]*t[3]-t[1]*t[2]));}
  return{throttle,debounce,safeKey,distPtSeg,ptInPoly,strokeBBox,isPalmContact,pruneEraserStrokes,cloneStrokes,pdfToCanvas,canvasToPdf,getVPScale};
})();


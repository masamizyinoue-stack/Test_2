/* ============================================================
   Module: PreviewPanel  v2.14
   責務: サムネイル一覧表示・ページ選択ナビゲーション
   ・遅延レンダリング（3枚ずつ、20ms間隔でフリーズ防止）
   ・キャッシュ（同一PDF中は再生成しない）
   ・PDF切替時にキャッシュ自動クリア
   ============================================================ */
const PreviewPanel=(() => {
  const _THUMB_W=480;   /* サムネイル幅px (v2.26: 160→320→V7.02: 480 解像度UP) */
  const CACHE_MAX=20;    /* V7.07: サムネイル/インセットキャッシュの上限ページ数(メモリ安定化) */
  let _cache={};        /* page番号→dataURL */
  let _cacheOrder=[];    /* V7.07: LRU順管理(古い順に並ぶ) */
  let _cacheSig={};     /* v2.27: page番号→描画時のストローク内容シグネチャ */
  let _lastDoc=null;    /* PDF変更検知 */

  /* ── V5.10: ページお気に入り(PDFごとにlocalStorage保存) ── */
  const FAV_KEY='mv_pagefav';
  let _fav={};          /* docKey → [page,…] */
  let _favOnly=false;
  let _detailMode=false; /* V5.20: 詳細番号モード(右下ピクチャーインピクチャー拡大) */
  /* V5.26: タイトル欄は正方形とは限らず、幅25%×高さ13%前後の横長帯であることが実図面で判明。
     幅・高さを別々に+/-調整→localStorageへ自動記憶。図面テンプレートは会社ごとに固定のため、
     一度合わせれば以降ずっと使い回せる。表示は固定倍率(ZOOM)で拡大し、大きくなり過ぎる場合のみ
     縦横比を保ったまま自動で縮小補正する(はみ出し防止)。 */
  const DETAIL_CAL_KEY_W='mv_detail_frac_w',DETAIL_CAL_KEY_H='mv_detail_frac_h';
  const DETAIL_FRAC_MIN=0.03,DETAIL_FRAC_MAX=0.70,DETAIL_FRAC_STEP=0.02;
  const DETAIL_CAL_KEY_Z='mv_detail_zoom';
  const DETAIL_ZOOM_MIN=1.0,DETAIL_ZOOM_MAX=6.0,DETAIL_ZOOM_STEP=0.2;
  const DETAIL_DISP_MAX=0.62;      /* 表示サイズの上限(サムネイルを覆い過ぎないように) */
  let _detailFracW=0.10,_detailFracH=0.10; /* V5.29: ご指定によりデフォルト値変更 */
  let _detailZoom=6.0;             /* V5.29: ご指定によりデフォルト値変更(6.0倍) */
  try{const vw=parseFloat(localStorage.getItem(DETAIL_CAL_KEY_W));if(vw>=DETAIL_FRAC_MIN&&vw<=DETAIL_FRAC_MAX)_detailFracW=vw;}catch(_){}
  try{const vh=parseFloat(localStorage.getItem(DETAIL_CAL_KEY_H));if(vh>=DETAIL_FRAC_MIN&&vh<=DETAIL_FRAC_MAX)_detailFracH=vh;}catch(_){}
  try{const vz=parseFloat(localStorage.getItem(DETAIL_CAL_KEY_Z));if(vz>=DETAIL_ZOOM_MIN&&vz<=DETAIL_ZOOM_MAX)_detailZoom=vz;}catch(_){}
  function _detailDispFracs(){
    let dw=_detailFracW*_detailZoom,dh=_detailFracH*_detailZoom;
    const m=Math.max(dw,dh);
    if(m>DETAIL_DISP_MAX){const k=DETAIL_DISP_MAX/m;dw*=k;dh*=k;} /* 縦横比を保ったまま上限内に収める */
    return{w:dw,h:dh};
  }
  let _insetCache={},_insetSig={}; /* 拡大インセット専用キャッシュ(通常サムネイルとは別管理) */
  let _insetOrder=[]; /* V7.07: LRU順管理 */
  /* V7.07: LRUキャッシュ登録共通ヘルパー — 上限超過時は最も古いページを1件破棄 */
  function _lruSet(cache,sigCache,order,pageNum,sig,url){
    cache[pageNum]=url;sigCache[pageNum]=sig;
    const i=order.indexOf(pageNum);if(i!==-1)order.splice(i,1);
    order.push(pageNum);
    if(order.length>CACHE_MAX){
      const old=order.shift();
      delete cache[old];delete sigCache[old];
    }
  }
  try{const d=JSON.parse(localStorage.getItem(FAV_KEY));if(d&&typeof d==='object')_fav=d;}catch(_){}
  function _favSave(){try{localStorage.setItem(FAV_KEY,JSON.stringify(_fav));}catch(_){}}
  function _docKey(){return App.docId||('fn:'+(App.fileName||''));}
  function _favSet(){
    try{const d=JSON.parse(localStorage.getItem(FAV_KEY));if(d&&typeof d==='object')_fav=d;}catch(_){} /* V5.11: 復元直後の書込みを取り込む */
    let a=_fav[_docKey()];
    if(!Array.isArray(a)){ /* V5.11: docId未確定期やZIP復元直後はファイル名キーから引継ぎ */
      const fb=_fav['fn:'+(App.fileName||'')];
      if(Array.isArray(fb)){a=fb;if(App.docId){_fav[App.docId]=fb.slice();_favSave();}}
    }
    return new Set(Array.isArray(a)?a:[]);
  }
  function _favToggle(n){
    const k=_docKey(),s=_favSet();
    s.has(n)?s.delete(n):s.add(n);
    if(s.size)_fav[k]=[...s].sort((a,b)=>a-b);else delete _fav[k];
    _favSave();
  }
  function _updateTitle(){
    const t=document.getElementById('pv-title');if(!t)return;
    t.textContent=_favOnly?('\u2605 \u304a\u6c17\u306b\u5165\u308a\uff08'+_favSet().size+'\u4ef6\uff09'):'\u30da\u30fc\u30b8\u4e00\u89a7';
  }

  /* v2.27: ページの書き込み内容シグネチャ(O(点数)・軽量)
     ストローク数/点数/座標和/色/太さを畳み込み、ペン・蛍光ペン・消しゴム・
     コピー/削除・移動・Undo/Redo・復元のあらゆる変化を検知する。
     一致時はキャッシュ再利用 → 変更ページのみ再描画。 */
  function _strokeSig(pageNum){
    const arr=(App.strokes&&App.strokes[pageNum])||[];
    let a=arr.length,b=0,c=0;
    for(const s of arr){
      const pts=s.points||[];b+=pts.length;
      for(const p of pts){c+=p[0]+p[1];}
      c+=(s.size||0)*7;
      if(s.color)for(let k=0;k<s.color.length;k++)c+=s.color.charCodeAt(k);
      c+=(s.type==='hl'?1e3:s.type==='eraser'?2e3:0);
    }
    return a+':'+b+':'+Math.round(c*100);
  }

  async function _renderThumb(pageNum){
    const pd=App.pdfDoc;if(!pd)return null;
    if(_lastDoc!==pd){_cache={};_cacheSig={};_cacheOrder=[];_lastDoc=pd;}  /* PDF変更→キャッシュクリア */
    const sig=_strokeSig(pageNum);
    if(_cache[pageNum]&&_cacheSig[pageNum]===sig)return _cache[pageNum];
    try{
      const page=await pd.getPage(pageNum);
      const sc=_THUMB_W/page.getViewport({scale:1}).width;
      const vp=page.getViewport({scale:sc});
      const cvs=document.createElement('canvas');
      cvs.width=Math.round(vp.width);cvs.height=Math.round(vp.height);
      await page.render({canvasContext:cvs.getContext('2d'),viewport:vp}).promise;
      /* v2.27: 書き込みを合成 — メイン画面と同じ層構造を再現。
         注釈は別キャンバスに描画(消しゴムのdestination-outがPDF画像を
         削らないようにするため)してから上に合成する。 */
      const arr=(App.strokes&&App.strokes[pageNum])||[];
      if(arr.length){
        const ann=document.createElement('canvas');
        ann.width=cvs.width;ann.height=cvs.height;
        DrawUtil.drawAnnotations(ann.getContext('2d'),arr,vp.transform);
        cvs.getContext('2d').drawImage(ann,0,0);
      }
      const url=cvs.toDataURL('image/jpeg',.72);
      _lruSet(_cache,_cacheSig,_cacheOrder,pageNum,sig,url);return url;
    }catch(_e){return null;}
  }

  async function _renderDetailInset(pageNum){
    /* V5.27: 回転ページで座標がずれるバグを修正。
       offsetX/offsetY付きviewportは回転ページで変換式が変わり右下がずれるため廃止。
       代わりに「通常どおり全体を描画→canvasの標準的な矩形切り出し(drawImage)で右下だけ取り出す」
       方式に変更。getViewport({scale})の結果は既存の全体表示・サムネイルと同じく回転を
       自動的に正しく処理するため、切り出し元の「右下」は常にfullCvsの右下端と一致し安全。 */
    const pd=App.pdfDoc;if(!pd)return null;
    if(_lastDoc!==pd){_insetCache={};_insetSig={};_insetOrder=[];}
    const sig=_strokeSig(pageNum)+':'+_detailFracW.toFixed(3)+':'+_detailFracH.toFixed(3);
    if(_insetCache[pageNum]&&_insetSig[pageNum]===sig)return _insetCache[pageNum];
    try{
      const page=await pd.getPage(pageNum);
      const full=page.getViewport({scale:1}); /* 回転補正済みの表示上サイズ */
      const cropW=full.width*_detailFracW,cropH=full.height*_detailFracH;
      const OVERSAMPLE=2; /* 高画質化のための追加解像度係数 */
      const disp=_detailDispFracs();
      const rasterW=Math.round(_THUMB_W*disp.w*OVERSAMPLE);
      const sc=rasterW/cropW; /* 理想スケール: この倍率で全体を描けばクロップ幅がrasterWになる */
      /* V5.30(パフォーマンス): 全体ラスタを約2.6MPに上限。従来は幅10%設定で1ページ10MP超の
         キャンバスをページ数ぶん生成しており、一覧表示や±調整のたびに大きなGC/描画負荷が出ていた。
         上限内で描画し、切り出し時に目標解像度へ拡大転写(smoothing)することで画質低下を最小化。 */
      const FULL_MAX_PX=4e6; /* V7.02: 2.6MP→4MPに引き上げ(インセット高画質化) */
      const idealPx=(full.width*sc)*(full.height*sc);
      const k=Math.min(1,Math.sqrt(FULL_MAX_PX/idealPx));
      const rsc=sc*k; /* 実レンダリングスケール */
      const vp=page.getViewport({scale:rsc}); /* オフセットなし。回転はPDF.js側で自動処理される */
      const fullCvs=document.createElement('canvas');
      fullCvs.width=Math.round(vp.width);fullCvs.height=Math.round(vp.height);
      await page.render({canvasContext:fullCvs.getContext('2d'),viewport:vp}).promise;
      const scw=Math.round(cropW*rsc),sch=Math.round(cropH*rsc); /* ソース側クロップ寸法 */
      const sx=fullCvs.width-scw,sy=fullCvs.height-sch; /* 常にfullCvsの右下端が基準(回転に依らず正しい) */
      const cw=Math.round(cropW*sc),ch=Math.round(cropH*sc); /* 出力(目標)寸法 */
      const cvs=document.createElement('canvas');
      cvs.width=cw;cvs.height=ch;
      const cctx=cvs.getContext('2d');
      cctx.imageSmoothingEnabled=true;cctx.imageSmoothingQuality='high';
      cctx.drawImage(fullCvs,sx,sy,scw,sch,0,0,cw,ch);
      const arr=(App.strokes&&App.strokes[pageNum])||[];
      if(arr.length){
        const annFull=document.createElement('canvas');
        annFull.width=fullCvs.width;annFull.height=fullCvs.height;
        DrawUtil.drawAnnotations(annFull.getContext('2d'),arr,vp.transform);
        cctx.drawImage(annFull,sx,sy,scw,sch,0,0,cw,ch);
      }
      const url=cvs.toDataURL('image/jpeg',.82);
      _lruSet(_insetCache,_insetSig,_insetOrder,pageNum,sig,url);return url;
    }catch(_e){return null;}
  }

  function _buildGrid(){
    const total=App.totalPages,cur=App.currentPage;
    const grid=document.getElementById('pv-grid');
    grid.innerHTML='';
    const favs=_favSet(); /* V5.10 */
    let shown=0;
    for(let n=1;n<=total;n++){
      if(_favOnly&&!favs.has(n))continue; /* V5.10: ★のみ絞り込み */
      shown++;
      const item=document.createElement('div');
      item.className='pv-item'+(n===cur?' pv-active':'')+(favs.has(n)?' pv-fav':'');
      item.dataset.page=n;
      const thumbWrap=document.createElement('div');thumbWrap.className='pv-thumb'; /* V5.20 */
      const ph=document.createElement('div');ph.className='pv-ph';ph.dataset.page=n;ph.textContent='…';
      thumbWrap.appendChild(ph);
      const pg=document.createElement('span');pg.className='pv-pg';pg.textContent=n+'ページ';
      /* V5.10: ☆/★トグル(タップしてもページジャンプしない) */
      const st=document.createElement('button');
      st.className='pv-star'+(favs.has(n)?' on':'');
      st.textContent=favs.has(n)?'\u2605':'\u2606';
      st.title='\u304a\u6c17\u306b\u5165\u308a';
      st.addEventListener('click',e=>{
        e.stopPropagation();
        _favToggle(n);
        _buildGrid();_loadThumbs();_updateTitle(); /* サムネイルはキャッシュ済みのため即時 */
      },{passive:false});
      item.append(thumbWrap,pg,st); /* V5.20: phは.pv-thumb内 */
      item.addEventListener('click',()=>{App.gotoPage(n,true);_setActive(n);close();},{passive:true});
      grid.appendChild(item);
    }
    if(_favOnly&&!shown){
      const em=document.createElement('div');em.id='pv-fav-empty';
      em.innerHTML='\u304a\u6c17\u306b\u5165\u308a\u306f\u307e\u3060\u3042\u308a\u307e\u305b\u3093<br>\u30b5\u30e0\u30cd\u30a4\u30eb\u306e\u2606\u3067\u767b\u9332\u3067\u304d\u307e\u3059';
      grid.appendChild(em);
    }
    _updateTitle();
  }

  function _setActive(n){
    document.getElementById('pv-grid').querySelectorAll('.pv-item').forEach(el=>{
      el.classList.toggle('pv-active',+el.dataset.page===n);
    });
  }

  function _loadThumbs(){
    const ov=document.getElementById('preview-overlay');
    const phs=[...document.getElementById('pv-grid').querySelectorAll('.pv-ph')];
    let i=0;
    async function batch(){
      const chunk=phs.slice(i,i+3);i+=3;
      if(!chunk.length||!ov.classList.contains('on'))return;
      for(const ph of chunk){
        const n=+ph.dataset.page;
        const url=await _renderThumb(n);
        if(!url||!ph.isConnected||!ov.classList.contains('on'))continue;
        const wrap=ph.parentElement; /* V5.20: .pv-thumb */
        const img=document.createElement('img');
        img.src=url;img.className='pv-img';img.draggable=false;
        ph.replaceWith(img);
        if(_detailMode&&wrap&&!wrap.querySelector('.pv-inset')){ /* V5.20/V5.30: 二重追加防止 */
          const iurl=await _renderDetailInset(n);
          if(iurl&&wrap&&wrap.isConnected&&ov.classList.contains('on')){
            const ins=document.createElement('img');
            ins.src=iurl;ins.className='pv-inset';ins.draggable=false;
            const disp=_detailDispFracs(); /* V5.26: 幅・高さ別の実表示割合 */
            ins.style.width=(disp.w*100)+'%';ins.style.height=(disp.h*100)+'%';
            wrap.appendChild(ins);
          }
        }
      }
      if(i<phs.length&&ov.classList.contains('on'))setTimeout(batch,20);
    }
    setTimeout(batch,0);
  }

  function open(){
    if(!App.pdfDoc){showToast('PDFが開かれていません');return;}
    const ov=document.getElementById('preview-overlay');
    _buildGrid();ov.classList.add('on');
    setTimeout(()=>{
      const act=document.getElementById('pv-grid').querySelector('.pv-active');
      if(act)act.scrollIntoView({block:'center'});
    },50);
    _loadThumbs();
  }

  function close(){document.getElementById('preview-overlay').classList.remove('on');}

  /* V5.30(パフォーマンス): 詳細番号モードの±調整・ON/OFF切替でグリッド全体を再構築せず、
     既存サムネイルはそのままインセット画像だけを追加/更新/削除する */
  async function _refreshInsets(){
    const ov=document.getElementById('preview-overlay');
    const wraps=document.getElementById('pv-grid').querySelectorAll('.pv-thumb');
    let i=0;
    for(const wrap of wraps){
      if(!ov.classList.contains('on'))return;
      let ins=wrap.querySelector('.pv-inset');
      if(!_detailMode){if(ins)ins.remove();continue;}
      const n=+(wrap.parentElement&&wrap.parentElement.dataset.page);
      if(!n)continue;
      const url=await _renderDetailInset(n);
      if(!url||!wrap.isConnected)continue;
      if(!ins){ins=document.createElement('img');ins.className='pv-inset';ins.draggable=false;wrap.appendChild(ins);}
      const disp=_detailDispFracs();
      ins.style.width=(disp.w*100)+'%';ins.style.height=(disp.h*100)+'%';
      ins.src=url;
      if(++i%3===0)await new Promise(r=>setTimeout(r,0)); /* UIブロック防止 */
    }
  }

  /* V5.10: ★のみトグル */
  const _favBtn=document.getElementById('pv-fav-btn');
  if(_favBtn)_favBtn.addEventListener('click',()=>{
    _favOnly=!_favOnly;
    _favBtn.classList.toggle('on',_favOnly);
    _buildGrid();_loadThumbs();
  },{passive:true});

  /* V5.19: 詳細番号モード切替(グリッド再構築→サムネ再読込で即時反映。ページ送り後もモード保持) */
  const _detailBtn=document.getElementById('pv-detail-btn');
  const _calEl=document.getElementById('pv-detail-cal');
  const _wPctEl=document.getElementById('pv-detail-w-pct');
  const _hPctEl=document.getElementById('pv-detail-h-pct');
  const _zPctEl=document.getElementById('pv-detail-z-pct');
  function _updateDetailPct(){
    if(_wPctEl)_wPctEl.textContent=Math.round(_detailFracW*100)+'%';
    if(_hPctEl)_hPctEl.textContent=Math.round(_detailFracH*100)+'%';
    if(_zPctEl)_zPctEl.textContent=_detailZoom.toFixed(1)+'x';
  }
  _updateDetailPct();
  if(_detailBtn)_detailBtn.addEventListener('click',()=>{
    _detailMode=!_detailMode;
    _detailBtn.classList.toggle('on',_detailMode);
    if(_calEl)_calEl.classList.toggle('on',_detailMode); /* V5.24: ON時だけ±調整を表示 */
    _refreshInsets(); /* V5.30: グリッド再構築せずインセットのみ追加/削除 */
  },{passive:true});
  /* V5.26: 幅・高さそれぞれの±調整(即時反映+自動記憶) */
  function _adjustDetailFracW(delta){
    _detailFracW=Math.max(DETAIL_FRAC_MIN,Math.min(DETAIL_FRAC_MAX,_detailFracW+delta));
    try{localStorage.setItem(DETAIL_CAL_KEY_W,String(_detailFracW));}catch(_){}
    _updateDetailPct();_refreshInsets(); /* V5.30 */
  }
  function _adjustDetailFracH(delta){
    _detailFracH=Math.max(DETAIL_FRAC_MIN,Math.min(DETAIL_FRAC_MAX,_detailFracH+delta));
    try{localStorage.setItem(DETAIL_CAL_KEY_H,String(_detailFracH));}catch(_){}
    _updateDetailPct();_refreshInsets(); /* V5.30 */
  }
  document.getElementById('pv-detail-w-minus')?.addEventListener('click',()=>_adjustDetailFracW(-DETAIL_FRAC_STEP),{passive:true});
  document.getElementById('pv-detail-w-plus')?.addEventListener('click',()=>_adjustDetailFracW(DETAIL_FRAC_STEP),{passive:true});
  document.getElementById('pv-detail-h-minus')?.addEventListener('click',()=>_adjustDetailFracH(-DETAIL_FRAC_STEP),{passive:true});
  document.getElementById('pv-detail-h-plus')?.addEventListener('click',()=>_adjustDetailFracH(DETAIL_FRAC_STEP),{passive:true});
  /* V5.28: 拡大倍率の±調整(即時反映+自動記憶) */
  function _adjustDetailZoom(delta){
    _detailZoom=Math.max(DETAIL_ZOOM_MIN,Math.min(DETAIL_ZOOM_MAX,+(_detailZoom+delta).toFixed(2)));
    try{localStorage.setItem(DETAIL_CAL_KEY_Z,String(_detailZoom));}catch(_){}
    _updateDetailPct();_refreshInsets(); /* V5.30 */
  }
  document.getElementById('pv-detail-z-minus')?.addEventListener('click',()=>_adjustDetailZoom(-DETAIL_ZOOM_STEP),{passive:true});
  document.getElementById('pv-detail-z-plus')?.addEventListener('click',()=>_adjustDetailZoom(DETAIL_ZOOM_STEP),{passive:true});

  return{open,close};
})();

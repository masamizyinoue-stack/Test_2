/* ============================================================
   Module: AutoSave
   責務: 保存ライフサイクル管理
   設計:
     schedSave()    → 1200ms debounce
     immediateSave()→ 即時（endDraw後）
     emergencySave()→ pagehide/visibilitychange/blur/freeze
   ============================================================ */
const AutoSave=(() => {
  let _timer=null;
  let _bkDirty=false;
  const INST_ID=(() => {
    const KEY='mv_iid2';
    let id=sessionStorage.getItem(KEY);
    if(!id){id=Date.now().toString(36)+Math.random().toString(36).slice(2,7);sessionStorage.setItem(KEY,id);}
    return id;
  })();
  const K_LAST='last:'+INST_ID;
  // Refactor: K_BK_LAT 未使用定数を削除

  function _buildData(getState){
    const s=getState();
    if(!s.pdfDoc||!s.origBuf)return null;
    const clean=Utils.pruneEraserStrokes(s.strokes);
    return{
      buf:null,docId:s.docId,file:s.fileName,
      strokes:Utils.cloneStrokes(clean),
      page:s.currentPage,scale:s.scale,panX:s.panX,panY:s.panY,
      subWinStates:s.subWinStates,ts:Date.now()
    };
  }

  function _lsBackup(data){
    try{localStorage.setItem('mv_lsbk2',JSON.stringify({file:data.file,page:data.page,strokes:data.strokes,ts:data.ts}));}catch(_){}
  }

  function _saveKeys(data){
    return[
      [K_LAST,data],
      ['f:'+Utils.safeKey(data.file),data],
      ['resume:last',data],
      ['resume:fname',data.file]
    ];
  }

  function schedSave(getState){
    _bkDirty=true;
    clearTimeout(_timer);
    _timer=setTimeout(async()=>{
      const data=_buildData(getState);
      if(!data)return;
      Logger.info('[AutoSave] sched start ts='+data.ts);
      EventBus.emit('autosave:saving'); /* v2.12: 保存中通知 */
      IDBStore.enqueue(_saveKeys(data));
      IDBStore.enqueue([['resume:prv',data]]);
      /* verify: IDBStore._flush()のリトライ機構に一元化（重複IDB読み込み削除） */
    },SAVE_DELAY);
  }

  function immediateSave(getState){
    const data=_buildData(getState);
    if(!data)return;
    _lsBackup(data);
    Logger.info('[AutoSave] immediate ts='+data.ts);
    EventBus.emit('autosave:saving'); /* v2.12: 保存中通知 */
    IDBStore.enqueue(_saveKeys(data));
  }

  function emergencySave(getState){
    const data=_buildData(getState);
    if(!data)return;
    _lsBackup(data);
    Logger.info('[AutoSave] emergency ts='+data.ts);
    IDBStore.saveNow(_saveKeys(data)).catch(()=>{});
  }

  function isValid(s){
    if(!s||typeof s!=='object')return false;
    if(typeof s.file!=='string'||!s.file)return false;
    if(typeof s.ts==='number'&&Date.now()-s.ts>30*24*60*60*1000)return false;
    return true;
  }

  function markDirty(){_bkDirty=true;}
  function clearDirty(){_bkDirty=false;}
  function isDirty(){return _bkDirty;}

  return{schedSave,immediateSave,emergencySave,isValid,markDirty,clearDirty,isDirty,
    get instId(){return INST_ID;}};
})();

/* 60秒周期バックグラウンド保存 */
setInterval(()=>EventBus.emit('autosave:periodic'),60000);


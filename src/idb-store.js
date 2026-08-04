/* ============================================================
   Module: IDBStore
   責務: IndexedDB 保存キュー + ジャーナル + transaction.oncomplete保証
   設計: 保存キューに積んで _flush() が1トランザクションで一括書き込み
         同キーは最新値が勝つ（マージ）
         ジャーナル: journal:pending → 書込 → journal:done
         クラッシュ回復: 起動時に journal:pending 残存を検出 → resume:prv を試みる
   ============================================================ */
const IDBStore=(() => {
  const DB_NAME='MViewerV2',DB_VER=1,ST='d';
  const MAX_RETRY=10; /* V7.08: 保存失敗の連続リトライ上限(無限ループ防止) */
  let _db=null;
  const _queue=[];  // Array<Map<key,value>>
  let _flushing=false;
  let _retryCount=0; /* V7.08: 連続失敗回数 */
  // Refactor: _pendingSave/_isSaving 未使用変数を削除（getter で直接参照に統一）

  async function _open(){
    if(_db)return _db;
    return _db=await new Promise((res,rej)=>{
      const req=indexedDB.open(DB_NAME,DB_VER);
      req.onupgradeneeded=e=>e.target.result.createObjectStore(ST);
      req.onsuccess=e=>{
        const db=e.target.result;
        /* V7.09: 接続が裏で切断された場合、_dbをリセットして次回_open()で必ず再接続させる
           (iPad Safariがメモリ逼迫時に未使用のIDB接続を切ることがあり、
            従来は壊れた接続を使い回し続けて永久に保存失敗していた) */
        db.onclose=()=>{Logger.warn('[IDB] connection closed unexpectedly, will reconnect');_db=null;};
        db.onversionchange=()=>{db.close();_db=null;};
        res(db);
      };
      req.onerror=e=>rej(e.target.error);
    });
  }

  async function _doWrite(pairs){
    const db=await _open();
    return new Promise((res,rej)=>{
      let tx;
      try{
        tx=db.transaction(ST,'readwrite');
      }catch(e){
        /* V7.09: 閉じた接続に対するtransaction()は同期的に例外を投げる(InvalidStateError等)。
           次回は必ず新しい接続を張り直す */
        _db=null;rej(e);return;
      }
      const st=tx.objectStore(ST);
      for(const[k,v]of pairs){
        if(v===null||v===undefined)st.delete(k);
        else st.put(v,k);
      }
      tx.oncomplete=res;
      tx.onerror=e=>rej(e.target.error);
      tx.onabort=()=>rej(new Error('IDB tx aborted'));
    });
  }

  async function _flush(){
    if(_flushing||_queue.length===0)return;
    _flushing=true;
    /* マージ: 同キーは最後の値が勝つ */
    const merged=new Map();
    for(const batch of _queue)for(const[k,v]of batch)merged.set(k,v);
    _queue.length=0;
    try{
      await _doWrite([...merged]);
      Logger.debug('[IDB] flushed',merged.size,'keys');
      _retryCount=0; /* V7.08: 成功したらカウントリセット */
    }catch(e){
      Logger.warn('[IDB] flush failed, requeue',e);
      _retryCount++;
      if(_retryCount>MAX_RETRY){
        /* V7.08: 上限到達→諦めてキューを破棄。無限リトライによるCPU負荷を防止 */
        Logger.error('[IDB] flush failed '+MAX_RETRY+'回連続、保存を断念します',e);
        _queue.length=0;_retryCount=0;_flushing=false;
        /* V7.09: エラー種別を通知(容量不足かどうかで表示メッセージを変える) */
        EventBus.emit('idb:saveFailed',{isQuota:e?.name==='QuotaExceededError'});
        return;
      }
      _queue.unshift(merged); /* 失敗時は先頭に戻す */
    }
    _flushing=false;
    if(_queue.length===0)EventBus.emit('idb:flushed'); /* v2.12: 保存完了通知 */
    else setTimeout(_flush,Math.min(30*Math.pow(2,_retryCount),5000)); /* V7.08: 指数バックオフ(最大5秒間隔) */
  }

  /* 非同期キュー書き込み（通常の自動保存） */
  function enqueue(pairs){
    _queue.push(new Map(pairs));
    setTimeout(_flush,0);
  }

  /* 同期的に即書き込み（pagehide/visibilitychange用） */
  async function saveNow(pairs){
    try{await _doWrite(pairs);}
    catch(e){Logger.warn('[IDB] saveNow failed',e);}
  }

  async function get(key){
    try{
      const db=await _open();
      return await new Promise(res=>{
        const q=db.transaction(ST,'readonly').objectStore(ST).get(key);
        q.onsuccess=e=>res(e.target.result??null);
        q.onerror=()=>res(null);
      });
    }catch{return null;}
  }

  /* 起動時にDB接続をウォームアップ */
  function warmup(){_open().catch(()=>{});}

  return{enqueue,saveNow,get,warmup,
    get isSaving(){return _flushing;},
    get pendingSave(){return _queue.length>0;}
  };
})();


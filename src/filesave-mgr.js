/* ============================================================
   Module: FileSaveMgr
   責務: ファイル保存・開くダイアログ管理
   設計: File System Access API が利用可能な環境では
         showSaveFilePicker / showOpenFilePicker を優先使用し
         前回使用ファイルハンドルを IndexedDB に保持して
         次回 startIn に指定することで「前回フォルダ」を再現する。
         未対応ブラウザ(iPad Safari等)は <a>クリック/<input>に自動フォールバック。
         エラー時も終了せず必ずフォールバックで完了する。
   ============================================================ */
const FileSaveMgr=(() => {
  const HANDLE_KEY='filesave:lastHandle';
  /* API 可否を起動時1回だけ判定 */
  const CAN_SAVE=typeof window!=='undefined'&&typeof window.showSaveFilePicker==='function';
  const CAN_OPEN=typeof window!=='undefined'&&typeof window.showOpenFilePicker==='function';
  Logger.info('[FileSaveMgr] init | showSaveFilePicker='+CAN_SAVE+' showOpenFilePicker='+CAN_OPEN);

  let _memHandle=null; /* セッション内キャッシュ */

  /* IDB から前回ハンドルを取得（セッション内は _memHandle を優先） */
  async function _getHandle(){
    if(_memHandle)return _memHandle;
    try{
      const h=await IDBStore.get(HANDLE_KEY);
      if(h){_memHandle=h;Logger.debug('[FileSaveMgr] handle loaded from IDB');}
    }catch(e){Logger.warn('[FileSaveMgr] IDB handle load failed',e);}
    return _memHandle;
  }

  /* ハンドルをセッション内キャッシュ + IDB に保存 */
  function _storeHandle(h){
    if(!h)return;
    _memHandle=h;
    try{
      IDBStore.enqueue([[HANDLE_KEY,h]]);
      Logger.debug('[FileSaveMgr] handle stored in IDB');
    }catch(e){Logger.warn('[FileSaveMgr] IDB handle enqueue failed (in-memory only)',e);}
  }

  /* --- 公開 API --- */

  /* Blob 保存
     returns: 'saved' | 'cancelled'
     優先: showSaveFilePicker → 失敗時 <a> ダウンロードにフォールバック */
  async function saveBlob(blob,suggestedName,mimeType,extDesc){
    const h=await _getHandle();
    const startIn=h||'downloads';
    if(CAN_SAVE){
      try{
        Logger.info('[FileSaveMgr] showSaveFilePicker | startIn='+(h?'lastHandle':'downloads'));
        const ext=suggestedName.split('.').pop().toLowerCase();
        const fh=await window.showSaveFilePicker({
          suggestedName,startIn,
          types:[{description:extDesc||suggestedName,accept:{[mimeType]:['.'+ext]}}]
        });
        const wr=await fh.createWritable();
        await wr.write(blob);await wr.close();
        _storeHandle(fh);
        Logger.info('[FileSaveMgr] File System Access API 保存成功 | handle 保存済み');
        return 'saved';
      }catch(e){
        if(e.name==='AbortError'){Logger.debug('[FileSaveMgr] ユーザーキャンセル');return 'cancelled';}
        Logger.warn('[FileSaveMgr] showSaveFilePicker 失敗 → <a> フォールバック:',e.message);
      }
    }else{
      Logger.info('[FileSaveMgr] File System Access API 未対応 → <a> フォールバック');
    }
    /* フォールバック: <a> クリック方式 */
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);
    a.download=suggestedName;a.click();URL.revokeObjectURL(a.href);
    Logger.info('[FileSaveMgr] <a> フォールバック完了');
    return 'saved';
  }

  /* ファイルを開く
     returns: File | null(ユーザーキャンセル) | 'fallback'(<input>を使うべき)
     優先: showOpenFilePicker → 未対応/'fallback'シグナルを返し caller が <input> 起動 */
  async function openFile(acceptTypes){
    const h=await _getHandle();
    const startIn=h||'downloads';
    if(CAN_OPEN){
      try{
        Logger.info('[FileSaveMgr] showOpenFilePicker | startIn='+(h?'lastHandle':'downloads'));
        const [fh]=await window.showOpenFilePicker({startIn,types:acceptTypes,multiple:false});
        _storeHandle(fh);
        Logger.info('[FileSaveMgr] showOpenFilePicker 成功 | handle 保存済み');
        return await fh.getFile();
      }catch(e){
        if(e.name==='AbortError'){Logger.debug('[FileSaveMgr] ユーザーキャンセル');return null;}
        Logger.warn('[FileSaveMgr] showOpenFilePicker 失敗 → <input> フォールバック:',e.message);
        return 'fallback';
      }
    }
    Logger.info('[FileSaveMgr] showOpenFilePicker 未対応 → <input> フォールバック');
    return 'fallback';
  }

  return{saveBlob,openFile};
})();


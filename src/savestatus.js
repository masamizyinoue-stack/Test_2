/* ============================================================
   Module: SaveStatus  v2.12
   保存状態表示: saved(保存済み) / saving(保存中) / dirty(未保存)
   ============================================================ */
const SaveStatus=(() => {
  const el=document.getElementById('save-status');
  // Refactor: set() 未使用プライベート関数を削除
  function setText(s,t){if(el){el.dataset.s=s;el.textContent=t;}}
  return{
    setDirty() {setText('dirty','未保存');},
    setSaving(){setText('saving','保存中…');},
    setSaved() {setText('saved','保存済み');},
  };
})();


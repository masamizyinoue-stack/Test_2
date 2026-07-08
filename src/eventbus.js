/* ============================================================
   Module: EventBus
   責務: モジュール間疎結合通信
   ============================================================ */
const EventBus=(() => {
  const _m=new Map();
  function on(ev,fn){if(!_m.has(ev))_m.set(ev,new Set());_m.get(ev).add(fn);return()=>off(ev,fn);}
  function off(ev,fn){_m.get(ev)?.delete(fn);}
  function once(ev,fn){const w=(d)=>{fn(d);off(ev,w);};return on(ev,w);}
  function emit(ev,data){const s=_m.get(ev);if(!s?.size)return;for(const fn of s){try{fn(data);}catch(e){Logger.error(`[EventBus]${ev}:`,e);}}}
  return{on,off,once,emit};
})();


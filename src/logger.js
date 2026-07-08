const Logger=(() => {
  let _debug=false; /* V5.30: 本番はOFF(ホットパスのconsole出力負荷を排除)。必要時はLogger.setDebug(true) */
  const _flags=new Map();
  const _lvl={debug:0,info:1,warn:2,error:3};
  let _min=0;
  function _log(lv,...a){
    if(_lvl[lv]<_min)return;
    const ts=performance.now().toFixed(1);
    console[lv](`[${ts}ms]`,...a);
  }
  return {
    debug:(...a)=>_debug&&_log('debug',...a),
    info:(...a)=>_log('info',...a),
    warn:(...a)=>_log('warn',...a),
    error:(...a)=>_log('error',...a),
    perf(label,fn){const t=performance.now();const r=fn();_debug&&console.debug(`[PERF]${label}:${(performance.now()-t).toFixed(1)}ms`);return r;},
    setLevel(l){_min=_lvl[l]??0;},
    setDebug(v){_debug=v;},
    get on(){return _debug;}, /* V5.30: ホットパスで引数評価自体をスキップするためのガード用 */
    /* 機能フラグ: DBG互換 */
    flags:{
      subWindowUpdate:true,redraw:true,pdfRender:true,raf:true,
      wheelZoom:true,touchMove:true,annotationDraw:true,overlay:true
    },
    flagOff(k){this.flags[k]=false;console.log(`%c[DBG]"${k}"STOPPED`,'color:red;font-weight:bold');}, /* V7.02: off→flagOff(getter onとの名前衝突修正) */
    flagOn(k){this.flags[k]=true;console.log(`%c[DBG]"${k}"ON`,'color:green;font-weight:bold');}, /* V7.02: on→flagOn */
    reset(){Object.keys(this.flags).forEach(k=>this.flags[k]=true);console.log('[DBG]ALL ON');},
    status(){console.table(this.flags);}
  };
})();
window.DBG=Logger; // 後方互換


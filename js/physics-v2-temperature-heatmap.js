/* Physics v2.4.2: detailed educational temperature heatmap.
 *
 * This changes visualization only.  It does NOT alter the temperature solver,
 * fire intensity, buoyancy, brick conduction, oxygen, or smoke equations.
 * Fire tiles remain rendered by the base drawFires() function unchanged.
 */
(() => {
  const STOPS = [
    {t:20,  c:[0,0,0],       a:0.00},
    {t:35,  c:[254,240,138], a:0.10},
    {t:50,  c:[253,224,71],  a:0.18},
    {t:70,  c:[251,191,36],  a:0.25},
    {t:100, c:[249,115,22],  a:0.31},
    {t:150, c:[239,68,68],   a:0.36},
    {t:220, c:[220,38,38],   a:0.40},
    {t:350, c:[153,27,27],   a:0.44},
    {t:550, c:[88,28,135],   a:0.47}
  ];

  function mix(a,b,f){ return a+(b-a)*f; }
  function colorAtTemp(temp) {
    if (temp <= STOPS[0].t) return {r:0,g:0,b:0,a:0};
    let hi = STOPS.length - 1;
    for (let i=1;i<STOPS.length;i++) { if (temp <= STOPS[i].t) { hi=i; break; } }
    const lo=Math.max(0,hi-1), s0=STOPS[lo], s1=STOPS[hi];
    const f=clamp((temp-s0.t)/Math.max(1e-6,s1.t-s0.t),0,1);
    return {
      r:Math.round(mix(s0.c[0],s1.c[0],f)),
      g:Math.round(mix(s0.c[1],s1.c[1],f)),
      b:Math.round(mix(s0.c[2],s1.c[2],f)),
      a:mix(s0.a,s1.a,f)
    };
  }

  // Replace the previous single pale-orange overlay with a continuous scale.
  drawTemperatureField = function() {
    for (let y=0;y<NY;y++) {
      for (let x=0;x<NX;x++) {
        const i=idx(x,y);
        if (solid[i]) continue;
        const c=colorAtTemp(temperature[i]);
        if (c.a<=0.005) continue;
        ctx.fillStyle=`rgba(${c.r},${c.g},${c.b},${c.a.toFixed(3)})`;
        ctx.fillRect(x*H,y*H,H+1,H+1);
      }
    }
  };

  // Insert a readable legend below the canvas. This is intentionally DOM UI
  // rather than part of the fluid field, so it never covers the students' stove.
  const card=document.querySelector('.simulation-card');
  const canvasEl=document.getElementById('simCanvas');
  if(card&&canvasEl&&!document.getElementById('temperatureLegend')){
    const legend=document.createElement('div');
    legend.id='temperatureLegend';
    legend.setAttribute('aria-label','背景溫度色階');
    legend.style.cssText='margin:10px 6px 2px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:13px;color:#64748b;';
    const label=document.createElement('strong');
    label.textContent='背景溫度';
    label.style.cssText='font-size:13px;color:inherit;';
    const bar=document.createElement('div');
    bar.style.cssText='width:min(360px,72vw);height:12px;border-radius:999px;border:1px solid rgba(100,116,139,.35);background:linear-gradient(90deg,rgba(254,240,138,.25) 0%,#fde047 14%,#fbbf24 25%,#f97316 38%,#ef4444 56%,#dc2626 70%,#991b1b 84%,#581c87 100%);';
    const scale=document.createElement('span');
    scale.textContent='20°  50°  70°  100°  150°  220°  350°C+';
    scale.style.cssText='white-space:pre;font-variant-numeric:tabular-nums;';
    legend.append(label,bar,scale);
    canvasEl.insertAdjacentElement('afterend',legend);
  }
})();

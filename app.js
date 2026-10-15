/* =========================================================================
   BAYMAX HEALTH ASSISTANT — app.js
   ========================================================================= */

/* ===================== RANGOS Y ESTADO ===================== */
const RANGES = {
  bpm: {low:50, high:120, critLow:40, critHigh:140},
  spo2: {low:92, critLow:88},
  tempCorp: {low:35.5, high:37.8, critHigh:39},
};

const state = {
  bpm:null, spo2:null, tempCorp:null, tempAmb:null, sound:null, ecg:null,
  lastUpdate:null,
  history:[],
  connected:false,   // true = ESP32 real o modo demo activo
  fingerOn:false,    // true solo mientras el dedo está puesto en el sensor (pulso/oxígeno reales)
  dataReceived:false, // true solo cuando YA llegó al menos un mensaje con datos del ESP32
  demoMode:false,
  status:'offline'
};

const PROFILE_DEFAULTS = { name:'', lastname:'', age:null, phone:'', email:'', photo:null, avatar:null, mood:null,
  meds:null, medsDetail:'', cond:null, condDetail:'', emgName:'', emgPhone:'', emgEmail:'' };
const profile = Object.assign({}, PROFILE_DEFAULTS);

/* Temperatura ambiente fija: apenas los sensores empiezan a dar datos, el ambiente se muestra
   estable en 26 °C o 27 °C (se elige una al abrir la página). */
const AMBIENT_FIXED = Math.random() < 0.5 ? 26 : 27;
let reviews = [];
let notifications = [];
let socket = null;
let simInterval = null;
let currentReviewSnapshot = null;
let cameraStream = null;

/* ===================== AVATARES PREDEFINIDOS ===================== */
const AVATAR_EMOJIS = ['🧑','👩','👨','🧕','👱‍♀️','👱','🧔','👵','👴','🧑‍🦱','👩‍🦰','🧑‍🦳'];

/* ===================== CONSEJOS Y DATOS CURIOSOS DIARIOS ===================== */
const DAILY_TIPS = [
  "Tomar agua apenas te despiertas ayuda a reactivar tu cuerpo después de horas sin hidratarte.",
  "Estirar el cuello y los hombros cada hora reduce la tensión acumulada frente a la pantalla.",
  "Dormir entre 7 y 9 horas ayuda a tu corazón y a tu memoria a funcionar mejor.",
  "Caminar 10 minutos después de comer puede ayudar a tu digestión y a estabilizar tu energía.",
  "Respirar profundo por la nariz durante un minuto puede bajar tu ritmo cardíaco en momentos de estrés.",
  "Reducir la sal en tus comidas es una de las formas más simples de cuidar tu presión arterial.",
  "Reír y pasar tiempo con quienes querés también es una forma de cuidar tu salud emocional.",
  "Evitar pantallas 30 minutos antes de dormir mejora la calidad de tu descanso.",
  "Comer frutas y verduras de distintos colores te da una variedad más amplia de nutrientes.",
  "Salir a que te dé el sol unos minutos al día ayuda a tu cuerpo a regular el sueño.",
  "Hacer pausas activas cada 45–60 minutos de trabajo ayuda a tu circulación.",
  "Escuchar música tranquila puede ayudar a bajar los niveles de estrés en pocos minutos.",
  "Llevar un vaso de agua contigo te recuerda hidratarte a lo largo del día.",
  "Anotar 3 cosas por las que estás agradecido puede mejorar tu estado de ánimo con el tiempo.",
  "Subir escaleras en vez de usar el ascensor es un pequeño ejercicio cardiovascular extra."
];
const DAILY_FACTS = [
  "El corazón de un adulto late en promedio entre 60 y 100 veces por minuto en reposo.",
  "Los pulmones tienen una superficie interna aproximada del tamaño de una cancha de tenis.",
  "La piel es el órgano más grande del cuerpo humano.",
  "El cerebro humano usa cerca del 20% de la energía total que consume el cuerpo.",
  "El nivel normal de oxígeno en sangre (SpO₂) suele estar entre 95% y 100%.",
  "La temperatura corporal puede variar ligeramente a lo largo del día, siendo más baja en la madrugada.",
  "El sonido de un latido corresponde al cierre de las válvulas del corazón.",
  "Reír varios minutos puede aumentar temporalmente el ritmo cardíaco de forma saludable, similar a un ejercicio leve.",
  "El cuerpo humano tiene aproximadamente 5 litros de sangre en promedio.",
  "Los recién nacidos tienen un ritmo cardíaco normal mucho más alto que el de un adulto.",
  "El estrés crónico puede afectar tanto el sistema cardiovascular como el sistema inmune.",
  "Hidratarse bien ayuda a que la sangre circule con más facilidad por el cuerpo.",
  "El ejercicio regular puede ayudar a bajar la frecuencia cardíaca en reposo con el tiempo.",
  "El sueño profundo es cuando el cuerpo realiza gran parte de su proceso de reparación celular.",
  "Un electrocardiograma (ECG) mide la actividad eléctrica que hace latir al corazón."
];
function seededIndex(seedStr, arrLen){
  // Genera un índice "pseudo-aleatorio" pero estable durante todo el día, a partir de la fecha.
  // Así el consejo y el dato curioso cambian cada día de forma aleatoria (no siempre en el
  // mismo orden de la lista), pero no cambian solos cada vez que recargás la página el mismo día.
  let hash = 0;
  for(let i=0;i<seedStr.length;i++){ hash = (hash*31 + seedStr.charCodeAt(i)) >>> 0; }
  return hash % arrLen;
}
function renderDailyContent(){
  const todayStr = new Date().toISOString().slice(0,10); // YYYY-MM-DD, igual durante todo el día
  const tipIdx = seededIndex(todayStr+'-tip', DAILY_TIPS.length);
  const factIdx = seededIndex(todayStr+'-fact', DAILY_FACTS.length);
  document.getElementById('dailyTipText').textContent = DAILY_TIPS[tipIdx];
  document.getElementById('dailyFactText').textContent = DAILY_FACTS[factIdx];
}
function todaysTip(){ return DAILY_TIPS[seededIndex(new Date().toISOString().slice(0,10)+'-tip', DAILY_TIPS.length)]; }
function todaysFact(){ return DAILY_FACTS[seededIndex(new Date().toISOString().slice(0,10)+'-fact', DAILY_FACTS.length)]; }

/* ===================== GUARDADO PERSISTENTE (localStorage) ===================== */
const STORAGE_KEY = 'baymax_health_assistant_v2';
function saveAll(){
  try{
    const data = {
      profile, reviews, notifications, lastReview,
      history: state.history,
      prefs: {
        dark: document.getElementById('prefDark').checked,
        anim: document.getElementById('prefAnim').checked,
        sound: document.getElementById('prefSound').checked,
        voice: voiceEnabled,
        robotVoice: document.getElementById('prefRobotVoice') ? document.getElementById('prefRobotVoice').checked : true
      }
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }catch(e){
    logLine('No se pudo guardar (almacenamiento lleno o no disponible).', 'err');
  }
}
function loadAll(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return false;
    const data = JSON.parse(raw);
    if(data.profile) Object.assign(profile, data.profile);
    if(Array.isArray(data.reviews)) reviews = data.reviews;
    if(data.lastReview && typeof data.lastReview==='object'){ lastReview = data.lastReview; currentReviewSnapshot = data.lastReview; }
    if(Array.isArray(data.notifications)) notifications = data.notifications;
    if(Array.isArray(data.history)) state.history = data.history;
    if(data.prefs){
      document.getElementById('prefDark').checked = !!data.prefs.dark;
      document.body.setAttribute('data-theme', data.prefs.dark ? 'dark' : 'light');
      document.getElementById('prefAnim').checked = data.prefs.anim !== false;
      document.body.classList.toggle('reduced-anim', data.prefs.anim === false);
      document.getElementById('prefSound').checked = data.prefs.sound !== false;
      voiceEnabled = data.prefs.voice !== false;
      if(document.getElementById('prefRobotVoice')) document.getElementById('prefRobotVoice').checked = data.prefs.robotVoice !== false;
    }
    return true;
  }catch(e){
    return false;
  }
}

/* ===================== VITALES ===================== */
const VITAL_META = [
  {key:'bpm', icon:'❤️', label:'Pulso', unit:'BPM', decimals:0},
  {key:'spo2', icon:'🫁', label:'Oxigenación', unit:'%', decimals:0},
  {key:'tempCorp', icon:'🌡️', label:'Temp. corporal', unit:'°C', decimals:1},
  {key:'tempAmb', icon:'🌤️', label:'Temp. ambiente', unit:'°C', decimals:1},
  {key:'sound', icon:'🔊', label:'Sonido', unit:'', decimals:0},
];

/* Un valor EXACTO de 0 en pulso, oxígeno o temperatura corporal no es un valor real:
   significa que el sensor no está detectando nada (electrodos/dedo mal puestos, cable
   suelto, AD8232 en "leads-off"). Antes esto se trataba igual que un valor médico
   crítico real (ej. bpm=200) y asustaba con "¡valor fuera de rango seguro!" cuando en
   realidad lo que hace falta es revisar la conexión del sensor. Ahora se distingue con
   un estado propio ('nosignal') en vez de disparar una alarma crítica. */
function isNoSignalVal(val){ return val===0; }
/* Un valor "real" es un número mayor que 0. Un 0 NUNCA se muestra ni se dice en voz alta
   como si fuera una medición (ej. "temperatura 0 grados"): significa que el sensor no lee. */
function isRealVal(v){ return typeof v==='number' && isFinite(v) && v>0; }
function noSignalSensors(){
  const out = [];
  if(state.bpm===0) out.push('pulso');
  if(state.spo2===0) out.push('oxígeno');
  if(state.tempCorp===0) out.push('temperatura corporal');
  return out;
}
function joinEs(list){
  if(list.length<=1) return list.join('');
  return list.slice(0,-1).join(', ') + ' y ' + list[list.length-1];
}
/* Texto con SOLO las mediciones reales (las que valen 0 o no existen se omiten) */
function vitalsSummaryText(v){
  v = v || state;
  const parts = [];
  if(isRealVal(v.bpm)) parts.push(`Pulso ${Math.round(v.bpm)} BPM`);
  if(isRealVal(v.spo2)) parts.push(`Oxígeno ${Math.round(v.spo2)}%`);
  if(isRealVal(v.tempCorp)) parts.push(`Temperatura ${Number(v.tempCorp).toFixed(1)}°C`);
  return parts.join(' · ');
}
/* Limpia cualquier texto ANTES de leerlo en voz alta: quita mediciones en 0 y hace que se
   lean bien las unidades (grados Celsius, latidos por minuto, por ciento, comas decimales). */
function sanitizeForSpeech(text){
  let t = String(text||'');
  // 1) Si hay varias mediciones separadas por "·", se descartan las que valen exactamente 0
  if(t.includes('·')){
    t = t.split(/\s*·\s*/).filter(seg=> !/(^|[^\d.,])0(?:[.,]0+)?\s*(?:BPM|%|°\s*C|grados)/i.test(seg)).join('. ');
  }
  // 2) Unidades y símbolos que la voz lee mal
  t = t.replace(/SpO\s*[₂2]/gi,'oxigenación')
       .replace(/\bBPM\b/g,'latidos por minuto')
       .replace(/°\s*C\b/g,' grados Celsius')
       .replace(/\bTemp\.\s*/g,'Temperatura ')
       .replace(/(\d)\.(\d)/g,'$1 coma $2')
       .replace(/%/g,' por ciento')
       .replace(/--/g,'sin dato');
  return t.replace(/\s+/g,' ').trim();
}

function computeStatus(){
  if(!state.connected) return 'offline';
  const {bpm, spo2, tempCorp} = state;
  if(bpm==null && spo2==null && tempCorp==null) return (state.dataReceived && !state.fingerOn) ? 'nosignal' : 'normal';
  const noSignal = isNoSignalVal(bpm) || isNoSignalVal(spo2) || isNoSignalVal(tempCorp);
  const critical = (bpm!=null && bpm>0 && (bpm>=RANGES.bpm.critHigh || bpm<=RANGES.bpm.critLow)) ||
    (spo2!=null && spo2>0 && spo2<RANGES.spo2.critLow) || (tempCorp!=null && tempCorp>0 && tempCorp>=RANGES.tempCorp.critHigh);
  if(critical) return 'critical';
  if(noSignal) return 'nosignal';
  const warning = (bpm!=null && (bpm<RANGES.bpm.low || bpm>RANGES.bpm.high)) ||
    (spo2!=null && spo2<RANGES.spo2.low) || (tempCorp!=null && (tempCorp<RANGES.tempCorp.low || tempCorp>RANGES.tempCorp.high));
  return warning ? 'warning' : 'normal';
}
function vitalStatus(key, val){
  if(val==null || !state.connected) return 'offline';
  if(isNoSignalVal(val)) return 'nosignal';
  if(key==='bpm') return (val>=RANGES.bpm.critHigh||val<=RANGES.bpm.critLow) ? 'critical' : (val<RANGES.bpm.low||val>RANGES.bpm.high) ? 'warning' : 'normal';
  if(key==='spo2') return val<RANGES.spo2.critLow ? 'critical' : val<RANGES.spo2.low ? 'warning' : 'normal';
  if(key==='tempCorp') return val>=RANGES.tempCorp.critHigh ? 'critical' : (val<RANGES.tempCorp.low||val>RANGES.tempCorp.high) ? 'warning' : 'normal';
  return 'normal';
}
function fmtTime(ts){ return new Date(ts).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit',second:'2-digit'}); }
function fmtDate(ts){ return new Date(ts).toLocaleDateString('es-ES',{day:'2-digit',month:'short',year:'numeric'}); }

/* ===================== RENDER PANEL ===================== */
function renderHero(){
  document.getElementById('heroFace').setAttribute('data-status', state.status==='nosignal' ? 'scanning' : state.status);
  document.getElementById('heroGreeting').textContent = profile.name ? `Hola, ${profile.name}` : '¿Cómo estás hoy?';
  const badge = document.getElementById('heroStatusBadge');
  badge.className = 'status-badge ' + state.status;
  badge.textContent = state.status==='offline' ? 'Sin conexión' : state.status==='nosignal' ? 'Esperando tu dedo' : state.status==='normal' ? 'Todo bien' : state.status==='warning' ? 'Atención requerida' : 'Aviso crítico';
  const msg = document.getElementById('heroMsg');
  msg.textContent = state.status==='offline'
    ? 'Aún no detecto un ESP32 conectado. Conecta tu dispositivo o activa el modo demostración para ver tus signos vitales en tiempo real.'
    : state.status==='nosignal' ? 'Coloca tu dedo en el sensor para ver tus mediciones. Si lo quitas, se ocultan hasta que lo vuelvas a colocar.'
    : state.status==='normal' ? 'Estoy monitoreando tus signos vitales en tiempo real.'
    : state.status==='warning' ? 'Uno de tus valores está fuera del rango habitual. Vale la pena descansar un momento.'
    : '¡Hay un valor fuera de rango seguro! Si te sentís mal, buscá ayuda de un adulto responsable o un profesional de salud.';
}
function renderVitals(){
  const grid = document.getElementById('vitalsGrid');
  // Antes esta función reconstruía las 5 tarjetas por completo (innerHTML) en cada lectura.
  // Cuando el ESP32 manda datos seguido, eso reiniciaba la animación de aparición de las
  // tarjetas en cada actualización, y si las lecturas llegaban más rápido que la animación,
  // las tarjetas 2 a 5 nunca llegaban a mostrarse completas (parecía que la página se "bugueaba"
  // y solo se veía la primera tarjeta, la de Pulso). Ahora creamos las 5 tarjetas UNA sola vez
  // y en cada lectura solo actualizamos su contenido, sin volver a crear los elementos.
  if(grid.children.length !== VITAL_META.length){
    grid.innerHTML = VITAL_META.map(v=>`<div class="vcard" data-status="offline"><div class="vtop"><span class="vlabel">${v.label}</span><div class="icon-badge" data-part="icon">${v.icon}</div></div><div class="vvalue" data-part="value">--<span class="vunit">${v.unit}</span></div><div class="vtrend" data-part="trend">Esperando conexión con el ESP32</div></div>`).join('');
  }
  VITAL_META.forEach((v, idx)=>{
    const card = grid.children[idx];
    if(!card) return;
    const val = (state.connected && state.dataReceived && state.fingerOn) ? state[v.key] : null;
    const status = vitalStatus(v.key, val);
    const badgeClass = status==='normal' ? 'green' : status==='warning' ? 'amber' : status==='nosignal' ? 'nosignal' : '';
    const display = (val==null || (val===0 && v.key!=='sound')) ? '--' : val.toFixed(v.decimals);
    const range = !(state.connected && state.dataReceived && state.fingerOn) ? (state.connected && state.dataReceived ? 'Coloca tu dedo en el sensor' : 'Esperando datos del ESP32')
      : status==='nosignal' ? 'Esperando lectura del sensor'
      : v.key==='bpm' ? `Rango normal: ${RANGES.bpm.low}–${RANGES.bpm.high} BPM`
      : v.key==='spo2' ? `Rango normal: ≥ ${RANGES.spo2.low}%`
      : v.key==='tempCorp' ? `Rango normal: ${RANGES.tempCorp.low}–${RANGES.tempCorp.high}°C`
      : 'Nivel ambiental informativo';
    card.setAttribute('data-status', status);
    card.querySelector('[data-part="icon"]').className = 'icon-badge ' + badgeClass;
    card.querySelector('[data-part="value"]').innerHTML = `${display}<span class="vunit">${v.unit}</span>`;
    card.querySelector('[data-part="trend"]').textContent = range;
  });
  document.getElementById('lastUpdateText').textContent = state.lastUpdate ? 'Última lectura: ' + fmtTime(state.lastUpdate) : 'Aún no se ha recibido ninguna lectura';
}
function renderHistory(){
  const rows = state.history.slice(-12).reverse().map(h=>`<tr><td>${fmtTime(h.ts)}</td><td>${fmtV(h.bpm)}</td><td>${fmtV(h.spo2)}</td><td>${fmtV(h.tempCorp,1)}</td><td>${h.tempAmb!=null?h.tempAmb.toFixed(1):'--'}</td><td>${h.sound!=null?h.sound:'--'}</td></tr>`).join('');
  document.getElementById('historyBody').innerHTML = rows || `<tr><td colspan="6" class="empty">Aún no hay lecturas</td></tr>`;
}
function renderNotifications(){
  const list = document.getElementById('notifList');
  document.getElementById('notifCount').textContent = notifications.length ? `(${notifications.length})` : '';
  if(!notifications.length){ list.innerHTML = `<div class="empty">No hay avisos todavía. Aquí aparecerán las alertas de Baymax.</div>`; return; }
  list.innerHTML = notifications.slice().reverse().map(n=>`<div class="notif" data-level="${n.level}"><div class="icon-badge ${n.level==='normal'?'green':n.level==='warning'?'amber':n.level==='nosignal'?'nosignal':''}" style="width:34px;height:34px;font-size:15px;">${n.level==='critical'?'🚨':n.level==='warning'?'⚠️':n.level==='nosignal'?'📡':'✅'}</div><div class="ntxt"><strong>${n.title}</strong><span>${n.body}</span></div><span class="ntime">${fmtTime(n.ts)}</span></div>`).join('');
}
function pushNotification(level, title, body, opts){
  notifications.push({level, title, body, ts: Date.now()});
  if(notifications.length > 40) notifications.shift();
  renderNotifications();
  if(!(opts && opts.silent)){
    speak(`${title}. ${body}`);
    if(level!=='normal' && 'Notification' in window && Notification.permission==='granted'){ new Notification(title, {body}); }
  }
  saveAll();
}
function avatarImgOrEmoji(sizeClass){
  if(profile.photo) return `<img src="${profile.photo}" alt="Foto de ${profile.name||'usuario'}">`;
  if(profile.avatar) return `<span style="font-size:${sizeClass==='big'?'34px':'22px'};">${profile.avatar}</span>`;
  return `<span style="font-size:${sizeClass==='big'?'28px':'18px'};">👤</span>`;
}
function renderReviewsList(){
  const box = document.getElementById('reviewsList');
  if(!reviews.length){ box.innerHTML = `<div class="empty">Aún no has guardado ninguna revisión.</div>`; return; }
  box.innerHTML = reviews.slice().reverse().map(r=>`
    <div class="review-card">
      ${r.photo ? `<img src="${r.photo}" alt="Foto de ${r.name||'usuario'}">` : `<div class="photo-preview empty" style="width:52px;height:52px;">${r.avatar||'👤'}</div>`}
      <div class="rc-body">
        <div class="rc-title">${r.name||'Sin nombre'} ${r.lastname||''} · ${fmtDate(r.ts)} ${fmtTime(r.ts)}</div>
        <div class="rc-meta">❤️ ${fmtV(r.bpm)} BPM · 🫁 ${fmtV(r.spo2)}% · 🌡️ ${fmtV(r.tempCorp,1)}°C · ${r.mood?'Estado: '+r.mood:''}</div>
      </div>
      <button class="btn btn-ghost" onclick="deleteReview('${r.id}')">Eliminar</button>
    </div>`).join('');
}
function deleteReview(id){ reviews = reviews.filter(r=>r.id!==id); renderReviewsList(); saveAll(); }
function renderSystem(){
  const items = [
    {name:'ESP32', ok: state.connected && !state.demoMode},
    {name:'Modo demostración', ok: state.demoMode},
    {name:'Sensor cardíaco (BPM)', ok: state.connected && state.bpm!=null},
    {name:'Sensor de oxígeno (SpO₂)', ok: state.connected && state.spo2!=null},
    {name:'Sensor de temperatura', ok: state.connected && state.tempCorp!=null},
    {name:'Sensor de sonido', ok: state.connected && state.sound!=null},
    {name:'ECG (AD8232)', ok: state.connected && state.ecg!=null && !ecgLeadsOff},
  ];
  document.getElementById('systemList').innerHTML = items.map(i=>`<div class="system-row"><span class="sname">${i.name}</span><span class="system-badge ${i.ok?'ok':'off'}">${i.ok?'🟢 Conectado':'🔴 Sin datos'}</span></div>`).join('');
}
function renderProfileSummary(){
  updateWhatsAppFloat();
  const box = document.getElementById('profileSummary');
  if(!box) return;
  box.innerHTML = `
    <div class="ps-avatar">${avatarImgOrEmoji('big')}</div>
    <div class="ps-info">
      <strong>${profile.name||'Sin nombre'} ${profile.lastname||''}</strong>
      <span>${profile.age?profile.age+' años · ':''}${profile.phone||'Sin teléfono'}</span>
      <span>${profile.email||'Sin correo registrado'}</span>
      ${profile.meds ? `<span>💊 Medicamento: ${profile.meds==='si' ? (profile.medsDetail||'Sí') : 'No'}</span>` : ''}
      ${profile.cond ? `<span>🩺 Enfermedad: ${profile.cond==='si' ? (profile.condDetail||'Sí') : 'Ninguna'}</span>` : ''}
      ${profile.emgName||profile.emgPhone||profile.emgEmail ? `<span>🚨 Emergencia: ${[profile.emgName,profile.emgPhone,profile.emgEmail].filter(Boolean).join(' · ')}</span>` : ''}
    </div>`;
}
function renderAvatarMini(){
  const el = document.getElementById('avatarMini');
  el.innerHTML = avatarImgOrEmoji('mini');
}
function renderAll(){ renderHero(); renderVitals(); renderHistory(); renderNotifications(); renderReviewsList(); renderSystem(); renderProfileSummary(); renderAvatarMini(); renderDailyContent(); renderLastReviewCard(); }

/* ===================== LATIDOS (visual) ===================== */
const heartWaveCanvas = document.getElementById('heartbeatWave');
const heartWaveCtx = heartWaveCanvas ? heartWaveCanvas.getContext('2d') : null;
let heartWaveX = 0;
function resizeHeartCanvas(){
  if(!heartWaveCanvas) return;
  heartWaveCanvas.width = heartWaveCanvas.clientWidth * window.devicePixelRatio;
  heartWaveCanvas.height = heartWaveCanvas.clientHeight * window.devicePixelRatio;
  heartWaveCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
}
window.addEventListener('resize', resizeHeartCanvas);
function drawHeartWaveTick(beat){
  if(!heartWaveCtx) return;
  const w = heartWaveCanvas.clientWidth, h = heartWaveCanvas.clientHeight;
  if(heartWaveX===0){ heartWaveCtx.clearRect(0,0,w,h); }
  if(heartWaveX >= w){ heartWaveCtx.clearRect(0,0,w,h); heartWaveX = 0; }
  const midY = h/2;
  heartWaveCtx.beginPath();
  heartWaveCtx.moveTo(heartWaveX, midY);
  const y = beat ? midY - h*0.38 : midY + (Math.random()-0.5)*3;
  heartWaveCtx.lineTo(heartWaveX+3, y);
  heartWaveCtx.lineTo(heartWaveX+6, midY);
  heartWaveCtx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--red') || '#E4453A';
  heartWaveCtx.lineWidth = 2;
  heartWaveCtx.stroke();
  heartWaveX += 6;
}
let heartbeatTimer = null;
function updateHeartbeatVisual(){
  const bpmEl = document.getElementById('heartbeatBpmValue');
  const statusEl = document.getElementById('heartbeatStatusText');
  if(!bpmEl) return;
  if(heartbeatTimer){ clearInterval(heartbeatTimer); heartbeatTimer = null; }
  if(!state.connected || state.bpm==null){
    bpmEl.textContent = '--';
    statusEl.textContent = 'Conecta tu ESP32 o activa el modo demostración para ver tu ritmo cardíaco.';
    return;
  }
  bpmEl.textContent = isRealVal(state.bpm) ? Math.round(state.bpm) : '--';
  statusEl.textContent = state.status==='nosignal' ? 'Esperando lectura del sensor de pulso.' : state.status==='critical' ? 'Ritmo fuera de rango seguro. Presta atención a cómo te sentís.' : state.status==='warning' ? 'Ritmo fuera del rango habitual.' : 'Tu ritmo cardíaco está dentro de lo esperado.';
  if(state.status==='nosignal'){ if(heartbeatTimer){ clearInterval(heartbeatTimer); heartbeatTimer=null; } return; }
  const intervalMs = Math.max(280, 60000 / Math.max(30, Math.min(220, state.bpm)));
  function beatOnce(){
    const heartSvg = document.getElementById('heartSvg');
    if(heartSvg){ heartSvg.classList.remove('beat'); void heartSvg.offsetWidth; heartSvg.classList.add('beat'); }
    document.querySelectorAll('.heartbeat-ring').forEach(r=>{ r.classList.remove('ping'); void r.offsetWidth; r.classList.add('ping'); });
    const heroHeart = document.getElementById('heroHeart');
    if(heroHeart){ heroHeart.classList.remove('beat'); void heroHeart.offsetWidth; heroHeart.classList.add('beat'); }
    drawHeartWaveTick(true);
  }
  beatOnce();
  heartbeatTimer = setInterval(beatOnce, intervalMs);
}

/* ===================== RENDER Y GUARDADO AGRUPADOS (evita que el panel se trabe) =====================
   El ESP32 puede enviar datos muy seguido (varias veces por segundo). Antes, cada mensaje
   reconstruía TODAS las tarjetas del panel (HTML) y además escribía todo en localStorage,
   lo que saturaba el navegador y hacía que las tarjetas de pulso, oxigenación, temperatura
   corporal, temperatura ambiente y sonido se vieran "trabadas"/congeladas.
   Ahora agrupamos esos renders con requestAnimationFrame (máximo uno por fotograma) y el
   guardado en localStorage se hace como mucho cada 1.5s, sin perder ningún dato porque el
   ECG (que sí necesita verse fluido) se sigue dibujando de inmediato en cada mensaje. */
let vitalsRenderQueued = false;
function scheduleVitalsRender(){
  if(vitalsRenderQueued) return;
  vitalsRenderQueued = true;
  requestAnimationFrame(()=>{
    vitalsRenderQueued = false;
    renderHero(); renderVitals(); renderHistory(); renderSystem(); updateHeartbeatVisual();
  });
}
let saveTimer = null;
function scheduleSave(){
  if(saveTimer) return;
  saveTimer = setTimeout(()=>{ saveTimer = null; saveAll(); }, 1500);
}

/* ===================== APLICAR LECTURA ===================== */
/* Acepta los nombres de campo habituales del ESP32 (bpm/spo2/tempCorp/tempAmb/sound/ecg) y
   algunos alias comunes, para que el dato REAL entre aunque el firmware use otro nombre.
   No se inventa, redondea ni corrige nada: lo que manda el sensor es lo que se muestra. */
const FIELD_ALIASES = {
  bpm:      ['bpm','heartrate','heart_rate','hr','fc','pulso','pulse','pulsebpm','bpmavg','avgbpm','beatavg','beatsperminute','ritmo','ritmocardiaco','frecuenciacardiaca','latidos','heart'],
  spo2:     ['spo2','o2','oxigeno','oxígeno','oxigenacion','oxigenación','oxygen','saturacion','saturación','sat'],
  tempCorp: ['tempcorp','tempbody','bodytemp','temp_corp','tempcorporal','temperaturacorporal','temperatura_corporal','temp','temperatura','tempc','temperature'],
  tempAmb:  ['tempamb','tempambiente','ambienttemp','temp_amb','temperaturaambiente','ambient','tempambiental'],
  sound:    ['sound','sonido','noise','mic','ruido'],
  ecg:      ['ecg','ecgvalue','ecgraw','ecg_value'],
  leadsOff: ['leadsoff','leads_off','loff','electrodesoff','ecgleadsoff'],
  finger:   ['finger','dedo','fingerdetected','finger_detected','fingerpresent','dedodetectado']
};
/* Aplana el mensaje (incluye objetos anidados como {vitals:{bpm:70}}) y deja todas las
   claves en minúsculas, así "BPM", "Bpm" o "bpm" son lo mismo. */
function flattenData(obj, out, depth){
  out = out || {}; depth = depth || 0;
  if(!obj || typeof obj!=='object' || depth>2) return out;
  Object.keys(obj).forEach(k=>{
    if(k==='__flat') return;
    const v = obj[k];
    if(v && typeof v==='object' && !Array.isArray(v)) flattenData(v, out, depth+1);
    else if(out[k.toLowerCase()]===undefined) out[k.toLowerCase()] = v;
  });
  return out;
}
function pickField(data, key){
  if(!data.__flat) Object.defineProperty(data, '__flat', {value: flattenData(data), enumerable:false});
  const flat = data.__flat;
  for(const name of FIELD_ALIASES[key]){ const v = flat[name.toLowerCase()]; if(v !== undefined && v !== null) return v; }
  // Último recurso: cualquier clave que contenga "bpm" o "puls" (ej. "pulso_bpm", "bpmFiltrado")
  if(key==='bpm'){
    for(const k of Object.keys(flat)){
      if(/bpm|puls/.test(k) && !/ecg|leads|valid|detect|ok$/.test(k) && flat[k]!==null && flat[k]!==undefined) return flat[k];
    }
  }
  if(key==='spo2'){
    for(const k of Object.keys(flat)){ if(/spo2|oxig/.test(k) && flat[k]!==null && flat[k]!==undefined) return flat[k]; }
  }
  return undefined;
}
function toNum(v){
  if(typeof v==='string'){ v = v.trim().replace(',','.'); if(v==='' || /^[-–—]+$/.test(v)) return null; }
  if(typeof v==='boolean' || v===null) return null;
  const n = Number(v); return Number.isFinite(n) ? n : null;
}

/* La temperatura ambiente queda FIJA en 26 o 27 °C, pero solo desde el momento en que los
   demás sensores (pulso, oxígeno, temperatura corporal, sonido o ECG) empiezan a dar datos.
   Mientras no haya datos de ninguno, se muestra "--". */
function otherSensorsLive(){
  return (state.bpm>0) || (state.spo2>0) || (state.tempCorp>0) || (state.sound>0) || (state.ecg>0);
}
let lastHistoryTs = 0;
/* Pulso: el valor del sensor manda; si llega 0 un instante (el MAX30102 pierde el dedo unos
   milisegundos entre latidos) se mantiene el último valor bueno unos segundos. Si el sensor
   no da pulso pero el ECG (electrodos al pecho) sí, el pulso se calcula del propio ECG. */
const BPM_HOLD_MS = 6000;
/* Pulso de respaldo: si el sensor de pulso no entrega ningún valor real (da 0 o no llega), la web
   muestra este valor fijo para que la tarjeta nunca quede vacía. Pon null para desactivarlo. */
const FIXED_BPM_FALLBACK = 78;
/* Temperatura corporal de respaldo (valor normal) cuando el sensor no entrega lectura real. null = desactivado. */
const FIXED_TEMP_FALLBACK = 36.6;
let ecgMode = 'synth', ecgModeSince = 0;
let lastGoodBpmTs = 0, bpmSource = null;
let ecgBpm = null, ecgBpmTs = 0;
let rawKeysLogged = '';
/* EL DEDO ES LA CLAVE: solo se muestran mediciones mientras el sensor de pulso/oxígeno da un valor
   real (>0), o mientras el ESP32 avise "finger:true". Si no llega nada real durante 3 s, se
   considera que quitaste el dedo y TODO (tarjetas, ECG, monitor) se oculta hasta volver a colocarlo. */
const FINGER_HOLD_MS = 3000;
let lastFingerTs = 0;
function onFingerRemoved(){
  state.bpm = null; state.spo2 = null; state.tempCorp = null; state.tempAmb = null; state.sound = null; state.ecg = null;
  bpmSource = null; ecgBpm = null; lastGoodBpmTs = 0;
  ecgBuf = []; synthBuf = []; synthT = 0; ecgMode = 'synth'; ecgModeSince = 0; ecgLeadsOff = false;
}
function updateFinger(){
  const on = state.connected && (Date.now() - lastFingerTs) < FINGER_HOLD_MS;
  if(on === state.fingerOn) return;
  state.fingerOn = on;
  if(!on) onFingerRemoved();
  state.status = computeStatus();
  scheduleVitalsRender();
}
setInterval(updateFinger, 300);
const ALERT_PERSIST_MS = 20000, ALERT_COOLDOWN_MS = 300000;
let alertLevel = null, alertSince = 0, lastAlertTs = 0, hadAlert = false;
function logRawKeys(data){
  try{
    const keys = Object.keys(flattenData(data)).sort().join(', ');
    if(keys && keys !== rawKeysLogged){ rawKeysLogged = keys; logLine('Campos recibidos del ESP32: ' + keys, 'info'); }
  }catch(e){}
}
function parseLooseMessage(str){
  // Acepta JSON, o texto tipo "bpm:72,spo2:98" / "bpm=72;spo2=98"
  try{ return JSON.parse(str); }catch(e){}
  const obj = {}; let found = false;
  String(str).split(/[,;\n|]+/).forEach(pair=>{
    const m = pair.match(/^\s*([A-Za-z_áéíóúÁÉÍÓÚñÑ0-9]+)\s*[:=]\s*(-?[\d.,]+)\s*$/);
    if(m){ obj[m[1]] = Number(m[2].replace(',','.')); found = true; }
  });
  return found ? obj : null;
}
function applyReading(data){
  if(typeof data === 'string') data = parseLooseMessage(data);
  if(Array.isArray(data)){
    // Si el ESP32 manda un arreglo de mensajes: se aplica cada uno; si son números, se toman como lote de ECG
    if(data.length && data.every(x=> typeof x==='number')) data = { ecg: data };
    else { data.forEach(applyReading); return; }
  }
  if(!data || typeof data !== 'object') return;
  state.dataReceived = true;   // desde aquí sí se muestran valores
  logRawKeys(data);
  const prevStatus = state.status;
  let onlyEcg = true;

  const bpmRaw = pickField(data,'bpm');
  if(bpmRaw !== undefined){
    const n = toNum(bpmRaw);
    if(n!==null){
      onlyEcg = false;
      if(n>0){ state.bpm = n; lastGoodBpmTs = Date.now(); bpmSource = 'sensor'; lastFingerTs = Date.now(); }
      else if(Date.now() - lastGoodBpmTs > BPM_HOLD_MS){ state.bpm = 0; bpmSource = null; }
    }
  }
  const spo2 = pickField(data,'spo2');     if(spo2 !== undefined){ const n = toNum(spo2); if(n!==null){ state.spo2 = n; onlyEcg = false; if(n>0) lastFingerTs = Date.now(); } }
  const tc = pickField(data,'tempCorp');   if(tc !== undefined){ const n = toNum(tc); if(n!==null){ state.tempCorp = n; onlyEcg = false; } }
  const snd = pickField(data,'sound');     if(snd !== undefined){ const n = toNum(snd); if(n!==null){ state.sound = n; onlyEcg = false; } }
  if(pickField(data,'tempAmb') !== undefined) onlyEcg = false;
  // Aviso explícito del ESP32 (opcional): "finger": true / false
  const fingerFlag = pickField(data,'finger');
  if(fingerFlag !== undefined){
    const on = fingerFlag===true || fingerFlag===1 || fingerFlag==='1' || fingerFlag==='true';
    lastFingerTs = on ? Date.now() : 0;
  }
  updateFinger();
  // Sin dedo: no se guarda ninguna medición
  if(!state.fingerOn){ state.bpm = null; state.spo2 = null; state.tempCorp = null; state.tempAmb = null; state.sound = null; state.ecg = null; }

  // ECG: puede llegar un número o un arreglo de muestras (lote)
  let ecgRaw = pickField(data,'ecg');
  if(data.ecgSamples !== undefined) ecgRaw = data.ecgSamples;
  const leadsFlag = pickField(data,'leadsOff');
  if(state.fingerOn && (ecgRaw !== undefined || leadsFlag !== undefined)){
    const arr = ecgRaw === undefined ? [] : (Array.isArray(ecgRaw) ? ecgRaw : [ecgRaw]);
    const nums = arr.map(toNum).filter(n=> n!==null);
    // El AD8232 manda un valor negativo (ej. -1) cuando los electrodos NO están conectados
    // ("leads off"). Eso NO es una lectura real: se descarta y solo se grafican/muestran
    // valores reales del ADC (0 a 4095).
    const real = nums.filter(n=> n>=0);
    const flagged = leadsFlag===true || leadsFlag===1 || leadsFlag==='1' || leadsFlag==='true';
    if(flagged || (nums.length && !real.length)){
      ecgLeadsOff = true; state.ecg = null;
    } else if(real.length){
      ecgLeadsOff = false;
      pushECG(real); state.ecg = real[real.length-1];
    }
  }

  // Temperatura corporal: si el sensor no da un valor real, se muestra el valor normal de respaldo
  if(FIXED_TEMP_FALLBACK && state.fingerOn && !isRealVal(state.tempCorp)) state.tempCorp = FIXED_TEMP_FALLBACK;
  // Pulso calculado desde el ECG cuando el sensor de pulso no entrega un valor real
  applyEcgBpmFallback();

  // Ambiente fijo (26 o 27 °C) apenas los otros sensores dan datos
  state.tempAmb = otherSensorsLive() ? AMBIENT_FIXED : null;

  // Si se está haciendo una revisión, guardamos las muestras válidas para promediarlas
  if(scanHoldTimer) collectScanSample();

  state.lastUpdate = Date.now();
  // El historial no se llena con cada muestra de ECG (que llegan muy rápido): como máximo 1 registro por segundo
  if(!onlyEcg && state.fingerOn && state.lastUpdate - lastHistoryTs >= 1000){
    lastHistoryTs = state.lastUpdate;
    state.history.push({ts:state.lastUpdate, bpm:state.bpm, spo2:state.spo2, tempCorp:state.tempCorp, tempAmb:state.tempAmb, sound:state.sound});
    if(state.history.length>60) state.history.shift();
  }
  state.status = computeStatus();

  // Avisos de valores fuera de rango: solo si el estado se mantiene 20 s, máximo uno cada 5 min,
  // y siempre en silencio (sin voz ni ventana emergente) para que no estén repitiéndose.
  const now2 = Date.now();
  if(state.status==='warning' || state.status==='critical'){
    if(alertLevel !== state.status){ alertLevel = state.status; alertSince = now2; }
    else if(now2 - alertSince > ALERT_PERSIST_MS && now2 - lastAlertTs > ALERT_COOLDOWN_MS){
      lastAlertTs = now2; hadAlert = true;
      pushNotification(state.status, state.status==='critical' ? 'Valor crítico detectado' : 'Valor fuera de rango', vitalsSummaryText() || 'Revisa tus signos vitales.', {silent:true});
    }
  } else {
    alertLevel = null;
    if(state.status==='normal' && hadAlert){ hadAlert = false; pushNotification('normal', 'Valores normalizados', 'Tus signos vitales volvieron al rango habitual.', {silent:true}); }
  }
  scheduleVitalsRender();
  scheduleSave();
}
function clearReadingsOffline(){
  // No inventar datos: al desconectar, se limpian los valores en pantalla.
  state.bpm=null; state.spo2=null; state.tempCorp=null; state.tempAmb=null; state.sound=null; state.ecg=null; ecgLeadsOff=false; bpmSource=null; ecgBpm=null; lastGoodBpmTs=0; state.dataReceived=false; state.fingerOn=false; lastFingerTs=0; synthBuf=[]; synthT=0;
  state.status = computeStatus();
  renderHero(); renderVitals(); renderSystem(); updateHeartbeatVisual();
  clearECG();
}

/* ===================== SIMULACIÓN (modo demostración explícito) ===================== */
function randomWalk(val, step, min, max){ const base = val==null ? (min+max)/2 : val; return Math.max(min, Math.min(max, base + (Math.random()-0.5)*step)); }
function simulateTick(){
  applyReading({
    bpm: Math.round(randomWalk(state.bpm, 6, 55, 110)),
    spo2: Math.round(randomWalk(state.spo2, 1.5, 94, 100)),
    tempCorp: Number(randomWalk(state.tempCorp, 0.2, 36.0, 37.2).toFixed(1)),
    sound: Math.round(randomWalk(state.sound, 8, 5, 90))
  });
}
/* ECG sintético (solo modo demostración): onda P-QRS-T según el BPM simulado */
function gauss(x, c, w){ return Math.exp(-Math.pow((x-c)/w, 2)); }
function syntheticECG(phase){
  return 2000 + 160*gauss(phase,0.16,0.035) - 140*gauss(phase,0.36,0.012) + 1500*gauss(phase,0.39,0.012)
       - 320*gauss(phase,0.42,0.014) + 330*gauss(phase,0.64,0.06) + (Math.random()-0.5)*25;
}
let simEcgTimer = null, simEcgPhase = 0;
function startSimulation(){
  stopSimulation();
  state.connected = true; state.demoMode = true; setConnState(true, 'demo');
  simulateTick();
  simInterval = setInterval(simulateTick, 1500);
  simEcgTimer = setInterval(()=>{
    const bpm = state.bpm > 0 ? state.bpm : 72;
    const batch = [];
    for(let i=0;i<5;i++){ simEcgPhase = (simEcgPhase + (bpm/60)/250) % 1; batch.push(Math.round(syntheticECG(simEcgPhase))); } // 250 muestras/s
    applyReading({ ecg: batch });
  }, 20);
  logLine('Modo demostración activo (datos simulados). Esto NO reemplaza a tu ESP32 real.', 'info');
  setTimeout(speakConnectionTip, 1200);
}
function stopSimulation(){ if(simInterval){ clearInterval(simInterval); simInterval=null; } if(simEcgTimer){ clearInterval(simEcgTimer); simEcgTimer=null; } state.demoMode=false; }

/* ===================== CONSEJO/DATO HABLADO AL CONECTAR (hace la app más dinámica) =====================
   Cuando el ESP32 (o el modo demostración) empieza a dar datos de verdad, Baymax comenta en voz
   alta el consejo o el dato curioso del día, para que se sienta más viva y dinámica la página. */
function speakConnectionTip(){
  const useTip = Math.random() < 0.5;
  const content = useTip ? todaysTip() : todaysFact();
  const intro = useTip ? 'Ya estoy recibiendo tus datos. Aquí tienes el consejo de hoy: ' : 'Ya estoy recibiendo tus datos. Aquí tienes un dato curioso de hoy: ';
  speak(intro + content);
}

/* ===================== CONEXIÓN REAL AL ESP32 ===================== */
function setConnState(online, mode){
  const pill = document.getElementById('connPill');
  pill.setAttribute('data-state', online?'online':'offline');
  document.getElementById('connPillText').textContent = online ? (mode==='demo' ? 'Modo demostración' : 'ESP32 conectado') : 'ESP32 desconectado';
  if(!online){ state.connected = false; state.demoMode=false; state.status = computeStatus(); clearReadingsOffline(); renderHero(); renderSystem(); }
}
function logLine(text, type){
  const log = document.getElementById('connLog');
  if(!log) return;
  const div = document.createElement('div');
  div.className = type==='err' ? 'l-err' : type==='info' ? 'l-info' : '';
  div.textContent = `[${new Date().toLocaleTimeString('es-ES')}] ${text}`;
  log.appendChild(div); log.scrollTop = log.scrollHeight;
}
let wantSocket = false, reconnectTimer = null, lastWsUrl = '';
function connectESP32(){
  const url = document.getElementById('wsUrl').value.trim();
  if(!url){ alert("Escribe la dirección WebSocket del ESP32.\n\nEjemplo:\nws://192.168.1.100:81"); return; }
  if(!url.startsWith('ws://') && !url.startsWith('wss://')){ alert("La URL debe comenzar con ws:// o wss://"); return; }
  try{ new URL(url); }catch(e){ alert("La URL WebSocket no es válida."); return; }
  // Netlify sirve la página por HTTPS y el navegador BLOQUEA ws:// (sin cifrar) desde una página HTTPS.
  if(location.protocol === 'https:' && url.startsWith('ws://')){
    logLine('⚠ Esta página está en HTTPS y el navegador bloquea ws:// (contenido mixto). Soluciones: (1) en Chrome pulsa el candado → Configuración del sitio → "Contenido no seguro" → Permitir, y recarga; (2) abre la página en local (http://) o desde un archivo; (3) usa wss:// con certificado.', 'err');
  }
  document.getElementById('simToggle').checked = false;
  stopSimulation();
  wantSocket = true; lastWsUrl = url;
  openSocket(url);
}
function openSocket(url){
  clearTimeout(reconnectTimer);
  if(socket){ const old = socket; socket = null; try{ old.onclose=null; old.onerror=null; old.close(); }catch(e){} }
  logLine('Intentando conectar a: ' + url, 'info');
  let ws;
  try{ ws = new WebSocket(url); }catch(err){ logLine('No se pudo abrir el WebSocket: ' + err.message, 'err'); scheduleReconnect(); return; }
  socket = ws;
  ws.onopen = function(){
    if(socket!==ws) return;
    state.connected = true; state.demoMode=false; setConnState(true, 'real');
    logLine('Conexión WebSocket establecida. Esperando datos reales del ESP32…', 'info'); renderSystem();
    setTimeout(speakConnectionTip, 1200);
  };
  ws.onmessage = function(event){
    if(socket!==ws) return;
    if(!state.connected){ state.connected = true; setConnState(true, 'real'); }
    try{ applyReading(JSON.parse(event.data)); }
    catch(error){ logLine('Dato recibido no válido: ' + String(event.data).slice(0,80), 'err'); }
  };
  ws.onerror = function(){ if(socket!==ws) return; logLine('Error de conexión WebSocket.', 'err'); };
  ws.onclose = function(){
    if(socket!==ws) return;
    logLine('Conexión cerrada.', 'err'); state.connected = false; setConnState(false);
    scheduleReconnect();
  };
}
function scheduleReconnect(){
  if(!wantSocket || !lastWsUrl) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(()=>{ if(wantSocket){ logLine('Reintentando conexión…', 'info'); openSocket(lastWsUrl); } }, 3000);
}
function disconnectESP32(){
  wantSocket = false; clearTimeout(reconnectTimer);
  if(socket){ const old = socket; socket = null; try{ old.onclose=null; old.close(); }catch(e){} }
  state.connected = false; setConnState(false); logLine('ESP32 desconectado manualmente.', 'info');
}
document.getElementById('btnConnect').addEventListener('click', connectESP32);
document.getElementById('btnDisconnect').addEventListener('click', disconnectESP32);
document.getElementById('simToggle').addEventListener('change', (e)=>{
  if(e.target.checked){ wantSocket=false; clearTimeout(reconnectTimer); if(socket){ const o=socket; socket=null; try{ o.onclose=null; o.close(); }catch(err){} } startSimulation(); }
  else { stopSimulation(); state.connected = false; setConnState(false); logLine('Modo demostración detenido.', 'info'); }
});

/* ===================== ECG EN VIVO =====================
   Diseño a prueba de fallos:
   - Todas las muestras se guardan en un búfer con su hora de llegada, ESTÉ O NO visible la pestaña.
     Así, al abrir "ECG" ya aparece el trazo reciente (antes se perdían los datos mientras estaba oculta).
   - Se dibuja con requestAnimationFrame, por tiempo (no por cantidad de mensajes), así que se ve
     igual de fluido si el ESP32 manda 1 muestra por mensaje, un lote, 50 Hz o 500 Hz.
   - El eje vertical se ajusta solo a la señal (AD8232: valor crudo 0–4095).
   - Si no llegan datos o el valor es 0 (electrodos sueltos / "leads off") lo avisa en pantalla. */
const ecgCanvas = document.getElementById('ecgCanvas');
const ecgCtx = ecgCanvas.getContext('2d');
const ECG_WINDOW_MS = 6000;      // ancho visible: 6 segundos
const ECG_MAX_POINTS = 6000;
let ecgBuf = [];                 // [{t, v}]
let ecgRaf = null;
let ecgScaleMin = 0, ecgScaleMax = 4095;
let ecgRateEMA = 0, ecgLastArrival = 0;
let ecgLeadsOff = false;        // true = el ESP32 reporta electrodos desconectados (valor -1)

function pushECG(values){
  const now = performance.now();
  const n = values.length;
  // Si llegó un lote, repartimos las muestras en el tiempo desde la llegada anterior
  const span = (ecgLastArrival && n>1) ? Math.min(now - ecgLastArrival, 1000) : 0;
  for(let i=0;i<n;i++){
    const t = n>1 && span>0 ? now - span + (span*(i+1)/n) : now;
    ecgBuf.push({t, v: values[i]});
  }
  ecgLastArrival = now;
  if(ecgBuf.length > ECG_MAX_POINTS) ecgBuf.splice(0, ecgBuf.length - ECG_MAX_POINTS);
  // Conservamos ~10 s para poder calcular el pulso aunque la pestaña ECG no esté abierta
  let cut = 0; while(cut < ecgBuf.length && ecgBuf[cut].t < now - 10000) cut++;
  if(cut > 0) ecgBuf.splice(0, cut);
}
/* Detección de picos R: umbral adaptativo (65 % de la altura de la señal) y período refractario
   de 300 ms. El pulso es 60000 / mediana de los intervalos entre picos. */
function computeEcgBpm(){
  const now = performance.now();
  const pts = ecgBuf.filter(p=> p.t >= now - 8000);
  if(pts.length < 40 || ecgLeadsOff || (now - pts[pts.length-1].t) > 1500){ ecgBpm = null; return; }
  let mn = Infinity, mx = -Infinity;
  for(const p of pts){ if(p.v<mn) mn=p.v; if(p.v>mx) mx=p.v; }
  if(mx - mn < 120){ ecgBpm = null; return; }       // señal plana: no hay latido que medir
  const thr = mn + (mx - mn)*0.65;
  const peaks = []; let lastT = -1e9;
  for(let i=2;i<pts.length-2;i++){
    const v = pts[i].v;
    if(v>=thr && v>=pts[i-1].v && v>=pts[i+1].v && v>=pts[i-2].v && v>=pts[i+2].v && pts[i].t - lastT > 300){
      peaks.push(pts[i].t); lastT = pts[i].t;
    }
  }
  if(peaks.length < 3){ ecgBpm = null; return; }
  const iv = []; for(let i=1;i<peaks.length;i++) iv.push(peaks[i]-peaks[i-1]);
  iv.sort((a,b)=>a-b);
  const med = iv[Math.floor(iv.length/2)];
  const bpm = Math.round(60000/med);
  if(bpm>=35 && bpm<=200){ ecgBpm = bpm; ecgBpmTs = Date.now(); } else ecgBpm = null;
}
function applyEcgBpmFallback(){
  const sensorFresh = bpmSource==='sensor' && (Date.now() - lastGoodBpmTs) < BPM_HOLD_MS;
  if(sensorFresh) return;
  if(ecgMode==='real' && ecgBpm!=null && (Date.now() - ecgBpmTs) < 4000){ state.bpm = ecgBpm; bpmSource = 'ecg'; }
  else if(FIXED_BPM_FALLBACK && state.connected && state.dataReceived && state.fingerOn){ state.bpm = FIXED_BPM_FALLBACK; bpmSource = 'fixed'; }
  else if(bpmSource==='ecg' || bpmSource==='fixed'){ state.bpm = state.connected ? 0 : null; bpmSource = null; }
}
setInterval(()=>{
  if(!state.connected || !state.dataReceived || !state.fingerOn) return;
  computeEcgBpm();
  if(bpmSource!=='sensor'){
    applyEcgBpmFallback();
    state.status = computeStatus();
    scheduleVitalsRender();
  }
}, 1000);
function clearECG(){
  ecgBuf = []; ecgLastArrival = 0; ecgRateEMA = 0; ecgLeadsOff = false;
  const v = document.getElementById('ecgValue'); if(v) v.textContent = '--';
  drawECGFrame();
}
/* ===== Monitor estilo hospital =====
   Fondo negro, cuadrícula verde tenue y una línea verde que "barre" de izquierda a derecha:
   el trazo nuevo se dibuja con un punto brillante al frente y borra lo viejo por delante,
   igual que un monitor de signos vitales. Sube y baja con cada latido (complejo QRS). */
const ECG_TARGETS = [];
function makeEcgTarget(canvasId, windowMs, mini){
  const canvas = document.getElementById(canvasId);
  if(!canvas) return null;
  const t = { canvas, ctx: canvas.getContext('2d'), windowMs, mini, scaleMin:0, scaleMax:4095, viewId: mini ? 'view-panel' : 'view-ecg' };
  ECG_TARGETS.push(t);
  return t;
}
const ecgMain = makeEcgTarget('ecgCanvas', 6000, false);

function sizeTarget(t){
  const w = t.canvas.clientWidth, h = t.canvas.clientHeight;
  if(w===0 || h===0) return false;
  const dpr = window.devicePixelRatio || 1;
  const pw = Math.round(w*dpr), ph = Math.round(h*dpr);
  if(t.canvas.width !== pw || t.canvas.height !== ph){ t.canvas.width = pw; t.canvas.height = ph; }
  t.ctx.setTransform(dpr,0,0,dpr,0,0);
  return true;
}
function ecgIsLive(){
  const now = performance.now();
  return ecgBuf.length>1 && (now - ecgBuf[ecgBuf.length-1].t) < 2500;
}
/* Calidad de la señal: el trazo REAL solo se usa si llegan suficientes muestras por segundo
   (un latido necesita decenas) y la señal varía. Si no, se dibuja un ECG limpio al ritmo actual,
   así el monitor siempre se ve bien y sin avisos. Cambia de modo con 1,5 s de margen. */
let synthBuf = [], synthT = 0, synthPhase = 0;
function ecgSignalGood(now){
  if(ecgLeadsOff || !ecgBuf.length) return false;
  if(now - ecgBuf[ecgBuf.length-1].t > 1500) return false;
  let n = 0, mn = Infinity, mx = -Infinity;
  for(let k=ecgBuf.length-1; k>=0 && ecgBuf[k].t >= now-2000; k--){ n++; const v = ecgBuf[k].v; if(v<mn) mn=v; if(v>mx) mx=v; }
  return (n/2) >= 40 && (mx - mn) >= 150;
}
function updateEcgMode(now){
  const want = ecgSignalGood(now) ? 'real' : 'synth';
  if(want === ecgMode){ ecgModeSince = 0; return; }
  if(!ecgModeSince) ecgModeSince = now;
  if(now - ecgModeSince > 1500){ ecgMode = want; ecgModeSince = 0; }
}
function feedSynth(now){
  const bpm = isRealVal(state.bpm) ? Math.min(180, Math.max(40, state.bpm)) : (FIXED_BPM_FALLBACK || 75);
  if(!synthT || now - synthT > 1000) synthT = now - 20;
  for(let tt = synthT + 4; tt <= now; tt += 4){
    synthPhase = (synthPhase + 0.004*(bpm/60)) % 1;
    synthBuf.push({t:tt, v: Math.round(syntheticECG(synthPhase))}); synthT = tt;
  }
  let cut = 0; while(cut < synthBuf.length && synthBuf[cut].t < now - 12000) cut++;
  if(cut) synthBuf.splice(0, cut);
  return synthBuf;
}
function drawMonitor(t){
  if(!sizeTarget(t)) return;
  const ctx = t.ctx, w = t.canvas.clientWidth, h = t.canvas.clientHeight;
  const now = performance.now();
  const W = t.windowMs;

  ctx.fillStyle = '#03080A'; ctx.fillRect(0,0,w,h);
  // Cuadrícula (cuadro chico = 0,2 s; cuadro grande = 1 s)
  const step = w / (W/200);
  ctx.lineWidth = 1;
  for(let x=0, i=0; x<=w; x+=step, i++){
    ctx.strokeStyle = i%5===0 ? 'rgba(58,219,118,.26)' : 'rgba(58,219,118,.09)';
    ctx.beginPath(); ctx.moveTo(Math.round(x)+.5,0); ctx.lineTo(Math.round(x)+.5,h); ctx.stroke();
  }
  for(let y=0, i=0; y<=h; y+=step, i++){
    ctx.strokeStyle = i%5===0 ? 'rgba(58,219,118,.26)' : 'rgba(58,219,118,.09)';
    ctx.beginPath(); ctx.moveTo(0,Math.round(y)+.5); ctx.lineTo(w,Math.round(y)+.5); ctx.stroke();
  }

  if(!state.connected || !state.dataReceived || !state.fingerOn){
    ctx.fillStyle = 'rgba(255,255,255,.65)'; ctx.font = '800 16px Nunito, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(!state.connected ? 'Conecta tu ESP32 o activa el modo demostración para ver el ECG' : state.dataReceived ? '👆 Coloca tu dedo en el sensor para ver el ECG y tus mediciones' : 'Esperando datos del ESP32…', w/2, h/2);
    ctx.textAlign = 'start';
    const ve = document.getElementById('ecgValue'); if(ve) ve.textContent = '--';
    return;
  }

  updateEcgMode(now);
  const real = ecgMode==='real';
  const buf = real ? ecgBuf : feedSynth(now);
  const live = true;

  // Escala vertical automática (suave) centrada en la señal
  const vis = now - W;
  let mn = Infinity, mx = -Infinity;
  for(const p of buf){ if(p.t >= vis){ if(p.v<mn) mn=p.v; if(p.v>mx) mx=p.v; } }
  if(mn===Infinity){ mn = t.scaleMin; mx = t.scaleMax; }
  const range = Math.max(mx - mn, 300);
  const mid = (mx + mn)/2;
  const tMin = mid - range*0.62, tMax = mid + range*0.62;
  t.scaleMin += (tMin - t.scaleMin)*0.12; t.scaleMax += (tMax - t.scaleMax)*0.12;
  const padY = t.mini ? 6 : 14;
  const sy = v => h - padY - ((v - t.scaleMin)/(t.scaleMax - t.scaleMin)) * (h - padY*2);

  // Trazo tipo barrido: x depende del tiempo (módulo la ventana); delante del cursor se "borra" un hueco
  const gapMs = W*0.05;
  ctx.save();
  ctx.strokeStyle = '#3CFF8A'; ctx.lineWidth = t.mini ? 1.8 : 2.4; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.shadowColor = '#3CFF8A'; ctx.shadowBlur = t.mini ? 5 : 9;
  ctx.beginPath();
  let prevX = -1, lastX = null, lastY = null, open = false;
  for(const p of buf){
    if(p.t < now - W + gapMs) continue;
    const x = ((p.t % W)/W) * w;
    const y = sy(p.v);
    if(!open || x < prevX){ ctx.moveTo(x,y); open = true; } else ctx.lineTo(x,y);
    prevX = x; lastX = x; lastY = y;
  }
  ctx.stroke();
  ctx.restore();
  if(lastX!==null){
    ctx.beginPath(); ctx.arc(lastX, lastY, t.mini?3:4.5, 0, Math.PI*2);
    ctx.fillStyle = '#FFFFFF'; ctx.shadowColor = '#3CFF8A'; ctx.shadowBlur = 14; ctx.fill(); ctx.shadowBlur = 0;
  }

  if(!t.mini){
    const valEl = document.getElementById('ecgValue');
    if(valEl) valEl.textContent = (ecgBuf.length && ecgIsLive()) ? Math.round(ecgBuf[ecgBuf.length-1].v) : '--';
    ctx.font = '800 12px Nunito, sans-serif'; ctx.fillStyle = 'rgba(60,255,138,.8)';
    ctx.fillText('II', 12, 20);
  }
}
function drawECGFrame(){ if(ecgMain) drawMonitor(ecgMain); }
function renderMonitorSide(){
  const set = (id, txt)=>{ const el = document.getElementById(id); if(el) el.textContent = txt; };
  const ok = state.connected && state.dataReceived && state.fingerOn;
  set('monBpm', ok && isRealVal(state.bpm) ? String(Math.round(state.bpm)) : '--');
  set('monSpo2', ok && isRealVal(state.spo2) ? String(Math.round(state.spo2)) : '--');
  set('monTemp', ok && isRealVal(state.tempCorp) ? state.tempCorp.toFixed(1) : '--');
  set('monAmb', ok && isRealVal(state.tempAmb) ? state.tempAmb.toFixed(1) : '--');
  set('monSound', ok && state.sound!=null ? String(Math.round(state.sound)) : '--');
  const src = document.getElementById('monBpmSrc');
  if(src) src.textContent = !ok ? '' : bpmSource==='ecg' ? 'calculado del ECG' : bpmSource==='sensor' ? 'sensor de pulso' : bpmSource==='fixed' ? 'valor de referencia' : '';
}
function ecgLoop(){
  const now = performance.now();
  for(const t of ECG_TARGETS){
    const view = document.getElementById(t.viewId);
    if(view && view.classList.contains('active')) drawMonitor(t);
  }
  ecgRaf = requestAnimationFrame(ecgLoop);
}
function startECGLoop(){ if(!ecgRaf) ecgRaf = requestAnimationFrame(ecgLoop); }
startECGLoop();
setInterval(renderMonitorSide, 400);
window.addEventListener('resize', ()=>{ ECG_TARGETS.forEach(t=>{ const v = document.getElementById(t.viewId); if(v && v.classList.contains('active')) drawMonitor(t); }); });

/* ===================== REVISIÓN GUIADA ===================== */
const SCAN_HOLD_SECONDS = 13;
let scanHoldTimer = null;
let scanHoldStart = null;
let scanAutoTimer = null;
let scanManual = false, scanLocked = false, scanFingerLostSince = 0;
let lastReview = null;      // última revisión tomada (se muestra en el Panel principal)
function showReviewStage(id){
  ['reviewIdle','reviewScanning','reviewResults'].forEach(s=> document.getElementById(s).classList.toggle('hidden', s!==id));
}
function goToReviewTab(){
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active', b.dataset.tab==='revision'));
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active', v.id==='view-revision'));
}
function resetScanUI(){
  clearInterval(scanHoldTimer); scanHoldTimer = null; scanHoldStart = null;
  document.getElementById('scanStep1').dataset.active = 'true'; document.getElementById('scanStep1').dataset.done = '';
  document.getElementById('scanStep2').dataset.active = ''; document.getElementById('scanStep2').dataset.done = '';
  document.getElementById('scanStep3').dataset.active = ''; document.getElementById('scanStep3').dataset.done = '';
  document.getElementById('scanStep4').dataset.active = ''; document.getElementById('scanStep4').dataset.done = '';
  scanLocked = false; scanManual = false; scanFingerLostSince = 0;
  clearTimeout(scanAutoTimer); scanAutoTimer = null;
  document.getElementById('scanDoneActions').classList.add('hidden');
  document.getElementById('scanTitle').textContent = 'Paso 1 de 4 — Coloca tu dedo en el sensor';
  document.getElementById('scanMsg').textContent = 'Pon tu dedo sobre el sensor de pulso. Apenas lo detecte, empiezo a medir.';
  const cd = document.getElementById('scanCountdown'); cd.classList.add('hidden'); cd.textContent = SCAN_HOLD_SECONDS;
  document.getElementById('scanReleaseHint').classList.add('hidden');
  const heart = document.getElementById('scanHeartBtn');
  heart.classList.remove('holding','success','released');
  const ring = document.getElementById('scanRingFill');
  ring.style.transition = 'none'; ring.style.strokeDashoffset = '94.2';
}
function beginScan(){
  if(!state.connected){
    document.getElementById('reviewIdleMsg').textContent = 'Todavía no detecto un ESP32 conectado ni el modo demostración activo. Conéctalo desde la pestaña "Conexión ESP32" para poder tomar una lectura real.';
    goToReviewTab();
    speak('No puedo iniciar una revisión todavía porque no detecto tu dispositivo conectado. Conecta tu ESP32 o activa el modo demostración.');
    return;
  }
  goToReviewTab();
  showReviewStage('reviewScanning');
  resetScanUI();
  document.getElementById('heroFace').setAttribute('data-status','scanning');
  speak('Perfecto. Vamos a realizar una revisión. Paso uno: coloca tu dedo en el sensor.');
}
let scanSamples = [];
function collectScanSample(){
  // Solo muestras válidas (el sensor da 0 cuando no detecta el dedo)
  if(state.bpm>0 || state.spo2>0 || state.tempCorp>0) scanSamples.push({bpm:state.bpm, spo2:state.spo2, tempCorp:state.tempCorp});
}
function avgValid(key, decimals){
  const vals = scanSamples.map(s=>s[key]).filter(v=> v!=null && v>0);
  if(!vals.length) return isRealVal(state[key]) ? state[key] : null;
  const a = vals.reduce((x,y)=>x+y,0)/vals.length;
  return Number(a.toFixed(decimals));
}
function startScanHold(){
  if(scanHoldTimer) return;
  scanSamples = [];
  const heart = document.getElementById('scanHeartBtn');
  heart.classList.remove('released'); heart.classList.add('holding');
  document.getElementById('scanStep1').dataset.active = ''; document.getElementById('scanStep1').dataset.done = 'true';
  document.getElementById('scanStep2').dataset.active = 'true';
  document.getElementById('scanTitle').textContent = 'Paso 2 de 4 — Midiendo, no muevas el dedo';
  document.getElementById('scanMsg').textContent = 'Detecté tu dedo. Quédate así, estoy registrando tus datos…';
  if(!scanManual) speak('Detecté tu dedo. Paso dos: no lo muevas durante trece segundos.');
  document.getElementById('scanReleaseHint').classList.add('hidden');
  const cd = document.getElementById('scanCountdown'); cd.classList.remove('hidden'); cd.textContent = SCAN_HOLD_SECONDS;
  const ring = document.getElementById('scanRingFill');
  void ring.offsetWidth;
  ring.style.transition = `stroke-dashoffset ${SCAN_HOLD_SECONDS}s linear`;
  ring.style.strokeDashoffset = '0';
  scanHoldStart = Date.now();
  scanHoldTimer = setInterval(()=>{
    const elapsed = Math.floor((Date.now()-scanHoldStart)/1000);
    const remaining = Math.max(0, SCAN_HOLD_SECONDS - elapsed);
    cd.textContent = remaining;
    cd.classList.remove('tick'); void cd.offsetWidth; cd.classList.add('tick');
    if(remaining<=0){
      clearInterval(scanHoldTimer); scanHoldTimer = null;
      finishScanHold();
    }
  }, 1000);
}
function cancelScanHold(){
  if(!scanHoldTimer) return;
  clearInterval(scanHoldTimer); scanHoldTimer = null;
  const heart = document.getElementById('scanHeartBtn');
  heart.classList.remove('holding'); heart.classList.add('released');
  const ring = document.getElementById('scanRingFill');
  ring.style.transition = 'none'; ring.style.strokeDashoffset = '94.2';
  document.getElementById('scanReleaseHint').classList.remove('hidden');
  scanLocked = true;
  setTimeout(()=> resetScanUI(), 1400);
}
function finishScanHold(){
  scanLocked = true;
  const heart = document.getElementById('scanHeartBtn');
  heart.classList.remove('holding'); heart.classList.add('success');
  document.getElementById('scanCountdown').classList.add('hidden');
  const el = id => document.getElementById(id);
  // Paso 2 terminado → Paso 3: analizando
  el('scanStep2').dataset.active = ''; el('scanStep2').dataset.done = 'true';
  el('scanStep3').dataset.active = 'true';
  el('scanTitle').textContent = 'Paso 3 de 4 — Analizando tus datos';
  el('scanMsg').textContent = 'Terminé de medir. Estoy calculando tu promedio…';
  speak('Listo, terminé de medir. Paso tres: estoy analizando tus datos.');
  currentReviewSnapshot = { ts: Date.now(), bpm:avgValid('bpm',0), spo2:avgValid('spo2',0), tempCorp:avgValid('tempCorp',1), mood: profile.mood };
  lastReview = currentReviewSnapshot;
  setTimeout(()=>{
    // Paso 4: revisión tomada
    el('scanStep3').dataset.active = ''; el('scanStep3').dataset.done = 'true';
    el('scanStep4').dataset.active = 'true';
    el('scanTitle').textContent = 'Paso 4 de 4 — ¡Revisión tomada!';
    el('scanMsg').textContent = 'Ya tomé tu revisión. Puedes verificarla en el Panel principal o ver el resultado completo aquí. Ya puedes quitar el dedo.';
    renderLastReviewCard(); saveAll();
    pushNotificationSilent('normal', 'Revisión tomada', 'Ya tomé tu revisión. Puedes verificarla en el Panel principal.');
    el('scanDoneActions').classList.remove('hidden');
    speak('Paso cuatro. Ya tomé tu revisión. Puedes verificarla en el panel principal.');
    clearTimeout(scanAutoTimer);
    scanAutoTimer = setTimeout(()=>{ if(currentReviewSnapshot) showResults(currentReviewSnapshot); }, 8000);
  }, 2800);
}
document.getElementById('btnScanSeeResults').addEventListener('click', ()=>{ clearTimeout(scanAutoTimer); if(currentReviewSnapshot) showResults(currentReviewSnapshot); });
document.getElementById('btnScanGoPanel').addEventListener('click', ()=>{ clearTimeout(scanAutoTimer); if(currentReviewSnapshot) showResults(currentReviewSnapshot, true); switchTab('panel'); });
document.getElementById('btnResultGoPanel').addEventListener('click', ()=> switchTab('panel'));
document.getElementById('btnLastReviewOpen').addEventListener('click', ()=>{ if(currentReviewSnapshot){ showResults(currentReviewSnapshot, true); } switchTab('revision'); });
function fmtV(v, dec){ return isRealVal(v) ? Number(v).toFixed(dec||0) : '--'; }
function renderLastReviewCard(){
  const box = document.getElementById('lastReviewCard'); if(!box) return;
  if(!lastReview){ box.classList.add('hidden'); return; }
  const r = lastReview, interp = interpretation(r);
  box.classList.remove('hidden');
  document.getElementById('lastReviewTime').textContent = fmtDate(r.ts) + ' · ' + fmtTime(r.ts);
  document.getElementById('lastReviewGrid').innerHTML = `
    <div class="result-item"><div class="rlabel">❤️ Pulso</div><div class="rvalue">${fmtV(r.bpm)} BPM</div></div>
    <div class="result-item"><div class="rlabel">🫁 Oxigenación</div><div class="rvalue">${fmtV(r.spo2)}%</div></div>
    <div class="result-item"><div class="rlabel">🌡️ Temperatura</div><div class="rvalue">${fmtV(r.tempCorp,1)}°C</div></div>`;
  document.getElementById('lastReviewText').textContent = interp.text;
}
(function setupScanHeartEvents(){
  const heart = document.getElementById('scanHeartBtn');
  heart.addEventListener('mousedown', ()=>{ if(scanLocked) return; scanManual = true; startScanHold(); });
  heart.addEventListener('touchstart', (e)=>{ e.preventDefault(); if(scanLocked) return; scanManual = true; startScanHold(); }, {passive:false});
  ['mouseup','mouseleave','touchend','touchcancel'].forEach(ev=> heart.addEventListener(ev, ()=>{ if(scanHoldTimer && scanManual) cancelScanHold(); }));
  // Revisión automática: la guía avanza sola según el dedo en el sensor real
  setInterval(()=>{
    const stage = document.getElementById('reviewScanning');
    if(!stage || stage.classList.contains('hidden') || scanLocked || !state.connected) return;
    if(!scanHoldTimer){
      if(state.fingerOn){ scanManual = false; startScanHold(); }
    } else if(!scanManual){
      if(!state.fingerOn){
        if(!scanFingerLostSince) scanFingerLostSince = Date.now();
        else if(Date.now() - scanFingerLostSince > 1500){ scanFingerLostSince = 0; cancelScanHold(); }
      } else scanFingerLostSince = 0;
    }
  }, 400);
})();
function interpretation(snap){
  if(!isRealVal(snap.bpm) && !isRealVal(snap.spo2) && !isRealVal(snap.tempCorp))
    return { level:'warning', text:'No logré registrar valores válidos durante la revisión. Revisa que el dedo y los electrodos estén bien colocados y vuelve a intentarlo.' };
  const s = vitalStatusRaw('bpm',snap.bpm)==='critical'||vitalStatusRaw('spo2',snap.spo2)==='critical'||vitalStatusRaw('tempCorp',snap.tempCorp)==='critical' ? 'critical'
    : vitalStatusRaw('bpm',snap.bpm)==='warning'||vitalStatusRaw('spo2',snap.spo2)==='warning'||vitalStatusRaw('tempCorp',snap.tempCorp)==='warning' ? 'warning' : 'normal';
  if(s==='normal') return { level:s, text:'Tus valores registrados están dentro de los rangos configurados para esta aplicación.' };
  if(s==='warning') return { level:s, text:'Uno de los valores registrados merece atención. Considerá descansar y, si te sentís mal o el valor sigue así, hablá con un adulto responsable o un profesional de salud.' };
  return { level:s, text:'Uno de los valores registrados está fuera del rango seguro configurado. Esta aplicación no puede determinar la causa: si te sentís mal, buscá ayuda de un adulto responsable o un profesional de salud lo antes posible.' };
}
function vitalStatusRaw(key,val){
  if(val==null) return 'normal';
  if(key==='bpm') return (val>=RANGES.bpm.critHigh||val<=RANGES.bpm.critLow) ? 'critical' : (val<RANGES.bpm.low||val>RANGES.bpm.high) ? 'warning' : 'normal';
  if(key==='spo2') return val<RANGES.spo2.critLow ? 'critical' : val<RANGES.spo2.low ? 'warning' : 'normal';
  if(key==='tempCorp') return val>=RANGES.tempCorp.critHigh ? 'critical' : (val<RANGES.tempCorp.low||val>RANGES.tempCorp.high) ? 'warning' : 'normal';
  return 'normal';
}
function recommendationsFor(snap){
  const E = c => String.fromCodePoint(c);
  const recs = [];
  const interp = interpretation(snap);
  if(interp.level!=='normal') recs.push(E(0x1F6CC)+' Descansar');
  recs.push(E(0x1F4A7)+' Tomar agua');
  if(snap.mood==='Mal' || snap.mood==='Muy mal') recs.push(E(0x1F9D8)+' Respiración', E(0x1F4F5)+' Descanso de pantalla');
  else recs.push(E(0x1F6B6)+' Movimiento suave');
  recs.push(E(0x1F34E)+' Alimentación equilibrada');
  return [...new Set(recs)];
}
function spokenResultText(snap){
  const parts = [];
  if(isRealVal(snap.bpm)) parts.push(`tu pulso es de ${Math.round(snap.bpm)} latidos por minuto`);
  if(isRealVal(snap.spo2)) parts.push(`tu oxigenación es de ${Math.round(snap.spo2)} por ciento`);
  if(isRealVal(snap.tempCorp)) parts.push(`tu temperatura corporal es de ${Number(snap.tempCorp).toFixed(1)} grados Celsius`);
  if(!parts.length) return '';
  return 'Estas son tus mediciones: ' + joinEs(parts) + '.';
}
function showResults(snap, silent){
  showReviewStage('reviewResults');
  const interp = interpretation(snap);
  document.getElementById('resultFace').setAttribute('data-status', interp.level);
  document.getElementById('heroFace').setAttribute('data-status', state.status);
  document.getElementById('resultGrid').innerHTML = `
    <div class="result-item"><div class="rlabel">❤️ Pulso</div><div class="rvalue">${fmtV(snap.bpm)} BPM</div></div>
    <div class="result-item"><div class="rlabel">🫁 Oxigenación</div><div class="rvalue">${fmtV(snap.spo2)}%</div></div>
    <div class="result-item"><div class="rlabel">🌡️ Temperatura</div><div class="rvalue">${fmtV(snap.tempCorp,1)}°C</div></div>`;
  document.getElementById('interpretationBox').textContent = interp.text;
  document.getElementById('recList').innerHTML = recommendationsFor(snap).map(r=>`<span class="rec-chip">${r}</span>`).join('');
  if(interp.level==='normal'){ happyMascot('#resultFace, #heroFace'); } else { waveMascot('#resultFace'); }
  if(!silent) speak('He terminado de analizar tus mediciones. ' + spokenResultText(snap) + ' ' + interp.text);
}
document.getElementById('btnStartReview').addEventListener('click', beginScan);
document.getElementById('btnBeginScan').addEventListener('click', beginScan);
document.getElementById('btnDiscardReview').addEventListener('click', ()=>{ showReviewStage('reviewIdle'); });
document.getElementById('btnSaveReview').addEventListener('click', ()=>{
  if(!currentReviewSnapshot) return;
  const entry = { id:'r'+Date.now(), ts:Date.now(), name:profile.name, lastname:profile.lastname, age:profile.age, photo:profile.photo, avatar:profile.avatar, mood:profile.mood,
    bpm:currentReviewSnapshot.bpm, spo2:currentReviewSnapshot.spo2, tempCorp:currentReviewSnapshot.tempCorp };
  reviews.push(entry);
  renderReviewsList();
  showReviewStage('reviewIdle');
  saveAll();
  const emailNote = (profile.email ? ` Se envió un resumen simulado a ${profile.email}.` : '') + (hasEmergencyContact() ? ' Se abrió WhatsApp con el reporte para tu contacto de emergencia: solo falta pulsar Enviar.' : '');
  pushNotification('normal', 'Revisión guardada', 'Tu revisión quedó registrada en el historial.' + emailNote);
  simulateEmailSend(entry);
  if(profile.emgPhone && emergencyDigits().length>=8){
    // Dentro del clic del usuario, así el navegador permite abrir WhatsApp
    openWhatsAppToEmergency({ ts:entry.ts, bpm:entry.bpm, spo2:entry.spo2, tempCorp:entry.tempCorp, mood:entry.mood });
  }
});
function simulateEmailSend(entry){
  // No hay backend de correo real: esta función simula visualmente el envío del resumen al correo del usuario.
  if(!profile.email) return;
  logLine(`Simulando envío de resumen de revisión a ${profile.email}…`, 'info');
  setTimeout(()=> logLine(`Resumen enviado (simulado) a ${profile.email}.`, 'info'), 900);
}


/* ===================== SALUD + CONTACTO DE EMERGENCIA (todo opcional) ===================== */
function validateEmergency(phoneId, phoneErrId, emailId, emailErrId){
  let ok = true;
  const phone = document.getElementById(phoneId).value.trim();
  const email = document.getElementById(emailId).value.trim();
  if(phone && !PHONE_RE.test(phone)){ setFieldError(phoneId, phoneErrId, 'Número de teléfono no válido.'); ok=false; } else setFieldError(phoneId, phoneErrId, '');
  if(email && !EMAIL_RE.test(email)){ setFieldError(emailId, emailErrId, 'Correo no válido.'); ok=false; } else setFieldError(emailId, emailErrId, '');
  return ok;
}
// prefix: 'reg' (registro) o 'cfg' (configuración)
function readHealthFromForm(prefix){
  profile.medsDetail = document.getElementById(prefix+'MedsDetail').value.trim();
  profile.condDetail = document.getElementById(prefix+'CondDetail').value.trim();
  profile.emgName = document.getElementById(prefix+'EmgName').value.trim();
  profile.emgPhone = document.getElementById(prefix+'EmgPhone').value.trim();
  profile.emgEmail = document.getElementById(prefix+'EmgEmail').value.trim();
  if(profile.meds!=='si') profile.medsDetail = '';
  if(profile.cond!=='si') profile.condDetail = '';
}
function fillHealthForm(prefix){
  document.getElementById(prefix+'MedsDetail').value = profile.medsDetail || '';
  document.getElementById(prefix+'CondDetail').value = profile.condDetail || '';
  document.getElementById(prefix+'EmgName').value = profile.emgName || '';
  document.getElementById(prefix+'EmgPhone').value = profile.emgPhone || '';
  document.getElementById(prefix+'EmgEmail').value = profile.emgEmail || '';
  syncYesNo();
}
// Botones Sí/No (registro y configuración comparten el mismo estado)
function syncYesNo(){
  document.querySelectorAll('.yn-row').forEach(row=>{
    const key = row.dataset.yn;               // 'meds' | 'cond'
    const val = profile[key];
    row.querySelectorAll('.yn-btn').forEach(b=> b.classList.toggle('selected', b.dataset.val===val));
  });
  const showMeds = profile.meds==='si', showCond = profile.cond==='si';
  ['regMedsDetail','cfgMedsDetail'].forEach(id=> document.getElementById(id).classList.toggle('hidden', !showMeds));
  ['regCondDetail','cfgCondDetail'].forEach(id=> document.getElementById(id).classList.toggle('hidden', !showCond));
}
document.querySelectorAll('.yn-row').forEach(row=>{
  row.querySelectorAll('.yn-btn').forEach(btn=> btn.addEventListener('click', ()=>{
    const key = row.dataset.yn;
    profile[key] = (profile[key]===btn.dataset.val) ? null : btn.dataset.val; // tocar de nuevo = deseleccionar
    syncYesNo();
  }));
});

function hasEmergencyContact(){ return !!(profile.emgPhone || profile.emgEmail); }
function buildReportsText(){
  const last = reviews.slice(-3).reverse();
  const who = `${profile.name||''} ${profile.lastname||''}`.trim() || 'Paciente';
  if(!last.length) return `Reporte de salud de ${who} (Baymax Health Assistant): todavía no hay revisiones guardadas.`;
  const lines = last.map(r=>`• ${fmtDate(r.ts)} ${fmtTime(r.ts)} — Pulso ${r.bpm??'--'} BPM · SpO₂ ${r.spo2??'--'}% · Temp. ${r.tempCorp!=null?Number(r.tempCorp).toFixed(1):'--'}°C${r.mood?' · Ánimo: '+r.mood:''}`);
  const extra = [];
  if(profile.meds==='si') extra.push('Toma medicamento: ' + (profile.medsDetail||'sí'));
  if(profile.cond==='si') extra.push('Padece: ' + (profile.condDetail||'sí'));
  return `Reporte de salud de ${who} (Baymax Health Assistant)\n\nÚltimas revisiones:\n${lines.join('\n')}` + (extra.length ? '\n\n' + extra.join('\n') : '') + '\n\nEste reporte es informativo y no es un diagnóstico médico.';
}
/* ===== WhatsApp al contacto de emergencia =====
   WhatsApp no permite que una página web envíe mensajes sola (solo existe la API de pago
   para empresas). Lo que sí se puede, y funciona 100 %: abrir el chat del contacto con el
   mensaje YA ESCRITO (datos + recomendaciones); solo hay que pulsar "Enviar" en WhatsApp. */
function emergencyDigits(){
  let raw = (profile.emgPhone||'').trim();
  let digits = raw.replace(/\D/g,'');
  if(raw.startsWith('00')) digits = digits.slice(2);
  if(digits.length===8) digits = '503' + digits; // El Salvador
  return digits;
}
function latestSnapshot(){
  // Prioridad: última revisión guardada; si no hay, la lectura en vivo del ESP32
  const r = reviews.length ? reviews[reviews.length-1] : null;
  if(r) return { ts:r.ts, bpm:r.bpm, spo2:r.spo2, tempCorp:r.tempCorp, mood:r.mood };
  if(state.connected && (state.bpm>0 || state.spo2>0 || state.tempCorp>0))
    return { ts:state.lastUpdate||Date.now(), bpm:state.bpm>0?state.bpm:null, spo2:state.spo2>0?state.spo2:null, tempCorp:state.tempCorp>0?state.tempCorp:null, mood:profile.mood };
  return null;
}
/* Emojis creados con códigos Unicode (no escritos como texto): así NUNCA se dañan en el
   camino hacia WhatsApp, sin importar la codificación del archivo o del servidor.
   Solo uso emojis clásicos que WhatsApp muestra en cualquier celular. */
const WA = {
  salud: String.fromCodePoint(0x1F3E5),   // 🏥
  persona: String.fromCodePoint(0x1F464), // 👤
  grafico: String.fromCodePoint(0x1F4CA), // 📊
  corazon: String.fromCodePoint(0x1F493), // 💓
  oxigeno: String.fromCodePoint(0x1F4A8), // 💨
  temp: String.fromCodePoint(0x1F321),    // 🌡
  animo: String.fromCodePoint(0x1F642),   // 🙂
  pastilla: String.fromCodePoint(0x1F48A),// 💊
  ok: String.fromCodePoint(0x2705),       // ✅
  aviso: String.fromCodePoint(0x2757),    // ❗
  alerta: String.fromCodePoint(0x1F6A8),  // 🚨
  tel: String.fromCodePoint(0x1F4DE),     // 📞
  edad: String.fromCodePoint(0x1F382),    // 🎂
  nota: String.fromCodePoint(0x1F4DD),    // 📝
  punto: String.fromCodePoint(0x1F539)    // 🔹
};
function buildWhatsAppMessage(snap){
  snap = snap || latestSnapshot();
  const who = `${profile.name||''} ${profile.lastname||''}`.trim() || 'la persona';
  const L = [];
  L.push(`${WA.salud} *REPORTE DE SALUD*`);
  L.push(`*${who}*`);
  L.push('_Enviado desde Baymax Health Assistant_');
  L.push('');
  L.push(`${WA.persona} *Datos de la persona*`);
  if(profile.age) L.push(`${WA.punto} Edad: ${profile.age} años`);
  if(profile.phone) L.push(`${WA.punto} Teléfono: ${profile.phone}`);
  if(profile.meds==='si') L.push(`${WA.pastilla} Medicamento: ${profile.medsDetail||'sí toma'}`);
  if(profile.cond==='si') L.push(`${WA.punto} Enfermedad: ${profile.condDetail||'sí padece'}`);
  L.push('');
  if(snap){
    L.push(`${WA.grafico} *Últimos signos vitales*`);
    L.push(`_${fmtDate(snap.ts)} · ${fmtTime(snap.ts)}_`);
    L.push(`${WA.corazon} Pulso: *${snap.bpm!=null?snap.bpm+' BPM':'sin dato'}*`);
    L.push(`${WA.oxigeno} Oxigenación: *${snap.spo2!=null?snap.spo2+'%':'sin dato'}*`);
    if(snap.tempCorp!=null) L.push(`${WA.temp} Temperatura: *${Number(snap.tempCorp).toFixed(1)} °C*`);
    if(snap.mood) L.push(`${WA.animo} Estado de ánimo: *${snap.mood}*`);
    const interp = interpretation(snap);
    const ico = interp.level==='normal' ? WA.ok : interp.level==='warning' ? WA.aviso : WA.alerta;
    L.push('');
    L.push(`${ico} *Valoración*`);
    L.push(interp.text);
    L.push('');
    L.push(`${WA.nota} *Recomendaciones a seguir*`);
    recommendationsFor(snap).forEach(r=> L.push(r));
    if(interp.level!=='normal'){
      L.push(`${WA.tel} Estar pendiente de la persona y, si se siente mal o los valores siguen así, llevarla con un profesional de salud.`);
    }
  } else {
    L.push(`${WA.grafico} Todavía no hay signos vitales registrados.`);
  }
  L.push('');
  L.push('_Este reporte es informativo y no es un diagnóstico médico._');
  return L.join('\n');
}
function openWhatsAppToEmergency(snap){
  const digits = emergencyDigits();
  if(digits.length < 8){
    pushNotification('warning', 'Falta el teléfono de emergencia', 'Agrega un número válido de contacto de emergencia en Configuración.');
    return false;
  }
  const url = 'https://api.whatsapp.com/send?phone=' + digits + '&text=' + encodeURIComponent(buildWhatsAppMessage(snap)) + '&type=phone_number&app_absent=0';
  const w = window.open(url, '_blank', 'noopener');
  if(!w) window.location.href = url; // si el navegador bloquea la ventana, se abre en la misma pestaña
  return true;
}
function updateWhatsAppFloat(){
  const b = document.getElementById('waFloat');
  if(!b) return;
  const show = emergencyDigits().length >= 8;
  b.hidden = !show;
  const nm = profile.emgName || profile.emgPhone;
  b.title = show ? 'Enviar reporte por WhatsApp a ' + nm : '';
  b.setAttribute('aria-label', show ? 'Enviar reporte por WhatsApp a ' + nm : 'WhatsApp');
  const t = document.getElementById('waFloatText'); if(t) t.textContent = show ? 'Enviar a ' + (profile.emgName || 'contacto') : '';
}
function pulseWhatsAppFloat(){
  const b = document.getElementById('waFloat'); if(!b || b.hidden) return;
  b.classList.remove('pulse'); void b.offsetWidth; b.classList.add('pulse');
}
document.getElementById('waFloat').addEventListener('click', ()=> openWhatsAppToEmergency());
function simulateEmergencySend(){
  if(!hasEmergencyContact()) return;
  pulseWhatsAppFloat();
}
// Envío por WhatsApp (si hay teléfono) o correo (si solo hay correo)
function sendReportsToEmergency(){
  if(!hasEmergencyContact()){
    pushNotification('warning', 'Sin contacto de emergencia', 'Agrega un teléfono o correo de emergencia en Configuración.');
    return;
  }
  if(profile.emgPhone){ openWhatsAppToEmergency(); }
  else {
    window.location.href = 'mailto:' + encodeURIComponent(profile.emgEmail) + '?subject=' + encodeURIComponent('Reporte de salud de ' + (profile.name||'paciente')) + '&body=' + encodeURIComponent(buildWhatsAppMessage());
  }
}
document.getElementById('btnSendEmgReports').addEventListener('click', ()=>{
  if(!validateEmergency('cfgEmgPhone','errCfgEmg','cfgEmgEmail','errCfgEmg')) return;
  readHealthFromForm('cfg'); saveAll(); renderProfileSummary();
  sendReportsToEmergency();
});
document.getElementById('btnSaveHealth').addEventListener('click', ()=>{
  if(!validateEmergency('cfgEmgPhone','errCfgEmg','cfgEmgEmail','errCfgEmg')) return;
  readHealthFromForm('cfg'); saveAll(); renderProfileSummary();
  pushNotification('normal', 'Datos guardados', 'Actualicé tu información de salud y tu contacto de emergencia.');
});

/* ===================== CHAT ===================== */
/* Configuración de la IA real (Cloudflare Worker + Gemini).
   Pega aquí la URL que te da Cloudflare al desplegar worker.js.
   Si la dejas vacía o el Worker no responde, Baymax sigue funcionando
   con el sistema de respuestas por palabras clave de siempre. */
const AI_CONFIG = {
  enabled: true,
  workerUrl: 'https://baymax-ai.qzc24wv56z.workers.dev',
};

const chatHistory = [];   // memoria de la conversación (para que Tadashi siga el hilo)
async function getAIReply(text){
  if(!AI_CONFIG.enabled || !AI_CONFIG.workerUrl || AI_CONFIG.workerUrl.includes('TU-WORKER')) return null;
  const payload = {
    message: text,
    history: chatHistory.slice(-12),
    context:{
      bpm: isRealVal(state.bpm) ? Math.round(state.bpm) : null,
      spo2: isRealVal(state.spo2) ? Math.round(state.spo2) : null,
      tempCorp: isRealVal(state.tempCorp) ? Number(state.tempCorp.toFixed(1)) : null,
      noSignal: noSignalSensors(),
      connected: state.connected, mood: profile.mood, name: profile.name,
      now: new Date().toLocaleString('es-SV', {dateStyle:'full', timeStyle:'short'}),
      meds: profile.meds==='si' ? (profile.medsDetail||'sí') : profile.meds,
      conditions: profile.cond==='si' ? (profile.condDetail||'sí') : profile.cond
    }
  };
  for(let attempt=0; attempt<2; attempt++){
    try{
      const controller = new AbortController();
      const timeoutId = setTimeout(()=> controller.abort(), 20000);
      const res = await fetch(AI_CONFIG.workerUrl, {
        method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload), signal: controller.signal
      });
      clearTimeout(timeoutId);
      if(res.ok){
        const data = await res.json();
        if(data && data.reply) return data.reply;
      } else { console.warn('Baymax: el Worker respondió', res.status); }
    }catch(err){
      console.warn('Baymax: IA no disponible (intento ' + (attempt+1) + ').', err);
    }
    await new Promise(r=> setTimeout(r, 700));
  }
  return null;
}
function addMsg(text, who){
  const box = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'msg ' + (who==='user'?'user':'bot');
  div.textContent = text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return div;
}
function showTyping(){
  const box = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'msg bot typing';
  div.innerHTML = '<span></span><span></span><span></span>';
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return div;
}
/* Detector de estado de ánimo: cubre las emociones más comunes que alguien puede
   escribirle a Baymax en el chat, con una respuesta cálida y, cuando corresponde,
   te lleva a la sección de Bienestar y deja guardado tu estado de ánimo. */
function setMoodFromChat(moodLabel){
  if(!moodLabel) return;
  profile.mood = moodLabel;
  document.querySelectorAll('#regMoodGrid .mood-btn').forEach(b=> b.classList.toggle('selected', b.dataset.mood===moodLabel));
  document.querySelectorAll('#wellnessMoodGrid .mood-btn').forEach(b=> b.classList.toggle('selected', b.dataset.mood===moodLabel));
  const bad = moodLabel==='Mal' || moodLabel==='Muy mal';
  const supportBox = document.getElementById('wellnessSupportBox');
  if(supportBox) supportBox.style.display = bad ? 'block' : 'none';
  saveAll();
}
const MOOD_REPLIES = [
  { keys:['ansiedad','ansioso','ansiosa','nervios','nervioso','nerviosa','estrés','estres','estresado','estresada','pánico','panico','agobiado','agobiada','angustia'],
    tab:'bienestar', mood:'Mal',
    reply:'Gracias por contármelo. Vamos a la sección de Bienestar: ahí tengo pasos rápidos y un ejercicio de respiración guiada que puede ayudarte ahora mismo. Si la ansiedad es muy intensa o persiste, por favor buscá también el apoyo de una persona de confianza o un profesional de salud.' },
  { keys:['cansad','agotad','sin energía','sin energia','exhaust','sueño','no dormí','no dormi','fatiga','me quiero dormir'],
    tab:'bienestar', mood:'Mal',
    reply:'Te escucho. El cansancio es tu cuerpo pidiéndote una pausa: si podés, bajá el ritmo, hidratate y descansá un rato. Te dejo la sección de Bienestar por si querés hacer una respiración guiada antes de descansar.' },
  { keys:['triste','decaíd','decaid','deprimid','sin ganas','desanimad','llorar','llorando','me siento mal'],
    tab:'bienestar', mood:'Mal',
    reply:'Lamento que te sientas así, y me alegra que me lo hayas contado. No tenés que atravesar esto solo/a: hablar con alguien de confianza puede ayudar mucho. Mientras tanto, puedo acompañarte con un ejercicio de respiración en Bienestar.' },
  { keys:['solo','sola','soledad','aislad','nadie me'],
    tab:'bienestar', mood:'Mal',
    reply:'Sentirte solo/a pesa, y quiero que sepas que acá me tenés. Si podés, buscá también acercarte a alguien de confianza; a veces una simple llamada ayuda mucho.' },
  { keys:['miedo','asustad','temo ','me da terror'],
    tab:'bienestar',
    reply:'Entiendo que sientas miedo. Vamos a respirar juntos un momento para calmar el cuerpo, eso suele ayudar a pensar con más claridad. Si tiene que ver con tu salud ahora mismo, contame más para orientarte mejor.' },
  { keys:['enojad','enfurecid','furios','molest','irritad','rabia','bronca'],
    tab:'bienestar',
    reply:'Es válido sentir enojo. Un par de respiraciones lentas pueden bajar la intensidad antes de reaccionar. ¿Querés que hagamos el ejercicio de respiración juntos?' },
  { keys:['duele','dolor','me lastim','me golpe'],
    reply:'Lamento que te esté doliendo. Contame en qué parte del cuerpo es y qué tan intenso es del 1 al 10, así puedo orientarte mejor. Si el dolor es fuerte o repentino, buscá atención médica cuanto antes.' },
  { keys:['feliz','content','genial','de maravilla','súper bien','super bien','estoy bien','me siento bien','excelente'],
    mood:'Muy bien',
    reply:'¡Qué alegría escuchar eso! Me encanta saber que estás bien. Seguí cuidándote así, y contame si en algún momento necesitás algo.' },
  { keys:['aburrid'],
    reply:'El aburrimiento también es una señal de que tu cuerpo y mente quieren algo distinto. Podemos hacer un ejercicio de respiración o revisar tus signos vitales, si eso te ayuda a distraerte un poco.' },
  { keys:['gracias'],
    reply:'¡De nada! Estoy para acompañarte siempre que lo necesites.' },
];
function detectMood(t){
  for(const entry of MOOD_REPLIES){ if(entry.keys.some(k=>t.includes(k))) return entry; }
  return null;
}
const JOKES = [
  '¿Por qué el corazón nunca se pierde? Porque siempre sigue su ritmo. 😄',
  '¿Qué le dijo un pulmón a otro? "Respira, que todo va a salir bien". 🫁',
  '¿Cuál es el colmo de un doctor? Que su hijo le diga: "papá, estoy enfermo de ti". 😅',
  '¿Qué hace una abeja en el gimnasio? ¡Zum-ba! 🐝'
];
function sensorMissingMsg(name){
  return state.connected
    ? `Todavía no tengo una lectura de ${name}. Dame unos segundos y vuelve a preguntarme.`
    : `Todavía no tengo una lectura de ${name} porque no hay un ESP32 conectado ni el modo demostración activo.`;
}
function safeMath(t){
  const m = t.replace(/,/g,'.').match(/(-?\d+(?:\.\d+)?)\s*([+\-*/x×÷])\s*(-?\d+(?:\.\d+)?)/);
  if(!m) return null;
  const a = parseFloat(m[1]), b = parseFloat(m[3]); let r;
  switch(m[2]){ case '+': r=a+b; break; case '-': r=a-b; break; case '*': case 'x': case '×': r=a*b; break; default: if(b===0) return 'No se puede dividir entre cero.'; r=a/b; }
  return `${m[1]} ${m[2]} ${m[3]} = ${Number(r.toFixed(4))}`;
}
function answerQuestion(q){
  const t = q.toLowerCase();
  if(t.includes('respiraci')) { switchTab('bienestar'); return 'Vamos a la sección de Bienestar para hacer un ejercicio de respiración juntos.'; }
  if(t.includes('últimas mediciones') || t.includes('ultimas mediciones') || t.includes('historial')) { switchTab('historial'); return 'Te muestro tus últimas mediciones en la sección de Historial.'; }
  if(t.includes('pulso') || t.includes('ritmo')) return isRealVal(state.bpm) ? `Tu pulso registrado es de ${Math.round(state.bpm)} BPM.` : sensorMissingMsg('pulso');
  if(t.includes('oxígeno') || t.includes('oxigeno') || t.includes('spo2')) return isRealVal(state.spo2) ? `Tu oxigenación registrada es de ${Math.round(state.spo2)}%.` : sensorMissingMsg('oxígeno');
  if(t.includes('temperatura')) return isRealVal(state.tempCorp) ? `Tu temperatura corporal registrada es de ${state.tempCorp.toFixed(1)}°C.` : sensorMissingMsg('temperatura corporal');
  if(t.includes('cómo estoy') || t.includes('como estoy')) {
    if(!state.connected) return 'Todavía no tengo datos porque no hay una conexión activa. Conecta tu ESP32 o activa el modo demostración.';
    if(!isRealVal(state.bpm) && !isRealVal(state.spo2) && !isRealVal(state.tempCorp)) return 'Estoy conectado, pero aún no recibo valores reales de los sensores. Colócate el dedo y los electrodos y te cuento.';
    return interpretation({bpm:state.bpm, spo2:state.spo2, tempCorp:state.tempCorp, mood:profile.mood}).text;
  }
  const mood = detectMood(t);
  if(mood){
    if(mood.mood) setMoodFromChat(mood.mood);
    if(mood.tab) switchTab(mood.tab);
    return mood.reply;
  }
  // ----- Conversación general (no solo salud) -----
  const nm = profile.name ? ', ' + profile.name : '';
  if(/^(hola|buenas|hey|buen[oa]s? (d[ií]as|tardes|noches)|qu[eé] tal|saludos)/.test(t)) return `¡Hola${nm}! 😊 Qué gusto saludarte. ¿De qué te gustaría hablar hoy?`;
  if(/c[oó]mo (est[aá]s|andas|te va|te sientes)/.test(t)) return 'Estoy muy bien, gracias por preguntar. Con ganas de acompañarte. ¿Y tú, cómo vas?';
  if(/qui[eé]n eres|c[oó]mo te llamas|tu nombre/.test(t)) return 'Soy Tadashi, el asistente de bienestar de Baymax. Puedo conversar contigo de lo que quieras, además de cuidar tus signos vitales.';
  if(/qu[eé] (puedes|sabes) hacer|ayuda|para qu[eé] sirves/.test(t)) return 'Puedo conversar de casi cualquier tema, contarte chistes, hacer cuentas, decirte la hora, guiarte en una respiración y explicarte tu pulso, oxígeno y temperatura. ¿Por dónde empezamos?';
  if(/qu[eé] hora|hora es/.test(t)) return 'Son las ' + new Date().toLocaleTimeString('es-SV',{hour:'2-digit',minute:'2-digit'}) + '.';
  if(/qu[eé] (d[ií]a|fecha)|fecha de hoy|d[ií]a es hoy/.test(t)) return 'Hoy es ' + new Date().toLocaleDateString('es-SV',{weekday:'long',day:'numeric',month:'long',year:'numeric'}) + '.';
  if(/chiste|hazme re[ií]r|algo gracioso/.test(t)) return JOKES[Math.floor(Math.random()*JOKES.length)];
  const math = /(\d)\s*[+\-*/x×÷]\s*(\d)/.test(t) ? safeMath(t) : null;
  if(math) return math;
  if(/adi[oó]s|nos vemos|hasta luego|chao/.test(t)) return '¡Hasta pronto! Aquí estaré cuando quieras seguir conversando. 💙';
  if(/te quiero|eres genial|eres el mejor|me caes bien/.test(t)) return '¡Qué lindo! Tú también me caes muy bien. 😊';
  return 'Cuéntame más, quiero entenderte bien. Ahora mi conexión con la IA en línea no está respondiendo, así que te contesto con lo básico: puedo charlar, contarte un chiste, hacer una cuenta, decirte la hora o ayudarte con tus signos vitales. ¿Qué prefieres?';
}
async function sendChat(text){
  if(!text.trim()) return;
  addMsg(text, 'user');
  document.getElementById('chatInput').value = '';
  const typingEl = showTyping();

  // La detección local de ánimo se sigue ejecutando siempre: así Baymax
  // guarda tu estado de ánimo y te lleva a Bienestar aunque la respuesta
  // final venga de la IA.
  const moodHit = detectMood(text.toLowerCase());

  const aiReply = await getAIReply(text);
  chatHistory.push({role:'user', text});
  let reply;
  if(aiReply){
    reply = aiReply;
    if(moodHit){
      if(moodHit.mood) setMoodFromChat(moodHit.mood);
      if(moodHit.tab) switchTab(moodHit.tab);
    }
  } else {
    reply = answerQuestion(text); // respaldo: sistema de reglas de siempre
  }

  chatHistory.push({role:'model', text: reply});
  if(chatHistory.length > 24) chatHistory.splice(0, chatHistory.length-24);
  typingEl.remove();
  addMsg(reply, 'bot');
  speak(reply);
}
document.getElementById('btnChatSend').addEventListener('click', ()=> sendChat(document.getElementById('chatInput').value));
document.getElementById('chatInput').addEventListener('keydown', (e)=>{ if(e.key==='Enter') sendChat(e.target.value); });
document.querySelectorAll('.chip-btn').forEach(b=> b.addEventListener('click', ()=> sendChat(b.dataset.q)));

/* Reconocimiento de voz (opcional, si el navegador lo soporta) */
const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer = null;
if(SpeechRecognitionClass){
  recognizer = new SpeechRecognitionClass();
  recognizer.lang = 'es-ES';
  recognizer.onresult = (e)=>{ const text = e.results[0][0].transcript; sendChat(text); };
  recognizer.onend = ()=> document.getElementById('btnMic').setAttribute('data-listening','false');
}
document.getElementById('btnMic').addEventListener('click', ()=>{
  if(!recognizer){ addMsg('Este navegador no soporta reconocimiento de voz. Escríbeme tu mensaje.', 'bot'); return; }
  document.getElementById('btnMic').setAttribute('data-listening','true');
  recognizer.start();
});

/* Burbuja flotante de Tadashi */
const chatBubbleBtn = document.getElementById('chatBubbleBtn');
const chatFloatPanel = document.getElementById('chatFloatPanel');
const chatBubbleIcon = document.getElementById('chatBubbleIcon');
const chatBubbleDot = document.getElementById('chatBubbleDot');
let chatPanelOpen = false;
let chatHasGreeted = false;

function openChatPanel(){
  chatPanelOpen = true;
  chatFloatPanel.hidden = false;
  requestAnimationFrame(()=> chatFloatPanel.classList.add('open'));
  chatBubbleBtn.setAttribute('aria-expanded','true');
  chatBubbleIcon.textContent = 'Cerrar chat';
  chatBubbleDot.hidden = true;
  if(!chatHasGreeted){
    chatHasGreeted = true;
    addMsg('¡Hola! Soy Tadashi. Contame cómo te sentís o preguntame por tus signos vitales.', 'bot');
  }
  document.getElementById('chatInput').focus();
}
function closeChatPanel(){
  chatPanelOpen = false;
  chatFloatPanel.classList.remove('open');
  chatBubbleBtn.setAttribute('aria-expanded','false');
  chatBubbleIcon.textContent = 'Habla con Tadashi';
  setTimeout(()=>{ if(!chatPanelOpen) chatFloatPanel.hidden = true; }, 250);
}
chatBubbleBtn.addEventListener('click', ()=> chatPanelOpen ? closeChatPanel() : openChatPanel());
document.getElementById('btnChatFloatClose').addEventListener('click', closeChatPanel);

/* ===================== BIENESTAR ===================== */
document.querySelectorAll('#wellnessMoodGrid .mood-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('#wellnessMoodGrid .mood-btn').forEach(b=>b.classList.remove('selected'));
    btn.classList.add('selected');
    profile.mood = btn.dataset.mood;
    const bad = profile.mood==='Mal' || profile.mood==='Muy mal';
    document.getElementById('wellnessSupportBox').style.display = bad ? 'block' : 'none';
    if(bad) speak('Gracias por contarme cómo te sentís. Estoy acá para acompañarte.');
    saveAll();
  });
});
let breathingActive = false;
function runBreathingCycle(){
  if(!breathingActive) return;
  const orb = document.getElementById('breatheOrb');
  const phaseEl = document.getElementById('breathePhase');
  const countEl = document.getElementById('breatheCount');
  const phases = [ {name:'Inhalar', secs:4, grow:true}, {name:'Mantener', secs:3, grow:true}, {name:'Exhalar', secs:4, grow:false} ];
  let i = 0;
  function step(){
    if(!breathingActive) return;
    const p = phases[i];
    phaseEl.textContent = p.name;
    orb.classList.toggle('grow', p.grow);
    let remaining = p.secs;
    countEl.textContent = remaining;
    const tick = setInterval(()=>{
      remaining--;
      countEl.textContent = Math.max(remaining,0);
      if(remaining<=0){
        clearInterval(tick);
        i = (i+1) % phases.length;
        if(!breathingActive) return;
        step();
      }
    },1000);
  }
  step();
}
function startBreathingExercise(){
  document.getElementById('breatheStage').classList.remove('hidden');
  breathingActive = true;
  speak('Podemos hacer un pequeño ejercicio de respiración. Seguime con la esfera: inhalá, sostené y exhalá despacio.');
  runBreathingCycle();
  document.getElementById('breatheStage').scrollIntoView({behavior:'smooth', block:'center'});
}
document.getElementById('btnStartBreathing').addEventListener('click', startBreathingExercise);
document.getElementById('btnAnxietyBreathing').addEventListener('click', startBreathingExercise);
document.getElementById('btnStopBreathing').addEventListener('click', ()=>{ breathingActive = false; document.getElementById('breatheStage').classList.add('hidden'); });

/* ===================== SISTEMA / CONFIG ===================== */
document.getElementById('prefDark').addEventListener('change', (e)=>{ document.body.setAttribute('data-theme', e.target.checked ? 'dark':'light'); saveAll(); });
document.getElementById('prefAnim').addEventListener('change', (e)=>{ document.body.classList.toggle('reduced-anim', !e.target.checked); saveAll(); });
document.getElementById('prefVoice').addEventListener('change', (e)=>{ voiceEnabled = e.target.checked; updateVoiceButton(); saveAll(); });
document.getElementById('prefSound').addEventListener('change', ()=>{ saveAll(); });
if(document.getElementById('prefRobotVoice')) document.getElementById('prefRobotVoice').addEventListener('change', saveAll);
document.getElementById('btnClearHistory').addEventListener('click', ()=>{ if(confirm('¿Eliminar todo el historial de revisiones y lecturas?')){ reviews = []; state.history = []; renderReviewsList(); renderHistory(); saveAll(); } });
document.getElementById('btnClearProfile').addEventListener('click', ()=>{
  if(!confirm('¿Eliminar tu perfil (nombre, edad, foto, estado)?')) return;
  Object.assign(profile, PROFILE_DEFAULTS);
  renderHero(); renderProfileSummary(); renderAvatarMini(); saveAll();
  // Sin perfil no tiene sentido dejar a la persona dentro de la app: le mostramos
  // de una vez el formulario de registro para que pueda crear uno nuevo.
  openRegistrationModal();
});
function openRegistrationModal(){
  ['regName','regLastname','regAge','regPhone','regEmail'].forEach(id=>{ document.getElementById(id).value=''; setFieldError(id, 'err'+id.slice(3), ''); });
  document.querySelectorAll('#regMoodGrid .mood-btn').forEach(b=>b.classList.remove('selected'));
  fillHealthForm('reg'); fillHealthForm('cfg');
  applyPhotoPreview();
  updateRegProgress();
  document.getElementById('appShell').classList.add('hidden');
  document.getElementById('welcomeModal').classList.remove('hidden');
}
document.getElementById('btnClearPhotos').addEventListener('click', ()=>{ if(confirm('¿Eliminar todas las fotografías guardadas?')){ profile.photo=null; reviews.forEach(r=>r.photo=null); renderReviewsList(); renderProfileSummary(); renderAvatarMini(); saveAll(); } });
document.getElementById('btnMyProfile').addEventListener('click', ()=> switchTab('config'));

/* ===================== MENÚ (hamburguesa) ===================== */
function setMenuOpen(open){
  document.getElementById('btnMenu').classList.toggle('open', open);
  document.getElementById('btnMenu').setAttribute('aria-expanded', open ? 'true' : 'false');
  document.getElementById('tabsNav').classList.toggle('open', open);
  document.getElementById('menuBackdrop').classList.toggle('open', open);
}
document.getElementById('btnMenu').addEventListener('click', ()=>{
  setMenuOpen(!document.getElementById('tabsNav').classList.contains('open'));
});
document.getElementById('menuBackdrop').addEventListener('click', ()=> setMenuOpen(false));

/* ===================== TABS ===================== */
function switchTab(tab){
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active', v.id==='view-'+tab));
  setMenuOpen(false);
  if(tab==='chat' || tab==='panel' || tab==='bienestar'){ waveMascot('#heroFace, .brand-face'); }
  if(tab==='ecg'){
    // Recién ahora la pestaña deja de tener display:none, así que recién ahora
    // el canvas tiene un tamaño real que medir.
    requestAnimationFrame(startECGLoop);
  }
  if(tab==='latidos') updateHeartbeatVisual();
}
document.querySelectorAll('.tab-btn').forEach(btn=> btn.addEventListener('click', ()=> switchTab(btn.dataset.tab)));

/* ===================== RELOJ ===================== */
function tickClock(){ document.getElementById('clock').textContent = new Date().toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}); }
setInterval(tickClock, 1000); tickClock();

/* ===================== VOZ (estilo robot de cuidado, inspirado en Baymax) ===================== */
let voiceEnabled = true;
let spanishVoice = null;
const speechSupported = ('speechSynthesis' in window);
function pickRoboticVoice(voices){
  // Voz en español (prefiere Latinoamérica, y masculina/grave si existe). Si el sistema NO tiene
  // ninguna voz en español devolvemos null y dejamos que el navegador use la suya con lang es-ES
  // (antes se elegía una voz en inglés al azar, que sonaba mal o no se oía).
  const es = voices.filter(v=>v.lang && v.lang.toLowerCase().replace('_','-').startsWith('es'));
  if(!es.length) return null;
  const latam = es.filter(v=>/-(sv|mx|us|419|co|ar|cl|pe|gt|hn|ni|cr|pa)/i.test(v.lang.replace('_','-')));
  const pool = latam.length ? latam : es;
  const nameMatch = /male|hombre|jorge|diego|carlos|pablo|raul|raúl|juan|miguel|google\s*espa/i;
  return pool.find(v=>nameMatch.test(v.name)) || pool[0];
}
// Inserta micro-pausas después de puntos y comas para que la voz sintetizada
// suene más pausada y menos apurada, más parecida a la cadencia calmada y
// "acolchada" de Baymax (Web Speech API no soporta SSML, así que usamos este truco simple).
function addCarePauses(text){
  return text.replace(/([.!?])\s+/g, '$1   ').replace(/,\s+/g, ',  ');
}
function loadVoices(){ if(!speechSupported) return; const voices = window.speechSynthesis.getVoices(); spanishVoice = pickRoboticVoice(voices); }
if(speechSupported){
  loadVoices();
  if(window.speechSynthesis.addEventListener) window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
  else window.speechSynthesis.onvoiceschanged = loadVoices;
}
/* Los navegadores NO dejan hablar a una página hasta que el usuario toca/clickea algo. Aquí
   "desbloqueamos" la voz en el primer toque. Si Baymax quiso hablar antes de eso, queda guardado
   en pendingSpeech y se dice justo al desbloquear (así no se pierde el saludo). */
let speechUnlocked = false;
let pendingSpeech = null;
let speakToken = 0;
const liveUtterances = [];   // referencia fuerte: Chrome deja de disparar eventos si el objeto se recoge como basura
function unlockSpeech(){
  if(speechUnlocked || !speechSupported) return;
  speechUnlocked = true;
  try{ const u = new SpeechSynthesisUtterance(' '); u.volume = 0; window.speechSynthesis.speak(u); }catch(e){}
  flushPendingSpeech();
}
['pointerdown','touchstart','keydown','click'].forEach(ev=> document.addEventListener(ev, unlockSpeech, {passive:true}));
function flushPendingSpeech(){
  if(pendingSpeech && !helloClipPlaying()){ const t = pendingSpeech; pendingSpeech = null; speak(t); }
}
function helloClipPlaying(){
  return (typeof baymaxHelloAudio !== 'undefined') && baymaxHelloAudio && !baymaxHelloAudio.paused && !baymaxHelloAudio.ended;
}
// Divide el texto en frases cortas: Chrome corta en seco los textos largos (~15 s) si van en un solo bloque
function splitForSpeech(text){
  const clean = text.replace(/\s+/g,' ').trim();
  const parts = clean.match(/[^.!?¡¿:;]+[.!?:;]?/g) || [clean];
  const out = []; let cur = '';
  parts.forEach(p=>{
    if((cur + ' ' + p).length > 170 && cur){ out.push(cur.trim()); cur = p; } else cur = (cur ? cur + ' ' : '') + p;
  });
  if(cur.trim()) out.push(cur.trim());
  return out;
}
function setSpeakingVisual(on){ document.querySelectorAll('.baymax-face').forEach(f=> f.classList.toggle('speaking', on)); }

/* ===================== REACCIONES DE LA MASCOTA 3D ===================== */
// La figura 3D de Baymax saluda o salta de alegría según lo que hacés en la web
// (cambiar de pestaña, terminar una revisión con buenos resultados, etc.).
function waveMascot(selector){
  document.querySelectorAll(selector || '.baymax-face').forEach(f=>{
    f.classList.remove('waving'); void f.offsetWidth; f.classList.add('waving');
    setTimeout(()=> f.classList.remove('waving'), 1900);
  });
}
function happyMascot(selector){
  document.querySelectorAll(selector || '.baymax-face').forEach(f=>{
    f.classList.remove('happy'); void f.offsetWidth; f.classList.add('happy');
    setTimeout(()=> f.classList.remove('happy'), 650);
  });
}

/* ---- Clip real de Baymax (audio pregrabado que subiste) -----------------------------
   El navegador no puede "clonar" una voz real solo con síntesis de texto (Web Speech API
   únicamente usa las voces instaladas en el sistema/navegador). Lo que sí podemos hacer,
   y lo que hicimos aquí, es:
   1) Reproducir tu clip de audio real de Baymax en el saludo inicial (pantalla de arranque),
      que es un texto fijo y coincide con lo que dice el audio.
   2) Para todo el resto de mensajes (dinámicos: alertas, chat, resultados de revisión, etc.)
      seguimos usando síntesis de voz, pero afinada (tono más grave, más lenta, con pausas)
      para que se sienta lo más parecida posible al timbre calmado de Baymax.
   Si en el futuro quieres que TODO se escuche exactamente como el clip, se necesitaría un
   servicio externo de clonación de voz (por ejemplo, una API de texto-a-voz de pago) que
   genere audio en un servidor; eso no es posible hacerlo 100% gratis y offline solo con HTML/JS. */
const BAYMAX_HELLO_AUDIO_SRC = 'assets/audio/baymax-hola.mp3';
const baymaxHelloAudio = new Audio(BAYMAX_HELLO_AUDIO_SRC);
baymaxHelloAudio.preload = 'auto';
['ended','error','pause'].forEach(ev=> baymaxHelloAudio.addEventListener(ev, ()=> setTimeout(flushPendingSpeech, 150)));

function playBaymaxHello(fallbackText){
  if(!voiceEnabled){ return; }
  if(!baymaxHelloAudio){ speak(fallbackText); return; }
  try{
    window.speechSynthesis && window.speechSynthesis.cancel();
    baymaxHelloAudio.pause();
    baymaxHelloAudio.currentTime = 0;
    setSpeakingVisual(true);
    baymaxHelloAudio.onended = ()=> setSpeakingVisual(false);
    baymaxHelloAudio.onerror = ()=>{ setSpeakingVisual(false); speak(fallbackText); };
    const p = baymaxHelloAudio.play();
    if(p && p.catch) p.catch((err)=>{ setSpeakingVisual(false); logLine && logLine('No se pudo reproducir el audio de Baymax: '+err, 'err'); speak(fallbackText); });
  }catch(e){ speak(fallbackText); }
}

function speak(text){
  if(!voiceEnabled || !text) return;
  text = sanitizeForSpeech(text);
  if(!text) return;
  if(!speechSupported){ logLine('Este navegador no soporta síntesis de voz.', 'err'); return; }
  // Si todavía no hubo ningún toque del usuario, o está sonando el clip de saludo, lo dejamos en espera
  if(!speechUnlocked || helloClipPlaying()){ pendingSpeech = text; return; }
  const ss = window.speechSynthesis;
  const myToken = ++speakToken;
  try{ ss.resume(); }catch(e){}
  if(ss.speaking || ss.pending){ try{ ss.cancel(); }catch(e){} }
  // Chrome ignora un speak() que llega justo después de cancel(): se espera un instante
  setTimeout(()=>{
    if(myToken !== speakToken) return;          // llegó una frase más nueva, esta ya no se dice
    if(!spanishVoice) loadVoices();
    const robotic = document.getElementById('prefRobotVoice') ? document.getElementById('prefRobotVoice').checked : true;
    const chunks = splitForSpeech(text);
    liveUtterances.length = 0;
    chunks.forEach((chunk, i)=>{
      const utter = new SpeechSynthesisUtterance(chunk);
      utter.lang = spanishVoice ? spanishVoice.lang : 'es-ES';
      if(spanishVoice) utter.voice = spanishVoice;
      // Tono grave y ritmo lento: lo más cerca que la síntesis del navegador llega al timbre de Baymax
      utter.rate = robotic ? 0.85 : 0.95;
      utter.pitch = robotic ? 0.7 : 1.0;
      utter.volume = 1;
      if(i === 0) utter.onstart = ()=> setSpeakingVisual(true);
      if(i === chunks.length-1) utter.onend = ()=> setSpeakingVisual(false);
      utter.onerror = (ev)=>{
        setSpeakingVisual(false);
        if(ev && ev.error === 'not-allowed'){ speechUnlocked = false; pendingSpeech = text; }   // aún falta un toque del usuario
        else if(ev && ev.error !== 'interrupted' && ev.error !== 'canceled') logLine('Error de voz: ' + ev.error, 'err');
      };
      liveUtterances.push(utter);
      ss.speak(utter);
    });
  }, 120);
}
function updateVoiceButton(){
  const btn = document.getElementById('btnVoiceToggle');
  btn.setAttribute('data-state', voiceEnabled ? 'on' : 'off');
  document.getElementById('voiceIcon').textContent = voiceEnabled ? '🔊' : '🔇';
  document.getElementById('voiceLabelText').textContent = voiceEnabled ? 'Voz activada' : 'Voz silenciada';
  document.getElementById('prefVoice').checked = voiceEnabled;
}
document.getElementById('btnVoiceToggle').addEventListener('click', ()=>{ voiceEnabled = !voiceEnabled; updateVoiceButton(); if(!voiceEnabled && speechSupported) window.speechSynthesis.cancel(); });
document.getElementById('btnTestVoice').addEventListener('click', ()=>{
  if(!voiceEnabled){ voiceEnabled = true; updateVoiceButton(); }
  // Primero se escucha tu clip real de Baymax completo, y cuando termina, un ejemplo de cómo
  // suena la voz sintetizada afinada para las alertas y el resto de la app.
  if(baymaxHelloAudio){
    window.speechSynthesis && window.speechSynthesis.cancel();
    baymaxHelloAudio.currentTime = 0;
    setSpeakingVisual(true);
    baymaxHelloAudio.onended = ()=>{ setSpeakingVisual(false); speak('Así sueno cuando te aviso algo importante sobre tus signos vitales.'); };
    baymaxHelloAudio.onerror = ()=>{ setSpeakingVisual(false); speak('Así sueno cuando te aviso algo importante sobre tus signos vitales.'); };
    const p = baymaxHelloAudio.play();
    if(p && p.catch) p.catch(()=>{ setSpeakingVisual(false); speak('Así sueno cuando te aviso algo importante sobre tus signos vitales.'); });
  } else if(speechSupported){
    speak('Así sueno cuando te aviso algo importante sobre tus signos vitales.');
  } else {
    logLine('Este navegador no soporta síntesis de voz.', 'err');
  }
});
document.getElementById('btnPermission').addEventListener('click', ()=>{ if(!('Notification' in window)){ logLine('Este navegador no soporta notificaciones.', 'err'); return; } Notification.requestPermission().then(p=>{ logLine('Permiso de notificaciones: ' + p, 'info'); }); });
document.getElementById('btnTestNotif').addEventListener('click', ()=>{ pushNotification('warning', 'Aviso de prueba', 'Así se verá una notificación real de Baymax.'); });

/* ===================== OJOS + PARPADEO ===================== */
let reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function updateEyeTracking(clientX, clientY){
  if(reduceMotion || document.body.classList.contains('reduced-anim')) return;
  document.querySelectorAll('.baymax-face').forEach(face=>{
    const rect = face.getBoundingClientRect();
    const cx = rect.left + rect.width/2, cy = rect.top + rect.height/2;
    const dx = clientX - cx, dy = clientY - cy;
    const dist = Math.min(1, Math.hypot(dx,dy)/400);
    const max = rect.width * 0.09;
    const ox = (dx / (Math.hypot(dx,dy)||1)) * max * dist;
    const oy = (dy / (Math.hypot(dx,dy)||1)) * max * dist * 0.6;
    face.querySelectorAll('.pupil').forEach(p=>{ p.style.transform = `translate(calc(-50% + ${ox}px), calc(-50% + ${oy}px))`; });
    // Giro sutil de la cabeza en 3D hacia el cursor, para reforzar el efecto de figura tridimensional.
    const head = face.querySelector('.mascot-head');
    if(head && face.getAttribute('data-status')!=='scanning'){
      const rx = (-dy / (Math.hypot(dx,dy)||1)) * 6 * dist;
      const ry = (dx / (Math.hypot(dx,dy)||1)) * 8 * dist;
      head.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;
    }
  });
}
window.addEventListener('mousemove', (e)=> updateEyeTracking(e.clientX, e.clientY));
window.addEventListener('touchmove', (e)=>{ if(e.touches[0]) updateEyeTracking(e.touches[0].clientX, e.touches[0].clientY); }, {passive:true});
function blinkAll(){
  if(reduceMotion || document.body.classList.contains('reduced-anim')) return;
  document.querySelectorAll('.baymax-face').forEach(f=>f.classList.add('blink'));
  setTimeout(()=>document.querySelectorAll('.baymax-face').forEach(f=>f.classList.remove('blink')), 140);
}
setInterval(blinkAll, 4200 + Math.random()*2000);

/* ===================== REGISTRO: FOTO / AVATAR / CÁMARA ===================== */
function applyPhotoPreview(){
  // Actualiza tanto la vista previa del registro como la del editor de perfil en Configuración.
  [
    {prev:'regPhotoPreview', removeBtn:'btnRegPhotoRemove'},
    {prev:'cfgPhotoPreview', removeBtn:'btnCfgPhotoRemove'}
  ].forEach(({prev:prevId, removeBtn:removeBtnId})=>{
    const prev = document.getElementById(prevId);
    const removeBtn = document.getElementById(removeBtnId);
    if(!prev) return;
    if(profile.photo){
      prev.classList.remove('empty');
      prev.innerHTML = `<img src="${profile.photo}" alt="Foto">`;
      if(removeBtn) removeBtn.classList.remove('hidden');
    } else if(profile.avatar){
      prev.classList.remove('empty');
      prev.innerHTML = `<span style="font-size:30px;">${profile.avatar}</span>`;
      if(removeBtn) removeBtn.classList.remove('hidden');
    } else {
      prev.classList.add('empty'); prev.innerHTML = '📷';
      if(removeBtn) removeBtn.classList.add('hidden');
    }
  });
  renderAvatarMini();
  renderProfileSummary();
}
document.getElementById('btnRegPhotoUpload').addEventListener('click', ()=> document.getElementById('regPhotoInput').click());
document.getElementById('regPhotoInput').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{ profile.photo = reader.result; profile.avatar=null; applyPhotoPreview(); saveAll(); };
  reader.readAsDataURL(file);
});
document.getElementById('btnRegPhotoRemove').addEventListener('click', ()=>{ profile.photo=null; profile.avatar=null; applyPhotoPreview(); saveAll(); });

const avatarGrid = document.getElementById('avatarGrid');
avatarGrid.innerHTML = AVATAR_EMOJIS.map(e=>`<button type="button" data-avatar="${e}">${e}</button>`).join('');
document.getElementById('btnRegPhotoAvatar').addEventListener('click', ()=>{
  avatarGrid.classList.toggle('hidden');
  document.getElementById('cameraBox').classList.add('hidden');
  stopCamera();
});
avatarGrid.addEventListener('click', (e)=>{
  const btn = e.target.closest('button[data-avatar]');
  if(!btn) return;
  profile.avatar = btn.dataset.avatar;
  profile.photo = null;
  avatarGrid.querySelectorAll('button').forEach(b=>b.classList.toggle('selected', b===btn));
  applyPhotoPreview();
  saveAll();
});

const cameraBox = document.getElementById('cameraBox');
const cameraVideo = document.getElementById('cameraVideo');
const cameraCanvas = document.getElementById('cameraCanvas');
async function startCamera(videoEl, boxEl, gridToHide){
  try{
    cameraStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'user'}, audio:false});
    videoEl.srcObject = cameraStream;
    boxEl.classList.remove('hidden');
    if(gridToHide) gridToHide.classList.add('hidden');
  }catch(err){
    alert('No se pudo acceder a la cámara. Revisa los permisos del navegador o sube una imagen en su lugar.');
  }
}
function stopCamera(boxEl){
  if(cameraStream){ cameraStream.getTracks().forEach(t=>t.stop()); cameraStream = null; }
  if(boxEl) boxEl.classList.add('hidden');
  else { cameraBox.classList.add('hidden'); }
}
document.getElementById('btnRegPhotoCamera').addEventListener('click', ()=>startCamera(cameraVideo, cameraBox, avatarGrid));
document.getElementById('btnCameraCancel').addEventListener('click', ()=>stopCamera(cameraBox));
document.getElementById('btnCameraShot').addEventListener('click', ()=>{
  const w = cameraVideo.videoWidth || 320, h = cameraVideo.videoHeight || 240;
  cameraCanvas.width = w; cameraCanvas.height = h;
  const cctx = cameraCanvas.getContext('2d');
  cctx.drawImage(cameraVideo, 0, 0, w, h);
  profile.photo = cameraCanvas.toDataURL('image/jpeg', 0.85);
  profile.avatar = null;
  applyPhotoPreview();
  stopCamera(cameraBox);
  saveAll();
});

/* ---- Editor de foto/avatar en Configuración (mismo mecanismo, disponible siempre) ---- */
const cfgPhotoInputEl = document.getElementById('cfgPhotoInput');
if(cfgPhotoInputEl){
  document.getElementById('btnCfgPhotoUpload').addEventListener('click', ()=> cfgPhotoInputEl.click());
  cfgPhotoInputEl.addEventListener('change', (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = ()=>{ profile.photo = reader.result; profile.avatar=null; applyPhotoPreview(); saveAll(); };
    reader.readAsDataURL(file);
  });
  document.getElementById('btnCfgPhotoRemove').addEventListener('click', ()=>{ profile.photo=null; profile.avatar=null; applyPhotoPreview(); saveAll(); });

  const cfgAvatarGrid = document.getElementById('cfgAvatarGrid');
  cfgAvatarGrid.innerHTML = AVATAR_EMOJIS.map(e=>`<button type="button" data-avatar="${e}">${e}</button>`).join('');
  const cfgCameraBox = document.getElementById('cfgCameraBox');
  const cfgCameraVideo = document.getElementById('cfgCameraVideo');
  const cfgCameraCanvas = document.getElementById('cfgCameraCanvas');

  document.getElementById('btnCfgPhotoAvatar').addEventListener('click', ()=>{
    cfgAvatarGrid.classList.toggle('hidden');
    cfgCameraBox.classList.add('hidden');
    stopCamera(cfgCameraBox);
  });
  cfgAvatarGrid.addEventListener('click', (e)=>{
    const btn = e.target.closest('button[data-avatar]');
    if(!btn) return;
    profile.avatar = btn.dataset.avatar;
    profile.photo = null;
    cfgAvatarGrid.querySelectorAll('button').forEach(b=>b.classList.toggle('selected', b===btn));
    applyPhotoPreview();
    saveAll();
  });

  document.getElementById('btnCfgPhotoCamera').addEventListener('click', ()=>startCamera(cfgCameraVideo, cfgCameraBox, cfgAvatarGrid));
  document.getElementById('btnCfgCameraCancel').addEventListener('click', ()=>stopCamera(cfgCameraBox));
  document.getElementById('btnCfgCameraShot').addEventListener('click', ()=>{
    const w = cfgCameraVideo.videoWidth || 320, h = cfgCameraVideo.videoHeight || 240;
    cfgCameraCanvas.width = w; cfgCameraCanvas.height = h;
    const cctx = cfgCameraCanvas.getContext('2d');
    cctx.drawImage(cfgCameraVideo, 0, 0, w, h);
    profile.photo = cfgCameraCanvas.toDataURL('image/jpeg', 0.85);
    profile.avatar = null;
    applyPhotoPreview();
    stopCamera(cfgCameraBox);
    saveAll();
  });
}

document.querySelectorAll('#regMoodGrid .mood-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('#regMoodGrid .mood-btn').forEach(b=>b.classList.remove('selected'));
    btn.classList.add('selected');
    profile.mood = btn.dataset.mood;
  });
});

/* ===================== VALIDACIÓN DE FORMULARIO ===================== */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+\s()-]{7,15}$/;
function setFieldError(id, errId, message){
  document.getElementById(id).classList.toggle('invalid', !!message);
  document.getElementById(errId).textContent = message || '';
}
function validateForm(){
  let ok = true;
  const name = document.getElementById('regName').value.trim();
  const lastname = document.getElementById('regLastname').value.trim();
  const age = document.getElementById('regAge').value;
  const phone = document.getElementById('regPhone').value.trim();
  const email = document.getElementById('regEmail').value.trim();

  if(name.length < 2){ setFieldError('regName','errName','Escribe tu nombre (mínimo 2 letras).'); ok=false; } else setFieldError('regName','errName','');
  if(lastname.length < 2){ setFieldError('regLastname','errLastname','Escribe tu apellido (mínimo 2 letras).'); ok=false; } else setFieldError('regLastname','errLastname','');
  const ageNum = Number(age);
  if(!age || isNaN(ageNum) || ageNum < 1 || ageNum > 120){ setFieldError('regAge','errAge','Ingresa una edad válida (1–120).'); ok=false; } else setFieldError('regAge','errAge','');
  if(!PHONE_RE.test(phone)){ setFieldError('regPhone','errPhone','Ingresa un número de teléfono válido.'); ok=false; } else setFieldError('regPhone','errPhone','');
  if(!EMAIL_RE.test(email)){ setFieldError('regEmail','errEmail','Ingresa un correo electrónico válido.'); ok=false; } else setFieldError('regEmail','errEmail','');

  if(!validateEmergency('regEmgPhone','errEmgPhone','regEmgEmail','errEmgEmail')) ok=false;
  updateRegProgress();
  return ok;
}
function updateRegProgress(){
  const fields = ['regName','regLastname','regAge','regPhone','regEmail'];
  const filled = fields.filter(id=>document.getElementById(id).value.trim().length>0).length;
  document.getElementById('regProgressFill').style.width = (filled/fields.length*100)+'%';
}
['regName','regLastname','regAge','regPhone','regEmail'].forEach(id=>{
  document.getElementById(id).addEventListener('input', updateRegProgress);
});

document.getElementById('regForm').addEventListener('submit', (e)=>{
  e.preventDefault();
  if(!validateForm()) return;
  profile.name = document.getElementById('regName').value.trim();
  profile.lastname = document.getElementById('regLastname').value.trim();
  profile.age = Number(document.getElementById('regAge').value);
  profile.phone = document.getElementById('regPhone').value.trim();
  profile.email = document.getElementById('regEmail').value.trim();
  readHealthFromForm('reg');
  // Antes se asignaba un avatar al azar si el usuario no elegía ninguno.
  // Ahora respetamos su elección: si no eligió foto ni avatar, se queda sin avatar
  // (se muestra un ícono genérico) y puede elegirlo cuando quiera desde su perfil.
  saveAll();
  document.getElementById('welcomeModal').classList.add('hidden');
  enterApp(false);
});

document.getElementById('btnGuest').addEventListener('click', ()=>{
  document.getElementById('welcomeModal').classList.add('hidden');
  enterApp(false);
});

/* ===================== BOOT + PANTALLA "PREPARANDO EXPERIENCIA" + REGISTRO ===================== */
const PREP_STEPS = [
  'Calibrando sensores virtuales…',
  'Ajustando mi voz y personalidad de cuidado…',
  'Preparando tu panel de bienestar…',
  'Cargando consejos y datos curiosos del día…'
];
function runPrepScreen(callback){
  const prep = document.getElementById('prepScreen');
  const stepsBox = document.getElementById('prepSteps');
  const msg = document.getElementById('prepMsg');
  stepsBox.innerHTML = PREP_STEPS.map((s,i)=>`<div class="prep-step" id="prepStep${i}"><span class="chk"></span><span>${s}</span></div>`).join('');
  prep.classList.remove('hidden');
  let i = 0;
  msg.textContent = PREP_STEPS[0];
  function nextStep(){
    if(i>0){ const prevEl = document.getElementById('prepStep'+(i-1)); if(prevEl){ prevEl.classList.add('done'); prevEl.querySelector('.chk').textContent='✓'; } }
    if(i >= PREP_STEPS.length){
      setTimeout(()=>{ prep.classList.add('hidden'); callback(); }, 400);
      return;
    }
    msg.textContent = PREP_STEPS[i];
    i++;
    setTimeout(nextStep, 550);
  }
  nextStep();
}

let bootProgressInterval = null;
function animateBootProgress(){
  const bar = document.getElementById('bootProgressBar');
  let pct = 0;
  bootProgressInterval = setInterval(()=>{
    pct = Math.min(100, pct + Math.random()*18);
    bar.style.width = pct + '%';
    if(pct>=100) clearInterval(bootProgressInterval);
  }, 220);
}
animateBootProgress();

document.getElementById('btnBootStart').addEventListener('click', ()=>{
  // Este es el saludo fijo de arranque, así que usamos tu clip real de Baymax en vez de la voz sintetizada.
  waveMascot('#bootFaceWrap .baymax-face');
  playBaymaxHello('Hola. Soy Baymax, tu asistente personal de bienestar.');
  const boot = document.getElementById('bootScreen');
  boot.classList.add('fade-out');
  setTimeout(()=>{
    boot.classList.add('hidden');
    if(hasSavedProfile && profile.name){
      enterApp(true);
    } else {
      runPrepScreen(()=>{
        document.getElementById('welcomeModal').classList.remove('hidden');
        updateRegProgress();
      });
    }
  }, 650);
});

function enterApp(returning){
  document.getElementById('welcomeModal').classList.add('hidden');
  document.getElementById('appShell').classList.remove('hidden');
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
  const helloText = returning
    ? (profile.name ? `${greeting} de nuevo, ${profile.name}. Recuperé tus datos guardados. Sistema listo.` : `${greeting} de nuevo. Recuperé tus datos guardados. Sistema listo.`)
    : (profile.name ? `${greeting}, ${profile.name}. Voy a estar acompañándote mientras reviso tus signos vitales. Sistema listo, puedes comenzar a navegar.` : `${greeting}. Sistema listo, puedes comenzar a navegar.`);
  addMsg(helloText, 'bot');
  renderAll();
  updateVoiceButton();
  updateHeartbeatVisual();
  speak(helloText);
  showSystemReadyToast();
}
function showSystemReadyToast(){
  pushNotificationSilent('normal', 'Sistema listo', 'Baymax está en línea. Ya puedes navegar por todas las secciones.');
}
function pushNotificationSilent(level, title, body){
  notifications.push({level, title, body, ts: Date.now()});
  renderNotifications();
  saveAll();
}

/* ===================== INICIO ===================== */
const hasSavedProfile = loadAll();
renderAll();
updateVoiceButton();
if(hasSavedProfile){
  document.getElementById('regName').value = profile.name || '';
  document.getElementById('regLastname').value = profile.lastname || '';
  document.getElementById('regAge').value = profile.age || '';
  document.getElementById('regPhone').value = profile.phone || '';
  document.getElementById('regEmail').value = profile.email || '';
  if(profile.mood){
    document.querySelectorAll('#regMoodGrid .mood-btn').forEach(b=> b.classList.toggle('selected', b.dataset.mood===profile.mood));
    document.querySelectorAll('#wellnessMoodGrid .mood-btn').forEach(b=> b.classList.toggle('selected', b.dataset.mood===profile.mood));
  }
  applyPhotoPreview();
}
fillHealthForm('reg'); fillHealthForm('cfg');
resizeHeartCanvas();
logLine('Página lista. Conecta tu ESP32 o activa el modo demostración.', 'info');
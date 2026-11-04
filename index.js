// Screen Time Stats · v1.0.0 (Stage 9) 

const MODULE_NAME = 'screentime-stats';
const LOG = `[${MODULE_NAME}]`;
const LS_MIRROR = `${MODULE_NAME}:mirror`;
const DEMO_PREFIX = 'demo:';
const MENU_ITEM_ID = 'sts_menu_item';
const DOW = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const TICK_MS = 5000;
const MSG_GAP_MS = 1500;

window.STS_LOADED = 'parsed';
console.log(`${LOG} 1/3 อ่านไฟล์แล้ว`);

const DEFAULTS = {
    version: 10,
    idleMinutes: 5,
    hideNames: false,
    fancy: true,
    devMode: false,
    dailyGoalMin: 120,
    daily: {},
    meta: {},
};

/* ══════════ ที่เก็บข้อมูล ══════════ */

function getSettings() {
    let store = null;
    try {
        const ctx = SillyTavern.getContext();
        ctx.extensionSettings[MODULE_NAME] = ctx.extensionSettings[MODULE_NAME] || {};
        store = ctx.extensionSettings[MODULE_NAME];
    } catch (err) {
        console.warn(`${LOG} อ่าน extensionSettings ไม่ได้ ใช้ localStorage แทน`, err);
    }
    if (!store) {
        try { store = JSON.parse(localStorage.getItem(LS_MIRROR)) || {}; }
        catch { store = {}; }
    }
    for (const k of Object.keys(DEFAULTS)) {
        if (store[k] === undefined) {
            const d = DEFAULTS[k];
            store[k] = (d && typeof d === 'object') ? structuredClone(d) : d;
        }
    }
    return store;
}

function saveSettings() {
    const s = getSettings();
    try { SillyTavern.getContext().saveSettingsDebounced(); }
    catch (err) { console.warn(`${LOG} saveSettingsDebounced พลาด`, err); }
    try { localStorage.setItem(LS_MIRROR, JSON.stringify(s)); }
    catch (err) { console.warn(`${LOG} เขียน localStorage พลาด`, err); }
}

function reducedMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch { return false; }
}

function fancyOn() {
    return getSettings().fancy && !reducedMotion();
}

/* ══════════ วันที่ + รูปแบบตัวเลข ══════════ */

function dateKey(d = new Date()) {
    const y = d.getFullYear() + 543;
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}`;
}

function shortMinutes(ms) {
    const total = Math.round(ms / 60000);
    if (total < 60) return `${total} мин`;
    const h = Math.floor(total / 60), m = total % 60;
    return m ? `${h} ч ${m} мин` : `${h} ч`;
}

function fmtClock(ms) {
    const t = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
    const pad = n => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

function lastDays(n, offset = 0) {
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i - offset);
        out.push({ key: dateKey(d), dow: DOW[d.getDay()], dom: d.getDate(), isToday: (i === 0 && offset === 0) });
    }
    return out;
}

/* ══════════ รวมยอด ══════════ */

function seriesByDay(days) {
    const s = getSettings();
    return days.map(day => {
        let ms = 0, msg = 0;
        for (const key of Object.keys(s.daily)) {
            const row = s.daily[key]?.[day.key];
            if (!row) continue;
            ms += row[0]; msg += (row[1] || 0) + (row[2] || 0);
        }
        return { ...day, ms, msg };
    });
}

function rankBy(days, field) {
    const s = getSettings();
    const want = new Set(days.map(d => d.key));
    const bucket = [];
    for (const key of Object.keys(s.daily)) {
        let ms = 0, msg = 0;
        for (const dk of Object.keys(s.daily[key])) {
            if (!want.has(dk)) continue;
            const row = s.daily[key][dk];
            ms += row[0]; msg += (row[1] || 0) + (row[2] || 0);
        }
        if (!ms && !msg) continue;
        bucket.push({
            key, ms, msg,
            name: s.meta[key]?.name || key,
            avatar: s.meta[key]?.avatar || null,
        });
    }
    bucket.sort((a, b) => b[field] - a[field]);
    return bucket;
}

/* ══════════ ตัวละครที่เปิดอยู่ ══════════ */

function currentTarget() {
    try {
        const ctx = SillyTavern.getContext();
        if (ctx.groupId) {
            const g = (ctx.groups || []).find(x => String(x.id) === String(ctx.groupId));
            return { key: `group:${ctx.groupId}`, name: g?.name || 'Безымянная группа', avatar: null };
        }
        const ch = ctx.characters?.[ctx.characterId];
        if (ch?.avatar) return { key: ch.avatar, name: ch.name || ch.avatar, avatar: ch.avatar };
    } catch (err) { console.warn(`${LOG} อ่านตัวละครปัจจุบันไม่ได้`, err); }
    return null;
}

function avatarUrl(file) {
    if (!file) return null;
    return `characters/${encodeURIComponent(file)}`;
}

/* ══════════ เขียนยอด ══════════ */

function touchMeta(key, name, avatar) {
    const s = getSettings();
    const m = s.meta[key] || {};
    s.meta[key] = {
        name: name || m.name || key,
        avatar: avatar || m.avatar || null,
        lastSeen: dateKey(),
    };
}

function addTime(key, name, avatar, whenMs, ms) {
    if (ms <= 0) return;
    const s = getSettings();
    const dk = dateKey(new Date(whenMs));
    s.daily[key] = s.daily[key] || {};
    const row = s.daily[key][dk] || [0, 0, 0];
    row[0] += ms;
    s.daily[key][dk] = row;
    touchMeta(key, name, avatar);
}

function addBotMsg(key, name, avatar) {
    const s = getSettings();
    const dk = dateKey();
    s.daily[key] = s.daily[key] || {};
    const row = s.daily[key][dk] || [0, 0, 0];
    row[2] += 1;
    s.daily[key][dk] = row;
    touchMeta(key, name, avatar);
    saveSettings();
}

/* ══════════ ตัวนับเวลาจริง ══════════ */

let liveKey = null;
let liveName = null;
let liveAvatar = null;
let activeSince = 0;
let lastActivity = 0;
let domThrottle = 0;
let trackerReady = false;
let lastMsgStamp = 0;
let seenMsgIds = new Set();

function markActivity() {
    const now = Date.now();
    lastActivity = now;
    if (activeSince === 0 && liveKey && document.visibilityState === 'visible') {
        activeSince = now;
        console.log(`${LOG} ▶ นับต่อ ${liveName}`);
    }
}

function onDomActivity() {
    const now = Date.now();
    if (now - domThrottle < 3000) return;
    domThrottle = now;
    markActivity();
}

function commit(endTs) {
    if (!liveKey || activeSince === 0) return;
    let start = activeSince;
    if (endTs <= start) { activeSince = endTs; return; }
    let changed = false;
    while (endTs > start) {
        const d = new Date(start);
        const nextMid = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
        const segEnd = Math.min(endTs, nextMid);
        const ms = segEnd - start;
        if (ms > 0) { addTime(liveKey, liveName, liveAvatar, start, ms); changed = true; }
        start = segEnd;
    }
    activeSince = endTs;
    if (changed) saveSettings();
}

function tick() {
    if (!liveKey || activeSince === 0) return;
    const now = Date.now();
    const idleMs = Math.max(1, getSettings().idleMinutes) * 60000;
    if (now - lastActivity > idleMs) {
        commit(lastActivity);
        activeSince = 0;
        console.log(`${LOG} ⏸ ว่างเกิน ${getSettings().idleMinutes} мин — หยุดนับ ${liveName}`);
    } else {
        commit(now);
    }
}

function onChatChanged() {
    commit(Date.now());
    activeSince = 0;
    seenMsgIds = new Set();
    const t = currentTarget();
    liveKey = t?.key || null;
    liveName = t?.name || null;
    liveAvatar = t?.avatar || null;
    if (liveKey && document.visibilityState === 'visible') {
        activeSince = Date.now();
        lastActivity = Date.now();
    }
    console.log(`${LOG} เปลี่ยนห้อง → ${liveName || '(ไม่มี)'} · Подсчёт=${activeSince > 0}`);
}

function onVisibility() {
    if (document.visibilityState === 'hidden') {
        commit(Date.now());
        activeSince = 0;
    } else if (liveKey) {
        activeSince = Date.now();
        lastActivity = Date.now();
    }
}

function fingerprintLastBotMsg() {
    try {
        const chat = SillyTavern.getContext()?.chat;
        if (!Array.isArray(chat) || !chat.length) return null;
        const idx = chat.length - 1;
        const m = chat[idx];
        if (!m || m.is_user) return null;
        if (m.is_system) return null;
        const text = String(m.mes || '');
        if (!text.trim()) return null;
        const swipeCount = Array.isArray(m.swipes) ? m.swipes.length : 0;
        return `${idx}|${swipeCount}|${text.length}|${text.slice(0, 24)}|${text.slice(-24)}`;
    } catch (err) {
        console.warn(`${LOG} ทำลายนิ้วมือсообщенийไม่ได้`, err);
        return null;
    }
}

function onBotMessage() {
    markActivity();
    if (!liveKey) {
        const t = currentTarget();
        if (t) { liveKey = t.key; liveName = t.name; liveAvatar = t.avatar; }
    }
    if (!liveKey) return;

    const now = Date.now();
    if (now - lastMsgStamp < MSG_GAP_MS) {
        console.log(`${LOG} ✋ сообщенийถี่เกินไป ไม่นับ`);
        return;
    }

    const fp = fingerprintLastBotMsg();
    if (!fp) { console.log(`${LOG} ✋ ไม่ใช่сообщенийบอทใหม่ ไม่นับ`); return; }
    if (seenMsgIds.has(fp)) { console.log(`${LOG} ✋ сообщенийซ้ำ (ปัด/รีเจน) ไม่นับ`); return; }

    seenMsgIds.add(fp);
    if (seenMsgIds.size > 400) seenMsgIds = new Set([...seenMsgIds].slice(-200));
    lastMsgStamp = now;
    addBotMsg(liveKey, liveName, liveAvatar);
    console.log(`${LOG} 💬 นับсообщенийบอท +1 (${liveName})`);
}

function flushNow() {
    commit(Date.now());
    activeSince = 0;
    saveSettings();
}

function startTracker() {
    if (trackerReady) return true;
    let ctx;
    try { ctx = SillyTavern.getContext(); } catch { return false; }
    if (!ctx?.eventSource || !ctx?.event_types) return false;

    const ev = ctx.event_types;
    if (ev.CHAT_CHANGED) ctx.eventSource.on(ev.CHAT_CHANGED, onChatChanged);
    if (ev.CHARACTER_MESSAGE_RENDERED) ctx.eventSource.on(ev.CHARACTER_MESSAGE_RENDERED, onBotMessage);
    else if (ev.MESSAGE_RECEIVED) ctx.eventSource.on(ev.MESSAGE_RECEIVED, onBotMessage);
    if (ev.MESSAGE_SENT) ctx.eventSource.on(ev.MESSAGE_SENT, markActivity);

    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('touchstart', onDomActivity, { passive: true });
    document.addEventListener('keydown', onDomActivity);
    window.addEventListener('pagehide', flushNow);
    window.addEventListener('beforeunload', flushNow);

    setInterval(tick, TICK_MS);
    onChatChanged();

    trackerReady = true;
    console.log(`${LOG} ⏱️ ตัวนับเวลาเริ่มทำงานแล้ว (เขียนทุก ${TICK_MS / 1000} วิ)`);
    return true;
}

let trackTries = 0;
const stsTrackTimer = setInterval(() => {
    trackTries++;
    if (startTracker() || trackTries >= 120) clearInterval(stsTrackTimer);
}, 500);

/* ══════════ ข้อมูลตัวอย่าง (เรียกจาก drawer เท่านั้น) ══════════ */

function say(msg, type = 'info') {
    if (typeof toastr !== 'undefined' && toastr[type]) toastr[type](msg, 'Screen Time Stats');
    console.log(`${LOG} ${msg}`);
}

function seedDemo() {
    const s = getSettings();
    const cast = [
        [`${DEMO_PREFIX}mira`, 'Mira'],
        [`${DEMO_PREFIX}kite`, 'Кайт'],
        [`${DEMO_PREFIX}noon`, 'Нун'],
        [`${DEMO_PREFIX}rin`, 'Рин'],
        [`${DEMO_PREFIX}ozzy`, 'Оззи'],
    ];
    for (const [key, name] of cast) {
        s.daily[key] = s.daily[key] || {};
        for (let i = 0; i < 14; i++) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const mins = 8 + Math.floor(Math.random() * 95);
            s.daily[key][dateKey(d)] = [mins * 60000, 0, 2 + Math.floor(Math.random() * 40)];
        }
        s.meta[key] = { name, avatar: null, lastSeen: dateKey() };
    }
    saveSettings();
    say('Добавлены демонстрационные данные: 14 дней, 5 персонажей', 'success');
}

function clearDemo() {
    const s = getSettings();
    let n = 0;
    for (const key of Object.keys(s.daily)) {
        if (key.startsWith(DEMO_PREFIX)) { delete s.daily[key]; delete s.meta[key]; n++; }
    }
    saveSettings();
    say(`Удалены демонстрационные данные для ${n} персонажей. Настоящие данные сохранены.`, 'success');
}

/* ══════════ ชั้นตกแต่ง: CSS ══════════ */

const FX_CSS = `
@keyframes sts-fx-rise{
  0%{opacity:0;transform:translateY(18px) scale(0.965)}
  62%{opacity:1;transform:translateY(-4px) scale(1.008)}
  100%{opacity:1;transform:none}
}
@keyframes sts-fx-grow{
  0%{transform:scaleY(0)}72%{transform:scaleY(1.07)}100%{transform:scaleY(1)}
}
@keyframes sts-fx-sweep{
  0%{background-position:-160% 0}100%{background-position:260% 0}
}
@keyframes sts-fx-breathe{
  0%,100%{box-shadow:0 0 0 0 rgba(127,127,127,0)}
  50%{box-shadow:0 0 18px 3px var(--sts-accent,#8ab4ff)}
}
@keyframes sts-fx-bob{
  0%,100%{transform:translateY(0) rotate(-5deg)}50%{transform:translateY(-6px) rotate(5deg)}
}
@keyframes sts-fx-blink{
  0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.32;transform:scale(0.74)}
}
@keyframes sts-fx-fall{
  0%{opacity:0;transform:translateY(-26px) rotate(0deg)}
  12%{opacity:1}
  100%{opacity:0;transform:translateY(170px) rotate(460deg)}
}
@keyframes sts-fx-pop{0%{transform:scale(1)}45%{transform:scale(1.17)}100%{transform:scale(1)}}
@keyframes sts-fx-spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}
@keyframes sts-fx-ripple{0%{opacity:0.55;transform:scale(0.4)}100%{opacity:0;transform:scale(3.2)}}
@keyframes sts-fx-drift{
  0%,100%{transform:translate(0,0) scale(1)}
  33%{transform:translate(12%,-8%) scale(1.1)}
  66%{transform:translate(-9%,7%) scale(0.94)}
}
@keyframes sts-fx-beam{0%,100%{opacity:0.18}50%{opacity:0.5}}
@keyframes sts-fx-twinkle{0%,100%{opacity:0.2;transform:scale(0.7)}50%{opacity:1;transform:scale(1.15)}}
@keyframes sts-fx-slidein{0%{opacity:0;transform:translateY(10px) scale(0.94)}100%{opacity:1;transform:none}}
@keyframes sts-fx-glowpulse{0%,100%{opacity:0.25}50%{opacity:0.75}}
.sts-fx-card{animation:sts-fx-rise 0.54s cubic-bezier(0.2,1.2,0.3,1) both}
.sts-fx-press{transition:transform 0.14s cubic-bezier(0.2,1.2,0.3,1);position:relative;overflow:hidden}
.sts-fx-press:active{transform:scale(0.955)}
.sts-fx-shine{
  background-image:linear-gradient(105deg,
    rgba(255,255,255,0) 38%,rgba(255,255,255,0.36) 50%,rgba(255,255,255,0) 62%);
  background-size:220% 100%;background-repeat:no-repeat;
  animation:sts-fx-sweep 3.2s linear infinite;
}
.sts-fx-crown{animation:sts-fx-bob 2.6s ease-in-out infinite}
.sts-fx-dot{animation:sts-fx-blink 1.15s ease-in-out infinite}
.sts-fx-glow{animation:sts-fx-breathe 2.8s ease-in-out infinite}
.sts-fx-confetti{position:absolute;border-radius:2px;pointer-events:none;
  animation:sts-fx-fall 1.6s cubic-bezier(0.3,0.7,0.4,1) forwards}
.sts-fx-spin{animation:sts-fx-spin 6s linear infinite}
.sts-fx-ripple{position:absolute;border-radius:50%;pointer-events:none;
  animation:sts-fx-ripple 0.62s ease-out forwards}
.sts-fx-orb{position:absolute;border-radius:50%;pointer-events:none;filter:blur(26px);
  animation:sts-fx-drift 18s ease-in-out infinite}
.sts-fx-beam{animation:sts-fx-beam 2.4s ease-in-out infinite}
.sts-fx-twinkle{animation:sts-fx-twinkle 1.6s ease-in-out infinite}
.sts-fx-slidein{animation:sts-fx-slidein 0.44s cubic-bezier(0.2,1.2,0.3,1) both}
.sts-fx-glowpulse{animation:sts-fx-glowpulse 2.2s ease-in-out infinite}
@media (prefers-reduced-motion: reduce){
  .sts-fx-card,.sts-fx-shine,.sts-fx-crown,.sts-fx-dot,.sts-fx-glow,.sts-fx-confetti,
  .sts-fx-spin,.sts-fx-ripple,.sts-fx-orb,.sts-fx-beam,.sts-fx-twinkle,
  .sts-fx-slidein,.sts-fx-glowpulse{animation:none !important}
}
.sts-card{padding:14px;margin-bottom:10px;border-radius:20px;
  background:rgba(127,127,127,0.10);
  border:1px solid var(--SmartThemeBorderColor, rgba(127,127,127,0.3))}
.sts-card-cap,.sts-hero-cap{font-size:0.75em;opacity:0.6;margin-bottom:8px}
.sts-hero-big{display:flex;align-items:baseline;gap:4px}
.sts-hero-unit{font-size:0.9em;opacity:0.7}
.sts-chips{display:flex;gap:8px;margin-top:12px}
.sts-chip{flex:1 1 0;padding:8px 10px;border-radius:14px;
  background:rgba(127,127,127,0.12);display:flex;flex-direction:column;gap:2px}
.sts-chip-k{font-size:0.66em;opacity:0.6}
.sts-chip-v{font-size:0.92em;font-weight:700;font-variant-numeric:tabular-nums}
.sts-chart{display:flex;align-items:flex-end;gap:6px;height:174px}
.sts-col{flex:1 1 0;height:100%;padding:0;cursor:pointer;background:none;border:none;
  color:inherit;display:flex;flex-direction:column;justify-content:flex-end;position:relative}
.sts-track{height:132px;display:flex;align-items:flex-end;border-radius:11px;
  background:rgba(127,127,127,0.12)}
.sts-fill{width:100%;border-radius:11px;transform-origin:bottom}
.sts-dow{margin-top:6px;text-align:center;font-size:0.72em;opacity:0.55}
.sts-col-today .sts-dow{opacity:1;font-weight:800;color:var(--SmartThemeQuoteColor,#8ab4ff)}
.sts-tip{position:absolute;left:50%;bottom:100%;transform:translate(-50%,6px) scale(0.9);
  white-space:nowrap;padding:4px 9px;border-radius:999px;font-size:0.66em;pointer-events:none;
  background:var(--SmartThemeQuoteColor,#8ab4ff);color:var(--SmartThemeBlurTintColor,#111);
  opacity:0;transition:all 0.2s ease;font-weight:700}
.sts-col.sts-open .sts-tip{opacity:1;transform:translate(-50%,-2px) scale(1)}
.sts-tabs{display:flex;gap:6px;margin-bottom:12px}
.sts-tab{flex:1 1 0;padding:8px 4px;cursor:pointer;border-radius:999px;font-size:0.78em;
  background:rgba(127,127,127,0.14);color:inherit;border:1px solid transparent}
.sts-tab-on{background:var(--SmartThemeQuoteColor,#8ab4ff);
  color:var(--SmartThemeBlurTintColor,#111);font-weight:800}
.sts-empty{font-size:0.82em;opacity:0.55;padding:8px 0}
`;

function ensureFx() {
    if (document.getElementById('sts_fx_css')) return;
    const st = document.createElement('style');
    st.id = 'sts_fx_css';
    st.textContent = FX_CSS + '#sts_dialog::backdrop{background:rgba(0,0,0,0.64)}';
    document.head.append(st);
}

function themeColor(varName, fallback) {
    try {
        const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
        return v || fallback;
    } catch { return fallback; }
}

/* ══════════ ตัวช่วยสร้าง DOM ══════════ */

function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
}

function attachRipple(node, color) {
    if (!fancyOn()) return;
    node.addEventListener('pointerdown', ev => {
        const r = node.getBoundingClientRect();
        const dot = el('div', 'sts-fx-ripple');
        const size = Math.max(r.width, r.height);
        dot.style.cssText = [
            `width:${size}px`, `height:${size}px`,
            `left:${ev.clientX - r.left - size / 2}px`,
            `top:${ev.clientY - r.top - size / 2}px`,
            `background:${color}`,
        ].join(';');
        dot.addEventListener('animationend', () => dot.remove());
        node.append(dot);
    });
}

function fxCard(order = 0) {
    const card = el('div', 'sts-card');
    card.style.position = 'relative';
    card.style.overflow = 'hidden';
    if (fancyOn()) {
        card.classList.add('sts-fx-card');
        card.style.animationDelay = `${order * 72}ms`;
    }
    return card;
}

function addOrbs(card, a, b) {
    if (!fancyOn()) return;
    const o1 = el('div', 'sts-fx-orb');
    o1.style.cssText = `width:130px;height:130px;left:-30px;top:-40px;background:${a};opacity:0.16`;
    const o2 = el('div', 'sts-fx-orb');
    o2.style.cssText = `width:150px;height:150px;right:-40px;bottom:-50px;background:${b};opacity:0.13;animation-delay:-7s`;
    card.prepend(o1, o2);
}

function countUp(node, target, suffix = '') {
    if (!fancyOn()) { node.textContent = `${target}${suffix}`; return; }
    const dur = 950;
    const t0 = performance.now();
    function frame(now) {
        const p = Math.min(1, (now - t0) / dur);
        const eased = 1 - Math.pow(1 - p, 4);
        node.textContent = `${Math.round(target * eased)}${suffix}`;
        if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}

function avatarNode(entry, size, ringColor, glow) {
    const box = el('div');
    box.style.cssText = [
        `width:${size}px`, `height:${size}px`, 'border-radius:50%',
        'overflow:hidden', 'flex:0 0 auto', 'position:relative',
        'display:flex', 'align-items:center', 'justify-content:center',
        `border:2px solid ${ringColor}`,
        'background:rgba(127,127,127,0.18)',
        `font-size:${Math.round(size / 2.4)}px`, 'font-weight:700',
        'box-shadow:0 5px 18px rgba(0,0,0,0.32)',
    ].join(';');
    if (glow && fancyOn()) {
        box.style.setProperty('--sts-accent', ringColor);
        box.classList.add('sts-fx-glow');
    }
    const url = avatarUrl(entry.avatar);
    if (url) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
        img.addEventListener('error', () => {
            img.remove();
            box.textContent = (entry.name || '?').trim().charAt(0).toUpperCase();
        });
        box.append(img);
    } else {
        box.textContent = (entry.name || '?').trim().charAt(0).toUpperCase();
    }
    return box;
}

function championNode(entry, ring) {
    const holder = el('div');
    holder.style.cssText = 'position:relative;width:76px;height:76px;display:flex;align-items:center;justify-content:center';
    if (fancyOn()) {
        const halo = el('div', 'sts-fx-spin');
        halo.style.cssText = ['position:absolute', 'inset:0', 'border-radius:50%',
            `border:2px dashed ${ring}`, 'opacity:0.6'].join(';');
        holder.append(halo);
    }
    holder.append(avatarNode(entry, 62, ring, true));
    return holder;
}

function dropConfetti(host, count = 10) {
    if (!fancyOn()) return;
    const accent = themeColor('--SmartThemeQuoteColor', '#8ab4ff');
    const second = themeColor('--SmartThemeEmColor', '#c8a2ff');
    const palette = [accent, second, '#ffd45e', '#c0c6d4', '#d99a6c'];
    for (let i = 0; i < count; i++) {
        const bit = el('div', 'sts-fx-confetti');
        const w = 4 + Math.round(Math.random() * 5);
        bit.style.cssText = [
            `width:${w}px`, `height:${w + Math.round(Math.random() * 7)}px`,
            `left:${4 + Math.random() * 92}%`, 'top:0',
            `background:${palette[i % palette.length]}`,
            `animation-delay:${Math.random() * 900}ms`, 'opacity:0',
        ].join(';');
        bit.addEventListener('animationend', () => bit.remove());
        host.append(bit);
    }
}

/* ══════════ การ์ด: นาฬิกาเดินสด ══════════ */

let liveTimer = null;

function buildLive() {
    const accent = themeColor('--SmartThemeQuoteColor', '#8ab4ff');
    const second = themeColor('--SmartThemeEmColor', '#c8a2ff');
    const goalMin = Math.max(1, getSettings().dailyGoalMin);

    const card = fxCard(0);
    addOrbs(card, accent, second);
    card.append(el('div', 'sts-card-cap', 'Идёт подсчёт'));

    const rowTop = el('div');
    rowTop.style.cssText = 'display:flex;align-items:center;gap:12px;position:relative';

    const who = el('div');
    who.style.cssText = 'flex:1 1 auto;min-width:0';
    const nameLine = el('div', null, liveName || 'Чат пока не открыт');
    nameLine.style.cssText = 'font-size:0.95em;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';

    const stateWrap = el('div');
    stateWrap.style.cssText = 'display:flex;align-items:center;gap:7px;margin-top:4px;position:relative';
    const dotHolder = el('div');
    dotHolder.style.cssText = 'position:relative;width:9px;height:9px;flex:0 0 auto';
    const dot = el('div');
    dot.id = 'sts_live_dot';
    dot.style.cssText = 'width:9px;height:9px;border-radius:50%';
    dotHolder.append(dot);
    const stateLine = el('div', 'sts-hint');
    stateLine.id = 'sts_live_state';
    stateLine.style.cssText = 'margin:0;font-size:0.8em;opacity:0.7';
    stateWrap.append(dotHolder, stateLine);
    who.append(nameLine, stateWrap);

    const ringBox = el('div');
    ringBox.id = 'sts_live_ring';
    ringBox.style.cssText = [
        'flex:0 0 auto', 'width:104px', 'height:104px', 'border-radius:50%',
        'display:flex', 'align-items:center', 'justify-content:center',
        `background:conic-gradient(${accent} 0deg, rgba(127,127,127,0.16) 0deg)`,
        'padding:6px', 'box-sizing:border-box',
    ].join(';');

    const inner = el('div');
    inner.style.cssText = [
        'width:100%', 'height:100%', 'border-radius:50%',
        'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center',
        'background:rgba(127,127,127,0.10)',
    ].join(';');

    const clock = el('div');
    clock.id = 'sts_live_clock';
    clock.style.cssText = [
        'font-size:1.24em', 'font-weight:800', 'line-height:1',
        'font-variant-numeric:tabular-nums', `color:${accent}`,
    ].join(';');
    clock.textContent = '0:00';
    const goalCap = el('div', null, `Цель: ${goalMin} мин`);
    goalCap.style.cssText = 'font-size:0.6em;opacity:0.55;margin-top:3px';
    inner.append(clock, goalCap);
    ringBox.append(inner);

    rowTop.append(who, ringBox);
    card.append(rowTop);

    const glowBar = el('div', fancyOn() ? 'sts-fx-glowpulse' : null);
    glowBar.style.cssText = ['height:3px', 'border-radius:99px', 'margin-top:12px',
        `background:linear-gradient(90deg, transparent, ${accent}, ${second}, transparent)`].join(';');
    card.append(glowBar);

    let lastSec = -1;
    function paint() {
        const c = document.getElementById('sts_live_clock');
        const st = document.getElementById('sts_live_state');
        const d = document.getElementById('sts_live_dot');
        const rg = document.getElementById('sts_live_ring');
        if (!c || !st || !d || !rg) { if (liveTimer) { clearInterval(liveTimer); liveTimer = null; } return; }

        const saved = liveKey ? (getSettings().daily?.[liveKey]?.[dateKey()]?.[0] || 0) : 0;
        const pending = activeSince > 0 ? (Date.now() - activeSince) : 0;
        const totalMs = saved + pending;
        const totalSec = Math.floor(totalMs / 1000);
        c.textContent = fmtClock(totalMs);

        const pct = Math.min(1, (totalMs / 60000) / goalMin);
        rg.style.background = `conic-gradient(${accent} ${pct * 360}deg, rgba(127,127,127,0.16) ${pct * 360}deg)`;

        const counting = activeSince > 0;
        if (fancyOn() && totalSec !== lastSec && counting) {
            c.style.animation = 'none';
            void c.offsetWidth;
            c.style.animation = 'sts-fx-pop 0.3s ease';
            const rip = el('div', 'sts-fx-ripple');
            rip.style.cssText = 'width:26px;height:26px;left:-8px;top:-8px;background:#4ade80';
            rip.addEventListener('animationend', () => rip.remove());
            d.parentElement.append(rip);
        }
        lastSec = totalSec;

        d.style.background = counting ? '#4ade80' : 'rgba(127,127,127,0.5)';
        d.classList.toggle('sts-fx-dot', counting && fancyOn());

        const msgs = liveKey ? (getSettings().daily?.[liveKey]?.[dateKey()]?.[2] || 0) : 0;
        st.textContent = `${counting ? 'Подсчёт' : 'Пауза'} · сегодня ${msgs} сообщений бота`;
    }
    paint();
    if (liveTimer) clearInterval(liveTimer);
    liveTimer = setInterval(paint, 1000);

    return card;
}

/* ══════════ การ์ด: สรุป ══════════ */

function buildSummary(rows) {
    const accent = themeColor('--SmartThemeQuoteColor', '#8ab4ff');
    const second = themeColor('--SmartThemeEmColor', '#c8a2ff');
    const totalMs = rows.reduce((a, r) => a + r.ms, 0);
    const totalMsg = rows.reduce((a, r) => a + r.msg, 0);
    const avgMin = Math.round(totalMs / 60000 / (rows.length || 1));
    const best = rows.reduce((a, r) => (r.ms > a.ms ? r : a), rows[0] || { ms: 0, dow: '-' });

    const prev = seriesByDay(lastDays(7, 7));
    const prevMs = prev.reduce((a, r) => a + r.ms, 0);
    const diffPct = prevMs > 0 ? Math.round(((totalMs - prevMs) / prevMs) * 100) : 0;

    const card = fxCard(1);
    addOrbs(card, second, accent);

    const capRow = el('div');
    capRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px';
    capRow.append(el('div', 'sts-hero-cap', 'За последние 7 дней'));
    if (prevMs > 0) {
        const badge = el('div', null, `${diffPct >= 0 ? '▲' : '▼'} ${Math.abs(diffPct)}%`);
        badge.style.cssText = [
            'font-size:0.68em', 'font-weight:800', 'padding:3px 9px', 'border-radius:999px',
            diffPct >= 0 ? 'color:#22a35a' : 'color:#d64545',
            diffPct >= 0 ? 'background:rgba(74,222,128,0.16)' : 'background:rgba(248,113,113,0.16)',
        ].join(';');
        capRow.append(badge);
    }
    card.append(capRow);

    const big = el('div', 'sts-hero-big');
    const num = el('span', 'sts-hero-num', '0');
    num.style.cssText = [
        'font-size:2.7em', 'font-weight:900', 'line-height:1',
        'font-variant-numeric:tabular-nums',
        `background:linear-gradient(92deg, ${accent}, ${second})`,
        '-webkit-background-clip:text', 'background-clip:text',
        '-webkit-text-fill-color:transparent',
    ].join(';');
    big.append(num, el('span', 'sts-hero-unit', ' мин'));
    card.append(big);
    countUp(num, Math.round(totalMs / 60000));

    const chips = el('div', 'sts-chips');
    [
        ['В среднем за день', `${avgMin} мин`],
        ['сообщений бота', `${totalMsg}`],
        ['Самый активный день', `${best.dow || '-'}`],
    ].forEach(([k, v], i) => {
        const c = el('div', 'sts-chip');
        c.style.borderRadius = '16px';
        if (fancyOn()) {
            c.classList.add('sts-fx-slidein');
            c.style.animationDelay = `${260 + i * 90}ms`;
        }
        c.append(el('span', 'sts-chip-k', k), el('span', 'sts-chip-v', v));
        chips.append(c);
    });
    card.append(chips);
    return card;
}

/* ══════════ การ์ด: กราฟПо дням ══════════ */

function buildChart(rows) {
    const accent = themeColor('--SmartThemeQuoteColor', '#8ab4ff');
    const second = themeColor('--SmartThemeEmColor', '#c8a2ff');
    const card = fxCard(2);
    card.append(el('div', 'sts-card-cap', 'По дням'));

    const peak = Math.max(1, ...rows.map(r => r.ms));
    const avg = rows.reduce((a, r) => a + r.ms, 0) / (rows.length || 1);

    const frame = el('div');
    frame.style.cssText = 'position:relative';

    [0.25, 0.5, 0.75].forEach(p => {
        const line = el('div');
        line.style.cssText = [
            'position:absolute', 'left:0', 'right:0',
            `bottom:${36 + p * 132}px`, 'height:1px',
            'background:var(--SmartThemeBorderColor, rgba(127,127,127,0.3))',
            'opacity:0.45', 'pointer-events:none',
        ].join(';');
        frame.append(line);
    });

    if (avg > 0) {
        const avgLine = el('div');
        avgLine.style.cssText = [
            'position:absolute', 'left:0', 'right:0',
            `bottom:${36 + Math.min(1, avg / peak) * 132}px`, 'height:0',
            `border-top:1px dashed ${second}`, 'opacity:0.8', 'pointer-events:none',
        ].join(';');
        const tag = el('div', null, `Среднее ${shortMinutes(avg)}`);
        tag.style.cssText = [
            'position:absolute', 'right:0', 'top:-14px',
            'font-size:0.6em', 'padding:1px 7px', 'border-radius:999px',
            `background:${second}`, 'color:var(--SmartThemeBlurTintColor,#111)', 'font-weight:800',
        ].join(';');
        avgLine.append(tag);
        frame.append(avgLine);
    }

    const chart = el('div', 'sts-chart');
    chart.style.position = 'relative';

    rows.forEach((r, i) => {
        const col = el('button', 'sts-col');
        col.type = 'button';
        if (fancyOn()) col.classList.add('sts-fx-press');
        if (r.isToday) col.classList.add('sts-col-today');
        attachRipple(col, `${accent}55`);

        const tip = el('div', 'sts-tip', `${shortMinutes(r.ms)} · ${r.msg} сообщений`);
        const track = el('div', 'sts-track');
        track.style.position = 'relative';

        const fill = el('div', 'sts-fill');
        const h = Math.max(4, Math.round((r.ms / peak) * 100));
        fill.style.height = `${h}%`;
        fill.style.position = 'relative';
        fill.style.overflow = 'hidden';
        fill.style.background = r.isToday
            ? `linear-gradient(180deg, ${accent}, ${second})`
            : `linear-gradient(180deg, ${accent}cc, ${accent}55)`;
        if (r.isToday) {
            fill.style.boxShadow = `0 0 16px ${accent}99`;
            if (fancyOn()) {
                fill.style.setProperty('--sts-accent', accent);
                fill.classList.add('sts-fx-glow');
            }
        }
        if (fancyOn()) {
            fill.style.animation = 'sts-fx-grow 0.64s cubic-bezier(0.2,1.2,0.3,1) both';
            fill.style.animationDelay = `${190 + i * 66}ms`;
            const shine = el('div', 'sts-fx-shine');
            shine.style.cssText = 'position:absolute;inset:0;pointer-events:none';
            shine.style.animationDelay = `${i * 260}ms`;
            fill.append(shine);
        }
        track.append(fill);

        if (r.isToday) {
            const pin = el('div');
            pin.style.cssText = [
                'position:absolute', 'left:50%', `bottom:calc(${h}% - 4px)`,
                'transform:translateX(-50%)', 'width:9px', 'height:9px', 'border-radius:50%',
                `background:${accent}`, `box-shadow:0 0 12px ${accent}`, 'pointer-events:none',
            ].join(';');
            if (fancyOn()) pin.classList.add('sts-fx-twinkle');
            track.append(pin);
        }

        if (r.ms === peak && r.ms > 0 && !r.isToday) {
            const star = el('div', null, '✦');
            star.style.cssText = [
                'position:absolute', 'left:50%', `bottom:calc(${h}% + 2px)`,
                'transform:translateX(-50%)', 'font-size:0.7em',
                `color:${second}`, 'pointer-events:none',
            ].join(';');
            if (fancyOn()) star.classList.add('sts-fx-twinkle');
            track.append(star);
        }

        col.append(tip, track, el('div', 'sts-dow', r.dow));
        col.addEventListener('click', () => {
            const on = col.classList.contains('sts-open');
            chart.querySelectorAll('.sts-col').forEach(c => c.classList.remove('sts-open'));
            if (!on) col.classList.add('sts-open');
        });
        chart.append(col);
    });

    frame.append(chart);
    card.append(frame);
    return card;
}

/* ══════════ การ์ด: โพเดียมРейтинг ══════════ */

function buildPodium(days) {
    const s = getSettings();
    const accent = themeColor('--SmartThemeQuoteColor', '#8ab4ff');
    const card = fxCard(3);
    card.append(el('div', 'sts-card-cap', 'Рейтинг'));

    const tabs = el('div', 'sts-tabs');
    const wrap = el('div');
    const views = {};

    const SLOTS = [
        { rank: 2, h: 56, color: '#c0c6d4', medal: '🥈' },
        { rank: 1, h: 92, color: '#ffd45e', medal: '🥇' },
        { rank: 3, h: 38, color: '#d99a6c', medal: '🥉' },
    ];

    function makeView(field) {
        const view = el('div');
        const top = rankBy(days, field);
        if (!top.length) {
            view.append(el('div', 'sts-empty', 'За этот период пока нет данных'));
            return { node: view, animated: true };
        }

        const stage = el('div');
        stage.style.cssText = [
            'position:relative', 'overflow:hidden',
            'display:flex', 'align-items:flex-end', 'justify-content:center',
            'gap:8px', 'padding:18px 0 2px',
        ].join(';');

        SLOTS.forEach((slot, order) => {
            const r = top[slot.rank - 1];
            const colWrap = el('div');
            colWrap.style.cssText = 'flex:1 1 0;display:flex;flex-direction:column;align-items:center;min-width:0;position:relative';

            if (!r) {
                const ghost = el('div');
                ghost.style.cssText = ['width:100%', 'border-radius:14px 14px 0 0',
                    `height:${slot.h}px`, 'background:rgba(127,127,127,0.09)'].join(';');
                colWrap.append(ghost);
                stage.append(colWrap);
                return;
            }

            const nm = s.hideNames ? `Персонаж ${slot.rank}` : r.name;

            if (slot.rank === 1) {
                if (fancyOn()) {
                    const beam = el('div', 'sts-fx-beam');
                    beam.style.cssText = [
                        'position:absolute', 'bottom:0', 'left:50%', 'transform:translateX(-50%)',
                        'width:78%', 'height:100%', 'pointer-events:none',
                        `background:linear-gradient(0deg, ${slot.color}55, transparent 78%)`,
                        'filter:blur(6px)',
                    ].join(';');
                    colWrap.append(beam);
                }
                const crownRow = el('div');
                crownRow.style.cssText = 'display:flex;align-items:center;gap:3px;position:relative';
                const sparkL = el('div', fancyOn() ? 'sts-fx-twinkle' : null, '✦');
                sparkL.style.cssText = `font-size:0.6em;color:${slot.color}`;
                const crown = el('div', null, '👑');
                crown.style.cssText = 'font-size:1.25em;line-height:1';
                if (fancyOn()) crown.classList.add('sts-fx-crown');
                const sparkR = el('div', fancyOn() ? 'sts-fx-twinkle' : null, '✦');
                sparkR.style.cssText = `font-size:0.6em;color:${slot.color};animation-delay:0.7s`;
                crownRow.append(sparkL, crown, sparkR);
                colWrap.append(crownRow, championNode(r, slot.color));
            } else {
                colWrap.append(avatarNode(r, 48, slot.color));
            }

            const name = el('div', null, nm);
            name.style.cssText = [
                'margin-top:6px', 'max-width:100%',
                `font-size:${slot.rank === 1 ? '0.9em' : '0.8em'}`, 'font-weight:700',
                'overflow:hidden', 'text-overflow:ellipsis', 'white-space:nowrap',
                'text-align:center', 'position:relative',
            ].join(';');
            colWrap.append(name);

            const t = el('div', null, shortMinutes(r.ms));
            t.style.cssText = ['font-size:0.88em', 'font-weight:800',
                'font-variant-numeric:tabular-nums', `color:${accent}`, 'position:relative'].join(';');
            colWrap.append(t);

            const c = el('div', null, `${r.msg} сообщений`);
            c.style.cssText = 'font-size:0.7em;opacity:0.6;margin-bottom:7px;position:relative';
            colWrap.append(c);

            const block = el('div', 'sts-podium-block');
            block.style.cssText = [
                'width:100%', 'border-radius:14px 14px 0 0',
                'height:0px', 'overflow:hidden', 'position:relative',
                'display:flex', 'align-items:center', 'justify-content:center',
                `background:linear-gradient(180deg, ${slot.color}, rgba(127,127,127,0.14))`,
                'transition:height 0.58s cubic-bezier(0.2,1.28,0.3,1)',
                `transition-delay:${order * 100}ms`,
                'box-shadow:inset 0 1px 0 rgba(255,255,255,0.32)',
            ].join(';');
            block.dataset.h = String(slot.h);

            if (fancyOn()) {
                const shine = el('div', 'sts-fx-shine');
                shine.style.cssText = 'position:absolute;inset:0;pointer-events:none';
                shine.style.animationDelay = `${order * 430}ms`;
                block.append(shine);
            }

            const medal = el('div', null, slot.medal);
            medal.style.cssText = 'font-size:1.15em;position:relative;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.35))';
            block.append(medal);
            colWrap.append(block);
            stage.append(colWrap);
        });

        view.append(stage);

        const floor = el('div');
        floor.style.cssText = ['height:4px', 'border-radius:99px', 'margin-bottom:10px',
            `background:linear-gradient(90deg, transparent, ${accent}, transparent)`, 'opacity:0.55'].join(';');
        if (fancyOn()) floor.classList.add('sts-fx-glowpulse');
        view.append(floor);

        top.slice(3, 5).forEach((r, i) => {
            const row = el('div');
            row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:7px 6px;border-radius:14px;background:rgba(127,127,127,0.07);margin-bottom:6px';
            if (fancyOn()) {
                row.classList.add('sts-fx-press', 'sts-fx-slidein');
                row.style.animationDelay = `${420 + i * 90}ms`;
            }
            attachRipple(row, `${accent}55`);
            const no = el('div', null, String(i + 4));
            no.style.cssText = 'flex:0 0 20px;text-align:center;font-size:0.8em;opacity:0.55;font-weight:800';
            row.append(no, avatarNode(r, 28, 'rgba(127,127,127,0.35)'));

            const mid = el('div');
            mid.style.cssText = 'flex:1 1 auto;min-width:0;font-size:0.82em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
            mid.textContent = s.hideNames ? `Персонаж ${i + 4}` : r.name;
            row.append(mid);

            const val = el('div', null, field === 'ms' ? shortMinutes(r.ms) : `${r.msg} сообщений`);
            val.style.cssText = 'flex:0 0 auto;font-size:0.78em;opacity:0.75;font-variant-numeric:tabular-nums';
            row.append(val);
            view.append(row);
        });

        return { node: view, animated: false };
    }

    function reveal(entry) {
        for (const k in views) views[k].node.style.display = 'none';
        entry.node.style.display = '';
        if (entry.animated) return;
        entry.animated = true;
        requestAnimationFrame(() => {
            entry.node.querySelectorAll('.sts-podium-block').forEach(b => {
                b.style.height = `${b.dataset.h || 0}px`;
            });
            const host = entry.node.firstElementChild;
            if (host) {
                dropConfetti(host, 10);
                setTimeout(() => dropConfetti(host, 9), 380);
                setTimeout(() => dropConfetti(host, 7), 760);
            }
        });
    }

    for (const [label, field] of [['По времени', 'ms'], ['По сообщениям', 'msg']]) {
        const entry = makeView(field);
        entry.node.style.display = 'none';
        views[field] = entry;
        wrap.append(entry.node);

        const b = el('button', 'sts-tab', label);
        b.type = 'button';
        b.style.transition = 'all 0.26s cubic-bezier(0.2,1,0.3,1)';
        if (fancyOn()) b.classList.add('sts-fx-press');
        attachRipple(b, 'rgba(255,255,255,0.4)');
        b.addEventListener('click', () => {
            tabs.querySelectorAll('.sts-tab').forEach(x => x.classList.remove('sts-tab-on'));
            b.classList.add('sts-tab-on');
            reveal(entry);
        });
        tabs.append(b);
    }

    tabs.firstChild.classList.add('sts-tab-on');
    card.append(tabs, wrap);
    reveal(views['ms']);
    return card;
}

/* ══════════ วาดหน้ากราฟ — ไม่มีเครื่องมือทดสอบแล้ว ══════════ */

function renderSheet() {
    const body = document.getElementById('sts_body');
    if (!body) return;
    ensureFx();
    const days = lastDays(7);
    const rows = seriesByDay(days);
    body.textContent = '';
    body.append(buildLive(), buildSummary(rows), buildChart(rows), buildPodium(days));
}

/* ══════════ เปิด / ปิดการ์ด ══════════ */

function openSheet() {
    try {
        ensureFx();

        function toOpaque(raw, fallback) {
            if (!raw) return fallback;
            raw = raw.trim();
            let m = raw.match(/rgba?\(([^)]+)\)/i);
            if (m) { const p = m[1].split(',').map(x => x.trim()); if (p.length >= 3) return `rgb(${p[0]}, ${p[1]}, ${p[2]})`; }
            m = raw.match(/hsla?\(([^)]+)\)/i);
            if (m) { const p = m[1].split(',').map(x => x.trim()); if (p.length >= 3) return `hsl(${p[0]}, ${p[1]}, ${p[2]})`; }
            if (raw[0] === '#') { let h = raw.slice(1); if (h.length === 4) h = h.slice(0, 3); else if (h.length === 8) h = h.slice(0, 6); return `#${h}`; }
            return fallback;
        }
        const cardBg = toOpaque(themeColor('--SmartThemeBlurTintColor', ''), '#1e1e26');
        const accent = themeColor('--SmartThemeQuoteColor', '#8ab4ff');
        const second = themeColor('--SmartThemeEmColor', '#c8a2ff');

        const canModal = !!window.HTMLDialogElement;
        let dlg = document.getElementById('sts_dialog');

        if (!dlg) {
            dlg = document.createElement(canModal ? 'dialog' : 'div');
            dlg.id = 'sts_dialog';
            dlg.style.cssText = [
                'position:fixed', 'inset:0', 'margin:auto',
                'width:calc(100% - 28px)', 'max-width:520px',
                'height:auto', 'max-height:calc(100% - 28px)',
                'display:flex', 'flex-direction:column', 'box-sizing:border-box',
                'padding:0', 'border:none', 'border-radius:26px', 'overflow:hidden',
                `background:${cardBg}`, 'opacity:1',
                'color:var(--SmartThemeBodyColor, #eee)',
                'box-shadow:0 24px 70px rgba(0,0,0,0.58)',
                'z-index:2147483647',
            ].join(';');

            const head = document.createElement('div');
            head.id = 'sts_head';
            head.style.cssText = [
                'flex:0 0 auto', 'position:relative',
                'display:flex', 'align-items:center', 'justify-content:space-between',
                'gap:10px', 'padding:15px 16px', `background:${cardBg}`,
                'border-bottom:1px solid var(--SmartThemeBorderColor, rgba(127,127,127,0.3))',
            ].join(';');

            const titleWrap = document.createElement('div');
            titleWrap.style.cssText = 'display:flex;align-items:center;gap:8px;min-width:0';
            const icon = el('div', fancyOn() ? 'sts-fx-spin' : null, '⏳');
            icon.style.cssText = 'font-size:1.05em;line-height:1';
            const title = el('div', null, 'Время в чате');
            title.style.cssText = 'font-size:1.12em;font-weight:800';
            titleWrap.append(icon, title);

            const btnX = document.createElement('button');
            btnX.type = 'button';
            btnX.textContent = '✕ Закрыть';
            if (fancyOn()) btnX.className = 'sts-fx-press';
            btnX.style.cssText = [
                'flex:0 0 auto', 'cursor:pointer', 'padding:8px 16px', 'border-radius:999px',
                'font-size:0.9em', 'font-weight:800', 'border:none',
                `background:linear-gradient(92deg, ${accent}, ${second})`,
                'color:var(--SmartThemeBlurTintColor, #111)',
                'box-shadow:0 5px 16px rgba(0,0,0,0.3)',
            ].join(';');
            btnX.addEventListener('click', closeSheet);
            attachRipple(btnX, 'rgba(255,255,255,0.45)');
            head.append(titleWrap, btnX);

            const rail = el('div');
            rail.style.cssText = ['position:absolute', 'left:0', 'right:0', 'bottom:0', 'height:2px',
                `background:linear-gradient(90deg, transparent, ${accent}, ${second}, transparent)`].join(';');
            if (fancyOn()) rail.classList.add('sts-fx-glowpulse');
            head.append(rail);

            const body = document.createElement('div');
            body.id = 'sts_body';
            body.style.cssText = [
                'flex:1 1 auto', 'min-height:0',
                'overflow-y:auto', 'overscroll-behavior:contain', '-webkit-overflow-scrolling:touch',
                'padding:12px 16px 22px', 'box-sizing:border-box',
            ].join(';');
            body.addEventListener('scroll', () => {
                const h = document.getElementById('sts_head');
                if (!h) return;
                h.style.boxShadow = body.scrollTop > 6 ? '0 6px 18px rgba(0,0,0,0.28)' : 'none';
            }, { passive: true });

            dlg.append(head, body);
            document.body.append(dlg);

            dlg.addEventListener('click', ev => { if (ev.target === dlg) closeSheet(); });
            dlg.addEventListener('cancel', ev => { ev.preventDefault(); closeSheet(); });
        } else {
            dlg.style.background = cardBg;
            const head = document.getElementById('sts_head');
            if (head) head.style.background = cardBg;
        }

        renderSheet();

        if (canModal && typeof dlg.showModal === 'function') {
            if (!dlg.open) dlg.showModal();
        } else {
            dlg.style.display = 'flex';
        }
        console.log(`${LOG} ✅ openSheet · fancy=${fancyOn()}`);
    } catch (err) {
        console.error(`${LOG} ❌ openSheet ล้ม`, err);
        if (typeof toastr !== 'undefined') toastr.error(String(err?.message || err), 'STS: не удалось открыть график');
    }
}

function closeSheet() {
    if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
    const dlg = document.getElementById('sts_dialog');
    if (!dlg) return;
    if (typeof dlg.close === 'function' && dlg.open) dlg.close();
    else dlg.style.display = 'none';
}

/* ══════════ ทางเข้า: เมนูไม้กายสิทธิ์ ══════════ */

function findMenu() {
    const direct = document.getElementById('extensionsMenu');
    if (direct) return direct;
    const block = document.querySelector('#extensions_menu .list-group, .extensions_block .list-group');
    if (block) return block;
    const btn = document.getElementById('extensionsMenuButton');
    if (btn) {
        let hop = btn;
        for (let i = 0; i < 3 && hop; i++) {
            const found = hop.parentElement?.querySelector('.list-group');
            if (found) return found;
            hop = hop.parentElement;
        }
    }
    return null;
}

function makeMenuItem() {
    const item = document.createElement('div');
    item.id = MENU_ITEM_ID;
    item.className = 'list-group-item flex-container flexGap5 interactable';
    item.tabIndex = 0;
    const icon = document.createElement('div');
    icon.className = 'fa-solid fa-hourglass-half extensionsMenuExtensionButton';
    const label = document.createElement('span');
    label.textContent = 'Время в чате';
    item.append(icon, label);
    item.addEventListener('click', () => {
        try { if (window.jQuery) window.jQuery('#extensionsMenu').fadeOut(120); }
        catch (e) { console.warn(`${LOG} ปิดเมนูไม่ได้ ปล่อยให้ ST จัดการเอง`, e); }
        openSheet();
    });
    return item;
}

function mountMenuItem(reason) {
    if (document.getElementById(MENU_ITEM_ID)) return true;
    const menu = findMenu();
    if (!menu) return false;
    menu.append(makeMenuItem());
    console.log(`${LOG} ✅ ใส่บรรทัดในเมนูแล้ว (${reason})`);
    return true;
}

let entryTries = 0;
const stsEntryTimer = setInterval(() => {
    entryTries++;
    if (mountMenuItem(`รอบที่ ${entryTries}`) || entryTries >= 60) clearInterval(stsEntryTimer);
}, 500);

document.addEventListener('click', ev => {
    const hit = ev.target.closest?.('#extensionsMenuButton, .extensionsMenuButton, [id*="extensionsMenu"]');
    if (!hit) return;
    setTimeout(() => mountMenuItem('ดักตอนกด'), 60);
    setTimeout(() => mountMenuItem('ดักตอนกด รอบสอง'), 320);
}, true);

try {
    const obs = new MutationObserver(() => {
        if (findMenu() && !document.getElementById(MENU_ITEM_ID)) mountMenuItem('observer');
    });
    obs.observe(document.body, { childList: true, subtree: true });
} catch (err) {
    console.warn(`${LOG} MutationObserver ใช้ไม่ได้`, err);
}

window.STS_OPEN = openSheet;
window.STS_CLOSE = closeSheet;

/* ══════════ drawer ในหน้า Extensions ══════════ */

const PANEL_HTML = `
<div class="sts-settings" id="sts_panel">
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>⏱️ Screen Time Stats</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
      <div class="sts-stage-tag">v1.0.0</div>

      <label class="sts-field-label" for="sts_idle">
        Приостанавливать подсчёт после бездействия
        <span id="sts_idle_out" class="sts-value-pill">5 мин</span>
      </label>
      <input id="sts_idle" class="sts-range" type="range" min="1" max="60" step="1" value="5">

      <label class="sts-field-label" for="sts_goal">
        Дневная цель
        <span id="sts_goal_out" class="sts-value-pill">120 мин</span>
      </label>
      <input id="sts_goal" class="sts-range" type="range" min="15" max="480" step="15" value="120">

      <label class="sts-check">
        <input id="sts_hide" type="checkbox">
        <span>Скрывать имена персонажей в рейтинге для скриншотов</span>
      </label>

      <label class="sts-check">
        <input id="sts_fancy" type="checkbox">
        <span>Включить эффекты и анимации</span>
      </label>

      <label class="sts-check">
        <input id="sts_dev" type="checkbox">
        <span>Режим разработчика</span>
      </label>

      <div id="sts_devbox">
        <div class="sts-btn-row">
          <input id="sts_btn_seed" class="menu_button" type="button" value="Добавить демоданные">
          <input id="sts_btn_wipe" class="menu_button" type="button" value="Удалить демоданные">
        </div>
      </div>

      <hr class="sysHR">
      <input id="sts_btn_open" class="menu_button" type="button" value="Открыть графики">
      <p class="sts-hint">Открывается из меню расширений → «Время в чате». Цвета берутся из текущей темы.</p>
    </div>
  </div>
</div>`;

/** ★ ทาสีรางแถบเลื่อนตามค่าปัจจุบัน — ให้เห็นขีดทั้งธีมมืดและธีมขาว */
function paintRange(input) {
    if (!input) return;
    const min = Number(input.min) || 0;
    const max = Number(input.max) || 100;
    const val = Number(input.value) || min;
    const pct = ((val - min) / (max - min)) * 100;
    input.style.setProperty('--sts-pct', `${pct}%`);
}

function bindPanel() {
    const s = getSettings();

    const input = document.getElementById('sts_idle');
    const out = document.getElementById('sts_idle_out');
    if (input && out) {
        input.value = String(s.idleMinutes);
        out.textContent = `${s.idleMinutes} мин`;
        paintRange(input);
        input.addEventListener('input', () => {
            const v = Math.min(60, Math.max(1, Number(input.value) || 5));
            out.textContent = `${v} мин`;
            out.classList.remove('sts-pulse');
            void out.offsetWidth;
            out.classList.add('sts-pulse');
            paintRange(input);
            getSettings().idleMinutes = v;
            saveSettings();
        });
    }

    const goal = document.getElementById('sts_goal');
    const goalOut = document.getElementById('sts_goal_out');
    if (goal && goalOut) {
        goal.value = String(s.dailyGoalMin);
        goalOut.textContent = `${s.dailyGoalMin} мин`;
        paintRange(goal);
        goal.addEventListener('input', () => {
            const v = Math.min(480, Math.max(15, Number(goal.value) || 120));
            goalOut.textContent = `${v} мин`;
            goalOut.classList.remove('sts-pulse');
            void goalOut.offsetWidth;
            goalOut.classList.add('sts-pulse');
            paintRange(goal);
            getSettings().dailyGoalMin = v;
            saveSettings();
            if (document.getElementById('sts_dialog')?.open) renderSheet();
        });
    }

    const hide = document.getElementById('sts_hide');
    if (hide) {
        hide.checked = !!s.hideNames;
        hide.addEventListener('change', () => {
            getSettings().hideNames = hide.checked;
            saveSettings();
            if (document.getElementById('sts_dialog')?.open) renderSheet();
        });
    }

    const fancy = document.getElementById('sts_fancy');
    if (fancy) {
        fancy.checked = !!s.fancy;
        fancy.addEventListener('change', () => {
            getSettings().fancy = fancy.checked;
            saveSettings();
            if (document.getElementById('sts_dialog')?.open) renderSheet();
        });
    }

    const dev = document.getElementById('sts_dev');
    const devbox = document.getElementById('sts_devbox');
    if (dev && devbox) {
        dev.checked = !!s.devMode;
        devbox.classList.toggle('sts-shown', !!s.devMode);
        dev.addEventListener('change', () => {
            getSettings().devMode = dev.checked;
            saveSettings();
            devbox.classList.toggle('sts-shown', dev.checked);
        });
    }

    document.getElementById('sts_btn_seed')?.addEventListener('click', () => {
        seedDemo();
        if (document.getElementById('sts_dialog')?.open) renderSheet();
    });
    document.getElementById('sts_btn_wipe')?.addEventListener('click', () => {
        clearDemo();
        if (document.getElementById('sts_dialog')?.open) renderSheet();
    });
    document.getElementById('sts_btn_open')?.addEventListener('click', openSheet);
}

let panelTries = 0;
console.log(`${LOG} 2/3 เริ่มมองหาช่องใส่ panel`);
const stsPanelTimer = setInterval(() => {
    panelTries++;
    if (document.getElementById('sts_panel')) { clearInterval(stsPanelTimer); return; }
    const host = document.getElementById('extensions_settings2')
              || document.getElementById('extensions_settings');
    if (host) {
        host.insertAdjacentHTML('beforeend', PANEL_HTML);
        bindPanel();
        clearInterval(stsPanelTimer);
        window.STS_LOADED = 'ok';
        console.log(`${LOG} 3/3 ✅ panel ขึ้นแล้ว (รอบที่ ${panelTries})`);
        return;
    }
    if (panelTries >= 60) {
        clearInterval(stsPanelTimer);
        window.STS_LOADED = 'no-host';
        console.error(`${LOG} ❌ หา host element ไม่เจอใน 30 วิмин`);
    }
}, 500);

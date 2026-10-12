"use strict";
// Mesa Colisão RPG — servidor sem dependências externas (Node 20+).
// Contas, salas com código, fichas, combate, dados, roteiro, trilha e falas em tempo real (SSE).

const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
// Supabase: guarda tudo numa linha da tabela colisao_kv (veja o README). Sem as variáveis, usa um arquivo local.
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || "";
const USE_SUPABASE = !!(SUPABASE_URL && SUPABASE_KEY);
const DB_KEY = process.env.DB_KEY || "principal";
const PUBLIC = path.join(__dirname, "public");
const SEED = JSON.parse(fs.readFileSync(path.join(__dirname, "seed-vale-das-cinzas.json"), "utf8"));

// ---------------------------------------------------------------- utilidades
const now = () => Date.now();
const rid = (n = 9) => crypto.randomBytes(16).toString("base64url").replace(/[-_]/g, "").slice(0, n);
const str = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").slice(0, max);
const int = (v, min, max, def) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const DIE = { 1: 4, 2: 6, 3: 8, 4: 10 };
const d = s => crypto.randomInt(1, s + 1);
class Erro extends Error { constructor(status, msg) { super(msg); this.status = status; } }

// ---------------------------------------------------------------- armazenamento
let DB = { users: {}, byName: {}, sessions: {}, salas: {} };

const sbHeaders = () => ({ apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY, "Content-Type": "application/json" });
async function supabaseLer() {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/colisao_kv?id=eq.${encodeURIComponent(DB_KEY)}&select=data`, { headers: sbHeaders() });
  if (!r.ok) throw new Error(`Supabase respondeu ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const rows = await r.json();
  return rows[0]?.data || null;
}
async function supabaseGravar(obj) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/colisao_kv?on_conflict=id`, {
    method: "POST", headers: { ...sbHeaders(), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ id: DB_KEY, data: obj, atualizado_em: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error(`Supabase respondeu ${r.status}: ${(await r.text()).slice(0, 200)}`);
}
async function load() {
  let parsed = null;
  try {
    if (USE_SUPABASE) parsed = await supabaseLer();
    else { const raw = await fsp.readFile(path.join(DATA_DIR, "db.json"), "utf8").catch(() => null); parsed = raw ? JSON.parse(raw) : null; }
  } catch (e) { console.error("Falha ao carregar os dados:", e.message); throw e; }
  if (parsed) DB = { users: parsed.users || {}, byName: parsed.byName || {}, sessions: parsed.sessions || {}, salas: parsed.salas || {} };
  for (const [t, s] of Object.entries(DB.sessions)) if (s.exp < now()) delete DB.sessions[t];
  console.log(`Dados carregados (${USE_SUPABASE ? "Supabase" : "arquivo em " + DATA_DIR}): ${Object.keys(DB.users).length} contas, ${Object.keys(DB.salas).length} salas.`);
}
// ---- imagens (retratos, mapas, criaturas): Supabase Storage ou pasta local
const BUCKET = process.env.SUPABASE_BUCKET || "colisao";
const IMG_MIME = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
const imgCache = new Map(); // id -> {buf, mime}, guarda as 80 mais recentes
function cachear(id, v) { imgCache.delete(id); imgCache.set(id, v); if (imgCache.size > 80) imgCache.delete(imgCache.keys().next().value); }
async function garantirBucket() {
  if (!USE_SUPABASE) return;
  try {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, { method: "POST", headers: sbHeaders(), body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }) });
    if (r.ok) console.log(`Bucket "${BUCKET}" criado no Supabase.`);
  } catch (e) { console.error("Não consegui conferir o bucket de imagens:", e.message); }
}
async function imgSalvar(id, buf, mime) {
  if (USE_SUPABASE) {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${id}`, { method: "POST", headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY, "Content-Type": mime, "x-upsert": "true" }, body: buf });
    if (!r.ok) throw new Error(`Supabase Storage respondeu ${r.status}: ${(await r.text()).slice(0, 200)}`);
  } else {
    const dir = path.join(DATA_DIR, "img"); await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, `${id}.${IMG_MIME[mime]}`), buf);
  }
  cachear(id, { buf, mime });
}
async function imgLer(id) {
  if (imgCache.has(id)) { const v = imgCache.get(id); cachear(id, v); return v; }
  let v = null;
  if (USE_SUPABASE) {
    for (const rota of [`object/authenticated/${BUCKET}/${id}`, `object/${BUCKET}/${id}`]) {
      const r = await fetch(`${SUPABASE_URL}/storage/v1/${rota}`, { headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY } });
      if (r.ok) { v = { buf: Buffer.from(await r.arrayBuffer()), mime: (r.headers.get("content-type") || "image/jpeg").split(";")[0] }; break; }
    }
  } else {
    const dir = path.join(DATA_DIR, "img");
    for (const [mime, ext] of Object.entries(IMG_MIME)) {
      const buf = await fsp.readFile(path.join(dir, `${id}.${ext}`)).catch(() => null);
      if (buf) { v = { buf, mime }; break; }
    }
  }
  if (v) cachear(id, v);
  return v;
}

let saveT = null, saving = false, again = false;
function persist() { clearTimeout(saveT); saveT = setTimeout(flush, 1000); }
async function flush() {
  clearTimeout(saveT);
  if (saving) { again = true; return; }
  saving = true;
  try {
    if (USE_SUPABASE) await supabaseGravar(DB);
    else {
      const json = JSON.stringify(DB);
      await fsp.mkdir(DATA_DIR, { recursive: true });
      const tmp = path.join(DATA_DIR, "db.json.tmp");
      await fsp.writeFile(tmp, json);
      await fsp.rename(tmp, path.join(DATA_DIR, "db.json"));
    }
  } catch (e) { console.error("Falha ao salvar:", e.message); again = true; }
  saving = false;
  if (again) { again = false; saveT = setTimeout(flush, 3000); }
}

// ---------------------------------------------------------------- contas e sessões
const COOKIE = "colisao_sid";
const SESSION_DAYS = 30;
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString("hex");
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) { const i = part.indexOf("="); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}
function currentUser(req) {
  const t = parseCookies(req)[COOKIE]; if (!t) return null;
  const s = DB.sessions[t]; if (!s || s.exp < now()) return null;
  return DB.users[s.uid] || null;
}
function setSession(req, res, uid) {
  const t = crypto.randomBytes(32).toString("hex");
  DB.sessions[t] = { uid, exp: now() + SESSION_DAYS * 864e5 };
  const secure = (req.headers["x-forwarded-proto"] || "").includes("https") ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`);
  persist();
}
const tries = new Map();
function rateLimit(req) {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  const e = tries.get(ip) || { n: 0, t: now() };
  if (now() - e.t > 10 * 60e3) { e.n = 0; e.t = now(); }
  e.n++; tries.set(ip, e);
  if (e.n > 30) throw Error429();
}
function Error429() { return new Erro(429, "Muitas tentativas. Espere alguns minutos."); }

// ---------------------------------------------------------------- modelos
const TALENTOS = ["Medicina", "Quimica", "Estudo", "Sobrevivencia", "Engenharia", "Estrategia", "Biologia", "Luta", "Fortitude", "Acrobacia", "Artilharia", "Atletismo", "Reflexo", "Crime", "Eloquencia", "Psique", "Performance"];
const ESTADOS = ["Machucado", "Lesionado", "Quebrado", "Sobrecarregado", "Em Panico", "Encarnacao Sombrosa"];
const SONS = ["voz-monstro", "voz-monstro-extremo", "sino", "ambiente", "batimento", "rosnado"];

function novaFicha(dono, nome) {
  return {
    id: "f" + rid(), dono, nome: str(nome, 60) || "Sem nome",
    idade: "", nacionalidade: "", ocupacao: "", estadoCivil: "", nascimento: "", rota: "", arquivo: "", patente: 1,
    pv: 20, pvMax: 20, caBase: 8, desviando: false, mov: 6, movMax: 6, tormento: 0,
    fisico: 1, influencia: 1, tecnica: 1,
    expertises: ["", "", "", "", "", ""], chamado: "", estados: {},
    vontade: 10, vontadeMax: 10, medo: 0, medoMax: 10, talentos: {},
    rituais: [0, 1, 2, 3].map(() => ({ nome: "", desc: "" })), habilidades: [0, 1, 2, 3].map(() => ({ nome: "", desc: "" })),
    notas: "", iniciativa: null, criadoEm: now(), atualizadoEm: now(),
  };
}
const FICHA_STR = { nome: 60, idade: 20, nacionalidade: 60, ocupacao: 60, estadoCivil: 40, nascimento: 20, rota: 60, arquivo: 30, chamado: 200, notas: 4000, aparencia: 800 };
// Imagem: "b:/mapas/x.jpg" (arte que vem com o app) ou "u:<id>" (enviada por alguém)
const IMG_RE = /^(b:\/(mapas|tokens)\/[a-z0-9-]{1,60}\.(jpg|png|webp|svg)|u:[A-Za-z0-9]{12,32})$/;
function imgRef(v) { const s = String(v ?? ""); if (s === "") return ""; if (!IMG_RE.test(s)) throw new Erro(400, "Imagem inválida."); return s; }
const FICHA_NUM = { patente: [1, 10], pv: [-99, 999], pvMax: [1, 999], caBase: [0, 50], mov: [0, 99], movMax: [0, 99], tormento: [0, 10], fisico: [1, 4], influencia: [1, 4], tecnica: [1, 4], vontade: [0, 99], vontadeMax: [1, 99], medo: [0, 99], medoMax: [1, 99] };
function setFichaCampo(f, key, value) {
  const parts = String(key).split(".");
  const [a, b, c] = parts;
  if (parts.length === 1) {
    if (a in FICHA_STR) { f[a] = str(value, FICHA_STR[a]); if (a === "nome" && !f.nome.trim()) f.nome = "Sem nome"; return; }
    if (a in FICHA_NUM) { const [mn, mx] = FICHA_NUM[a]; f[a] = int(value, mn, mx, f[a]); return; }
    if (a === "desviando") { f.desviando = !!value; return; }
    if (a === "retrato") { f.retrato = imgRef(value); return; }
    if (a === "iniciativa") { f.iniciativa = value === null || value === "" ? null : int(value, -99, 999, null); return; }
  }
  if (parts.length === 2 && a === "expertises") { const i = int(b, 0, 5, -1); if (i >= 0 && String(i) === b) { f.expertises[i] = str(value, 120); return; } }
  if (parts.length === 2 && a === "talentos" && TALENTOS.includes(b)) { const n = int(value, 0, 10, 0); if (n) f.talentos[b] = n; else delete f.talentos[b]; return; }
  if (parts.length === 2 && a === "estados" && ESTADOS.includes(b)) { if (value) f.estados[b] = true; else delete f.estados[b]; return; }
  if (parts.length === 3 && (a === "rituais" || a === "habilidades") && (c === "nome" || c === "desc")) {
    const i = int(b, 0, 3, -1); if (i >= 0 && String(i) === b) { f[a][i][c] = str(value, c === "nome" ? 80 : 1500); return; }
  }
  throw new Erro(400, "Campo desconhecido: " + key);
}
function novaCriatura(dados) {
  const pvMax = int(dados.pvMax, 1, 9999, 20);
  return { id: "c" + rid(), nome: str(dados.nome, 60) || "Criatura", pv: int(dados.pv, -999, 9999, pvMax), pvMax, caBase: int(dados.caBase, 0, 50, 8),
    tecnica: int(dados.tecnica, 1, 4, 1), oculto: dados.oculto !== false, desviando: false, iniciativa: null, notas: str(dados.notas, 2000),
    imagem: dados.imagem ? imgRef(dados.imagem) : "", criadoEm: now() };
}
function novaCena(dados) {
  return { id: "s" + rid(), nome: str(dados.nome, 60) || "Nova cena", mapa: dados.mapa ? imgRef(dados.mapa) : "", grade: !!dados.grade, tokens: [], criadaEm: now() };
}
function cenaDe(sala, id) { const c = (sala.cenas || []).find(x => x.id === id); if (!c) throw new Erro(404, "Cena não encontrada."); return c; }
function refValida(sala, ref) {
  const [t, id] = String(ref).split(":");
  if (t === "ficha" && sala.fichas[id]) return `ficha:${id}`;
  if (t === "criatura" && sala.criaturas[id]) return `criatura:${id}`;
  throw new Erro(404, "Personagem não encontrado.");
}
const pos = v => clamp(Number(v) || 0, 0, 1);
const CRIA_STR = { nome: 60, notas: 2000 };
const CRIA_NUM = { pv: [-999, 9999], pvMax: [1, 9999], caBase: [0, 50], tecnica: [1, 4] };
function setCriaturaCampo(cr, key, value) {
  if (key in CRIA_STR) { cr[key] = str(value, CRIA_STR[key]) || (key === "nome" ? "Criatura" : ""); return; }
  if (key in CRIA_NUM) { const [mn, mx] = CRIA_NUM[key]; cr[key] = int(value, mn, mx, cr[key]); return; }
  if (key === "oculto" || key === "desviando") { cr[key] = !!value; return; }
  if (key === "imagem") { cr.imagem = imgRef(value); return; }
  if (key === "iniciativa") { cr.iniciativa = value === null || value === "" ? null : int(value, -99, 999, null); return; }
  throw new Erro(400, "Campo desconhecido: " + key);
}
function sanitizeRoteiro(r) {
  const cenas = (Array.isArray(r?.cenas) ? r.cenas : []).slice(0, 60).map(c => ({
    id: str(c?.id, 20) || rid(), titulo: str(c?.titulo, 120), resumo: str(c?.resumo, 6000),
    pistas: (Array.isArray(c?.pistas) ? c.pistas : []).slice(0, 40).map(p => ({ id: str(p?.id, 20) || rid(), texto: str(p?.texto, 2000), teste: str(p?.teste, 120), revelada: !!p?.revelada })),
  }));
  const npcs = (Array.isArray(r?.npcs) ? r.npcs : []).slice(0, 80).map(n => ({ id: str(n?.id, 20) || rid(), nome: str(n?.nome, 80), texto: str(n?.texto, 3000) }));
  const falas = (Array.isArray(r?.falas) ? r.falas : []).slice(0, 80).map(f => ({ id: str(f?.id, 20) || rid(), texto: str(f?.texto, 400) }));
  return { cenas, npcs, falas };
}
function novaSala(uid, nome, modelo) {
  const ALFA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let codigo;
  do { codigo = Array.from({ length: 6 }, () => ALFA[crypto.randomInt(ALFA.length)]).join(""); } while (DB.salas[codigo]);
  const sala = {
    codigo, nome: str(nome, 60) || "Mesa de Colisão", mestre: uid, jogadores: [], criadaEm: now(),
    fichas: {}, criaturas: {}, combate: { ativo: false, rodada: 0, turnoId: null },
    rolagens: [], pistas: [], destaque: null, roteiro: { cenas: [], npcs: [], falas: [] }, cenas: [], cenaAtiva: null,
  };
  if (modelo === "vale") {
    sala.roteiro = sanitizeRoteiro(SEED.roteiro);
    const criadas = SEED.criaturas.map(c => { const cr = novaCriatura(c); sala.criaturas[cr.id] = cr; return cr; });
    for (const sc of SEED.cenas || []) {
      const cena = novaCena(sc);
      for (const t of sc.tokens || []) { const cr = criadas[t.criatura]; if (cr) cena.tokens.push({ id: "t" + rid(), ref: `criatura:${cr.id}`, x: t.x, y: t.y, tam: t.tam || 1, visivel: !!t.visivel }); }
      sala.cenas.push(cena);
    }
    sala.cenaAtiva = sala.cenas[0]?.id || null;
  }
  DB.salas[codigo] = sala;
  return sala;
}

// ---------------------------------------------------------------- visão por pessoa
function bucketPv(e) { const max = Math.max(1, e.pvMax), r = e.pv / max; return r <= 0 ? 0 : r <= 0.25 ? 1 : r <= 0.6 ? 2 : r < 1 ? 3 : 4; }
function viewFor(sala, uid) {
  const gm = sala.mestre === uid;
  const membros = [sala.mestre, ...sala.jogadores].map(id => ({ id, usuario: DB.users[id]?.usuario || "?", mestre: id === sala.mestre }));
  const fichas = Object.values(sala.fichas).map(f => {
    if (gm || f.dono === uid) return f;
    const { id, dono, nome, pv, pvMax, caBase, desviando, medo, medoMax, vontade, vontadeMax, iniciativa, tecnica, criadoEm, retrato, aparencia } = f;
    return { id, dono, nome, pv, pvMax, caBase, desviando, medo, medoMax, vontade, vontadeMax, iniciativa, tecnica, criadoEm, retrato, aparencia, resumo: true };
  });
  const criaturas = Object.values(sala.criaturas).map(c => {
    if (gm || !c.oculto) return gm ? c : { ...c, notas: "" };
    return { id: c.id, nome: c.nome, oculto: true, pv: bucketPv(c), pvMax: 4, caBase: null, desviando: c.desviando, iniciativa: c.iniciativa, imagem: c.imagem, criadoEm: c.criadoEm };
  });
  // Players veem só a cena ativa, e só os tokens visíveis
  const todas = sala.cenas || [];
  const cenas = gm ? todas : todas.filter(c => c.id === sala.cenaAtiva).map(c => ({ ...c, tokens: c.tokens.filter(t => t.visivel) }));
  return {
    codigo: sala.codigo, nome: sala.nome, souMestre: gm, eu: uid, membros, fichas, criaturas, combate: sala.combate,
    rolagens: sala.rolagens.filter(r => gm || !r.soMestre || r.by === uid), pistas: sala.pistas, destaque: sala.destaque,
    roteiro: gm ? sala.roteiro : null, online: [...(conns.get(sala.codigo) || [])].length,
    cenas, cenaAtiva: sala.cenaAtiva || null,
  };
}

// ---------------------------------------------------------------- tempo real (SSE)
const conns = new Map(); // codigo -> Set<{uid, res}>
const pendingPush = new Set();
function sse(res, ev, data) { try { res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); } catch (e) {} }
function push(codigo) {
  if (pendingPush.has(codigo)) return;
  pendingPush.add(codigo);
  setImmediate(() => {
    pendingPush.delete(codigo);
    const sala = DB.salas[codigo], set = conns.get(codigo); if (!set) return;
    for (const c of set) { if (sala) sse(c.res, "estado", viewFor(sala, c.uid)); else { sse(c.res, "fim", { motivo: "A sala foi apagada." }); c.res.end(); } }
  });
}
function broadcast(codigo, ev, data) { for (const c of conns.get(codigo) || []) sse(c.res, ev, data); }
setInterval(() => { for (const set of conns.values()) for (const c of set) { try { c.res.write(": ping\n\n"); } catch (e) {} } }, 25e3).unref();

// Áudios gravados pelo Mestre (só em memória, somem em 1 hora)
const clips = new Map(); // id -> {codigo, buf, mime, t}
setInterval(() => { for (const [id, c] of clips) if (now() - c.t > 3600e3) clips.delete(id); }, 300e3).unref();

// ---------------------------------------------------------------- rolagens
function rolagemTeste(dados) {
  const pts = int(dados.pts, 1, 4, 1), lados = DIE[pts];
  const n = int(dados.n, 1, 6, 1) + (dados.tenacidade ? 1 : 0);
  const vant = int(dados.vant, 0, 5, 0), desv = int(dados.desv, 0, 5, 0);
  const res = [];
  for (let i = 0; i < n; i++) res.push({ l: lados, v: d(lados), k: "m" });
  for (let i = 0; i < vant; i++) res.push({ l: 4, v: d(4), k: "v" });
  for (let i = 0; i < desv; i++) res.push({ l: 4, v: d(4), k: "d" });
  const total = res.reduce((s, x) => s + (x.k === "d" ? -x.v : x.v), 0);
  const main = res.filter(x => x.k === "m").map(x => x.v);
  const critico = main.length >= 2 && new Set(main).size < main.length;
  const rot = str(dados.rotulo, 50).trim();
  return { rotulo: rot ? "Teste de " + rot : `Teste (${n}d${lados})`, dados: res, total, critico };
}
function rolagemLivre(dados) {
  const l = [4, 6, 8, 10, 12, 20, 100].includes(Number(dados.lados)) ? Number(dados.lados) : 20;
  const q = int(dados.qtd, 1, 20, 1), mod = int(dados.mod, -99, 99, 0);
  const res = Array.from({ length: q }, () => ({ l, v: d(l), k: "m" }));
  return { rotulo: `${q}d${l}${mod ? (mod > 0 ? "+" : "") + mod : ""}`, dados: res, total: res.reduce((s, x) => s + x.v, 0) + mod, critico: false };
}
function addRolagem(sala, r) { sala.rolagens.unshift({ id: rid(), ts: now(), ...r }); sala.rolagens = sala.rolagens.slice(0, 50); }

// ---------------------------------------------------------------- ações da sala
function entidade(sala, tipo, id) {
  const e = tipo === "criatura" ? sala.criaturas[id] : sala.fichas[id];
  if (!e) throw new Erro(404, "Não encontrei esse personagem.");
  return e;
}
function podeEditarFicha(sala, uid, f) { return sala.mestre === uid || f.dono === uid; }
function ordemCombate(sala) {
  const list = [...Object.values(sala.fichas).map(f => ({ ...f, tipo: "ficha" })), ...Object.values(sala.criaturas).map(c => ({ ...c, tipo: "criatura" }))];
  return list.sort((a, b) => (b.iniciativa ?? -99) - (a.iniciativa ?? -99) || String(a.nome).localeCompare(b.nome));
}
function rolarIniciativa(sala, tipo, e, autor) {
  const t = clamp(e.tecnica || 1, 1, 4), v = d(DIE[t]);
  e.iniciativa = v;
  addRolagem(sala, { by: autor, quem: e.nome, rotulo: "Iniciativa (Técnica)", dados: [{ l: DIE[t], v, k: "m" }], total: v, critico: false, gm: false, soMestre: tipo === "criatura" && e.oculto });
}

function acao(sala, user, body) {
  const uid = user.id, gm = sala.mestre === uid, tipo = String(body.tipo || "");
  const soMestre = () => { if (!gm) throw new Erro(403, "Só o Mestre pode fazer isso."); };
  let resposta = { ok: true };
  switch (tipo) {
    case "ficha.criar": {
      if (!gm && Object.values(sala.fichas).some(f => f.dono === uid)) throw new Erro(400, "Você já tem uma ficha nesta sala.");
      if (Object.keys(sala.fichas).length >= 40) throw new Erro(400, "A sala já tem fichas demais.");
      const f = novaFicha(uid, body.nome); sala.fichas[f.id] = f; resposta.id = f.id; break;
    }
    case "ficha.atualizar": {
      const f = entidade(sala, "ficha", body.id);
      if (!podeEditarFicha(sala, uid, f)) throw new Erro(403, "Você só pode editar a sua ficha.");
      const campos = body.campos && typeof body.campos === "object" ? Object.entries(body.campos).slice(0, 40) : [];
      for (const [k, v] of campos) setFichaCampo(f, k, v);
      f.atualizadoEm = now(); break;
    }
    case "ficha.apagar": {
      const f = entidade(sala, "ficha", body.id);
      if (!podeEditarFicha(sala, uid, f)) throw new Erro(403, "Você só pode apagar a sua ficha.");
      delete sala.fichas[f.id];
      for (const c of sala.cenas || []) c.tokens = c.tokens.filter(t => t.ref !== `ficha:${f.id}`);
      break;
    }
    case "ficha.dono": { soMestre(); const f = entidade(sala, "ficha", body.id); const novo = String(body.dono || ""); if (novo && novo !== sala.mestre && !sala.jogadores.includes(novo)) throw new Erro(400, "Essa pessoa não está na sala."); f.dono = novo || sala.mestre; break; }
    case "criatura.criar": { soMestre(); if (Object.keys(sala.criaturas).length >= 60) throw new Erro(400, "Criaturas demais na sala."); const c = novaCriatura(body); sala.criaturas[c.id] = c; break; }
    case "criatura.atualizar": { soMestre(); const c = entidade(sala, "criatura", body.id); for (const [k, v] of Object.entries(body.campos || {}).slice(0, 20)) setCriaturaCampo(c, k, v); break; }
    case "criatura.apagar": {
      soMestre(); delete sala.criaturas[body.id];
      for (const c of sala.cenas || []) c.tokens = c.tokens.filter(t => t.ref !== `criatura:${body.id}`);
      break;
    }
    case "ajustar": {
      const t = body.alvo === "criatura" ? "criatura" : "ficha", e = entidade(sala, t, body.id);
      if (t === "criatura" ? !gm : !podeEditarFicha(sala, uid, e)) throw new Erro(403, "Você não pode mexer nesse personagem.");
      const campo = String(body.campo), delta = int(body.delta, -999, 999, 0);
      const lim = { pv: [-999, e.pvMax], medo: [0, e.medoMax ?? 99], vontade: [0, (e.vontadeMax ?? 10) + 20], tormento: [0, 10], mov: [0, 99] }[campo];
      if (!lim || (t === "criatura" && campo !== "pv")) throw new Erro(400, "Campo inválido.");
      e[campo] = clamp((Number(e[campo]) || 0) + delta, lim[0], lim[1]);
      resposta.valor = e[campo]; break;
    }
    case "desviar": {
      const t = body.alvo === "criatura" ? "criatura" : "ficha", e = entidade(sala, t, body.id);
      if (t === "criatura" ? !gm : !podeEditarFicha(sala, uid, e)) throw new Erro(403, "Você não pode mexer nesse personagem.");
      e.desviando = !e.desviando; break;
    }
    case "iniciativa": {
      const t = body.alvo === "criatura" ? "criatura" : "ficha", e = entidade(sala, t, body.id);
      if (t === "criatura" ? !gm : !podeEditarFicha(sala, uid, e)) throw new Erro(403, "Você não pode rolar por esse personagem.");
      rolarIniciativa(sala, t, e, uid); break;
    }
    case "combate.iniciar": {
      soMestre();
      for (const f of Object.values(sala.fichas)) if (f.iniciativa == null) rolarIniciativa(sala, "ficha", f, uid);
      for (const c of Object.values(sala.criaturas)) if (c.iniciativa == null) rolarIniciativa(sala, "criatura", c, uid);
      const o = ordemCombate(sala);
      sala.combate = { ativo: true, rodada: 1, turnoId: o[0]?.id || null }; break;
    }
    case "combate.rolarTodos": {
      soMestre();
      for (const f of Object.values(sala.fichas)) rolarIniciativa(sala, "ficha", f, uid);
      for (const c of Object.values(sala.criaturas)) rolarIniciativa(sala, "criatura", c, uid);
      break;
    }
    case "combate.proximo": {
      soMestre();
      const o = ordemCombate(sala).filter(x => x.tipo === "ficha" || x.pv > 0); if (!o.length) break;
      let i = o.findIndex(x => x.id === sala.combate.turnoId), rodada = sala.combate.rodada || 1;
      i++; if (i >= o.length) { i = 0; rodada++; }
      const nx = o[i], real = nx.tipo === "criatura" ? sala.criaturas[nx.id] : sala.fichas[nx.id];
      if (real) real.desviando = false;
      sala.combate = { ativo: true, rodada, turnoId: nx.id }; break;
    }
    case "combate.encerrar": {
      soMestre(); sala.combate = { ativo: false, rodada: 0, turnoId: null };
      for (const e of [...Object.values(sala.fichas), ...Object.values(sala.criaturas)]) { e.desviando = false; e.iniciativa = null; }
      break;
    }
    case "rolar": {
      const r = body.modo === "livre" ? rolagemLivre(body) : rolagemTeste(body);
      const ficha = Object.values(sala.fichas).find(f => f.dono === uid);
      const quem = gm ? "Mestre" : (ficha?.nome || user.usuario);
      const secreto = gm && !!body.secreto;
      addRolagem(sala, { by: uid, quem, gm, soMestre: secreto, secreto, ...r });
      resposta.rolagem = sala.rolagens[0]; break;
    }
    case "rolagens.limpar": soMestre(); sala.rolagens = []; break;
    case "roteiro.salvar": {
      soMestre();
      if (JSON.stringify(body.roteiro || {}).length > 400e3) throw new Erro(400, "O roteiro ficou grande demais.");
      sala.roteiro = sanitizeRoteiro(body.roteiro); break;
    }
    case "pista.revelar": {
      soMestre();
      const id = str(body.id, 30) || rid(), texto = str(body.texto, 2000).trim();
      if (!texto) throw new Erro(400, "Escreva o texto da pista antes de revelar.");
      sala.pistas = sala.pistas.filter(p => p.id !== id);
      sala.pistas.unshift({ id, texto, cena: str(body.cena, 120), ts: now() });
      sala.pistas = sala.pistas.slice(0, 200); break;
    }
    case "pista.esconder": soMestre(); sala.pistas = sala.pistas.filter(p => p.id !== String(body.id)); break;
    case "destaque": {
      soMestre();
      sala.destaque = body.ativo ? { ativo: true, tipo: body.tipoDestaque === "pista" ? "pista" : "npc", nome: str(body.nome, 120), texto: str(body.texto, 2000), ts: now() } : null;
      break;
    }
    case "som": {
      soMestre();
      const som = SONS.includes(body.som) ? body.som : null;
      broadcast(sala.codigo, "som", { acao: body.acao === "parar" ? "parar" : "tocar", som });
      return resposta; // sem mudança de estado
    }
    case "fala": {
      soMestre();
      const texto = str(body.texto, 400).trim(); if (!texto) throw new Erro(400, "Escreva a fala primeiro.");
      broadcast(sala.codigo, "fala", { tipo: "texto", texto, grave: clamp(Number(body.grave) || 0.1, 0, 1), velocidade: clamp(Number(body.velocidade) || 0.75, 0.4, 1.2), rosnado: body.rosnado !== false, legenda: body.legenda !== false, quem: str(body.quem, 60) });
      return resposta;
    }
    case "jogador.remover": {
      soMestre();
      const alvo = String(body.uid); sala.jogadores = sala.jogadores.filter(j => j !== alvo);
      for (const c of [...(conns.get(sala.codigo) || [])]) if (c.uid === alvo) { sse(c.res, "fim", { motivo: "O Mestre te removeu da sala." }); c.res.end(); }
      break;
    }
    case "sala.renomear": soMestre(); sala.nome = str(body.nome, 60) || sala.nome; break;

    // ---- cenas e tokens (aba Mesa)
    case "cena.criar": {
      soMestre(); sala.cenas = sala.cenas || [];
      if (sala.cenas.length >= 30) throw new Erro(400, "A sala já tem cenas demais.");
      const c = novaCena(body); sala.cenas.push(c); if (!sala.cenaAtiva) sala.cenaAtiva = c.id; resposta.id = c.id; break;
    }
    case "cena.atualizar": {
      soMestre(); const c = cenaDe(sala, body.id), k = body.campos || {};
      if ("nome" in k) c.nome = str(k.nome, 60) || c.nome;
      if ("mapa" in k) c.mapa = imgRef(k.mapa);
      if ("grade" in k) c.grade = !!k.grade;
      break;
    }
    case "cena.apagar": {
      soMestre(); sala.cenas = (sala.cenas || []).filter(c => c.id !== body.id);
      if (sala.cenaAtiva === body.id) sala.cenaAtiva = sala.cenas[0]?.id || null; break;
    }
    case "cena.ativar": soMestre(); sala.cenaAtiva = cenaDe(sala, body.id).id; break;
    case "token.colocar": {
      soMestre(); const c = cenaDe(sala, body.cena), ref = refValida(sala, body.ref);
      if (c.tokens.some(t => t.ref === ref)) throw new Erro(400, "Esse personagem já está na cena.");
      if (c.tokens.length >= 60) throw new Erro(400, "Tokens demais nesta cena.");
      c.tokens.push({ id: "t" + rid(), ref, x: pos(body.x ?? .5), y: pos(body.y ?? .5), tam: 1, visivel: body.visivel !== false }); break;
    }
    case "token.mover": {
      const c = cenaDe(sala, body.cena), t = c.tokens.find(x => x.id === body.token);
      if (!t) throw new Erro(404, "Token não encontrado.");
      const [tipo, eid] = t.ref.split(":");
      const dono = tipo === "ficha" && sala.fichas[eid]?.dono === uid;
      if (!gm && !(dono && sala.cenaAtiva === c.id && t.visivel)) throw new Erro(403, "Você só pode mover o seu personagem.");
      t.x = pos(body.x); t.y = pos(body.y); break;
    }
    case "token.ajustar": {
      soMestre(); const c = cenaDe(sala, body.cena), t = c.tokens.find(x => x.id === body.token);
      if (!t) throw new Erro(404, "Token não encontrado.");
      if ("visivel" in body) t.visivel = !!body.visivel;
      if ("tam" in body) t.tam = clamp(Number(body.tam) || 1, 0.5, 4);
      break;
    }
    case "token.remover": { soMestre(); const c = cenaDe(sala, body.cena); c.tokens = c.tokens.filter(t => t.id !== body.token); break; }
    case "sala.apagar": {
      soMestre(); delete DB.salas[sala.codigo];
      for (const c of [...(conns.get(sala.codigo) || [])]) { sse(c.res, "fim", { motivo: "A sala foi apagada." }); c.res.end(); }
      conns.delete(sala.codigo); persist(); return resposta;
    }
    default: throw new Erro(400, "Ação desconhecida.");
  }
  persist(); push(sala.codigo);
  return resposta;
}

// ---------------------------------------------------------------- HTTP
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".mp3": "audio/mpeg", ".pdf": "application/pdf", ".json": "application/json", ".ico": "image/x-icon", ".svg": "image/svg+xml" };
function send(res, status, obj) { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(obj)); }
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on("data", c => { size += c.length; if (size > limit) { reject(new Erro(413, "Arquivo grande demais.")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
async function readJson(req) { const b = await readBody(req, 512e3); try { return JSON.parse(b.toString("utf8") || "{}"); } catch (e) { throw new Erro(400, "Pedido inválido."); } }
function precisaLogin(req) { const u = currentUser(req); if (!u) throw new Erro(401, "Entre na sua conta."); return u; }
function salaDe(codigo, u) {
  const sala = DB.salas[String(codigo || "").toUpperCase()];
  if (!sala) throw new Erro(404, "Sala não encontrada. Confira o código.");
  if (sala.mestre !== u.id && !sala.jogadores.includes(u.id)) throw new Erro(403, "Você não está nesta sala. Entre com o código.");
  return sala;
}

async function serveStatic(req, res, pathname) {
  let p = pathname === "/" ? "/index.html" : pathname;
  const file = path.normalize(path.join(PUBLIC, decodeURIComponent(p)));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    const st = await fsp.stat(file); if (!st.isFile()) throw 0;
    const ext = path.extname(file).toLowerCase();
    const headers = { "Content-Type": MIME[ext] || "application/octet-stream", "Content-Length": st.size, "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=86400" };
    const range = req.headers.range;
    if (range && ext === ".mp3") {
      const m = /bytes=(\d*)-(\d*)/.exec(range); let start = m && m[1] ? +m[1] : 0, end = m && m[2] ? +m[2] : st.size - 1;
      end = Math.min(end, st.size - 1);
      res.writeHead(206, { ...headers, "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${st.size}`, "Accept-Ranges": "bytes" });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, "Accept-Ranges": "bytes" });
    fs.createReadStream(file).pipe(res);
  } catch (e) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("Não encontrado"); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x"); const p = url.pathname, m = req.method;
  try {
    if (!p.startsWith("/api/")) { if (m !== "GET" && m !== "HEAD") { res.writeHead(405); return res.end(); } return serveStatic(req, res, p); }
    if (m === "POST") { const o = req.headers.origin; if (o && new URL(o).host !== req.headers.host) throw new Erro(403, "Origem não permitida."); }

    if (p === "/api/saude") return send(res, 200, { ok: true });
    if (p === "/api/eu" && m === "GET") { const u = currentUser(req); return send(res, 200, { usuario: u ? { id: u.id, usuario: u.usuario } : null }); }
    if (p === "/api/cadastro" && m === "POST") {
      rateLimit(req);
      const b = await readJson(req);
      const usuario = str(b.usuario, 30).trim(), senha = String(b.senha || "");
      if (!/^[\p{L}\p{N}_.-]{3,30}$/u.test(usuario)) throw new Erro(400, "O nome de usuário precisa ter de 3 a 30 letras, números, ponto, traço ou _.");
      if (senha.length < 6 || senha.length > 200) throw new Erro(400, "A senha precisa ter pelo menos 6 caracteres.");
      const key = usuario.toLowerCase(); if (DB.byName[key]) throw new Erro(409, "Esse nome de usuário já existe. Escolha outro.");
      const id = "u" + rid(12), salt = crypto.randomBytes(16).toString("hex");
      DB.users[id] = { id, usuario, salt, hash: hashPw(senha, salt), criadoEm: now() }; DB.byName[key] = id;
      setSession(req, res, id); return send(res, 200, { usuario: { id, usuario } });
    }
    if (p === "/api/login" && m === "POST") {
      rateLimit(req);
      const b = await readJson(req);
      const id = DB.byName[str(b.usuario, 30).trim().toLowerCase()], u = id && DB.users[id];
      const ok = u && crypto.timingSafeEqual(Buffer.from(hashPw(String(b.senha || ""), u.salt), "hex"), Buffer.from(u.hash, "hex"));
      if (!ok) throw new Erro(401, "Usuário ou senha incorretos.");
      setSession(req, res, u.id); return send(res, 200, { usuario: { id: u.id, usuario: u.usuario } });
    }
    if (p === "/api/sair" && m === "POST") {
      const t = parseCookies(req)[COOKIE]; if (t) { delete DB.sessions[t]; persist(); }
      res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`); return send(res, 200, { ok: true });
    }

    const u = precisaLogin(req);
    if (p === "/api/salas" && m === "GET") {
      const salas = Object.values(DB.salas).filter(s => s.mestre === u.id || s.jogadores.includes(u.id))
        .map(s => ({ codigo: s.codigo, nome: s.nome, souMestre: s.mestre === u.id, mestre: DB.users[s.mestre]?.usuario || "?", jogadores: s.jogadores.length, criadaEm: s.criadaEm }))
        .sort((a, b) => b.criadaEm - a.criadaEm);
      return send(res, 200, { salas });
    }
    if (p === "/api/salas" && m === "POST") {
      const b = await readJson(req);
      if (Object.values(DB.salas).filter(s => s.mestre === u.id).length >= 20) throw new Erro(400, "Você já tem 20 salas. Apague alguma antes.");
      const sala = novaSala(u.id, b.nome, b.modelo === "vale" ? "vale" : "vazia"); persist();
      return send(res, 200, { codigo: sala.codigo });
    }
    if (p === "/api/salas/entrar" && m === "POST") {
      const b = await readJson(req); const codigo = str(b.codigo, 10).trim().toUpperCase();
      const sala = DB.salas[codigo]; if (!sala) throw new Erro(404, "Sala não encontrada. Confira o código.");
      if (sala.mestre !== u.id && !sala.jogadores.includes(u.id)) { if (sala.jogadores.length >= 12) throw new Erro(400, "A sala está cheia."); sala.jogadores.push(u.id); persist(); push(codigo); }
      return send(res, 200, { codigo });
    }
    const mi = /^\/api\/img\/([A-Za-z0-9]{12,32})$/.exec(p);
    if (mi && m === "GET") {
      const v = await imgLer(mi[1]); if (!v) throw new Erro(404, "Imagem não encontrada.");
      res.writeHead(200, { "Content-Type": v.mime, "Content-Length": v.buf.length, "Cache-Control": "private, max-age=604800, immutable" });
      return res.end(v.buf);
    }
    const mm = /^\/api\/salas\/([A-Za-z0-9]{4,10})\/(eventos|acao|fala-audio|sair|imagem)$/.exec(p) || /^\/api\/salas\/([A-Za-z0-9]{4,10})\/(audio)\/([A-Za-z0-9]{4,20})$/.exec(p);
    if (mm) {
      const sala = salaDe(mm[1], u), rota = mm[2];
      if (rota === "eventos" && m === "GET") {
        res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
        res.write("retry: 3000\n\n");
        const c = { uid: u.id, res };
        if (!conns.has(sala.codigo)) conns.set(sala.codigo, new Set());
        conns.get(sala.codigo).add(c);
        sse(res, "estado", viewFor(sala, u.id)); push(sala.codigo);
        req.on("close", () => { const s = conns.get(sala.codigo); if (s) { s.delete(c); if (!s.size) conns.delete(sala.codigo); } push(sala.codigo); });
        return;
      }
      if (rota === "acao" && m === "POST") return send(res, 200, acao(sala, u, await readJson(req)));
      if (rota === "sair" && m === "POST") {
        if (sala.mestre === u.id) throw new Erro(400, "O Mestre não sai da própria sala. Você pode apagá-la.");
        sala.jogadores = sala.jogadores.filter(j => j !== u.id); persist(); push(sala.codigo); return send(res, 200, { ok: true });
      }
      if (rota === "fala-audio" && m === "POST") {
        if (sala.mestre !== u.id) throw new Erro(403, "Só o Mestre pode enviar falas.");
        const buf = await readBody(req, 4 * 1024 * 1024); if (buf.length < 100) throw new Erro(400, "A gravação ficou vazia.");
        const mime = /^audio\/[a-z0-9.+-]+/i.exec(String(req.headers["content-type"] || ""))?.[0] || "audio/webm";
        const id = rid(12); clips.set(id, { codigo: sala.codigo, buf, mime, t: now() });
        const grave = clamp(Number(url.searchParams.get("grave")) || 0.7, 0.4, 1), dist = clamp(Number(url.searchParams.get("dist")) || 0, 0, 1), eco = clamp(Number(url.searchParams.get("eco")) || 0, 0, 1);
        broadcast(sala.codigo, "fala", { tipo: "audio", id, grave, dist, eco });
        return send(res, 200, { ok: true, id });
      }
      if (rota === "imagem" && m === "POST") {
        const mime = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
        if (!IMG_MIME[mime]) throw new Erro(415, "Envie uma imagem PNG, JPG, WEBP ou GIF.");
        sala.imagens = (sala.imagens || 0) + 1;
        if (sala.imagens > 500) throw new Erro(400, "Esta sala já enviou imagens demais.");
        const buf = await readBody(req, 4 * 1024 * 1024); if (buf.length < 50) throw new Erro(400, "A imagem veio vazia.");
        const id = rid(20);
        try { await imgSalvar(id, buf, mime); } catch (e) { console.error(e.message); throw new Erro(502, "Não consegui guardar a imagem. Tente de novo."); }
        persist(); return send(res, 200, { ref: "u:" + id });
      }
      if (rota === "audio" && m === "GET") {
        const c = clips.get(mm[3]); if (!c || c.codigo !== sala.codigo) throw new Erro(404, "Essa fala já expirou.");
        res.writeHead(200, { "Content-Type": c.mime, "Content-Length": c.buf.length, "Cache-Control": "private, max-age=3600" }); return res.end(c.buf);
      }
    }
    throw new Erro(404, "Rota não encontrada.");
  } catch (e) {
    if (!(e instanceof Erro)) console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { erro: e instanceof Erro ? e.message : "Erro no servidor. Tente de novo." });
    else try { res.end(); } catch (er) {}
  }
});

async function shutdown() { console.log("Salvando antes de desligar…"); try { await flush(); } catch (e) {} process.exit(0); }
process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);

load().then(garantirBucket).then(() => server.listen(PORT, () => console.log(`Mesa Colisão rodando na porta ${PORT}`)))
  .catch(() => { console.error("Não foi possível iniciar sem os dados. Confira SUPABASE_URL, SUPABASE_SERVICE_KEY e se a tabela colisao_kv existe."); process.exit(1); });

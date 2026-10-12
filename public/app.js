// Mesa Colisão RPG — app do navegador (JavaScript puro, sem frameworks).
(() => {
"use strict";

// ================================================================ utilidades
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rid = () => Math.random().toString(36).slice(2, 10);
const DIE = { 1: 4, 2: 6, 3: 8, 4: 10 };
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
let toastT;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3600); }

async function api(path, opts = {}) {
  const init = { method: opts.method || "GET", credentials: "same-origin", headers: {} };
  if (opts.body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(opts.body); }
  let r;
  try { r = await fetch(path, init); } catch (e) { throw new Error("Sem conexão com o servidor."); }
  let data = null; try { data = await r.json(); } catch (e) {}
  if (r.status === 401 && path !== "/api/login") { S.me = null; mostrar("login"); }
  if (!r.ok) throw new Error(data?.erro || "Algo deu errado. Tente de novo.");
  return data;
}
const acao = (tipo, dados = {}) => api(`/api/salas/${S.codigo}/acao`, { method: "POST", body: { tipo, ...dados } }).catch(e => { toast(e.message); throw e; });

const TALENTOS = [["Medicina", "Medicina"], ["Quimica", "Química"], ["Estudo", "Estudo"], ["Sobrevivencia", "Sobrevivência"], ["Engenharia", "Engenharia"], ["Estrategia", "Estratégia"], ["Biologia", "Biologia"], ["Luta", "Luta"], ["Fortitude", "Fortitude"], ["Acrobacia", "Acrobacia"], ["Artilharia", "Artilharia"], ["Atletismo", "Atletismo"], ["Reflexo", "Reflexo"], ["Crime", "Crime"], ["Eloquencia", "Eloquência"], ["Psique", "Psique"], ["Performance", "Performance"]];
const ESTADOS_FIS = [["Machucado", "Machucado"], ["Lesionado", "Lesionado"], ["Quebrado", "Quebrado"]];
const ESTADOS_MEN = [["Sobrecarregado", "Sobrecarregado"], ["Em Panico", "Em Pânico"], ["Encarnacao Sombrosa", "Encarnação Sombrosa"]];
const SONS = {
  "voz-monstro": { nome: "Voz do Monstro", desc: "A gravação editada. Grave e rosnada.", src: "/sons/voz-monstro.mp3", loop: false },
  "voz-monstro-extremo": { nome: "Voz do Monstro (extrema)", desc: "Mais distorcida, para o clímax.", src: "/sons/voz-monstro-extremo.mp3", loop: false },
  "sino": { nome: "Sino", desc: "Uma badalada do sino rachado.", src: "/sons/sino.mp3", loop: false },
  "ambiente": { nome: "Ambiente do Vale", desc: "Zumbido grave e vento parado. Em loop.", src: "/sons/ambiente.mp3", loop: true },
  "batimento": { nome: "Batimento", desc: "Coração acelerado para o pavor. Em loop.", src: "/sons/batimento.mp3", loop: true },
  "rosnado": { nome: "Rosnado", desc: "Respiração e rosnado da criatura. Em loop.", src: "/sons/rosnado.mp3", loop: true },
};

// ================================================================ estado
const S = {
  me: null, codigo: null, sala: null, es: null, conectado: false,
  tab: "combate", fichaAberta: null, addOpen: null,
  modo: "teste", pts: 1, vant: 0, desv: 0,
  audioOn: false, vol: clamp(num(store.get("colisao-vol", "0.8"), .8), 0, 1), playing: new Set(),
  rot: null, rotDirty: false,
};
$("#vol").value = S.vol;

const gm = () => !!S.sala?.souMestre;
const minhaFicha = () => S.sala?.fichas.find(f => f.dono === S.me?.id && !f.resumo) || null;
const nomeMembro = id => S.sala?.membros.find(m => m.id === id)?.usuario || "?";

// ================================================================ telas
function mostrar(t) {
  $("#tela-login").hidden = t !== "login"; $("#tela-lobby").hidden = t !== "lobby"; $("#tela-sala").hidden = t !== "sala";
  if (t !== "sala") { $("#voz").hidden = true; }
}

// ---------------- login
let authModo = "login";
$$("[data-auth]").forEach(b => b.addEventListener("click", () => {
  authModo = b.dataset.auth;
  $$("[data-auth]").forEach(x => x.setAttribute("aria-pressed", x === b));
  $("#auth-pass2-wrap").hidden = authModo !== "cadastro";
  $("#auth-pass").autocomplete = authModo === "cadastro" ? "new-password" : "current-password";
  $("#auth-submit").textContent = authModo === "cadastro" ? "Criar conta" : "Entrar";
  $("#auth-err").textContent = "";
}));
$("#form-auth").addEventListener("submit", async e => {
  e.preventDefault();
  const usuario = $("#auth-user").value.trim(), senha = $("#auth-pass").value;
  if (authModo === "cadastro" && senha !== $("#auth-pass2").value) { $("#auth-err").textContent = "As senhas não são iguais."; return; }
  const btn = $("#auth-submit"); btn.disabled = true; $("#auth-err").textContent = "";
  try {
    const r = await api(authModo === "cadastro" ? "/api/cadastro" : "/api/login", { method: "POST", body: { usuario, senha } });
    S.me = r.usuario; $("#auth-pass").value = ""; $("#auth-pass2").value = "";
    await depoisDoLogin();
  } catch (er) { $("#auth-err").textContent = er.message; }
  btn.disabled = false;
});

// ---------------- lobby
async function abrirLobby() {
  fecharSala(); mostrar("lobby");
  $("#lobby-user").textContent = S.me.usuario;
  const box = $("#lista-salas"); box.innerHTML = `<div class="empty">Carregando…</div>`;
  try {
    const { salas } = await api("/api/salas");
    box.innerHTML = salas.length ? salas.map(s => `<div class="sala-item"><div style="display:grid;gap:2px;min-width:0"><b>${esc(s.nome)}</b>
      <span class="meta">${s.souMestre ? "Você é o Mestre" : "Mestre: " + esc(s.mestre)} · ${s.jogadores} jogador${s.jogadores === 1 ? "" : "es"}</span></div>
      <span class="codigo">${esc(s.codigo)}</span>
      <div class="acts">${s.souMestre ? "" : `<button class="btn sm ghost" type="button" data-sair-sala="${esc(s.codigo)}">Sair</button>`}<button class="btn sm pri" type="button" data-abrir="${esc(s.codigo)}">Abrir</button></div></div>`).join("")
      : `<div class="empty">Você ainda não está em nenhuma sala. Crie uma ou entre com o código do Mestre.</div>`;
  } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
$("#lista-salas").addEventListener("click", async e => {
  const a = e.target.closest("[data-abrir]"); if (a) return abrirSala(a.dataset.abrir);
  const s = e.target.closest("[data-sair-sala]");
  if (s) {
    if (s.dataset.confirm !== "1") { s.dataset.confirm = "1"; s.textContent = "Confirmar"; return; }
    try { await api(`/api/salas/${s.dataset.sairSala}/sair`, { method: "POST", body: {} }); toast("Você saiu da sala."); abrirLobby(); } catch (er) { toast(er.message); }
  }
});
$("#form-criar").addEventListener("submit", async e => {
  e.preventDefault();
  try { const r = await api("/api/salas", { method: "POST", body: { nome: $("#criar-nome").value, modelo: $("#criar-vale").checked ? "vale" : "vazia" } }); $("#criar-nome").value = ""; abrirSala(r.codigo); }
  catch (er) { toast(er.message); }
});
$("#form-entrar").addEventListener("submit", async e => {
  e.preventDefault(); $("#entrar-err").textContent = "";
  const codigo = $("#entrar-codigo").value.trim().toUpperCase(); if (!codigo) return;
  try { await api("/api/salas/entrar", { method: "POST", body: { codigo } }); $("#entrar-codigo").value = ""; abrirSala(codigo); }
  catch (er) { $("#entrar-err").textContent = er.message; }
});
$("#btn-logout").addEventListener("click", async () => { await api("/api/sair", { method: "POST", body: {} }).catch(() => {}); S.me = null; store.set("colisao-sala", ""); mostrar("login"); });

// ================================================================ sala: conexão
function fecharSala() { if (S.es) { S.es.close(); S.es = null; } S.sala = null; S.codigo = null; S.conectado = false; pararTudo(); }
function abrirSala(codigo) {
  fecharSala();
  S.codigo = codigo; S.fichaAberta = null; S.rot = null; S.rotDirty = false; S.addOpen = null;
  store.set("colisao-sala", codigo);
  mostrar("sala"); $("#sala-nome").textContent = "Conectando…"; $("#sala-codigo").textContent = codigo;
  $("#cb-list").innerHTML = ""; $("#turn-bar").innerHTML = ""; $("#tabs").innerHTML = "";
  const es = new EventSource(`/api/salas/${encodeURIComponent(codigo)}/eventos`);
  S.es = es;
  es.addEventListener("estado", ev => { const primeira = !S.sala; S.sala = JSON.parse(ev.data); S.conectado = true; if (primeira) prepararSala(); renderSala(); });
  es.addEventListener("som", ev => { const d = JSON.parse(ev.data); d.acao === "tocar" ? tocar(d.som) : parar(d.som); });
  es.addEventListener("fala", ev => receberFala(JSON.parse(ev.data)));
  es.addEventListener("fim", ev => { toast(JSON.parse(ev.data).motivo); store.set("colisao-sala", ""); abrirLobby(); });
  es.onerror = async () => {
    S.conectado = false; renderTopo();
    if (!S.sala) { // nunca conectou: provavelmente sem acesso
      es.close(); S.es = null;
      try { await api(`/api/salas/${codigo}/acao`, { method: "POST", body: { tipo: "nada" } }); } catch (e) { toast(e.message); }
      store.set("colisao-sala", ""); abrirLobby();
    }
  };
}
$("#btn-voltar").addEventListener("click", () => { store.set("colisao-sala", ""); abrirLobby(); });
$("#btn-convite").addEventListener("click", async () => {
  const link = `${location.origin}/?entrar=${S.codigo}`;
  const txt = `Entra na minha mesa de Colisão RPG: ${link} (código ${S.codigo})`;
  try { await navigator.clipboard.writeText(txt); toast("Convite copiado. É só colar no grupo."); } catch (e) { toast(`Código da sala: ${S.codigo} · Link: ${link}`); }
});

function prepararSala() {
  const tabs = gm()
    ? [["mesa", "Mesa"], ["combate", "Combate"], ["fichas", "Fichas"], ["roteiro", "Roteiro"], ["trilha", "Trilha e falas"], ["jogadores", "Jogadores"], ["dados", "Dados", "side-tab"]]
    : [["mesa", "Mesa"], ["combate", "Combate"], ["fichas", "Minha ficha"], ["pistas", "Pistas"], ["dados", "Dados", "side-tab"]];
  $(".mesa-split").classList.toggle("gm", gm());
  S.cenaSel = null; S.zoom = 1; S.tkSel = null; mapaSrcAtual = null;
  $("#tabs").innerHTML = tabs.map(([k, n, c]) => `<button class="tab ${c || ""}" role="tab" data-tab="${k}" type="button">${n}</button>`).join("");
  const salvo = store.get("colisao-tab", "mesa");
  setTab(tabs.some(t => t[0] === salvo) ? salvo : "mesa");
  $("#secret-wrap").hidden = !gm(); $("#btn-clear-log").hidden = !gm();
  $("#t-tal").innerHTML = `<option value="">Sem talento (1 dado)</option>` + TALENTOS.map(([k, n]) => `<option value="${k}">${n}</option>`).join("");
  if (gm()) renderTrilha();
}
function setTab(t) {
  S.tab = t; store.set("colisao-tab", t);
  $$(".tab").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === t));
  ["mesa", "combate", "fichas", "roteiro", "pistas", "trilha", "jogadores", "dados"].forEach(k => { $("#pane-" + k).hidden = k !== t; });
  if (t === "mesa") requestAnimationFrame(ajustarMapa);
}
$("#tabs").addEventListener("click", e => { const b = e.target.closest("[data-tab]"); if (b) { setTab(b.dataset.tab); if (b.dataset.tab === "fichas") renderFichas(true); } });

// ================================================================ sala: render
function renderSala() {
  renderTopo(); renderSpot(); renderMesa(); renderCombate(); renderFichas(); renderLog(); renderTray();
  if (gm()) { renderRoteiro(); renderFalas(); renderJogadores(); } else renderPistas();
}
function renderTopo() {
  if (!S.sala) return;
  $("#sala-nome").textContent = S.sala.nome; $("#sala-codigo").textContent = S.sala.codigo;
  const chip = $("#role-chip"); chip.textContent = gm() ? "Mestre" : "Jogador"; chip.className = "chip " + (gm() ? "gm" : "pl");
  $("#online").textContent = !S.conectado ? "reconectando…" : S.sala.online > 1 ? `${S.sala.online} na mesa` : "só você";
  $("#conn-dot").className = "dot" + (S.conectado ? " on" : "");
  const b = $("#btn-som"); b.textContent = S.audioOn ? "Som ativo" : "Ativar som"; b.setAttribute("aria-pressed", S.audioOn);
}
function renderSpot() {
  const d = S.sala?.destaque, el = $("#spot");
  if (!d || !d.ativo) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="spot"><div class="spot-row"><div style="display:grid;gap:4px"><span class="lbl">${d.tipo === "pista" ? "Pista em destaque" : "Em cena"}</span><h2>${esc(d.nome)}</h2></div>${gm() ? `<button class="btn sm ghost" data-act="spot-off" type="button">Fechar para todos</button>` : ""}</div>${d.texto ? `<p>${esc(d.texto)}</p>` : ""}</div>`;
}

// Não redesenha um painel enquanto a pessoa digita nele; redesenha quando sair do campo.
const adiados = new Set();
function emFoco(el) { const a = document.activeElement; return el.contains(a) && a.matches("input:not([type=checkbox]):not([type=range]), textarea, select"); }
document.addEventListener("focusout", () => setTimeout(() => {
  if (adiados.has("combate")) renderCombate();
  if (adiados.has("roteiro")) renderRoteiro();
  if (adiados.has("falas")) renderFalas();
}, 0));

// ================================================================ combate
function entidades() {
  const s = S.sala; if (!s) return [];
  const list = [...s.fichas.map(f => ({ ...f, tipo: "ficha" })), ...s.criaturas.map(c => ({ ...c, tipo: "criatura" }))];
  if (s.combate?.ativo) return list.sort((a, b) => num(b.iniciativa, -99) - num(a.iniciativa, -99) || String(a.nome).localeCompare(b.nome));
  return list.sort((a, b) => (a.tipo === b.tipo ? num(a.criadoEm) - num(b.criadoEm) : a.tipo === "ficha" ? -1 : 1));
}
const podeMexer = e => gm() || (e.tipo === "ficha" && e.dono === S.me?.id);
function estadoOculto(e) { const p = num(e.pv) / Math.max(1, num(e.pvMax, 1)); return p <= 0 ? "Caído" : p <= .25 ? "Quase caindo" : p <= .6 ? "Ferido" : p < 1 ? "Arranhado" : "Inteiro"; }
function barra(v, max, cls = "") { const pct = clamp(num(v) / Math.max(1, num(max, 1)) * 100, 0, 100); return `<div class="bar ${cls}"><i class="${!cls ? (pct <= 25 ? "low" : pct <= 60 ? "mid" : "") : ""}" style="width:${pct}%"></i></div>`; }

function cardHTML(e) {
  const c = S.sala.combate || {}, edit = podeMexer(e), hide = e.tipo === "criatura" && e.oculto && !gm();
  const max = num(e.pvMax, 1), pv = num(e.pv, max), ca = num(e.caBase, 8) + (e.desviando ? 2 : 0);
  const turno = c.ativo && c.turnoId === e.id, meu = e.tipo === "ficha" && e.dono === S.me?.id;
  const medo = num(e.medo), medoMax = num(e.medoMax, 10), vont = num(e.vontade, 10), vontMax = num(e.vontadeMax, 10);
  let h = `<article class="cb t-${e.tipo}${turno ? " turn" : ""}${pv <= 0 && !hide ? " down" : ""}" data-id="${esc(e.id)}" data-tipo="${e.tipo}">`;
  h += `<div class="cb-head">${avatarHTML(e, "cb-av")}<span class="cb-name">${esc(e.nome)}${meu ? `<small class="me">você</small>` : e.tipo === "ficha" && gm() ? `<small>${esc(nomeMembro(e.dono))}</small>` : ""}</span>`;
  if (turno) h += `<span class="turn-tag">VEZ</span>`;
  if (e.iniciativa != null) h += `<span class="chip mono" title="Iniciativa">Init ${esc(e.iniciativa)}</span>`;
  if (e.desviando) h += `<span class="badge dodge">DESVIANDO</span>`;
  if (e.tipo === "ficha" && medo >= medoMax) h += `<span class="badge panic">EM PÂNICO</span>`;
  else if (e.tipo === "ficha" && medo > 5) h += `<span class="badge over">SOBRECARGA</span>`;
  if (gm() && e.tipo === "criatura" && e.oculto) h += `<span class="chip">Oculta dos players</span>`;
  h += `</div><div class="stats">`;
  h += `<div class="stat"><div class="stat-top"><span class="lbl">Pontos de Vida</span>`;
  h += hide ? `<span class="big" style="font-size:16px">${estadoOculto(e)}</span></div>` : `<span class="big">${pv}<small> / ${max}</small></span></div>${barra(pv, max)}`;
  if (edit) h += `<div class="dmg"><span class="step"><button type="button" data-act="aj" data-campo="pv" data-d="-1" aria-label="Menos 1 PV">−</button><button type="button" data-act="aj" data-campo="pv" data-d="1" aria-label="Mais 1 PV">+</button></span><input type="number" min="0" data-dmg aria-label="Dano ou cura" placeholder="0"><button class="btn sm danger" type="button" data-act="dano">Dano</button><button class="btn sm" type="button" data-act="cura">Cura</button></div>`;
  h += `</div><div class="stat"><div class="stat-top"><span class="lbl">Couraça</span><span class="big">${hide ? "?" : ca}${!hide && e.desviando ? `<small> (${num(e.caBase, 8)}+2)</small>` : ""}</span></div>`;
  if (edit) h += `<div class="row"><button class="btn sm" type="button" data-act="desviar" aria-pressed="${!!e.desviando}">${e.desviando ? "Desviando +2" : "Desviar (+2)"}</button></div>`;
  h += `</div>`;
  if (e.tipo === "ficha") {
    h += `<div class="stat"><div class="stat-top"><span class="lbl">Medo</span><span class="big">${medo}<small> / ${medoMax}</small></span></div>${barra(medo, medoMax, "fear")}`;
    if (edit) h += `<span class="step"><button type="button" data-act="aj" data-campo="medo" data-d="-1" aria-label="Menos medo">−</button><button type="button" data-act="aj" data-campo="medo" data-d="1" aria-label="Mais medo">+</button></span>`;
    h += `</div><div class="stat"><div class="stat-top"><span class="lbl">Vontade</span><span class="big">${vont}<small> / ${vontMax}</small></span></div>${barra(vont, vontMax, "will")}`;
    if (edit) h += `<span class="step"><button type="button" data-act="aj" data-campo="vontade" data-d="-1" aria-label="Menos vontade">−</button><button type="button" data-act="aj" data-campo="vontade" data-d="1" aria-label="Mais vontade">+</button></span>`;
    h += `</div>`;
  }
  h += `</div>`;
  if (edit) {
    h += `<div class="row"><button class="btn sm" type="button" data-act="init">Rolar iniciativa (Técnica ${num(e.tecnica, 1)} · d${DIE[clamp(num(e.tecnica, 1), 1, 4)]})</button>`;
    if (e.tipo === "ficha") h += `<button class="btn sm ghost" type="button" data-act="abrir-ficha">Abrir ficha</button>`;
    h += `</div>`;
    if (e.tipo === "criatura") {
      h += `<details class="adj"><summary>Ajustar criatura</summary><div class="adj-grid">
        <label><span class="lbl">Nome</span><input type="text" data-cf="nome" value="${esc(e.nome)}" maxlength="60"></label>
        <label><span class="lbl">PV atual</span><input type="number" data-cf="pv" value="${pv}"></label>
        <label><span class="lbl">PV máximo</span><input type="number" data-cf="pvMax" value="${max}" min="1"></label>
        <label><span class="lbl">Couraça base</span><input type="number" data-cf="caBase" value="${num(e.caBase, 8)}"></label>
        <label><span class="lbl">Técnica</span><select data-cf="tecnica">${[1, 2, 3, 4].map(n => `<option value="${n}" ${num(e.tecnica, 1) === n ? "selected" : ""}>${n} · d${DIE[n]}</option>`).join("")}</select></label>
      </div><label class="f" style="margin-top:8px"><span class="lbl">Notas do Mestre</span><textarea data-cf="notas" maxlength="2000">${esc(e.notas)}</textarea></label>
      <div class="row" style="margin-top:8px"><button class="btn sm" type="button" data-act="img-criatura">${e.imagem ? "Trocar imagem" : "Enviar imagem"}</button>${e.imagem ? `<button class="btn sm ghost" type="button" data-act="img-criatura-tirar">Tirar imagem</button>` : ""}</div>
      <div class="row" style="margin-top:8px"><button class="btn sm" type="button" data-act="ocultar">${e.oculto ? "Mostrar números aos players" : "Esconder números dos players"}</button><button class="btn sm danger" type="button" data-act="remover-criatura">Remover da mesa</button></div></details>`;
    }
  }
  return h + `</article>`;
}
function renderCombate() {
  if (!S.sala) return;
  const list = $("#cb-list");
  if (emFoco(list)) { adiados.add("combate"); return; }
  adiados.delete("combate");
  const abertos = new Set($$("details[open]", list).map(d => d.closest("[data-id]").dataset.id));
  const c = S.sala.combate || {}, ents = entidades(), atual = ents.find(e => e.id === c.turnoId);
  const status = c.ativo ? `Rodada <b class="mono">${num(c.rodada, 1)}</b> · vez de <b>${esc(atual?.nome || "—")}</b>` : "Fora de combate";
  $("#turn-bar").innerHTML = (gm() ? (c.ativo
    ? `<button class="btn pri" data-act="proximo" type="button">Próximo turno</button><button class="btn" data-act="encerrar" type="button">Encerrar combate</button>`
    : `<button class="btn pri" data-act="iniciar" type="button" ${ents.length ? "" : "disabled"}>Iniciar combate</button><button class="btn" data-act="rolar-todos" type="button" ${ents.length ? "" : "disabled"}>Rolar iniciativa de todos</button>`) : "")
    + `<span class="status">${status}</span>`;
  list.innerHTML = ents.length ? ents.map(cardHTML).join("") : `<div class="empty">${gm() ? "Ninguém na mesa ainda. Os players aparecem aqui quando criarem a ficha. Adicione criaturas abaixo." : "Ninguém na mesa ainda. Crie sua ficha na aba Minha ficha."}</div>`;
  abertos.forEach(id => { const d = list.querySelector(`[data-id="${CSS.escape(id)}"] details`); if (d) d.open = true; });
  renderAdd();
}
function renderAdd() {
  const area = $("#add-area");
  if (!gm()) { area.innerHTML = minhaFicha() ? "" : `<div class="row"><button class="btn pri" type="button" data-act="ir-ficha">Criar minha ficha</button></div>`; return; }
  if (!S.addOpen) { area.innerHTML = `<div class="row"><button class="btn" type="button" data-act="add-criatura">+ Criatura</button></div>`; return; }
  area.innerHTML = `<form class="addbox" id="form-criatura"><span class="lbl">Nova criatura</span><div class="adj-grid">
    <label><span class="lbl">Nome</span><input type="text" name="nome" required maxlength="60" placeholder="Ex.: Aquele que Responde"></label>
    <label><span class="lbl">PV máximo</span><input type="number" name="pvMax" min="1" value="30" required></label>
    <label><span class="lbl">Couraça base</span><input type="number" name="caBase" value="8"></label>
    <label><span class="lbl">Técnica</span><select name="tecnica">${[1, 2, 3, 4].map(n => `<option value="${n}">${n} · d${DIE[n]}</option>`).join("")}</select></label>
    </div><label class="check"><input type="checkbox" name="oculto" checked> Esconder PV e Couraça dos players</label>
    <div class="row"><button class="btn pri" type="submit">Adicionar</button><button class="btn ghost" type="button" data-act="add-cancel">Cancelar</button></div></form>`;
  $("#form-criatura input[name=nome]").focus();
}
document.addEventListener("submit", async e => {
  if (e.target.id !== "form-criatura") return;
  e.preventDefault();
  const fd = new FormData(e.target);
  await acao("criatura.criar", { nome: fd.get("nome"), pvMax: fd.get("pvMax"), caBase: fd.get("caBase"), tecnica: fd.get("tecnica"), oculto: fd.get("oculto") === "on" }).catch(() => {});
  S.addOpen = null; renderAdd();
});
$("#pane-combate").addEventListener("change", e => {
  const el = e.target; if (!el.dataset.cf) return;
  const card = el.closest("[data-id]");
  acao("criatura.atualizar", { id: card.dataset.id, campos: { [el.dataset.cf]: el.value } }).catch(() => {});
});

document.addEventListener("click", async ev => {
  const t = ev.target.closest("[data-act]"); if (!t) return;
  const card = t.closest("[data-id]"), id = card?.dataset.id, alvo = card?.dataset.tipo;
  const a = t.dataset.act;
  try {
    switch (a) {
      case "aj": await acao("ajustar", { alvo, id, campo: t.dataset.campo, delta: num(t.dataset.d) }); break;
      case "dano": case "cura": {
        const inp = card.querySelector("[data-dmg]"), q = Math.abs(num(inp.value)); if (!q) { inp.focus(); return; }
        inp.value = ""; await acao("ajustar", { alvo, id, campo: "pv", delta: a === "dano" ? -q : q }); break;
      }
      case "desviar": await acao("desviar", { alvo, id }); break;
      case "init": await acao("iniciativa", { alvo, id }); break;
      case "abrir-ficha": S.fichaAberta = id; setTab("fichas"); renderFichas(true); break;
      case "ir-ficha": setTab("fichas"); renderFichas(true); break;
      case "ocultar": { const e = S.sala.criaturas.find(x => x.id === id); await acao("criatura.atualizar", { id, campos: { oculto: !e.oculto } }); break; }
      case "remover-criatura":
        if (t.dataset.confirm !== "1") { t.dataset.confirm = "1"; t.textContent = "Clique de novo para remover"; return; }
        await acao("criatura.apagar", { id }); break;
      case "img-criatura": escolherImagem({ max: 512, quadrado: true }, ref => acao("criatura.atualizar", { id, campos: { imagem: ref } })); break;
      case "img-criatura-tirar": await acao("criatura.atualizar", { id, campos: { imagem: "" } }); break;
      case "add-criatura": S.addOpen = "criatura"; renderAdd(); break;
      case "add-cancel": S.addOpen = null; renderAdd(); break;
      case "iniciar": await acao("combate.iniciar"); break;
      case "rolar-todos": await acao("combate.rolarTodos"); toast("Iniciativa rolada para todos."); break;
      case "proximo": await acao("combate.proximo"); break;
      case "encerrar": await acao("combate.encerrar"); break;
      case "spot-off": await acao("destaque", { ativo: false }); break;
    }
  } catch (e) { /* toast já mostrado */ }
});

// ================================================================ imagens
function imgSrc(ref) {
  if (!ref) return "";
  if (ref.startsWith("b:")) return ref.slice(2);
  if (ref.startsWith("u:")) return "/api/img/" + encodeURIComponent(ref.slice(2));
  return "";
}
const iniciais = n => String(n || "?").trim().split(/\s+/).slice(0, 2).map(p => p[0]).join("").toUpperCase();
function avatarHTML(e, cls) {
  const src = imgSrc(e.tipo === "criatura" ? e.imagem : e.retrato);
  return `<span class="${cls}${e.tipo === "criatura" ? " c" : ""}" style="${src ? `background-image:url('${esc(src)}')` : ""}" aria-hidden="true">${src ? "" : esc(iniciais(e.nome))}</span>`;
}
async function prepararImagem(file, { max = 1600, quadrado = false } = {}) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error("Não consegui abrir essa imagem.")); i.src = url; });
    let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
    if (quadrado) { const m = Math.min(sw, sh); sx = (sw - m) / 2; sy = (sh - m) / 2; sw = sh = m; }
    const k = Math.min(1, max / Math.max(sw, sh)), cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(sw * k)); cv.height = Math.max(1, Math.round(sh * k));
    cv.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
    const blob = (t, q) => new Promise(ok => cv.toBlob(ok, t, q));
    let b = await blob("image/webp", .86);
    if (!b || b.type !== "image/webp") b = await blob(quadrado ? "image/png" : "image/jpeg", .86);
    if (b.size > 3.8 * 1024 * 1024) b = await blob("image/jpeg", .7);
    return b;
  } finally { URL.revokeObjectURL(url); }
}
let aoEscolher = null, opcoesImg = null;
function escolherImagem(opcoes, cb) { aoEscolher = cb; opcoesImg = opcoes; const inp = $("#up-file"); inp.value = ""; inp.click(); }
$("#up-file").addEventListener("change", async e => {
  const file = e.target.files?.[0], cb = aoEscolher; aoEscolher = null; if (!file || !cb) return;
  toast("Enviando a imagem…");
  try {
    const blob = await prepararImagem(file, opcoesImg || {});
    const r = await fetch(`/api/salas/${S.codigo}/imagem`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": blob.type }, body: blob });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.erro || "Não consegui enviar a imagem.");
    await cb(data.ref); toast("Imagem salva.");
  } catch (er) { toast(er.message); }
});

// ================================================================ mesa (mapa e tokens)
let mapaSrcAtual = null;
const MAPAS_PRONTOS = [["b:/mapas/vale-das-cinzas.jpg", "Vale das Cinzas (pronto)"], ["b:/mapas/igreja-velha.jpg", "Igreja velha (pronto)"]];
function cenaMostrada() {
  const s = S.sala; if (!s) return null;
  if (!gm()) return s.cenas[0] || null;
  if (!s.cenas.find(c => c.id === S.cenaSel)) S.cenaSel = s.cenaAtiva || s.cenas[0]?.id || null;
  return s.cenas.find(c => c.id === S.cenaSel) || null;
}
function entPorRef(ref) {
  const [t, id] = String(ref).split(":");
  const e = t === "ficha" ? S.sala.fichas.find(f => f.id === id) : S.sala.criaturas.find(c => c.id === id);
  return e ? { ...e, tipo: t } : null;
}
function renderMesa() {
  if (!S.sala) return;
  const cena = cenaMostrada();
  renderMesaBar(cena); renderMapa(cena); renderMesaSide(cena);
}
function renderMesaBar(cena) {
  const bar = $("#mesa-bar");
  if (!gm()) {
    bar.className = ""; bar.innerHTML = cena ? `<div class="row"><h3 class="sec" style="font-size:24px">${esc(cena.nome)}</h3></div>` : "";
    return;
  }
  if (emFoco(bar)) return;
  bar.className = "mesa-bar";
  const s = S.sala, ativa = cena && cena.id === s.cenaAtiva;
  if (S.novaCena) {
    bar.innerHTML = `<form id="form-cena" class="row" style="flex:1"><input type="text" name="nome" maxlength="60" required placeholder="Nome da cena" style="flex:1;min-width:140px">
      <select name="mapa" aria-label="Mapa">${MAPAS_PRONTOS.map(([v, n]) => `<option value="${v}">${n}</option>`).join("")}<option value="">Sem mapa (envio depois)</option></select>
      <label class="check"><input type="checkbox" name="grade"> Grade</label><button class="btn pri sm" type="submit">Criar cena</button><button class="btn ghost sm" type="button" data-mesa="cancelar">Cancelar</button></form>`;
    return;
  }
  bar.innerHTML = s.cenas.length ? `<select id="cena-sel" aria-label="Cena">${s.cenas.map(c => `<option value="${esc(c.id)}" ${cena && c.id === cena.id ? "selected" : ""}>${esc(c.nome)}${c.id === s.cenaAtiva ? " · players veem" : ""}</option>`).join("")}</select>
    ${ativa ? `<span class="badge live">OS PLAYERS VEEM ESTA</span>` : `<button class="btn pri sm" type="button" data-mesa="ativar">Mostrar aos players</button>`}
    <button class="btn sm" type="button" data-mesa="mapa">Trocar mapa</button>
    <button class="btn sm" type="button" data-mesa="grade" aria-pressed="${!!cena?.grade}">Grade</button>
    <button class="btn sm ghost" type="button" data-mesa="renomear">Renomear</button>
    <button class="btn sm ghost danger" type="button" data-mesa="apagar">Apagar cena</button>
    <button class="btn sm" type="button" data-mesa="nova" style="margin-left:auto">+ Nova cena</button>`
    : `<span style="color:var(--ash)">Nenhuma cena ainda.</span><button class="btn pri sm" type="button" data-mesa="nova">+ Nova cena</button>`;
}
function renderMapa(cena) {
  const img = $("#mapa-img"), vazio = $("#mapa-vazio"), mapa = $("#mapa");
  if (!cena) {
    mapa.hidden = true; vazio.hidden = false;
    vazio.textContent = gm() ? "Crie uma cena para colocar um mapa." : "O Mestre ainda não mostrou nenhuma cena.";
    $("#mapa-dica").textContent = ""; return;
  }
  mapa.hidden = false;
  const src = imgSrc(cena.mapa);
  vazio.hidden = !!src; if (!src) vazio.textContent = gm() ? "Esta cena ainda não tem mapa. Use Trocar mapa para enviar uma imagem." : "Sem mapa nesta cena.";
  if (src !== mapaSrcAtual) { mapaSrcAtual = src; img.hidden = !src; if (src) { img.src = src; img.onload = ajustarMapa; } else { img.removeAttribute("src"); } }
  $("#mapa-grade").hidden = !cena.grade;
  $("#mapa-dica").textContent = gm() ? "Arraste os tokens. Clique num token para ajustar." : (meuToken(cena) ? "Arraste o seu token para mover." : "");
  renderTokens(cena);
  ajustarMapa();
}
function meuToken(cena) { return cena?.tokens.find(t => { const e = entPorRef(t.ref); return e && e.tipo === "ficha" && e.dono === S.me?.id; }); }
let arrastando = null;
function renderTokens(cena) {
  if (arrastando) return;
  const c = S.sala.combate || {};
  $("#mapa-tokens").innerHTML = cena.tokens.map(t => {
    const e = entPorRef(t.ref); if (!e) return "";
    const src = imgSrc(e.tipo === "criatura" ? e.imagem : e.retrato);
    const meu = e.tipo === "ficha" && e.dono === S.me?.id, pode = gm() || meu;
    const cls = ["tk", "t-" + e.tipo, meu ? "meu" : "", !t.visivel ? "oculto" : "", S.tkSel === t.id ? "sel" : "", c.ativo && c.turnoId === e.id ? "turno" : "", num(e.pv, 1) <= 0 && !(e.oculto && !gm()) ? "caido" : ""].filter(Boolean).join(" ");
    return `<div class="${cls}" data-tk="${esc(t.id)}" ${pode ? "data-drag" : ""} style="left:${num(t.x) * 100}%;top:${num(t.y) * 100}%;--t:${num(t.tam, 1)}" title="${esc(e.nome)}">
      <div class="tk-img" style="${src ? `background-image:url('${esc(src)}')` : ""}">${src ? "" : esc(iniciais(e.nome))}</div><span class="tk-nome">${esc(e.nome)}</span></div>`;
  }).join("");
}
function ajustarMapa() {
  const wrap = $("#mapa-wrap"), mapa = $("#mapa"), img = $("#mapa-img"); if (!wrap || mapa.hidden) return;
  const larg = Math.max(200, wrap.clientWidth - 2) * (S.zoom || 1);
  mapa.style.width = larg + "px";
  if (!img.getAttribute("src")) mapa.style.height = Math.round(larg * 0.62) + "px"; else mapa.style.height = "";
  mapa.style.setProperty("--tk", (larg * 0.025) + "px");
  const cel = larg * 0.025; $("#mapa-grade").style.backgroundSize = `${cel}px ${cel}px`;
}
window.addEventListener("resize", () => { if (S.tab === "mesa") ajustarMapa(); });
$("#pane-mesa").addEventListener("click", e => {
  const z = e.target.closest("[data-zoom]"); if (!z) return;
  const d = num(z.dataset.zoom), wrap = $("#mapa-wrap");
  const cx = (wrap.scrollLeft + wrap.clientWidth / 2) / Math.max(1, wrap.scrollWidth), cy = (wrap.scrollTop + wrap.clientHeight / 2) / Math.max(1, wrap.scrollHeight);
  S.zoom = d === 0 ? 1 : clamp((S.zoom || 1) * (d > 0 ? 1.25 : 0.8), 0.5, 4);
  ajustarMapa();
  wrap.scrollLeft = cx * wrap.scrollWidth - wrap.clientWidth / 2; wrap.scrollTop = cy * wrap.scrollHeight - wrap.clientHeight / 2;
});
// Arrastar tokens e mover o mapa
(() => {
  const wrap = $("#mapa-wrap"); let pan = null;
  wrap.addEventListener("pointerdown", e => {
    const tk = e.target.closest(".tk");
    if (tk && tk.hasAttribute("data-drag")) {
      e.preventDefault(); tk.setPointerCapture(e.pointerId);
      arrastando = { el: tk, id: tk.dataset.tk, x0: e.clientX, y0: e.clientY, moveu: false };
      return;
    }
    if (tk && gm()) { S.tkSel = tk.dataset.tk; renderMesa(); return; }
    pan = { x: e.clientX, y: e.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop }; wrap.classList.add("pan"); wrap.setPointerCapture(e.pointerId);
  });
  wrap.addEventListener("pointermove", e => {
    if (arrastando) {
      if (Math.abs(e.clientX - arrastando.x0) + Math.abs(e.clientY - arrastando.y0) > 4) arrastando.moveu = true;
      if (!arrastando.moveu) return;
      const r = $("#mapa").getBoundingClientRect();
      arrastando.fx = clamp((e.clientX - r.left) / r.width, 0, 1); arrastando.fy = clamp((e.clientY - r.top) / r.height, 0, 1);
      arrastando.el.style.left = arrastando.fx * 100 + "%"; arrastando.el.style.top = arrastando.fy * 100 + "%";
    } else if (pan) { wrap.scrollLeft = pan.sl - (e.clientX - pan.x); wrap.scrollTop = pan.st - (e.clientY - pan.y); }
  });
  const fim = async () => {
    if (arrastando) {
      const a = arrastando; arrastando = null;
      const cena = cenaMostrada();
      if (!a.moveu) { if (gm()) { S.tkSel = a.id; renderMesa(); } return; }
      if (cena) await acao("token.mover", { cena: cena.id, token: a.id, x: a.fx, y: a.fy }).catch(() => renderMesa());
    }
    if (pan) { pan = null; wrap.classList.remove("pan"); }
  };
  wrap.addEventListener("pointerup", fim); wrap.addEventListener("pointercancel", fim);
  wrap.addEventListener("wheel", e => { if (!e.ctrlKey) return; e.preventDefault(); S.zoom = clamp((S.zoom || 1) * (e.deltaY < 0 ? 1.1 : 0.9), 0.5, 4); ajustarMapa(); }, { passive: false });
})();
function renderMesaSide(cena) {
  const side = $("#mesa-side");
  if (!gm() || !cena) { side.innerHTML = ""; side.hidden = true; return; }
  side.hidden = false;
  const naCena = cena.tokens.map(t => ({ t, e: entPorRef(t.ref) })).filter(x => x.e);
  const refs = new Set(cena.tokens.map(t => t.ref));
  const fora = [...S.sala.fichas.map(f => ({ ...f, tipo: "ficha" })), ...S.sala.criaturas.map(c => ({ ...c, tipo: "criatura" }))].filter(e => !refs.has(`${e.tipo}:${e.id}`));
  side.innerHTML = `<div class="card"><span class="lbl">Na cena</span>${naCena.length ? naCena.map(({ t, e }) => `<div class="tk-row${S.tkSel === t.id ? " sel" : ""}" data-tkrow="${esc(t.id)}">${avatarHTML(e, "av")}<span class="n">${esc(e.nome)}</span>
      <button class="btn sm ghost" type="button" data-tka="ver" title="${t.visivel ? "Esconder dos players" : "Mostrar aos players"}" aria-label="${t.visivel ? "Esconder dos players" : "Mostrar aos players"}">${t.visivel ? "Visível" : "Oculto"}</button></div>
      ${S.tkSel === t.id ? `<div class="row" style="padding:0 0 6px 38px"><span class="lbl">Tamanho</span><span class="step"><button type="button" data-tka="menor" aria-label="Diminuir">−</button><span class="mono">${num(t.tam, 1)}</span><button type="button" data-tka="maior" aria-label="Aumentar">+</button></span><button class="btn sm ghost danger" type="button" data-tka="tirar">Tirar</button></div>` : ""}`).join("")
      : `<p style="margin:0;color:var(--ash);font-size:13px">Ninguém nesta cena ainda.</p>`}</div>
    <div class="card"><span class="lbl">Colocar na cena</span>${fora.length ? fora.map(e => `<div class="tk-row">${avatarHTML(e, "av")}<span class="n">${esc(e.nome)}</span><button class="btn sm" type="button" data-colocar="${e.tipo}:${esc(e.id)}" data-vis="1">Colocar</button><button class="btn sm ghost" type="button" data-colocar="${e.tipo}:${esc(e.id)}" data-vis="0" title="Colocar escondido dos players">Oculto</button></div>`).join("")
      : `<p style="margin:0;color:var(--ash);font-size:13px">Todos já estão na cena. Os players aparecem aqui quando criam a ficha.</p>`}</div>`;
}
$("#mesa-side").addEventListener("click", async e => {
  const b = e.target.closest("button"); if (!b) return;
  const cena = cenaMostrada(); if (!cena) return;
  if (b.dataset.colocar) {
    const n = cena.tokens.length, x = .5 + ((n % 5) - 2) * .04, y = .5 + (Math.floor(n / 5) % 3 - 1) * .06;
    await acao("token.colocar", { cena: cena.id, ref: b.dataset.colocar, x, y, visivel: b.dataset.vis === "1" }).catch(() => {}); return;
  }
  const row = b.closest("[data-tkrow]") || b.closest(".row")?.previousElementSibling;
  const tid = row?.dataset.tkrow || S.tkSel, t = cena.tokens.find(x => x.id === tid); if (!t) return;
  const a = b.dataset.tka;
  if (a === "ver") await acao("token.ajustar", { cena: cena.id, token: t.id, visivel: !t.visivel }).catch(() => {});
  if (a === "menor" || a === "maior") await acao("token.ajustar", { cena: cena.id, token: t.id, tam: clamp(num(t.tam, 1) + (a === "maior" ? .5 : -.5), .5, 4) }).catch(() => {});
  if (a === "tirar") { await acao("token.remover", { cena: cena.id, token: t.id }).catch(() => {}); S.tkSel = null; }
});
$("#mesa-side").addEventListener("click", e => { const r = e.target.closest("[data-tkrow]"); if (r && !e.target.closest("button")) { S.tkSel = r.dataset.tkrow; renderMesa(); } });
$("#mesa-bar").addEventListener("change", e => { if (e.target.id === "cena-sel") { S.cenaSel = e.target.value; S.tkSel = null; mapaSrcAtual = null; renderMesa(); } });
$("#mesa-bar").addEventListener("submit", async e => {
  if (e.target.id !== "form-cena") return; e.preventDefault();
  const fd = new FormData(e.target);
  try { const r = await acao("cena.criar", { nome: fd.get("nome"), mapa: fd.get("mapa"), grade: fd.get("grade") === "on" }); S.cenaSel = r.id; S.novaCena = false; mapaSrcAtual = null; renderMesa(); } catch (er) {}
});
$("#mesa-bar").addEventListener("click", async e => {
  const b = e.target.closest("[data-mesa]"); if (!b) return;
  const cena = cenaMostrada(), a = b.dataset.mesa;
  if (a === "nova") { S.novaCena = true; renderMesaBar(cena); $("#form-cena input[name=nome]").focus(); return; }
  if (a === "cancelar") { S.novaCena = false; renderMesaBar(cena); return; }
  if (!cena) return;
  if (a === "ativar") await acao("cena.ativar", { id: cena.id }).then(() => toast("Os players agora veem esta cena.")).catch(() => {});
  if (a === "grade") await acao("cena.atualizar", { id: cena.id, campos: { grade: !cena.grade } }).catch(() => {});
  if (a === "mapa") escolherImagem({ max: 2600 }, ref => acao("cena.atualizar", { id: cena.id, campos: { mapa: ref } }));
  if (a === "renomear") {
    b.outerHTML = `<form id="form-renomear" class="row"><input type="text" value="${esc(cena.nome)}" maxlength="60" aria-label="Novo nome da cena"><button class="btn sm pri" type="submit">Salvar</button></form>`;
    const f = $("#form-renomear"); f.querySelector("input").focus();
    f.addEventListener("submit", async ev => { ev.preventDefault(); await acao("cena.atualizar", { id: cena.id, campos: { nome: f.querySelector("input").value } }).catch(() => {}); f.querySelector("input").blur(); renderMesa(); });
  }
  if (a === "apagar") {
    if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Clique de novo para apagar"; return; }
    await acao("cena.apagar", { id: cena.id }).catch(() => {}); S.cenaSel = null; mapaSrcAtual = null;
  }
});

// ================================================================ fichas
function renderFichas(forcar) {
  if (!S.sala) return;
  const pane = $("#pane-fichas");
  const fichas = S.sala.fichas.filter(f => !f.resumo);
  if (!gm()) {
    const f = minhaFicha();
    if (!f) {
      if (pane.dataset.modo === "criar" && !forcar) return;
      pane.dataset.modo = "criar"; pane.dataset.ficha = "";
      pane.innerHTML = `<form class="card" id="form-ficha-nova" style="max-width:520px"><h3 class="sec">Criar sua ficha</h3>
        <p style="margin:0;color:var(--ash)">Ela fica salva na sala. O Mestre consegue ver e editar.</p>
        <label class="f"><span class="lbl">Nome do personagem</span><input type="text" name="nome" maxlength="60" required placeholder="Ex.: Karol"></label>
        <button class="btn pri" type="submit">Criar ficha</button></form>`;
      return;
    }
    S.fichaAberta = f.id;
    garantirEditor(pane, f, null);
    return;
  }
  // Mestre: lista + editor
  if (!fichas.find(f => f.id === S.fichaAberta)) S.fichaAberta = fichas[0]?.id || null;
  let lista = pane.querySelector(".ficha-list");
  if (pane.dataset.modo !== "gm" || forcar || !lista) {
    pane.dataset.modo = "gm"; pane.dataset.ficha = "";
    pane.innerHTML = `<div class="fichas-split"><div class="pane" style="gap:8px"><div class="ficha-list"></div>
      <form class="addbox" id="form-ficha-npc"><span class="lbl">Nova ficha</span><input type="text" name="nome" maxlength="60" required placeholder="Nome"><button class="btn sm" type="submit">Criar</button></form></div>
      <div id="ficha-editor-gm"></div></div>`;
    lista = pane.querySelector(".ficha-list");
  }
  lista.innerHTML = fichas.length ? fichas.map(f => `<button type="button" class="ficha-pick" data-pick="${esc(f.id)}" aria-current="${f.id === S.fichaAberta}"><b>${esc(f.nome)}</b><span>${f.dono === S.me.id ? "Sua (Mestre)" : "de " + esc(nomeMembro(f.dono))} · PV ${num(f.pv)}/${num(f.pvMax)}</span></button>`).join("")
    : `<div class="empty" style="padding:10px">Nenhuma ficha ainda. Os players criam as deles ao entrar.</div>`;
  const f = fichas.find(x => x.id === S.fichaAberta);
  const host = $("#ficha-editor-gm");
  if (!f) { host.innerHTML = ""; host.dataset.ficha = ""; return; }
  garantirEditor(host, f, forcar);
}
$("#pane-fichas").addEventListener("submit", async e => {
  if (e.target.id !== "form-ficha-nova" && e.target.id !== "form-ficha-npc") return;
  e.preventDefault();
  const nome = new FormData(e.target).get("nome");
  try { const r = await acao("ficha.criar", { nome }); S.fichaAberta = r.id; e.target.reset(); renderFichas(true); } catch (er) {}
});
$("#pane-fichas").addEventListener("click", e => {
  const p = e.target.closest("[data-pick]");
  if (p) { S.fichaAberta = p.dataset.pick; renderFichas(true); }
});

// ---- editor de ficha: desenhado uma vez, depois só sincroniza os valores
function editorHTML(f) {
  const dono = gm() ? `<label class="f" style="max-width:260px"><span class="lbl">Dono da ficha</span><select data-dono>${S.sala.membros.map(m => `<option value="${esc(m.id)}" ${m.id === f.dono ? "selected" : ""}>${esc(m.usuario)}${m.mestre ? " (Mestre)" : ""}</option>`).join("")}</select></label>` : "";
  const inp = (k, label, extra = "") => `<label class="f"><span class="lbl">${label}</span><input type="text" data-k="${k}" ${extra}></label>`;
  const numInp = (k, aria) => `<input type="number" data-k="${k}" aria-label="${aria}">`;
  const chips = list => list.map(([k, n]) => `<label class="cchip"><input type="checkbox" data-k="estados.${k}"><span class="x">✕</span>${n}</label>`).join("");
  const bloco = (tipo, label, i) => `<div class="block"><label class="f"><span class="lbl">${label} ${i + 1}</span><input type="text" data-k="${tipo}.${i}.nome" maxlength="80" placeholder="Nome"></label><textarea data-k="${tipo}.${i}.desc" maxlength="1500" aria-label="${label} ${i + 1}, descrição" placeholder="Descrição, custo, efeito…"></textarea></div>`;
  return `<div class="fe" data-editor="${esc(f.id)}">
  <section><div class="fe-head"><h4 data-show="nome"></h4><span class="saved" data-saved>Salvo</span></div>
    <div class="row">${dono}<button class="btn sm" type="button" data-pdf>Baixar PDF da ficha</button>
    <button class="btn sm ghost danger" type="button" data-apagar-ficha>Apagar ficha</button></div>
    <div class="grid2">${inp("nome", "Nome", 'maxlength="60"')}${inp("idade", "Idade", 'maxlength="20"')}${inp("nacionalidade", "Nacionalidade", 'maxlength="60"')}${inp("ocupacao", "Ocupação", 'maxlength="60"')}
    ${inp("estadoCivil", "Estado civil", 'maxlength="40"')}${inp("nascimento", "Data de nascimento", 'maxlength="20" placeholder="dd.mm.aaaa"')}${inp("rota", "Rota", 'maxlength="60"')}${inp("arquivo", "Número do arquivo", 'maxlength="30"')}
    <label class="f"><span class="lbl">Patente</span><input type="number" data-k="patente" min="1" max="10"></label></div></section>

  <section><div class="fe-head"><h4>Aparência</h4><span class="lbl">vira o token na Mesa</span></div><div class="retrato"><div class="retrato-img" data-img="retrato"></div>
    <div class="pane" style="gap:8px"><div class="row"><button class="btn sm" type="button" data-retrato>Enviar imagem</button><button class="btn sm ghost" type="button" data-retrato-tirar>Tirar imagem</button></div>
    <textarea data-k="aparencia" maxlength="800" aria-label="Descrição da aparência" placeholder="Rosto, roupas, cicatrizes, o jeito de andar…"></textarea></div></div></section>

  <section><div class="fe-head"><h4>Condição</h4></div><div class="vitals">
    <div class="vital"><span class="lbl">Pontos de Vida</span><div class="pair">${numInp("pv", "PV atual")}<span class="slash">/</span>${numInp("pvMax", "PV máximo")}</div><div data-bar="pv"></div></div>
    <div class="vital"><span class="lbl">Couraça</span><div class="pair"><span class="big" data-show="ca"></span><span class="slash">·</span><label class="f"><span class="lbl">Base</span>${numInp("caBase", "Couraça base")}</label></div><button class="btn sm" type="button" data-toggle="desviando">Desviar (+2)</button></div>
    <div class="vital"><span class="lbl">Movimento</span><div class="pair">${numInp("mov", "Movimento atual")}<span class="slash">/</span>${numInp("movMax", "Movimento máximo")}</div></div>
    <div class="vital"><span class="lbl">Vontade</span><div class="pair">${numInp("vontade", "Vontade atual")}<span class="slash">/</span>${numInp("vontadeMax", "Vontade máxima")}</div><div data-bar="vontade"></div></div>
    <div class="vital"><span class="lbl">Medo</span><div class="pair">${numInp("medo", "Medo atual")}<span class="slash">/</span>${numInp("medoMax", "Medo máximo")}</div><div data-bar="medo"></div></div>
  </div><div class="pane" style="gap:6px"><span class="lbl">Tormento (<span data-show="tormento"></span> / 10)</span><div class="pips">${Array.from({ length: 10 }, (_, i) => `<button type="button" class="pip" data-tor="${i + 1}" aria-label="Tormento ${i + 1}">${i + 1}</button>`).join("")}</div></div></section>

  <section><div class="fe-head"><h4>Atributos</h4><span class="lbl">1 ponto = d4 · 2 = d6 · 3 = d8 · 4 = d10</span></div><div class="grid2">
    ${[["fisico", "Físico"], ["influencia", "Influência"], ["tecnica", "Técnica"]].map(([k, n]) => `<label class="f"><span class="lbl">${n}</span><select data-k="${k}">${[1, 2, 3, 4].map(p => `<option value="${p}">${p} ponto${p > 1 ? "s" : ""} · d${DIE[p]}</option>`).join("")}</select></label>`).join("")}
  </div></section>

  <section><div class="fe-head"><h4>Expertises e Chamado</h4></div><div class="grid2">${[0, 1, 2, 3, 4, 5].map(i => inp("expertises." + i, "Expertise " + (i + 1), 'maxlength="120"')).join("")}</div>
    ${inp("chamado", "Chamado", 'maxlength="200"')}</section>

  <section><div class="fe-head"><h4>Estado</h4></div><div class="pane" style="gap:6px"><span class="lbl">Físico</span><div class="chips">${chips(ESTADOS_FIS)}</div></div>
    <div class="pane" style="gap:6px"><span class="lbl">Mental</span><div class="chips">${chips(ESTADOS_MEN)}</div></div></section>

  <section><div class="fe-head"><h4>Talentos</h4><span class="lbl">Número de dados</span></div><div class="talents">
    ${TALENTOS.map(([k, n]) => `<div class="tal"><span>${n}</span><span class="step"><button type="button" data-tstep="${k}" data-d="-1" aria-label="Menos um dado em ${n}">−</button><input type="number" data-k="talentos.${k}" min="0" max="10" aria-label="Dados em ${n}" placeholder="0"><button type="button" data-tstep="${k}" data-d="1" aria-label="Mais um dado em ${n}">+</button></span></div>`).join("")}
  </div></section>

  <section><div class="fe-head"><h4>Rituais</h4></div><div class="blocks">${[0, 1, 2, 3].map(i => bloco("rituais", "Ritual", i)).join("")}</div></section>
  <section><div class="fe-head"><h4>Habilidades e Artimanhas</h4></div><div class="blocks">${[0, 1, 2, 3].map(i => bloco("habilidades", "Habilidade", i)).join("")}</div></section>
  <section><div class="fe-head"><h4>Anotações</h4></div><textarea data-k="notas" maxlength="4000" style="min-height:120px" aria-label="Anotações" placeholder="Inventário, contatos, segredos…"></textarea></section>
  </div>`;
}
function valorDe(f, k) {
  const p = k.split("."); let v = f;
  for (const x of p) { v = v == null ? undefined : v[x]; }
  return v;
}
const pendentes = new Map(); // fichaId -> {campos, t}
function garantirEditor(host, f, forcar) {
  if (forcar || host.dataset.ficha !== f.id || !host.querySelector("[data-editor]")) { host.innerHTML = editorHTML(f); host.dataset.ficha = f.id; }
  sincronizarEditor(host, f);
}
function sincronizarEditor(host, f) {
  const ativo = document.activeElement, pend = pendentes.get(f.id)?.campos || {};
  $$("[data-k]", host).forEach(el => {
    const k = el.dataset.k; if (el === ativo || k in pend) return;
    let v = valorDe(f, k);
    if (el.type === "checkbox") el.checked = !!v;
    else { v = v ?? (k.startsWith("talentos.") ? "" : ""); if (String(el.value) !== String(v)) el.value = v; }
  });
  $$("[data-show]", host).forEach(el => {
    const k = el.dataset.show;
    el.textContent = k === "ca" ? String(num(f.caBase, 8) + (f.desviando ? 2 : 0)) : String(valorDe(f, k) ?? "");
  });
  const ri = $("[data-img=retrato]", host);
  if (ri) { const src = imgSrc(f.retrato); ri.style.backgroundImage = src ? `url("${src}")` : ""; ri.textContent = src ? "" : "Sem imagem"; }
  const tg = $("[data-toggle=desviando]", host); if (tg) { tg.setAttribute("aria-pressed", !!f.desviando); tg.textContent = f.desviando ? "Desviando +2" : "Desviar (+2)"; }
  $$("[data-tor]", host).forEach(b => b.classList.toggle("on", +b.dataset.tor <= num(f.tormento)));
  const bars = { pv: [f.pv, f.pvMax, ""], vontade: [f.vontade, f.vontadeMax, "will"], medo: [f.medo, f.medoMax, "fear"] };
  $$("[data-bar]", host).forEach(el => { const [v, m, c] = bars[el.dataset.bar]; el.innerHTML = barra(v, m, c); });
  const dono = $("[data-dono]", host); if (dono && dono !== ativo) dono.value = f.dono;
}
function fichaPorEditor(el) { const ed = el.closest("[data-editor]"); return ed ? S.sala.fichas.find(f => f.id === ed.dataset.editor) : null; }
function enviarCampo(fid, k, v, host) {
  const p = pendentes.get(fid) || { campos: {}, t: null };
  p.campos[k] = v; clearTimeout(p.t);
  const saved = host?.querySelector("[data-saved]"); if (saved) saved.textContent = "Salvando…";
  p.t = setTimeout(async () => {
    const campos = p.campos; pendentes.delete(fid);
    try { await acao("ficha.atualizar", { id: fid, campos }); if (saved && saved.isConnected) saved.textContent = "Salvo"; }
    catch (e) { if (saved && saved.isConnected) saved.textContent = "Não salvou"; }
  }, 450);
  pendentes.set(fid, p);
}
$("#pane-fichas").addEventListener("input", e => {
  const el = e.target; if (!el.dataset.k) return;
  const f = fichaPorEditor(el); if (!f) return;
  const v = el.type === "checkbox" ? el.checked : el.value;
  if (el.type === "number" && el.value === "" && !el.dataset.k.startsWith("talentos.")) return;
  enviarCampo(f.id, el.dataset.k, v, el.closest("[data-editor]"));
});
$("#pane-fichas").addEventListener("change", async e => {
  const el = e.target;
  if (el.matches("select[data-k]")) return; // já enviado pelo input
  if (el.matches("[data-dono]")) { const f = fichaPorEditor(el); await acao("ficha.dono", { id: f.id, dono: el.value }).catch(() => {}); }
});
$("#pane-fichas").addEventListener("click", async e => {
  const b = e.target.closest("button"); if (!b) return;
  const f = fichaPorEditor(b); if (!f) return;
  const host = b.closest("[data-editor]");
  if (b.dataset.tor) { const n = +b.dataset.tor; enviarCampo(f.id, "tormento", num(f.tormento) === n ? n - 1 : n, host); f.tormento = num(f.tormento) === n ? n - 1 : n; sincronizarEditor(host.parentElement, f); return; }
  if (b.dataset.tstep) { const inp = host.querySelector(`[data-k="talentos.${b.dataset.tstep}"]`); const v = clamp(num(inp.value) + num(b.dataset.d), 0, 10); inp.value = v || ""; enviarCampo(f.id, "talentos." + b.dataset.tstep, v, host); return; }
  if (b.dataset.toggle === "desviando") { await acao("desviar", { alvo: "ficha", id: f.id }).catch(() => {}); return; }
  if (b.hasAttribute("data-pdf")) { baixarPdf(f, b); return; }
  if (b.hasAttribute("data-retrato")) { escolherImagem({ max: 512, quadrado: true }, ref => acao("ficha.atualizar", { id: f.id, campos: { retrato: ref } })); return; }
  if (b.hasAttribute("data-retrato-tirar")) { await acao("ficha.atualizar", { id: f.id, campos: { retrato: "" } }).catch(() => {}); return; }
  if (b.hasAttribute("data-apagar-ficha")) {
    if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Clique de novo para apagar"; return; }
    await acao("ficha.apagar", { id: f.id }).catch(() => {}); S.fichaAberta = null; renderFichas(true);
  }
});

// ================================================================ dados
function renderTray() {
  const f = minhaFicha();
  $("#t-attr-wrap").hidden = !f;
}
document.addEventListener("click", ev => {
  const b = ev.target.closest("button"); if (!b || !b.closest("#pane-dados")) return;
  if (b.dataset.mode) {
    S.modo = b.dataset.mode; $$("[data-mode]").forEach(x => x.setAttribute("aria-pressed", x.dataset.mode === S.modo));
    $("#mode-teste").hidden = S.modo !== "teste"; $("#mode-livre").hidden = S.modo !== "livre"; return;
  }
  if (b.dataset.pts) { setPts(num(b.dataset.pts, 1)); $("#t-attr").value = ""; return; }
  if (b.dataset.cnt) { const k = b.dataset.cnt; S[k] = clamp(S[k] + num(b.dataset.d), 0, 5); $("#t-" + k).textContent = S[k]; return; }
  if (b.id === "btn-rolar-teste") {
    const tal = $("#t-tal").value, f = minhaFicha();
    const n = tal ? Math.max(2, num(f?.talentos?.[tal], 2)) : 1;
    const rot = tal ? TALENTOS.find(t => t[0] === tal)[1] : ($("#t-attr").value ? $("#t-attr").selectedOptions[0].textContent : "");
    acao("rolar", { modo: "teste", pts: S.pts, n, tenacidade: $("#t-ten").checked, vant: S.vant, desv: S.desv, rotulo: rot, secreto: gm() && $("#secret").checked }).catch(() => {});
    if ($("#t-ten").checked && f) { acao("ajustar", { alvo: "ficha", id: f.id, campo: "vontade", delta: -1 }).catch(() => {}); $("#t-ten").checked = false; }
    return;
  }
  if (b.dataset.free) {
    acao("rolar", { modo: "livre", lados: num(b.dataset.free), qtd: num($("#l-qtd").value, 1), mod: num($("#l-mod").value), secreto: gm() && $("#secret").checked }).catch(() => {});
    return;
  }
  if (b.id === "btn-clear-log") {
    if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Confirmar"; setTimeout(() => { b.dataset.confirm = ""; b.textContent = "Limpar"; }, 3000); return; }
    b.dataset.confirm = ""; b.textContent = "Limpar"; acao("rolagens.limpar").catch(() => {});
  }
});
function setPts(p) { S.pts = p; $$("[data-pts]").forEach(x => x.setAttribute("aria-pressed", x.dataset.pts == S.pts)); }
$("#t-attr").addEventListener("change", e => { const f = minhaFicha(); if (f && e.target.value) setPts(clamp(num(f[e.target.value], 1), 1, 4)); });
$("#t-tal").addEventListener("change", e => {
  const f = minhaFicha(), k = e.target.value;
  e.target.title = k ? `${Math.max(2, num(f?.talentos?.[k], 2))} dados` : "1 dado";
});
function renderLog() {
  const rs = S.sala?.rolagens || [], el = $("#log");
  if (!rs.length) { el.innerHTML = `<div class="empty">Nenhuma rolagem ainda. Os dados de todos aparecem aqui.</div>`; return; }
  el.innerHTML = rs.slice(0, 40).map(r => {
    const hora = new Date(num(r.ts)).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const cls = r.secreto || r.soMestre ? "gm secret" : r.gm ? "gm" : r.by === S.me?.id ? "mine" : "";
    return `<div class="roll ${cls}"><div class="roll-top"><span><b>${esc(r.quem)}</b> · ${esc(r.rotulo)}${r.soMestre ? " · só Mestre" : ""}</span><time>${hora}</time></div>
      <div class="roll-body"><div class="faces">${(r.dados || []).slice(0, 30).map(d => `<span class="face ${d.k === "v" ? "v" : d.k === "d" ? "d" : ""}" title="d${num(d.l)}">${d.k === "d" ? "−" : d.k === "v" ? "+" : ""}${num(d.v)}</span>`).join("")}</div>
      ${r.critico ? `<span class="crit">SUCESSO EXTREMO</span>` : ""}<span class="total">${num(r.total)}</span></div></div>`;
  }).join("");
}

// ================================================================ roteiro (Mestre) e pistas
let rotT;
function salvarRoteiro() {
  S.rotDirty = true; clearTimeout(rotT);
  rotT = setTimeout(async () => { try { await acao("roteiro.salvar", { roteiro: S.rot }); } catch (e) {} S.rotDirty = false; }, 700);
}
function syncRot() { if (!S.rotDirty && S.sala?.roteiro) S.rot = JSON.parse(JSON.stringify(S.sala.roteiro)); if (!S.rot) S.rot = { cenas: [], npcs: [], falas: [] }; }
function renderRoteiro() {
  const pane = $("#pane-roteiro"); if (!gm()) return;
  if (emFoco(pane)) { adiados.add("roteiro"); return; }
  adiados.delete("roteiro"); syncRot();
  const R = S.rot;
  let h = `<div class="notice">Só você vê o roteiro. <b>Revelar</b> manda a pista para a aba Pistas dos players. <b>Destacar</b> e <b>Mostrar</b> colocam uma pista ou um NPC no topo da tela de todos.</div><h3 class="sec">Cenas</h3>`;
  if (!R.cenas.length) h += `<div class="empty">Nenhuma cena ainda. Adicione a primeira.</div>`;
  R.cenas.forEach((c, ci) => {
    h += `<div class="scene" data-ci="${ci}"><input class="scene-title" type="text" data-r="titulo" value="${esc(c.titulo)}" aria-label="Título da cena"><textarea data-r="resumo" aria-label="Resumo da cena" placeholder="O que acontece, o que narrar…">${esc(c.resumo)}</textarea>`;
    (c.pistas || []).forEach((p, pi) => {
      h += `<div class="clue${p.revelada ? " done" : ""}" data-pi="${pi}"><span class="lbl" style="padding-top:8px">${p.revelada ? "✓" : "•"}</span>
        <div><textarea data-p="texto" aria-label="Texto da pista">${esc(p.texto)}</textarea><input class="test" type="text" data-p="teste" value="${esc(p.teste)}" placeholder="Teste: Talento Dt N" aria-label="Teste da pista"></div>
        <div class="acts">${p.revelada ? `<button class="btn sm" type="button" data-r-act="esconder">Esconder</button>` : `<button class="btn sm pri" type="button" data-r-act="revelar">Revelar</button>`}
        <button class="btn sm ghost" type="button" data-r-act="destacar">Destacar</button><button class="btn sm ghost danger" type="button" data-r-act="del-pista">Apagar</button></div></div>`;
    });
    h += `<div class="row"><button class="btn sm" type="button" data-r-act="add-pista">+ Pista</button><button class="btn sm ghost danger" type="button" data-r-act="del-cena">Apagar cena</button></div></div>`;
  });
  h += `<div class="row"><button class="btn" type="button" data-r-act="add-cena">+ Cena</button></div><h3 class="sec">NPCs</h3><div class="scene">`;
  if (!R.npcs.length) h += `<div class="empty" style="padding:10px">Nenhum NPC ainda.</div>`;
  R.npcs.forEach((n, ni) => {
    h += `<div class="npc" data-ni="${ni}"><div class="row"><input type="text" data-n="nome" value="${esc(n.nome)}" aria-label="Nome do NPC" style="flex:1;font-weight:700">
      <button class="btn sm pri" type="button" data-r-act="mostrar-npc">Mostrar</button><button class="btn sm ghost danger" type="button" data-r-act="del-npc">Apagar</button></div>
      <textarea data-n="texto" aria-label="Notas do NPC" placeholder="Aparência, fala, o que sabe…">${esc(n.texto)}</textarea></div>`;
  });
  h += `<div class="row"><button class="btn sm" type="button" data-r-act="add-npc">+ NPC</button></div></div><h3 class="sec">Pistas reveladas</h3>${pistasHTML(true)}`;
  pane.innerHTML = h;
}
function pistasHTML(isGm) {
  const ps = S.sala?.pistas || [];
  if (!ps.length) return `<div class="empty">${isGm ? "Nenhuma pista revelada ainda." : "Nenhuma pista ainda. Quando o Mestre revelar uma, ela aparece aqui."}</div>`;
  return `<div class="revealed">${ps.map(p => `<div class="rv"><span class="lbl">${esc(p.cena || "Pista")}</span><p>${esc(p.texto)}</p></div>`).join("")}</div>`;
}
function renderPistas() { $("#pane-pistas").innerHTML = `<h3 class="sec">Pistas</h3>${pistasHTML(false)}`; }
$("#pane-roteiro").addEventListener("input", e => {
  const el = e.target, R = S.rot; if (!R) return;
  const sc = el.closest("[data-ci]"), cl = el.closest("[data-pi]"), np = el.closest("[data-ni]");
  if (np && el.dataset.n) R.npcs[+np.dataset.ni][el.dataset.n] = el.value;
  else if (cl && el.dataset.p) R.cenas[+sc.dataset.ci].pistas[+cl.dataset.pi][el.dataset.p] = el.value;
  else if (sc && el.dataset.r) R.cenas[+sc.dataset.ci][el.dataset.r] = el.value;
  else return;
  salvarRoteiro();
});
$("#pane-roteiro").addEventListener("click", async e => {
  const b = e.target.closest("[data-r-act]"); if (!b) return;
  syncRot(); const R = S.rot, a = b.dataset.rAct;
  const sc = b.closest("[data-ci]"), cl = b.closest("[data-pi]"), np = b.closest("[data-ni]");
  const cena = sc ? R.cenas[+sc.dataset.ci] : null, pista = cl ? cena.pistas[+cl.dataset.pi] : null, npc = np ? R.npcs[+np.dataset.ni] : null;
  if (a.startsWith("del-") && b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Confirmar"; return; }
  try {
    switch (a) {
      case "add-cena": R.cenas.push({ id: rid(), titulo: "Nova cena", resumo: "", pistas: [] }); break;
      case "del-cena": R.cenas.splice(+sc.dataset.ci, 1); break;
      case "add-pista": cena.pistas.push({ id: rid(), texto: "", teste: "", revelada: false }); break;
      case "del-pista": cena.pistas.splice(+cl.dataset.pi, 1); break;
      case "revelar": await acao("pista.revelar", { id: pista.id, texto: pista.texto, cena: cena.titulo }); pista.revelada = true; toast("Pista revelada aos players."); break;
      case "esconder": await acao("pista.esconder", { id: pista.id }); pista.revelada = false; break;
      case "destacar": await acao("destaque", { ativo: true, tipoDestaque: "pista", nome: cena.titulo, texto: pista.texto }); toast("Pista em destaque na tela de todos."); return;
      case "add-npc": R.npcs.push({ id: rid(), nome: "Novo NPC", texto: "" }); break;
      case "del-npc": R.npcs.splice(+np.dataset.ni, 1); break;
      case "mostrar-npc": await acao("destaque", { ativo: true, tipoDestaque: "npc", nome: npc.nome, texto: "" }); toast(`${npc.nome} em cena na tela de todos.`); return;
    }
  } catch (er) { return; }
  salvarRoteiro(); adiados.delete("roteiro"); renderRoteiro();
});

// ================================================================ jogadores (Mestre)
function renderJogadores() {
  const pane = $("#pane-jogadores"); if (!gm()) return;
  const s = S.sala;
  pane.innerHTML = `<div class="card"><h3 class="sec">Convidar</h3>
    <p style="margin:0">Mande o código <span class="codigo">${esc(s.codigo)}</span> ou o link abaixo. Cada player cria uma conta, entra e faz a ficha.</p>
    <div class="row"><input type="text" readonly value="${esc(location.origin + "/?entrar=" + s.codigo)}" style="flex:1;font-family:var(--f-mono)" aria-label="Link de convite"><button class="btn" type="button" id="btn-convite-2">Copiar convite</button></div></div>
    <div class="card"><h3 class="sec">Na sala</h3>${s.membros.map(m => {
      const fs = s.fichas.filter(f => f.dono === m.id).map(f => esc(f.nome)).join(", ");
      return `<div class="sala-item" style="background:var(--panel-2)"><div style="display:grid;gap:2px"><b>${esc(m.usuario)}</b><span class="meta">${m.mestre ? "Mestre" : "Jogador"}${fs ? " · " + fs : " · sem ficha"}</span></div>
      ${m.mestre ? "" : `<div class="acts"><button class="btn sm ghost danger" type="button" data-remover="${esc(m.id)}">Remover da sala</button></div>`}</div>`;
    }).join("")}</div>
    <div class="card"><h3 class="sec">Sala</h3><div class="row"><input type="text" id="sala-novo-nome" value="${esc(s.nome)}" maxlength="60" aria-label="Nome da sala" style="flex:1"><button class="btn" type="button" id="btn-renomear">Renomear</button></div>
    <div class="row"><button class="btn danger" type="button" id="btn-apagar-sala">Apagar sala para sempre</button></div></div>`;
}
$("#pane-jogadores").addEventListener("click", async e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.id === "btn-convite-2") return $("#btn-convite").click();
  if (b.id === "btn-renomear") return acao("sala.renomear", { nome: $("#sala-novo-nome").value }).then(() => toast("Nome salvo.")).catch(() => {});
  if (b.dataset.remover || b.id === "btn-apagar-sala") {
    if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Clique de novo para confirmar"; return; }
    if (b.dataset.remover) acao("jogador.remover", { uid: b.dataset.remover }).catch(() => {});
    else acao("sala.apagar").then(() => { store.set("colisao-sala", ""); abrirLobby(); }).catch(() => {});
  }
});

// ================================================================ som
let ctx = null;
function audioCtx() { if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === "suspended") ctx.resume(); return ctx; }
const audios = {};
function getAudio(k) {
  if (!audios[k]) { const a = new Audio(SONS[k].src); a.loop = SONS[k].loop; a.preload = "auto"; a.addEventListener("ended", () => { S.playing.delete(k); marcarSons(); }); audios[k] = a; }
  audios[k].volume = S.vol; return audios[k];
}
function avisarSom() { const b = $("#btn-som"); b.classList.remove("pulse"); void b.offsetWidth; b.classList.add("pulse"); }
function tocar(k) {
  if (!SONS[k]) return;
  if (!S.audioOn) { avisarSom(); toast("O Mestre tocou um som. Toque em Ativar som para ouvir."); return; }
  const a = getAudio(k); a.currentTime = 0; a.play().then(() => { S.playing.add(k); marcarSons(); }).catch(() => {});
}
function parar(k) {
  const keys = k ? [k] : Object.keys(audios);
  keys.forEach(x => { if (audios[x]) { audios[x].pause(); audios[x].currentTime = 0; } S.playing.delete(x); });
  if (!k && window.speechSynthesis) speechSynthesis.cancel();
  marcarSons();
}
function pararTudo() { parar(null); }
function ativarSom() {
  S.audioOn = true; audioCtx();
  Object.keys(SONS).forEach(k => { const a = getAudio(k); a.muted = true; a.play().then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => { a.muted = false; }); });
  if (window.speechSynthesis) { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; speechSynthesis.speak(u); }
  renderTopo();
}
$("#btn-som").addEventListener("click", () => { if (S.audioOn) { pararTudo(); S.audioOn = false; renderTopo(); } else { ativarSom(); toast("Som ativado. Você vai ouvir o que o Mestre tocar."); } });
$("#vol").addEventListener("input", e => { S.vol = clamp(num(e.target.value, .8), 0, 1); Object.values(audios).forEach(a => (a.volume = S.vol)); store.set("colisao-vol", S.vol); });

// ---- efeito de monstro para falas gravadas (Web Audio)
function curva(k) { const n = 2048, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i * 2 / n - 1; c[i] = (3 + k) * x * 20 * Math.PI / 180 / (Math.PI + k * Math.abs(x)); } return c; }
function impulso(ac, seg) { const len = Math.floor(ac.sampleRate * seg), b = ac.createBuffer(2, len, ac.sampleRate); for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); } return b; }
async function tocarMonstro(arrayBuf, { grave = 0.7, dist = 0.5, eco = 0.4 } = {}) {
  const ac = audioCtx();
  const buf = await ac.decodeAudioData(arrayBuf);
  const src = ac.createBufferSource(); src.buffer = buf; src.playbackRate.value = grave;
  const pre = ac.createGain(); pre.gain.value = 1 + dist * 3;
  const sh = ac.createWaveShaper(); sh.curve = curva(1 + dist * 300); sh.oversample = "4x";
  const graves = ac.createBiquadFilter(); graves.type = "lowshelf"; graves.frequency.value = 160; graves.gain.value = 9;
  const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 4200 - dist * 1800;
  const trem = ac.createGain(); const lfo = ac.createOscillator(); lfo.frequency.value = 26; const lfoG = ac.createGain(); lfoG.gain.value = 0.3 * dist; lfo.connect(lfoG).connect(trem.gain); lfo.start();
  const conv = ac.createConvolver(); conv.buffer = impulso(ac, 2.4); const wet = ac.createGain(); wet.gain.value = eco * 0.9;
  const out = ac.createGain(); out.gain.value = S.vol * (1 - dist * 0.4);
  src.connect(pre).connect(sh).connect(graves).connect(lp).connect(trem);
  trem.connect(out); trem.connect(conv).connect(wet).connect(out); out.connect(ac.destination);
  src.start();
  const dur = buf.duration / grave;
  src.onended = () => { lfo.stop(); setTimeout(() => out.disconnect(), 3000); };
  return dur;
}

// ---- falas: o que todos recebem
let vozT;
function mostrarVoz(quem, texto, ms) {
  $("#voz-quem").textContent = quem || "Uma voz ecoa"; $("#voz-texto").textContent = texto || "…";
  $("#voz").hidden = false; clearTimeout(vozT); vozT = setTimeout(() => ($("#voz").hidden = true), ms);
}
function vozPt() { const vs = window.speechSynthesis ? speechSynthesis.getVoices() : []; return vs.find(v => /pt[-_]BR/i.test(v.lang)) || vs.find(v => /^pt/i.test(v.lang)) || null; }
function falarTexto(d, local) {
  const estimado = 2500 + d.texto.length * 85 / Math.max(.4, d.velocidade || .75);
  if (d.legenda) mostrarVoz(d.quem, d.texto, estimado);
  if (!S.audioOn) { if (!local) { avisarSom(); } return; }
  if (!window.speechSynthesis) { toast("Este navegador não fala texto. A fala aparece só como legenda."); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(d.texto);
  u.lang = "pt-BR"; const v = vozPt(); if (v) u.voice = v;
  u.pitch = clamp(1 - num(d.grave, .9), 0, 2); u.rate = clamp(num(d.velocidade, .75), .4, 1.2); u.volume = S.vol;
  const r = d.rosnado ? getAudio("rosnado") : null;
  if (r) { r.currentTime = 0; r.volume = S.vol * 0.7; r.play().catch(() => {}); }
  const fim = () => { if (r) r.pause(); if (d.legenda) { clearTimeout(vozT); vozT = setTimeout(() => ($("#voz").hidden = true), 1800); } };
  u.onend = fim; u.onerror = fim;
  speechSynthesis.speak(u);
}
async function receberFala(d) {
  if (d.tipo === "texto") return falarTexto(d, false);
  if (d.tipo === "audio") {
    if (!S.audioOn) { avisarSom(); toast("O Mestre mandou uma fala. Toque em Ativar som para ouvir as próximas."); return; }
    try {
      const r = await fetch(`/api/salas/${S.codigo}/audio/${d.id}`, { credentials: "same-origin" });
      if (!r.ok) throw new Error();
      const dur = await tocarMonstro(await r.arrayBuffer(), d);
      mostrarVoz("Uma voz ecoa", "…", dur * 1000 + 1500);
    } catch (e) { toast("Não consegui tocar a fala gravada neste aparelho."); }
  }
}
if (window.speechSynthesis) speechSynthesis.onvoiceschanged = () => {};

// ================================================================ trilha e falas (Mestre)
function renderTrilha() {
  const pane = $("#pane-trilha");
  pane.innerHTML = `<div class="notice">Tudo aqui toca para quem está com a mesa aberta e tocou em <b>Ativar som</b>. Peça para os players ativarem no começo da sessão.</div>

  <div class="card"><h3 class="sec">Fala do monstro: escrever</h3>
    <div class="grid2"><label class="f"><span class="lbl">Quem fala</span><input type="text" id="fala-quem" value="Aquele que Responde" maxlength="60"></label></div>
    <label class="f"><span class="lbl">Fala</span><textarea id="fala-texto" maxlength="400" placeholder="Ex.: Ninguém aqui se perde."></textarea></label>
    <div class="grid2">
      <label class="slider"><span class="lbl">Grave</span><input type="range" id="fala-grave" min="0" max="1" step="0.05" value="0.95"></label>
      <label class="slider"><span class="lbl">Velocidade</span><input type="range" id="fala-vel" min="0.4" max="1.1" step="0.05" value="0.7"></label>
    </div>
    <div class="row"><label class="check"><input type="checkbox" id="fala-rosnado" checked> Rosnado por baixo</label><label class="check"><input type="checkbox" id="fala-legenda" checked> Mostrar a fala na tela</label></div>
    <div class="row"><button class="btn pri" type="button" id="fala-enviar">Falar para todos</button><button class="btn" type="button" id="fala-testar">Testar só para mim</button><button class="btn ghost" type="button" id="fala-salvar">Guardar nas falas prontas</button></div>
    <p style="margin:0;font-size:13px;color:var(--ash)">A voz digitada usa a voz do navegador de cada pessoa, mais grave e com o rosnado por baixo. Para a voz distorcida de verdade, use a gravação abaixo.</p>
    <span class="lbl">Falas prontas</span><div class="falas" id="falas-lista"></div>
  </div>

  <div class="card"><h3 class="sec">Fala do monstro: gravar com o microfone</h3>
    <p style="margin:0;color:var(--ash)">Grave com a sua voz. Cada pessoa ouve com o efeito: mais grave, distorcida e com eco. Até 30 segundos.</p>
    <div class="grid2">
      <label class="slider"><span class="lbl">Grave</span><input type="range" id="rec-grave" min="0.45" max="1" step="0.05" value="0.68"></label>
      <label class="slider"><span class="lbl">Distorção</span><input type="range" id="rec-dist" min="0" max="1" step="0.05" value="0.55"></label>
      <label class="slider"><span class="lbl">Eco</span><input type="range" id="rec-eco" min="0" max="1" step="0.05" value="0.45"></label>
    </div>
    <div class="row"><button class="btn pri rec" type="button" id="rec-btn"><span class="led"></span><span id="rec-txt">Gravar</span></button>
      <button class="btn" type="button" id="rec-ouvir" disabled>Ouvir com efeito</button><button class="btn pri" type="button" id="rec-enviar" disabled>Enviar para todos</button><button class="btn ghost" type="button" id="rec-descartar" disabled>Descartar</button></div>
  </div>

  <div class="card"><h3 class="sec">Sons</h3>
    <div class="row"><button class="btn danger" type="button" data-snd-all>Parar tudo para todos</button></div>
    <div class="sounds">${Object.entries(SONS).map(([k, s]) => `<div class="snd" data-sndbox="${k}"><b>${esc(s.nome)}</b><p>${esc(s.desc)}</p>
      <div class="row"><button class="btn sm pri" type="button" data-snd="${k}" data-snd-act="tocar">Tocar para todos</button><button class="btn sm" type="button" data-snd="${k}" data-snd-act="parar">Parar</button><button class="btn sm ghost" type="button" data-snd="${k}" data-snd-act="ouvir">Só eu</button></div></div>`).join("")}</div>
  </div>`;
  renderFalas();
}
function marcarSons() { $$("[data-sndbox]").forEach(b => b.classList.toggle("playing", S.playing.has(b.dataset.sndbox))); }
function renderFalas() {
  const el = $("#falas-lista"); if (!el || !gm()) return;
  if (emFoco(el)) { adiados.add("falas"); return; } adiados.delete("falas");
  syncRot(); const fs = S.rot.falas || [];
  el.innerHTML = fs.length ? fs.map((f, i) => `<div class="fala-item" data-fi="${i}"><span>“${esc(f.texto)}”</span><button class="btn sm pri" type="button" data-fala-act="falar">Falar</button><button class="btn sm ghost" type="button" data-fala-act="usar">Editar</button><button class="btn sm ghost danger" type="button" data-fala-act="apagar">Apagar</button></div>`).join("")
    : `<div class="empty" style="padding:10px">Nenhuma fala pronta. Escreva uma e guarde.</div>`;
}
function dadosFala(texto) {
  return { texto, quem: $("#fala-quem").value.trim() || "Aquele que Responde", grave: num($("#fala-grave").value, .95), velocidade: num($("#fala-vel").value, .7), rosnado: $("#fala-rosnado").checked, legenda: $("#fala-legenda").checked };
}
let gravador = null, gravacao = null, recTimer = null;
$("#pane-trilha").addEventListener("click", async e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.hasAttribute("data-snd-all")) { acao("som", { acao: "parar", som: null }).catch(() => {}); return; }
  if (b.dataset.snd) {
    const k = b.dataset.snd, a = b.dataset.sndAct;
    if (!S.audioOn) ativarSom();
    if (a === "ouvir") tocar(k); else acao("som", { acao: a, som: k }).catch(() => {});
    return;
  }
  if (b.id === "fala-enviar" || b.id === "fala-testar") {
    const t = $("#fala-texto").value.trim(); if (!t) { $("#fala-texto").focus(); return; }
    if (!S.audioOn) ativarSom();
    if (b.id === "fala-testar") falarTexto(dadosFala(t), true);
    else acao("fala", dadosFala(t)).catch(() => {});
    return;
  }
  if (b.id === "fala-salvar") {
    const t = $("#fala-texto").value.trim(); if (!t) return;
    syncRot(); S.rot.falas.push({ id: rid(), texto: t }); salvarRoteiro(); renderFalas(); toast("Fala guardada."); return;
  }
  if (b.dataset.falaAct) {
    syncRot(); const i = +b.closest("[data-fi]").dataset.fi, f = S.rot.falas[i];
    if (b.dataset.falaAct === "falar") { if (!S.audioOn) ativarSom(); acao("fala", dadosFala(f.texto)).catch(() => {}); }
    if (b.dataset.falaAct === "usar") { $("#fala-texto").value = f.texto; $("#fala-texto").focus(); }
    if (b.dataset.falaAct === "apagar") { S.rot.falas.splice(i, 1); salvarRoteiro(); renderFalas(); }
    return;
  }
  if (b.id === "rec-btn") return gravador ? pararGravacao() : comecarGravacao();
  const efeito = () => ({ grave: num($("#rec-grave").value, .68), dist: num($("#rec-dist").value, .55), eco: num($("#rec-eco").value, .45) });
  if (b.id === "rec-ouvir" && gravacao) { if (!S.audioOn) ativarSom(); try { await tocarMonstro(await gravacao.arrayBuffer(), efeito()); } catch (er) { toast("Não consegui tocar a gravação."); } return; }
  if (b.id === "rec-descartar") { gravacao = null; estadoRec(); return; }
  if (b.id === "rec-enviar" && gravacao) {
    b.disabled = true;
    const q = new URLSearchParams(Object.entries(efeito()).map(([k, v]) => [k, String(v)]));
    try {
      const r = await fetch(`/api/salas/${S.codigo}/fala-audio?${q}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": gravacao.type || "audio/webm" }, body: gravacao });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || "Não consegui enviar.");
      toast("Fala enviada.");
    } catch (er) { toast(er.message); }
    b.disabled = false;
  }
});
function estadoRec() {
  const on = !!gravador;
  $("#rec-btn").classList.toggle("on", on); $("#rec-txt").textContent = on ? "Parar gravação" : (gravacao ? "Gravar de novo" : "Gravar");
  ["rec-ouvir", "rec-enviar", "rec-descartar"].forEach(id => ($("#" + id).disabled = on || !gravacao));
}
async function comecarGravacao() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast("Este navegador não grava áudio. Use Chrome, Edge ou Firefox no computador."); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch (e) { toast("Sem acesso ao microfone. Libere o microfone para este site nas permissões do navegador."); return; }
  const chunks = [];
  gravador = new MediaRecorder(stream);
  gravador.ondataavailable = ev => ev.data.size && chunks.push(ev.data);
  gravador.onstop = () => { stream.getTracks().forEach(t => t.stop()); gravacao = new Blob(chunks, { type: gravador.mimeType || "audio/webm" }); gravador = null; clearTimeout(recTimer); estadoRec(); };
  gravador.start(); estadoRec();
  recTimer = setTimeout(pararGravacao, 30000);
}
function pararGravacao() { if (gravador && gravador.state !== "inactive") gravador.stop(); }

// ================================================================ PDF da ficha
let pdfLibPromise = null;
function carregarPdfLib() {
  if (window.PDFLib) return Promise.resolve();
  if (!pdfLibPromise) pdfLibPromise = new Promise((ok, no) => { const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js"; s.onload = ok; s.onerror = () => { pdfLibPromise = null; no(new Error("Não consegui carregar o gerador de PDF.")); }; document.head.appendChild(s); });
  return pdfLibPromise;
}
const limpar = s => String(s ?? "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\n\x20-\x7E -ÿ–—…•]/g, "");
function quebrar(font, text, width, size) {
  const out = [];
  for (const para of limpar(text).split("\n")) {
    const words = para.split(/\s+/).filter(Boolean); if (!words.length) { out.push(""); continue; }
    let line = "";
    for (let w of words) {
      while (font.widthOfTextAtSize(w, size) > width) { let cut = w.length; while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > width) cut--; if (line) { out.push(line); line = ""; } out.push(w.slice(0, cut)); w = w.slice(cut); }
      const test = line ? line + " " + w : w;
      if (font.widthOfTextAtSize(test, size) <= width) line = test; else { out.push(line); line = w; }
    }
    out.push(line);
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out;
}
function arrumarBloco(font, b, largura, base) {
  const nome = limpar(b.nome).trim();
  for (let size = base; size >= 10; size--) {
    const lines = (nome ? [nome] : []).concat(b.desc?.trim() ? quebrar(font, b.desc, largura, size) : []);
    if (lines.length <= 6 && (!nome || font.widthOfTextAtSize(nome, size) <= largura)) return { lines, size, cortou: false };
  }
  const lines = (nome ? [nome] : []).concat(quebrar(font, b.desc || "", largura, 10));
  return { lines: lines.slice(0, 6), size: 10, cortou: lines.length > 6 };
}
async function baixarPdf(f, btn) {
  btn.disabled = true; const txt = btn.textContent; btn.textContent = "Montando o PDF…";
  try {
    await carregarPdfLib();
    const { PDFDocument, StandardFonts } = window.PDFLib;
    const bytes = await (await fetch("/ficha.pdf")).arrayBuffer();
    const doc = await PDFDocument.load(bytes);
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const form = doc.getForm();
    const caber = (name, text, base) => {
      try {
        const fld = form.getTextField(name), t = limpar(text).replace(/\n/g, " ").trim(); if (!t) return;
        const w = fld.acroField.getWidgets()[0].getRectangle().width - 4;
        let size = base; while (size > 7 && helv.widthOfTextAtSize(t, size) > w) size--;
        fld.setText(t); fld.setFontSize(size);
      } catch (e) {}
    };
    const ca = num(f.caBase, 8) + (f.desviando ? 2 : 0);
    const campos = [["Numero do Arquivo", f.arquivo, 15], ["Rota", f.rota, 16], ["Nome", f.nome, 20], ["Idade", f.idade, 20], ["Nacionalidade", f.nacionalidade, 20], ["Ocupacao", f.ocupacao, 20], ["Estado Civil", f.estadoCivil, 20], ["Data de Nascimento", f.nascimento, 18],
      ["PV atual", f.pv, 40], ["PV max", f.pvMax, 40], ["Couraca atual", ca, 40], ["Couraca max", f.caBase, 40], ["Movimento atual", f.mov, 40], ["Movimento max", f.movMax, 40],
      ["Fisico", f.fisico, 34], ["Influencia", f.influencia, 34], ["Tecnica", f.tecnica, 34], ["Chamado", f.chamado, 18], ["Vontade", `${num(f.vontade)} / ${num(f.vontadeMax)}`, 22], ["Medo", `${num(f.medo)} / ${num(f.medoMax)}`, 22], ["Tormento atual", f.tormento || "", 44]];
    (f.expertises || []).forEach((x, i) => campos.push(["Expertise " + (i + 1), x, 18]));
    TALENTOS.forEach(([k]) => { if (f.talentos?.[k]) campos.push(["Dados " + k, f.talentos[k], 18]); });
    campos.forEach(([n, v, s]) => caber(n, v, s));
    Object.keys(f.estados || {}).forEach(k => { try { form.getCheckBox(k).check(); } catch (e) {} });
    let cortou = false;
    const blocos = (tipo, lista, largura, base) => (lista || []).forEach((b, i) => {
      if (!b.nome && !b.desc) return;
      const r = arrumarBloco(helv, b, largura, base); cortou = cortou || r.cortou;
      r.lines.forEach((ln, j) => { try { const fld = form.getTextField(`${tipo} ${i + 1} linha ${j + 1}`); fld.setText(ln); fld.setFontSize(r.size); } catch (e) {} });
    });
    blocos("Ritual", f.rituais, 562, 17); blocos("Habilidade", f.habilidades, 1140, 18);
    form.updateFieldAppearances(helv);
    const out = await doc.save();
    const url = URL.createObjectURL(new Blob([out], { type: "application/pdf" }));
    const a = document.createElement("a"); a.href = url; a.download = `Ficha_${limpar(f.nome).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w]+/g, "_") || "personagem"}.pdf`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(cortou ? "PDF baixado. Algum ritual ou habilidade não coube nas 6 linhas e foi cortado." : "PDF baixado.");
  } catch (e) { toast(e.message || "Não consegui gerar o PDF."); }
  btn.disabled = false; btn.textContent = txt;
}

// ================================================================ início
async function depoisDoLogin() {
  const pend = new URLSearchParams(location.search).get("entrar") || sessionStorage.getItem("colisao-entrar");
  if (pend) {
    sessionStorage.removeItem("colisao-entrar"); history.replaceState(null, "", "/");
    try { const r = await api("/api/salas/entrar", { method: "POST", body: { codigo: pend } }); return abrirSala(r.codigo); }
    catch (e) { toast(e.message); }
  }
  const ultima = store.get("colisao-sala", "");
  if (ultima) return abrirSala(ultima);
  abrirLobby();
}
async function iniciar() {
  const q = new URLSearchParams(location.search).get("entrar");
  if (q) { sessionStorage.setItem("colisao-entrar", q.toUpperCase()); const av = $("#convite-aviso"); av.hidden = false; av.textContent = `Você foi convidado para a sala ${q.toUpperCase()}. Entre ou crie uma conta para participar.`; }
  try { const r = await api("/api/eu"); S.me = r.usuario; } catch (e) { S.me = null; }
  if (!S.me) { mostrar("login"); if (q) { $$("[data-auth]")[1].click(); } $("#auth-user").focus(); return; }
  depoisDoLogin();
}
iniciar();
})();

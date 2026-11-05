/* Controle de acesso do portal publicado no claude.ai (mesmo modelo do Portal SPO).
   Login com e-mail + código. Dois tipos de usuário:
     - Administrador: vê tudo e cadastra/libera acessos (precisa ser Editor do portal no claude.ai para gravar);
     - Usuário: só acessa, no escopo liberado (todas as GEOs, uma GEO ou uma unidade).
   Proprietário e Editores do portal no claude.ai entram direto como administradores.

   db: usuarios/<sha u|e-mail>          = {email, nome, tipo, perfil, escopo, codigo, criadoEm, origem}   (só administradores)
       acesso/<sha a|e-mail|código>     = {tipo, perfil, escopo, nome}                                    (lido no login)
       config/dados                     = {asset, arquivo, enviadoEm, resumo}                             (dados atuais do painel)
       config/portal                    = {contato}
   Só este arquivo conhece o db; o núcleo do painel recebe window.__DADOS__ já recortado pelo escopo. */
(function () {
  'use strict';
  window.__ACESSO__ = true;
  const LS = 'painel-ambiental-login';
  const TIPOS = { usuario: 'Usuário', admin: 'Administrador' };
  const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  const ACC = { db: null, user: null, assets: null, downloads: null, admin: false, editor: false, nome: '', email: '', perfil: 'todos', escopo: '', contato: '' };
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = e => String(e || '').trim().toLowerCase();
  const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const normCod = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(norm(e));
  const codUn = n => (String(n).match(/^\s*(BR[0-9A-Z]{2})/) || [])[1] || '';
  async function sha(t) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  const chaveUsuario = e => sha('u|' + norm(e));
  const chaveAcesso = (e, c) => sha('a|' + norm(e) + '|' + normCod(c));
  function novoCodigo() {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', r = crypto.getRandomValues(new Uint32Array(8));
    const s = [...r].map(x => A[x % A.length]).join('');
    return s.slice(0, 4) + '-' + s.slice(4);
  }
  const lsGet = () => { try { return JSON.parse(localStorage.getItem(LS) || 'null'); } catch (e) { return null; } };
  const lsSet = v => { try { v ? localStorage.setItem(LS, JSON.stringify(v)) : localStorage.removeItem(LS); } catch (e) {} };
  function toast(t) {
    let el = $('#ac-toast'); if (!el) { el = document.createElement('div'); el.id = 'ac-toast'; el.className = 'ac-toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = t; el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 3200);
  }
  function copiar(texto, rotulo) {
    navigator.clipboard.writeText(texto).then(() => toast(rotulo + ' copiado')).catch(() => toast('Não deu para copiar: selecione o texto e use Ctrl+C'));
  }
  const linkPortal = () => location.href.split('#')[0];
  const geos = () => [...new Set(window.__DADOS__.dic.geo)].filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt'));
  const curtoUn = n => String(n).replace(/^\s*BR[0-9A-Z]{2}\s*-\s*/, '');
  const unidades = () => window.__DADOS__.unidades.map(u => u.nome).sort((a, b) => curtoUn(a).localeCompare(curtoUn(b), 'pt'));
  const rotEscopo = (p, e) => p === 'todos' ? 'Todas as GEOs' : (e || '—');
  const rotUsuario = u => u.tipo === 'admin' ? 'Tudo · administra acessos' : rotEscopo(u.perfil, u.escopo);
  /* escopo num único campo: "todos", "geo:GEO CO" ou "unidade:BR5U - CDD Goiania" */
  const escVal = (p, e) => p === 'todos' ? 'todos' : p + ':' + e;
  const escDe = v => { const i = v.indexOf(':'); return i < 0 ? { perfil: 'todos', escopo: '' } : { perfil: v.slice(0, i), escopo: v.slice(i + 1) }; };
  const opcoesEscopo = sel => `<option value="todos"${sel === 'todos' ? ' selected' : ''}>Todas as GEOs</option>
    <optgroup label="Uma GEO">${geos().map(g => `<option value="${esc('geo:' + g)}"${sel === 'geo:' + g ? ' selected' : ''}>${esc(g)}</option>`).join('')}</optgroup>
    <optgroup label="Uma unidade">${unidades().map(u => `<option value="${esc('unidade:' + u)}"${sel === 'unidade:' + u ? ' selected' : ''}>${esc(curtoUn(u))} (${esc(codUn(u) || '—')})</option>`).join('')}</optgroup>`;

  /* ---------- tela de entrada ---------- */
  const gate = document.createElement('div');
  gate.className = 'ac-gate'; gate.id = 'ac-gate';
  document.body.appendChild(gate);
  function telaGate(estado, aviso) {
    gate.hidden = false;
    const marca = '<div class="ac-marca"><span class="ac-k">L&amp;A · Ambiental</span><h1>Indicadores<br><em>Ambientais</em></h1></div>';
    if (estado === 'carregando') { gate.innerHTML = `<div class="ac-card">${marca}<p class="ac-lead"><span class="ac-spin"></span>Verificando seu acesso…</p></div>`; return; }
    if (estado === 'sem-plataforma') { gate.innerHTML = `<div class="ac-card">${marca}<p class="ac-lead">Para entrar, abra o painel pelo link do claude.ai e faça login na sua conta.</p></div>`; return; }
    gate.innerHTML = `<div class="ac-card">${marca}
      <p class="ac-lead">Entre com o e-mail cadastrado e o código de acesso que a equipe Demarco enviou para você.</p>
      <form id="ac-login" novalidate>
        <label for="ac-email">E-mail<input id="ac-email" type="email" autocomplete="username" placeholder="nome@empresa.com.br"></label>
        <label for="ac-cod">Código de acesso<input id="ac-cod" type="password" autocomplete="current-password" placeholder="XXXX-XXXX"></label>
        <button class="ac-btn" type="submit" id="ac-entrar">Entrar</button>
        <p class="ac-err" id="ac-err" aria-live="polite"></p>
      </form>
      <p class="ac-lead ac-peq">Ainda não tem acesso? <button class="ac-lnk" id="ac-req-abrir" type="button">Solicitar acesso</button></p>
      <form id="ac-req" novalidate hidden>
        <label for="ac-r-nome">Nome<input id="ac-r-nome" autocomplete="name"></label>
        <label for="ac-r-email">E-mail<input id="ac-r-email" type="email" autocomplete="email"></label>
        <label for="ac-r-area">Área ou unidade<input id="ac-r-area" placeholder="Ex.: GEO RJ-ES ou CDD Vitória"></label>
        <button class="ac-btn ac-sec" type="submit">Gerar pedido</button>
        <p class="ac-err" id="ac-r-err" aria-live="polite"></p>
        <div id="ac-r-out" hidden><p class="ac-peq" id="ac-r-dest"></p><textarea id="ac-r-msg" rows="6" readonly></textarea><button class="ac-btn ac-sec" type="button" id="ac-r-copiar">Copiar pedido</button></div>
      </form></div>`;
    if (aviso) $('#ac-err').textContent = aviso;
    const salvo = lsGet(); if (salvo && salvo.email) $('#ac-email').value = salvo.email;
    $('#ac-login').addEventListener('submit', async e => {
      e.preventDefault();
      const em = norm($('#ac-email').value), cod = $('#ac-cod').value;
      if (!emailOk(em) || normCod(cod).length < 6) { $('#ac-err').textContent = 'Informe o e-mail e o código de acesso.'; return; }
      const b = $('#ac-entrar'); b.disabled = true; b.textContent = 'Entrando…'; $('#ac-err').textContent = '';
      const ok = await tentarLogin(em, cod);
      b.disabled = false; b.textContent = 'Entrar';
      if (ok) { lsSet({ email: em, codigo: normCod(cod) }); posLogin(); }
      else $('#ac-err').textContent = 'E-mail ou código incorretos. Confira o código recebido ou solicite acesso.';
    });
    $('#ac-req-abrir').addEventListener('click', () => { const f = $('#ac-req'); f.hidden = !f.hidden; if (!f.hidden) $('#ac-r-nome').focus(); });
    $('#ac-req').addEventListener('submit', e => {
      e.preventDefault();
      const nome = $('#ac-r-nome').value.trim(), em = norm($('#ac-r-email').value), area = $('#ac-r-area').value.trim();
      if (!nome || !emailOk(em)) { $('#ac-r-err').textContent = 'Preencha o nome e um e-mail válido.'; return; }
      $('#ac-r-err').textContent = '';
      $('#ac-r-msg').value = `Olá! Gostaria de solicitar acesso ao Painel Indicadores Ambientais.\n\nNome: ${nome}\nE-mail: ${em}${area ? `\nÁrea ou unidade: ${area}` : ''}\n\nObrigado(a)!`;
      $('#ac-r-dest').textContent = ACC.contato ? `Copie o pedido e envie para: ${ACC.contato}` : 'Copie o pedido e envie para o responsável pelo painel na Demarco.';
      $('#ac-r-out').hidden = false;
    });
    $('#ac-r-copiar').addEventListener('click', () => {
      const t = $('#ac-r-msg');
      navigator.clipboard.writeText(t.value).then(() => toast('Pedido copiado')).catch(() => { t.focus(); t.select(); toast('Selecionado: use Ctrl+C para copiar'); });
    });
  }

  async function tentarLogin(email, codigo) {
    try {
      const s = await ACC.db.doc('acesso/' + await chaveAcesso(email, codigo)).get();
      if (!s.exists) return false;
      const a = s.data() || {};
      if (a.tipo === 'admin') { ACC.admin = true; ACC.perfil = 'todos'; ACC.escopo = ''; }
      else {
        if (!['todos', 'geo', 'unidade'].includes(a.perfil)) return false;
        if (a.perfil !== 'todos' && !a.escopo) return false;
        ACC.perfil = a.perfil; ACC.escopo = String(a.escopo || '');
      }
      ACC.nome = String(a.nome || ''); ACC.email = norm(email);
      return true;
    } catch (e) { return false; }
  }

  /* ---------- dados: os mais recentes enviados pelo administrador, recortados pelo escopo ---------- */
  const validos = d => d && d.dic && Array.isArray(d.regs) && Array.isArray(d.unidades) && Array.isArray(d.aplic) && d.fontes;
  async function carregarDados() {
    try {
      const c = await ACC.db.doc('config/dados').get();
      if (c.exists && c.data().asset) {
        const r = await fetch('/_blob/' + c.data().asset);
        if (r.ok) { const d = await r.json(); if (validos(d)) { window.__DADOS__ = d; ACC.dadosInfo = c.data(); } }
      }
    } catch (e) { /* fica com os dados embutidos no painel */ }
  }
  function recortar() {
    if (ACC.admin || ACC.perfil === 'todos') return;
    const D = window.__DADOS__, e = ACC.escopo;
    if (ACC.perfil === 'geo') {
      const g = D.dic.geo.indexOf(e);
      D.regs = D.regs.filter(r => r[1] === g);
      D.unidades = D.unidades.filter(u => u.geo === e);
      D.aplic = D.aplic.filter(a => a.geo === e);
    } else {
      const u = D.dic.un.indexOf(e), cod = codUn(e);
      D.regs = D.regs.filter(r => r[0] === u);
      D.unidades = D.unidades.filter(x => x.nome === e);
      D.aplic = D.aplic.filter(a => cod ? a.cod === cod : false);
    }
  }

  async function posLogin() {
    if (ACC.admin && !ACC.assets) { ACC.assets = await claude.use('assets'); }
    if (ACC.admin) ACC.downloads = await claude.use('downloads');
    abrirPainel();
  }
  function abrirPainel() {
    recortar();
    gate.hidden = true;
    const tab = $('#tab-usuarios'), sec = document.querySelector('[data-panel="usuarios"]');
    if (ACC.admin) tab.hidden = false; else { tab.remove(); sec.remove(); }
    const q = $('#quem');
    q.hidden = false;
    q.innerHTML = '<i></i><span class="t"></span>' + (ACC.dono ? '' : '<button class="ac-lnk" id="ac-sair" type="button">Sair</button>');
    q.querySelector('.t').textContent = (ACC.nome || ACC.email || 'Você') + ' · ' + (ACC.admin ? 'Administrador' : rotEscopo(ACC.perfil, ACC.escopo));
    const sair = $('#ac-sair'); if (sair) sair.addEventListener('click', () => { lsSet({ email: ACC.email }); location.reload(); });
    window.__NUCLEO__();
    /* na aba Usuários os filtros do painel não se aplicam */
    window.Painel.aoMudarAba(aba => {
      const u = aba === 'usuarios';
      ['#filtros', '#btn-f', '.chipbar'].forEach(s => { const el = $(s); if (el) el.hidden = u; });
    });
    window.__LAYOUT__();
    if (ACC.admin) { montarUsuarios(); ouvirUsuarios(); }
  }

  /* ---------- aba Usuários (administradores) ---------- */
  let USERS = [];
  function ouvirUsuarios() {
    ACC.db.collection('usuarios').onSnapshot(s => {
      USERS = s.docs.map(d => ({ id: d.id, ...d.data() })).filter(u => typeof u.email === 'string');
      listarUsuarios();
    }, () => {
      const b = $('#u-list'); if (b) b.innerHTML = `<p class="ac-err">${ACC.editor ? 'Não foi possível carregar os usuários agora. Recarregue a página.' : 'Para ver e cadastrar usuários, peça ao dono do portal para compartilhar com você como Editor no claude.ai.'}</p>`;
    });
  }
  async function gravarUsuario(u, codigoAntigo) {
    const k = await chaveUsuario(u.email);
    if (codigoAntigo && codigoAntigo !== u.codigo) await ACC.db.doc('acesso/' + await chaveAcesso(u.email, codigoAntigo)).delete();
    await ACC.db.doc('usuarios/' + k).set(u);
    await ACC.db.doc('acesso/' + await chaveAcesso(u.email, u.codigo)).set({ tipo: u.tipo, perfil: u.perfil, escopo: u.escopo, nome: u.nome });
  }
  const textoAcesso = u => `Acesso ao Painel Indicadores Ambientais\nLink: ${linkPortal()}\nE-mail: ${u.email}\nCódigo de acesso: ${u.codigo}`;
  const erroGravar = () => ACC.editor ? 'Não foi possível salvar agora. Tente de novo em alguns segundos.' : 'Para cadastrar, você precisa ser Editor do portal no claude.ai. Peça ao dono do portal para alterar seu compartilhamento.';

  function montarUsuarios() {
    const info = ACC.dadosInfo;
    $('#usuarios-area').innerHTML = `
      ${ACC.editor ? '' : '<div class="row" style="margin-top:22px"><div class="ac-aviso"><b>Seu acesso no claude.ai ainda não permite cadastrar.</b> Você entrou como Administrador, mas para gravar usuários e enviar dados é preciso ser <b>Editor</b> do portal no claude.ai. Peça ao dono do portal para alterar seu compartilhamento.</div></div>'}
      <div class="row" style="margin-top:22px"><div class="c">
        <span class="c-k">Acesso</span><h3>Liberar acesso ao painel</h3>
        <p class="c-s">Cadastre a pessoa e o que ela pode ver. O portal gera um código de acesso; com e-mail e código, ela entra direto no painel.</p>
        <ol class="ac-passos"><li><b>Cadastre</b> aqui, uma pessoa por vez ou várias pela planilha (card abaixo).</li><li><b>Compartilhe o portal</b> com a pessoa no claude.ai (botão Compartilhar do portal). Administradores precisam ser compartilhados como <b>Editor</b>.</li><li><b>Envie o acesso</b> pelo botão “Copiar acesso” ou pela planilha de acessos.</li></ol>
        <div class="ac-tipos"><div><span class="ac-tag" data-t="usuario">Usuário</span> só acessa o painel, no escopo liberado.</div><div><span class="ac-tag" data-t="admin">Administrador</span> vê tudo e cadastra e libera acessos de outras pessoas.</div></div>
        <form id="u-form" class="ac-form" novalidate>
          <label for="u-email">E-mail<input id="u-email" type="email" placeholder="nome@empresa.com.br" autocomplete="off"></label>
          <label for="u-nome">Nome<input id="u-nome" placeholder="Nome da pessoa" autocomplete="off"></label>
          <label for="u-tipo">Tipo<select id="u-tipo"><option value="usuario">Usuário</option><option value="admin">Administrador</option></select></label>
          <label for="u-escopo" id="u-escopo-l">Pode ver<select id="u-escopo">${opcoesEscopo('todos')}</select></label>
          <button class="ac-btn" type="submit" id="u-salvar">Cadastrar acesso</button>
          <p class="ac-err" id="u-err" aria-live="polite"></p>
        </form>
      </div></div>
      <div class="row"><div class="c">
        <span class="c-k">Planilha</span><h3>Cadastrar várias pessoas pela planilha</h3>
        <p class="c-s">Envie a planilha de cadastro com as colunas <b>GEO</b>, <b>Unidade</b>, <b>Nome</b> e <b>E-mail</b>. A coluna <b>Tipo</b> é opcional (Usuário ou Administrador; em branco vira Usuário). O portal mostra uma prévia para você conferir o que cada pessoa vai ver e então gera os códigos de todos.</p>
        <label class="ac-btn ac-sec ac-arquivo" for="p-arquivo">Escolher planilha (.xlsx ou .csv)<input id="p-arquivo" type="file" accept=".xlsx,.xls,.csv"></label>
        <p class="ac-err" id="p-err" aria-live="polite"></p>
        <div id="p-previa"></div>
      </div></div>
      <div class="row"><div class="c">
        <div class="ac-lista-h"><div><span class="c-k">Usuários</span><h3>Acessos liberados</h3></div>
          <div class="ac-lista-acoes"><span class="ac-cont" id="u-count"></span><button class="ac-mini" type="button" id="u-copiar-todos">Copiar todos</button><button class="ac-mini" type="button" id="u-baixar-todos">Baixar planilha de acessos</button></div></div>
        <div id="u-list" class="ac-lista"><p class="c-s">Carregando usuários…</p></div>
      </div></div>
      <div class="row r-2">
        <div class="c"><span class="c-k">Dados</span><h3>Atualizar os dados do painel</h3>
          <p class="c-s">Dê dois cliques em <b>Atualizar e publicar painel.bat</b> no computador. Ele lê as planilhas e gera o arquivo <b>Dados do painel.json</b>. Envie esse arquivo aqui e todos passam a ver os dados novos.</p>
          <p class="ac-peq" id="d-info">${info ? `Dados atuais: enviados em ${esc(new Date(info.enviadoEm).toLocaleString('pt-BR'))} · ${esc(info.resumo || '')}` : `Dados atuais: os que vieram junto com o painel (${esc(window.__DADOS__.fontes.principalModificado || '')}).`}</p>
          <label class="ac-btn ac-arquivo" for="d-arquivo">Escolher “Dados do painel.json”<input id="d-arquivo" type="file" accept=".json,application/json"></label>
          <p class="ac-err" id="d-err" aria-live="polite"></p></div>
        <div class="c"><span class="c-k">Contato</span><h3>Contato para pedidos de acesso</h3>
          <p class="c-s">Aparece para quem clica em “Solicitar acesso” na tela de entrada.</p>
          <form id="cfg-form" class="ac-form" novalidate><label for="cfg-contato">E-mail ou nome do responsável<input id="cfg-contato" value="${esc(ACC.contato)}"></label>
          <button class="ac-btn ac-sec" type="submit">Salvar contato</button><p class="ac-err" id="cfg-msg" aria-live="polite"></p></form></div>
      </div>`;
    const tipo = $('#u-tipo'), escopoL = $('#u-escopo-l');
    tipo.addEventListener('change', () => { escopoL.hidden = tipo.value === 'admin'; });
    $('#u-form').addEventListener('submit', async e => {
      e.preventDefault();
      const em = norm($('#u-email').value), nome = $('#u-nome').value.trim().slice(0, 120), t = tipo.value;
      const { perfil, escopo } = t === 'admin' ? { perfil: 'todos', escopo: '' } : escDe($('#u-escopo').value);
      const msg = $('#u-err');
      if (!emailOk(em)) { msg.textContent = 'Informe um e-mail válido.'; return; }
      msg.textContent = ''; const b = $('#u-salvar'); b.disabled = true; b.textContent = 'Salvando…';
      try {
        const antigo = USERS.find(x => x.email === em);
        const u = { email: em, nome, tipo: t, perfil, escopo, codigo: novoCodigo(), criadoEm: new Date().toISOString(), origem: 'manual' };
        await gravarUsuario(u, antigo && antigo.codigo);
        toast(`Acesso criado para ${em}. Código: ${u.codigo}`);
        $('#u-form').reset(); escopoL.hidden = false;
      } catch (err) { msg.textContent = erroGravar(); }
      finally { b.disabled = false; b.textContent = 'Cadastrar acesso'; }
    });
    $('#cfg-form').addEventListener('submit', async e => {
      e.preventDefault();
      const c = $('#cfg-contato').value.trim().slice(0, 160), m = $('#cfg-msg');
      try { await ACC.db.doc('config/portal').set({ contato: c }); ACC.contato = c; m.className = 'ac-ok'; m.textContent = 'Contato salvo.'; }
      catch (err) { m.className = 'ac-err'; m.textContent = erroGravar(); }
    });
    $('#d-arquivo').addEventListener('change', e => enviarDados(e.target));
    $('#p-arquivo').addEventListener('change', e => lerPlanilha(e.target));
    $('#u-copiar-todos').addEventListener('click', () => copiarTabela(USERS));
    $('#u-baixar-todos').addEventListener('click', () => baixarPlanilha(USERS, 'Acessos - Painel Indicadores Ambientais.xlsx'));
  }

  /* ---------- importação pela planilha de cadastro ---------- */
  let XLSX_P = null;
  const carregarXLSX = () => XLSX_P || (XLSX_P = new Promise((ok, falha) => {
    if (window.XLSX) return ok(window.XLSX);
    const s = document.createElement('script'); s.src = XLSX_URL; s.onload = () => ok(window.XLSX); s.onerror = () => { XLSX_P = null; falha(new Error('xlsx')); };
    document.head.appendChild(s);
  }));
  const chaveCol = h => semAcento(h).replace(/[^a-z]/g, '');
  const COLS = { geo: ['geo', 'regional'], unidade: ['unidade', 'cdd', 'localidade'], nome: ['god', 'nome', 'responsavel', 'gestor'], email: ['email', 'emails'], tipo: ['tipo', 'perfil', 'acesso'] };
  /* núcleo do nome da unidade, para comparar "AS Goiânia" com "BR5U - CDD Goiania" */
  const nucleoUn = n => semAcento(curtoUn(n)).replace(/\[[^\]]*\]/g, ' ').replace(/\b(cdd|cdl|cdc|cds|cd|as|revenda|unidade|filial)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  function achaGeo(txt) {
    const k = semAcento(txt).replace(/^geo\s*/, '').replace(/[^a-z0-9]/g, '');
    return k ? geos().find(g => semAcento(g).replace(/^geo\s*/, '').replace(/[^a-z0-9]/g, '') === k) || '' : '';
  }
  function achaUnidade(txt, geo) {
    const k = nucleoUn(txt); if (!k) return { un: '', duvida: false };
    let cands = window.__DADOS__.unidades.filter(u => { const n = nucleoUn(u.nome); return n === k || n.split(' (')[0] === k || (' ' + n + ' ').includes(' ' + k + ' '); });
    if (geo && cands.some(u => u.geo === geo)) cands = cands.filter(u => u.geo === geo);
    if (cands.length > 1) { const exato = cands.filter(u => nucleoUn(u.nome) === k && !/\[/.test(u.nome)); if (exato.length === 1) cands = exato; }
    return cands.length === 1 ? { un: cands[0].nome, duvida: false } : { un: '', duvida: cands.length > 1 };
  }
  let PREVIA = [];
  async function lerPlanilha(inp) {
    const f = inp.files && inp.files[0], err = $('#p-err'); err.className = 'ac-err'; err.textContent = ''; $('#p-previa').innerHTML = '';
    if (!f) return;
    try {
      err.className = 'ac-ok'; err.textContent = 'Lendo a planilha…';
      const X = await carregarXLSX();
      const wb = X.read(await f.arrayBuffer(), { type: 'array' });
      const linhas = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false });
      const iCab = linhas.findIndex(l => l.some(c => COLS.email.includes(chaveCol(c))));
      if (iCab < 0) { err.className = 'ac-err'; err.textContent = 'Não encontrei a coluna “E-mail” na primeira aba da planilha.'; return; }
      const cab = linhas[iCab].map(chaveCol), idx = {};
      Object.entries(COLS).forEach(([k, nomes]) => { idx[k] = cab.findIndex(c => nomes.includes(c)); });
      const vistos = new Set();
      PREVIA = linhas.slice(iCab + 1).filter(l => l.some(c => String(c).trim())).map((l, n) => {
        const val = k => idx[k] >= 0 ? String(l[idx[k]] || '').trim() : '';
        const em = norm(val('email')), geoTxt = val('geo'), unTxt = val('unidade');
        const tipo = /adm/i.test(val('tipo')) ? 'admin' : 'usuario';
        const geo = achaGeo(geoTxt), achou = achaUnidade(unTxt, geo);
        let escopo = 'todos', aviso = '';
        if (achou.un) escopo = 'unidade:' + achou.un;
        else if (geo) { escopo = 'geo:' + geo; if (unTxt) aviso = achou.duvida ? 'Unidade com mais de uma opção: escolha abaixo' : 'Unidade não encontrada: liberada a GEO'; }
        else if (geoTxt || unTxt) aviso = 'GEO e unidade não encontradas: confira';
        let status = 'ok';
        if (!emailOk(em)) { status = 'erro'; aviso = 'E-mail inválido'; }
        else if (vistos.has(em)) { status = 'erro'; aviso = 'E-mail repetido na planilha'; }
        vistos.add(em);
        const existe = USERS.find(u => u.email === em);
        return { n: iCab + n + 2, email: em, nome: val('nome'), geoTxt, unTxt, tipo, escopo, aviso, status, existe: !!existe };
      });
      if (!PREVIA.length) { err.className = 'ac-err'; err.textContent = 'A planilha não tem linhas de cadastro abaixo do cabeçalho.'; return; }
      err.textContent = '';
      desenharPrevia();
    } catch (e) {
      err.className = 'ac-err';
      err.textContent = e && e.message === 'xlsx' ? 'Não foi possível carregar o leitor de planilhas. Confira a internet e tente de novo.' : 'Não consegui ler esse arquivo. Envie a planilha de cadastro em .xlsx ou .csv.';
    } finally { inp.value = ''; }
  }
  function desenharPrevia() {
    const ok = PREVIA.filter(p => p.status === 'ok'), novos = ok.filter(p => !p.existe).length;
    $('#p-previa').innerHTML = `
      <div class="ac-previa-h"><b>${PREVIA.length} linhas lidas</b><span>${novos} novos · ${ok.length - novos} já cadastrados (o código atual é mantido) · ${PREVIA.length - ok.length} com erro (ficam de fora)</span></div>
      <div class="ac-tab-wrap"><table class="ac-tab"><thead><tr><th>Linha</th><th>Nome</th><th>E-mail</th><th>Na planilha</th><th>Tipo</th><th>Pode ver</th><th></th></tr></thead><tbody>
      ${PREVIA.map((p, i) => `<tr class="${p.status === 'erro' ? 'ac-tr-erro' : ''}">
        <td class="num">${p.n}</td><td>${esc(p.nome || '—')}</td><td>${esc(p.email || '—')}</td>
        <td class="ac-peq">${esc([p.geoTxt, p.unTxt].filter(Boolean).join(' · ') || '—')}</td>
        <td>${p.status === 'erro' ? '' : `<select data-pt="${i}" aria-label="Tipo da linha ${p.n}"><option value="usuario"${p.tipo === 'usuario' ? ' selected' : ''}>Usuário</option><option value="admin"${p.tipo === 'admin' ? ' selected' : ''}>Administrador</option></select>`}</td>
        <td>${p.status === 'erro' ? '' : p.tipo === 'admin' ? '<span class="ac-peq">Tudo</span>' : `<select data-pe="${i}" aria-label="Escopo da linha ${p.n}">${opcoesEscopo(p.escopo)}</select>`}</td>
        <td class="ac-peq ${p.status === 'erro' ? 'ac-err' : p.aviso ? 'ac-alerta' : ''}">${esc(p.aviso || (p.existe ? 'Já cadastrado' : 'Novo'))}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="ac-previa-acoes"><button class="ac-btn" type="button" id="p-gerar"${ok.length ? '' : ' disabled'}>Gerar acessos para ${ok.length} ${ok.length === 1 ? 'pessoa' : 'pessoas'}</button><button class="ac-btn ac-sec" type="button" id="p-cancelar">Cancelar</button><p class="ac-err" id="p-msg" aria-live="polite"></p></div>
      <div id="p-result"></div>`;
    $('#p-previa').querySelectorAll('[data-pe]').forEach(s => s.addEventListener('change', () => { PREVIA[+s.dataset.pe].escopo = s.value; PREVIA[+s.dataset.pe].aviso = ''; }));
    $('#p-previa').querySelectorAll('[data-pt]').forEach(s => s.addEventListener('change', () => { PREVIA[+s.dataset.pt].tipo = s.value; desenharPrevia(); }));
    $('#p-cancelar').addEventListener('click', () => { PREVIA = []; $('#p-previa').innerHTML = ''; });
    $('#p-gerar').addEventListener('click', gerarLote);
  }
  async function gerarLote() {
    const lote = PREVIA.filter(p => p.status === 'ok'), b = $('#p-gerar'), msg = $('#p-msg');
    b.disabled = true; $('#p-cancelar').disabled = true; msg.className = 'ac-ok';
    const feitos = []; let falhas = 0;
    for (let i = 0; i < lote.length; i++) {
      const p = lote[i]; msg.textContent = `Gerando acessos… ${i + 1} de ${lote.length}`;
      const antigo = USERS.find(u => u.email === p.email);
      const { perfil, escopo } = p.tipo === 'admin' ? { perfil: 'todos', escopo: '' } : escDe(p.escopo);
      const u = { email: p.email, nome: p.nome || (antigo && antigo.nome) || '', tipo: p.tipo, perfil, escopo,
        codigo: (antigo && antigo.codigo) || novoCodigo(), criadoEm: (antigo && antigo.criadoEm) || new Date().toISOString(), origem: 'planilha',
        geoPlanilha: p.geoTxt, unidadePlanilha: p.unTxt };
      try { await gravarUsuario(u, antigo && antigo.codigo); feitos.push(u); }
      catch (e) { falhas++; if (i === 0) { msg.className = 'ac-err'; msg.textContent = erroGravar(); b.disabled = false; $('#p-cancelar').disabled = false; return; } }
    }
    msg.textContent = `${feitos.length} acessos gerados${falhas ? ` · ${falhas} não foram gravados, envie a planilha de novo para tentar esses` : ''}.`;
    if (falhas) msg.className = 'ac-err';
    $('#p-result').innerHTML = `<div class="ac-previa-acoes"><button class="ac-btn" type="button" id="p-baixar">Baixar planilha com os acessos</button><button class="ac-btn ac-sec" type="button" id="p-copiar">Copiar tabela</button></div>`;
    $('#p-baixar').addEventListener('click', () => baixarPlanilha(feitos, 'Acessos gerados - Painel Indicadores Ambientais.xlsx'));
    $('#p-copiar').addEventListener('click', () => copiarTabela(feitos));
    PREVIA = [];
  }
  /* tabela de acessos: mesma estrutura no download e na cópia */
  const CAB = ['GEO', 'Unidade', 'Nome', 'E-mail', 'Tipo', 'Pode ver', 'Código de acesso', 'Link do painel'];
  const linhaAcesso = u => [u.geoPlanilha || (u.perfil === 'geo' ? u.escopo : u.perfil === 'unidade' ? ((window.__DADOS__.unidades.find(x => x.nome === u.escopo) || {}).geo || '') : ''),
    u.unidadePlanilha || (u.perfil === 'unidade' ? curtoUn(u.escopo) : ''), u.nome || '', u.email, TIPOS[u.tipo] || 'Usuário', rotUsuario(u), u.codigo, linkPortal()];
  const ordenar = L => [...L].sort((a, b) => String(linhaAcesso(a)[0]).localeCompare(String(linhaAcesso(b)[0]), 'pt') || a.email.localeCompare(b.email));
  function copiarTabela(L) {
    if (!L.length) { toast('Nenhum acesso para copiar'); return; }
    const t = [CAB, ...ordenar(L).map(linhaAcesso)].map(l => l.map(c => String(c).replace(/[\t\n]/g, ' ')).join('\t')).join('\n');
    copiar(t, 'Tabela (cole no Excel)');
  }
  async function baixarPlanilha(L, nome) {
    if (!L.length) { toast('Nenhum acesso para baixar'); return; }
    if (!ACC.downloads) { toast('Download indisponível aqui: use “Copiar” e cole no Excel'); return; }
    try {
      const X = await carregarXLSX();
      const ws = X.utils.aoa_to_sheet([CAB, ...ordenar(L).map(linhaAcesso)]);
      ws['!cols'] = [{ wch: 10 }, { wch: 26 }, { wch: 26 }, { wch: 34 }, { wch: 14 }, { wch: 28 }, { wch: 16 }, { wch: 52 }];
      const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, 'Acessos');
      const dados = X.write(wb, { bookType: 'xlsx', type: 'array' });
      const r = await ACC.downloads.save({ filename: nome, data: new Uint8Array(dados) });
      if (r && r.status === 'saved') toast('Planilha salva');
    } catch (e) {
      if (e && e.code === 'declined') return;
      toast(e && e.message === 'xlsx' ? 'Não foi possível carregar o gerador de planilhas. Use “Copiar”.' : 'Não foi possível baixar agora. Use “Copiar” e cole no Excel.');
    }
  }

  async function enviarDados(inp) {
    const f = inp.files && inp.files[0], err = $('#d-err'); err.className = 'ac-err'; err.textContent = '';
    if (!f) return;
    let d;
    try { d = JSON.parse(await f.text()); } catch (e) { err.textContent = 'Esse arquivo não é o “Dados do painel.json”. Gere de novo pelo .bat e envie o arquivo gerado.'; inp.value = ''; return; }
    if (!validos(d)) { err.textContent = 'Esse arquivo não tem os dados do painel. Envie o “Dados do painel.json” gerado pelo .bat.'; inp.value = ''; return; }
    if (!ACC.assets) { err.textContent = 'Seu acesso no claude.ai não permite enviar arquivos. Peça para ser Editor do portal.'; inp.value = ''; return; }
    err.className = 'ac-ok'; err.textContent = 'Enviando…';
    try {
      const anterior = ACC.dadosInfo && ACC.dadosInfo.asset;
      const up = await ACC.assets.upload(new Blob([JSON.stringify(d)], { type: 'application/json' }), { type: 'application/json' });
      const resumo = `${d.regs.length.toLocaleString('pt-BR')} condicionantes · planilha salva em ${d.fontes.principalModificado || '—'}`;
      await ACC.db.doc('config/dados').set({ asset: up.id, arquivo: f.name, enviadoEm: new Date().toISOString(), resumo });
      if (anterior && anterior !== up.id) { try { await ACC.assets.delete(anterior); } catch (e) {} }
      err.textContent = 'Dados atualizados. Recarregando o painel…';
      setTimeout(() => location.reload(), 900);
    } catch (e) {
      err.className = 'ac-err';
      err.textContent = e && e.code === 'not_granted' ? 'Seu acesso no claude.ai não permite enviar arquivos. Peça para ser Editor do portal.' : 'Não foi possível enviar agora. Tente de novo em alguns segundos.';
    } finally { inp.value = ''; }
  }

  function listarUsuarios() {
    const box = $('#u-list'); if (!box) return;
    const L = [...USERS].sort((a, b) => (a.tipo === 'admin' ? 0 : 1) - (b.tipo === 'admin' ? 0 : 1) || rotUsuario(a).localeCompare(rotUsuario(b), 'pt') || a.email.localeCompare(b.email));
    const nAdm = L.filter(u => u.tipo === 'admin').length;
    $('#u-count').textContent = `${L.length} ${L.length === 1 ? 'cadastrado' : 'cadastrados'} · ${nAdm} ${nAdm === 1 ? 'administrador' : 'administradores'}`;
    if (!L.length) { box.innerHTML = '<div class="ac-vazio"><b>Nenhum usuário cadastrado ainda</b><span>Cadastre uma pessoa pelo formulário ou várias pela planilha.</span></div>'; return; }
    box.innerHTML = '';
    L.forEach(u => {
      const row = document.createElement('div'); row.className = 'ac-linha';
      row.innerHTML = `<div class="ac-pessoa"><b></b><span></span></div><div class="ac-escopo"><span class="ac-tag"></span><span class="ac-esc"></span></div>
        <div class="ac-cod"><code></code></div>
        <div class="ac-acoes"><button class="ac-mini" type="button" data-a="copiar">Copiar acesso</button><button class="ac-mini" type="button" data-a="tipo"></button><button class="ac-mini" type="button" data-a="novo">Novo código</button><button class="ac-mini ac-rm" type="button" data-a="rm">Remover</button></div>`;
      row.querySelector('.ac-pessoa b').textContent = u.nome || u.email;
      row.querySelector('.ac-pessoa span').textContent = u.email;
      const tg = row.querySelector('.ac-tag'); tg.textContent = TIPOS[u.tipo] || 'Usuário'; tg.dataset.t = u.tipo === 'admin' ? 'admin' : 'usuario';
      row.querySelector('.ac-esc').textContent = rotUsuario(u);
      row.querySelector('code').textContent = u.codigo || '—';
      row.querySelector('[data-a="tipo"]').textContent = u.tipo === 'admin' ? 'Tornar usuário' : 'Tornar administrador';
      row.addEventListener('click', async ev => {
        const b = ev.target.closest('button'); if (!b) return;
        const base = { ...u }; delete base.id;
        if (b.dataset.a === 'copiar') return copiar(textoAcesso(u), 'Acesso');
        if (b.dataset.a === 'novo' || b.dataset.a === 'tipo') {
          b.disabled = true;
          try {
            if (b.dataset.a === 'novo') { await gravarUsuario({ ...base, codigo: novoCodigo() }, u.codigo); toast(`Novo código gerado para ${u.email}`); }
            else {
              const vira = u.tipo === 'admin' ? 'usuario' : 'admin';
              await gravarUsuario({ ...base, tipo: vira, ...(vira === 'admin' ? { perfil: 'todos', escopo: '' } : {}) }, u.codigo);
              toast(vira === 'admin' ? `${u.email} agora é administrador. Compartilhe o portal com ele como Editor.` : `${u.email} agora é usuário`);
            }
          } catch (e) { toast(erroGravar()); } finally { b.disabled = false; }
          return;
        }
        if (b.dataset.ok !== '1') { b.dataset.ok = '1'; b.textContent = 'Confirmar remoção'; b.classList.add('ac-conf'); setTimeout(() => { b.dataset.ok = ''; b.textContent = 'Remover'; b.classList.remove('ac-conf'); }, 4000); return; }
        b.disabled = true;
        try { if (u.codigo) await ACC.db.doc('acesso/' + await chaveAcesso(u.email, u.codigo)).delete(); await ACC.db.doc('usuarios/' + u.id).delete(); toast(`Acesso de ${u.email} removido`); }
        catch (e) { b.disabled = false; toast(erroGravar()); }
      });
      box.appendChild(row);
    });
  }

  /* ---------- início ---------- */
  async function iniciar() {
    telaGate('carregando');
    if (!window.claude || !window.claude.use) return telaGate('sem-plataforma');
    const tempo = setTimeout(() => telaGate('sem-plataforma'), 12000);
    const [user, db] = await Promise.all([claude.use('user'), claude.use('db')]);
    clearTimeout(tempo);
    ACC.user = user; ACC.db = db;
    if (!user || !db) return telaGate('sem-plataforma');
    const me = await user.me();
    ACC.editor = !!(me.isOwner || me.canEdit);
    try { const c = await db.doc('config/portal').get(); if (c.exists) ACC.contato = String(c.data().contato || ''); } catch (e) {}
    await carregarDados();
    if (ACC.editor) { ACC.admin = true; ACC.dono = true; ACC.nome = me.name || 'Administrador'; return posLogin(); }
    const salvo = lsGet();
    if (salvo && salvo.email && salvo.codigo && await tentarLogin(salvo.email, salvo.codigo)) return posLogin();
    if (salvo && salvo.codigo) lsSet({ email: salvo.email });
    telaGate('login', salvo && salvo.codigo ? 'Seu código mudou ou o acesso foi removido. Entre de novo.' : '');
  }
  iniciar();
})();

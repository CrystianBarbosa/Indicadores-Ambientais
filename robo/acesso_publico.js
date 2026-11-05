/* Login da versão pública (GitHub Pages). Os dados chegam criptografados em window.__COFRE__ (gerado por publicar.py):
   e-mail + código -> PBKDF2 -> abre a chave do escopo da pessoa -> AES-GCM -> gzip -> window.__DADOS__.
   Administradores cadastram, importam planilha, removem e trocam códigos aqui; "Publicar no site" refaz o cofre no
   navegador (mesmo formato do publicar.py) e grava o index.html no GitHub com a chave (token) do administrador.
   A lista do site é a oficial: o .bat de atualização lê os usuários daqui e não os apaga. */
(function () {
  'use strict';
  const C = window.__COFRE__;
  const LS = 'painel-ambiental-acesso', LS_TOKEN = 'painel-ambiental-github';
  const REPO_PADRAO = { dono: 'CrystianBarbosa', repo: 'Indicadores-Ambientais', arquivo: 'index.html', ramo: 'main' };
  const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  const TIPOS = { usuario: 'Usuário', admin: 'Administrador' };
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = e => String(e || '').trim().toLowerCase();
  const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const normCod = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(norm(e));
  const codUn = n => (String(n).match(/^\s*(BR[0-9A-Z]{2})/) || [])[1] || '';
  const curtoUn = n => String(n).replace(/^\s*BR[0-9A-Z]{2}\s*-\s*/, '');
  const de64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  function para64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
  const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  const enc = new TextEncoder(), dec = new TextDecoder();
  const lsGet = (k = LS) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  const lsSet = (v, k = LS) => { try { v ? localStorage.setItem(k, JSON.stringify(v)) : localStorage.removeItem(k); } catch (e) {} };
  const rotEscopo = (p, e) => p === 'todos' ? 'Todas as GEOs' : (e || '—');
  const rotUsuario = u => u.tipo === 'admin' ? 'Tudo · administra acessos' : rotEscopo(u.perfil, u.escopo);
  const linkSite = () => location.href.split('#')[0];
  function novoCodigo() {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', r = crypto.getRandomValues(new Uint32Array(8));
    const s = [...r].map(x => A[x % A.length]).join('');
    return s.slice(0, 4) + '-' + s.slice(4);
  }
  function toast(t) {
    let el = $('#ac-toast'); if (!el) { el = document.createElement('div'); el.id = 'ac-toast'; el.className = 'ac-toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = t; el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 3400);
  }
  const copiar = (t, r) => navigator.clipboard.writeText(t).then(() => toast(r + ' copiado')).catch(() => toast('Não deu para copiar: selecione o texto e use Ctrl+C'));

  /* ---------- criptografia (mesmo formato do publicar.py) ---------- */
  const importar = (raw, usos = ['decrypt']) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, usos);
  async function abrir(chave, p) { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: de64(p.iv) }, chave, de64(p.ct))); }
  async function fechar(chave, bytes) { const iv = crypto.getRandomValues(new Uint8Array(12)); return { iv: para64(iv), ct: para64(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, chave, bytes))) }; }
  async function porStream(bytes, t) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(t)).arrayBuffer()); }
  const gunzip = async b => dec.decode(await porStream(b, new DecompressionStream('gzip')));
  const gzip = s => porStream(enc.encode(s), new CompressionStream('gzip'));
  async function derivar(email, codigo, sal, usos) {
    const base = await crypto.subtle.importKey('raw', enc.encode(email + '|' + normCod(codigo)), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: sal, iterations: C.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, usos);
  }
  const idDe = async (salId, email) => hex(await crypto.subtle.digest('SHA-256', new Uint8Array([...salId, ...enc.encode(email)]))).slice(0, 32);
  async function entrar(email, codigo) {
    const id = await idDe(de64(C.salId), email);
    const ent = C.usuarios.find(u => u.id === id);
    if (!ent) return null;
    const kek = await derivar(email, codigo, de64(ent.sal), ['decrypt']);
    try {
      const meta = JSON.parse(dec.decode(await abrir(kek, ent.meta)));
      const chave = await importar(await abrir(kek, ent.chave));
      const dados = JSON.parse(await gunzip(await abrir(chave, C.pacotes[meta.pacote])));
      let lista = null;
      if (ent.adm) lista = JSON.parse(await gunzip(await abrir(await importar(await abrir(kek, ent.adm)), C.admin)));
      return { meta, dados, lista };
    } catch (err) { return null; } /* código errado: a decifragem falha */
  }
  function recortar(D, perfil, escopo) {
    if (perfil === 'todos') return D;
    const d = Object.assign({}, D);
    if (perfil === 'geo') {
      const g = D.dic.geo.indexOf(escopo);
      d.regs = g < 0 ? [] : D.regs.filter(r => r[1] === g); d.unidades = D.unidades.filter(u => u.geo === escopo); d.aplic = D.aplic.filter(a => a.geo === escopo);
    } else {
      const u = D.dic.un.indexOf(escopo), cod = codUn(escopo);
      d.regs = u < 0 ? [] : D.regs.filter(r => r[0] === u); d.unidades = D.unidades.filter(x => x.nome === escopo); d.aplic = D.aplic.filter(a => cod && a.cod === cod);
    }
    return d;
  }
  async function montarCofre(D, lista, aoProgresso) {
    const chaves = {}, pacotes = {};
    async function pacote(perfil, escopo) {
      const nome = perfil + ':' + escopo;
      if (!chaves[nome]) {
        const pid = 'p' + Object.keys(chaves).length;
        const raw = crypto.getRandomValues(new Uint8Array(32));
        chaves[nome] = { pid, raw };
        pacotes[pid] = await fechar(await importar(raw, ['encrypt']), await gzip(JSON.stringify(recortar(D, perfil, escopo))));
      }
      return chaves[nome];
    }
    const kAdm = crypto.getRandomValues(new Uint8Array(32));
    const limpa = lista.map(u => ({ email: u.email, nome: u.nome || '', tipo: u.tipo, perfil: u.perfil, escopo: u.escopo || '', codigo: u.codigo, geo: u.geo || '', unidade: u.unidade || '', criadoEm: u.criadoEm || '' }));
    const admin = await fechar(await importar(kAdm, ['encrypt']), await gzip(JSON.stringify(limpa)));
    const salId = crypto.getRandomValues(new Uint8Array(16));
    const usuarios = [];
    for (let i = 0; i < limpa.length; i++) {
      const u = limpa[i]; aoProgresso && aoProgresso(i + 1, limpa.length);
      const pk = u.tipo === 'admin' ? await pacote('todos', '') : await pacote(u.perfil, u.escopo);
      const sal = crypto.getRandomValues(new Uint8Array(16));
      const kek = await derivar(u.email, u.codigo, sal, ['encrypt']);
      const meta = { nome: u.nome, tipo: u.tipo, perfil: u.tipo === 'admin' ? 'todos' : u.perfil, escopo: u.tipo === 'admin' ? '' : u.escopo, pacote: pk.pid };
      const e = { id: await idDe(salId, u.email), sal: para64(sal), chave: await fechar(kek, pk.raw), meta: await fechar(kek, enc.encode(JSON.stringify(meta))) };
      if (u.tipo === 'admin') e.adm = await fechar(kek, kAdm);
      usuarios.push(e);
    }
    for (let i = usuarios.length - 1; i > 0; i--) { const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1); [usuarios[i], usuarios[j]] = [usuarios[j], usuarios[i]]; }
    const novo = { v: 1, iter: C.iter, salId: para64(salId), pacotes, usuarios, admin, geradoEm: C.geradoEm || '' };
    /* cópia da chave da lista de usuários para o robô do GitHub (só a chave privada dele abre) */
    if (C.chaveRobo) { novo.chaveRobo = C.chaveRobo; novo.adminRobo = para64(new Uint8Array(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, await chaveRobo(), kAdm))); }
    return novo;
  }

  /* ---------- tela de entrada ---------- */
  const gate = document.createElement('div'); gate.className = 'ac-gate'; gate.id = 'ac-gate'; document.body.appendChild(gate);
  const marca = '<div class="ac-marca"><span class="ac-k">L&amp;A · Ambiental</span><h1>Indicadores<br><em>Ambientais</em></h1></div>';
  function telaCarregando(msg) { gate.hidden = false; gate.innerHTML = `<div class="ac-card">${marca}<p class="ac-lead"><span class="ac-spin"></span>${msg}</p></div>`; }
  function telaLogin(aviso) {
    gate.hidden = false;
    gate.innerHTML = `<div class="ac-card">${marca}
      <p class="ac-lead">Entre com o e-mail cadastrado e o código de acesso que a equipe Demarco enviou para você.</p>
      <form id="ac-login" novalidate>
        <label for="ac-email">E-mail<input id="ac-email" type="email" autocomplete="username" placeholder="nome@empresa.com.br"></label>
        <label for="ac-cod">Código de acesso<input id="ac-cod" type="password" autocomplete="current-password" placeholder="XXXX-XXXX"></label>
        <label class="ac-lembrar" for="ac-lembrar"><input id="ac-lembrar" type="checkbox" checked> Manter conectado neste computador</label>
        <button class="ac-btn" type="submit" id="ac-entrar">Entrar</button>
        <p class="ac-err" id="ac-err" aria-live="polite"></p>
      </form>
      <p class="ac-lead ac-peq">Ainda não tem acesso? Peça ao responsável pelo painel na Demarco.</p></div>`;
    if (aviso) $('#ac-err').textContent = aviso;
    const salvo = lsGet(); if (salvo && salvo.email) $('#ac-email').value = salvo.email;
    $('#ac-login').addEventListener('submit', async ev => {
      ev.preventDefault();
      const em = norm($('#ac-email').value), cod = $('#ac-cod').value;
      if (!emailOk(em) || normCod(cod).length < 8) { $('#ac-err').textContent = 'Informe o e-mail e o código de acesso (8 letras e números).'; return; }
      const b = $('#ac-entrar'); b.disabled = true; b.textContent = 'Entrando…'; $('#ac-err').textContent = '';
      const r = await entrar(em, cod);
      b.disabled = false; b.textContent = 'Entrar';
      if (!r) { $('#ac-err').textContent = 'E-mail ou código incorretos. Confira o código recebido.'; return; }
      lsSet($('#ac-lembrar').checked ? { email: em, codigo: normCod(cod) } : { email: em });
      abrirPainel(em, r);
    });
  }

  /* ---------- painel ---------- */
  function abrirPainel(email, r) {
    window.__DADOS__ = r.dados;
    const admin = r.meta.tipo === 'admin' && r.lista;
    gate.hidden = true;
    const tab = $('#tab-usuarios'), sec = document.querySelector('[data-panel="usuarios"]');
    if (admin) tab.hidden = false; else { tab.remove(); sec.remove(); }
    const q = $('#quem'); q.hidden = false;
    q.innerHTML = '<i></i><span class="t"></span><button class="ac-lnk" id="ac-sair" type="button">Sair</button>';
    q.querySelector('.t').textContent = (r.meta.nome || email) + ' · ' + (admin ? 'Administrador' : rotEscopo(r.meta.perfil, r.meta.escopo));
    $('#ac-sair').addEventListener('click', () => {
      if (ADM.pendentes && !confirm('Há alterações de acesso não publicadas. Sair mesmo assim?')) return;
      ADM.pendentes = 0; lsSet({ email }); location.reload();
    });
    window.__NUCLEO__();
    window.Painel.aoMudarAba(aba => { const u = aba === 'usuarios'; ['#filtros', '#btn-f', '.chipbar'].forEach(s => { const el = $(s); if (el) el.hidden = u; }); });
    window.__LAYOUT__();
    if (admin) { ADM.dados = r.dados; ADM.lista = r.lista.map(u => Object.assign({}, u)); ADM.eu = email; recuperarRascunho(); montarUsuarios(); }
  }

  /* ---------- aba Usuários (administradores) ---------- */
  const ADM = { dados: null, lista: [], pendentes: 0, eu: '', sel: new Set(), busca: '' };
  const geos = () => [...new Set(ADM.dados.dic.geo)].filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt'));
  const unidades = () => ADM.dados.unidades.map(u => u.nome).sort((a, b) => curtoUn(a).localeCompare(curtoUn(b), 'pt'));
  const escVal = u => u.perfil === 'todos' ? 'todos' : u.perfil + ':' + u.escopo;
  const escDe = v => { const i = v.indexOf(':'); return i < 0 ? { perfil: 'todos', escopo: '' } : { perfil: v.slice(0, i), escopo: v.slice(i + 1) }; };
  const opcoesEscopo = sel => `<option value="todos"${sel === 'todos' ? ' selected' : ''}>Todas as GEOs</option>
    <optgroup label="Uma GEO">${geos().map(g => `<option value="${esc('geo:' + g)}"${sel === 'geo:' + g ? ' selected' : ''}>${esc(g)}</option>`).join('')}</optgroup>
    <optgroup label="Uma unidade">${unidades().map(u => `<option value="${esc('unidade:' + u)}"${sel === 'unidade:' + u ? ' selected' : ''}>${esc(curtoUn(u))} (${esc(codUn(u) || '—')})</option>`).join('')}</optgroup>`;
  const textoAcesso = u => `Acesso ao Painel Indicadores Ambientais\nLink: ${linkSite()}\nE-mail: ${u.email}\nCódigo de acesso: ${u.codigo}`;
  /* rascunho das alterações não publicadas: sobrevive a recarregar a página (só neste navegador) */
  const LS_RASCUNHO = 'painel-ambiental-rascunho';
  const salvarRascunho = () => lsSet(ADM.pendentes ? { base: C.salId, eu: ADM.eu, pendentes: ADM.pendentes, lista: ADM.lista } : null, LS_RASCUNHO);
  function recuperarRascunho() {
    const r = lsGet(LS_RASCUNHO);
    if (!r || r.eu !== ADM.eu || !Array.isArray(r.lista)) return;
    if (r.base !== C.salId) { lsSet(null, LS_RASCUNHO); toast('O site foi publicado de novo desde o seu rascunho; as alterações antigas foram descartadas.'); return; }
    ADM.lista = r.lista; ADM.pendentes = r.pendentes || 1;
    toast(`Recuperamos ${ADM.pendentes} ${ADM.pendentes === 1 ? 'alteração não publicada' : 'alterações não publicadas'}.`);
  }
  function marcar(n = 1) { ADM.pendentes += n; salvarRascunho(); desenharPendentes(); listarUsuarios(); }
  window.addEventListener('beforeunload', ev => { if (ADM.pendentes) { ev.preventDefault(); ev.returnValue = ''; } });

  function montarUsuarios() {
    const tok = lsGet(LS_TOKEN);
    $('#usuarios-area').innerHTML = `
      <div class="ac-pend" id="u-pend" hidden><div><b id="u-pend-t"></b><span>As alterações só valem depois de publicadas. Quem tiver o site aberto precisa recarregar a página.</span></div>
        <button class="ac-btn" type="button" id="u-publicar">Publicar no site</button><p class="ac-err" id="u-pub-msg" aria-live="polite"></p></div>
      <div class="row" style="margin-top:22px"><div class="c">
        <span class="c-k">Acesso</span><h3>Liberar acesso ao painel</h3>
        <p class="c-s">Cadastre a pessoa e o que ela pode ver. O código de acesso é gerado na hora; depois clique em <b>Publicar no site</b>.</p>
        <div class="ac-tipos"><div><span class="ac-tag" data-t="usuario">Usuário</span> só acessa o painel, no escopo liberado.</div><div><span class="ac-tag" data-t="admin">Administrador</span> vê tudo e cadastra e libera acessos.</div></div>
        <form id="u-form" class="ac-form" novalidate>
          <label for="u-email">E-mail<input id="u-email" type="email" placeholder="nome@empresa.com.br" autocomplete="off"></label>
          <label for="u-nome">Nome<input id="u-nome" placeholder="Nome da pessoa" autocomplete="off"></label>
          <label for="u-tipo">Tipo<select id="u-tipo"><option value="usuario">Usuário</option><option value="admin">Administrador</option></select></label>
          <label for="u-escopo" id="u-escopo-l">Pode ver<select id="u-escopo">${opcoesEscopo('todos')}</select></label>
          <button class="ac-btn" type="submit">Cadastrar acesso</button>
          <p class="ac-err" id="u-err" aria-live="polite"></p>
        </form>
      </div></div>
      <div class="row"><div class="c">
        <span class="c-k">Planilha</span><h3>Cadastrar várias pessoas pela planilha</h3>
        <p class="c-s">Envie a planilha de cadastro com as colunas <b>GEO</b>, <b>Unidade</b>, <b>Nome</b> e <b>E-mail</b>. A coluna <b>Tipo</b> é opcional (Usuário ou Administrador; em branco vira Usuário). Confira a prévia, gere os acessos e publique.</p>
        <label class="ac-btn ac-sec ac-arquivo" for="p-arquivo">Escolher planilha (.xlsx ou .csv)<input id="p-arquivo" type="file" accept=".xlsx,.xls,.csv"></label>
        <p class="ac-err" id="p-err" aria-live="polite"></p>
        <div id="p-previa"></div>
      </div></div>
      <div class="row"><div class="c">
        <div class="ac-lista-h"><div><span class="c-k">Usuários</span><h3>Acessos liberados</h3></div>
          <div class="ac-lista-acoes"><span class="ac-cont" id="u-count"></span><button class="ac-mini" type="button" id="u-copiar-todos">Copiar todos</button><button class="ac-mini" type="button" id="u-baixar">Baixar planilha de acessos</button></div></div>
        <div class="ac-selbar">
          <label class="ac-chk" for="u-todos"><input type="checkbox" id="u-todos"> Selecionar todos</label>
          <input id="u-busca" type="search" placeholder="Filtrar por nome, e-mail, GEO ou unidade" aria-label="Filtrar usuários" autocomplete="off">
          <span class="ac-cont" id="u-sel-n"></span>
          <div class="ac-selbar-acoes"><button class="ac-mini" type="button" id="u-sel-copiar" disabled>Copiar acessos</button><button class="ac-mini" type="button" id="u-sel-baixar" disabled>Baixar selecionados</button><button class="ac-mini ac-rm" type="button" id="u-sel-rm" disabled>Remover selecionados</button></div>
        </div>
        <div id="u-list" class="ac-lista"></div>
      </div></div>
      <div class="row"><div class="c" id="d-card">
        <span class="c-k">Dados</span><h3>Atualizar dados do painel</h3>
        <p class="c-s">Envie as planilhas atualizadas. Elas são criptografadas aqui no navegador antes de sair do computador (no GitHub ficam ilegíveis e guardadas como backup) e o robô gera e publica o painel em 2 a 4 minutos. Pode enviar só uma delas: a outra continua a última enviada.</p>
        <div class="ac-form ac-form-dados">
          <label for="d-principal">Planilha de condicionantes<input id="d-principal" type="file" accept=".xlsx"><small id="d-principal-n" class="ac-peq">Análise de condicionantes - Todas as GEOs - atualizada.xlsx</small></label>
          <label for="d-base">Base de conhecimento<input id="d-base" type="file" accept=".xlsx"><small id="d-base-n" class="ac-peq">Base de conhecimento (condicionantes) - sem Nova Iguaçu.xlsx</small></label>
          <button class="ac-btn" type="button" id="d-enviar">Enviar e atualizar o painel</button>
        </div>
        <ol class="ac-etapas" id="d-etapas" hidden></ol>
        <p class="ac-err" id="d-msg" aria-live="polite"></p>
      </div></div>
      <div class="row"><div class="c" id="g-card">
        <span class="c-k">GitHub</span><h3>Chave para publicar no site</h3>
        <p class="c-s">Para publicar as alterações, o site precisa de uma chave do GitHub com permissão de gravar no repositório. Ela fica salva só neste navegador.</p>
        <ol class="ac-passos"><li>Abra <b>github.com/settings/personal-access-tokens/new</b> (logado na conta dona do repositório).</li>
          <li>Em <b>Repository access</b>, escolha <b>Only select repositories</b> e marque <b>${esc(repo().repo)}</b>.</li>
          <li>Em <b>Permissions → Repository permissions → Contents</b>, escolha <b>Read and write</b>. Gere a chave e cole abaixo.</li></ol>
        <form id="g-form" class="ac-form" novalidate>
          <label for="g-token">Chave do GitHub<input id="g-token" type="password" autocomplete="off" placeholder="${tok ? 'Chave salva neste navegador' : 'github_pat_…'}"></label>
          <button class="ac-btn ac-sec" type="submit">Salvar chave</button>
          <button class="ac-btn ac-sec" type="button" id="g-apagar"${tok ? '' : ' hidden'}>Apagar chave</button>
          <p class="ac-err ${tok ? 'ac-ok' : ''}" id="g-msg" aria-live="polite">${tok ? 'Chave salva neste navegador.' : ''}</p>
        </form>
      </div></div>`;
    const tipo = $('#u-tipo'), escopoL = $('#u-escopo-l');
    tipo.addEventListener('change', () => { escopoL.hidden = tipo.value === 'admin'; });
    $('#u-form').addEventListener('submit', e => {
      e.preventDefault();
      const em = norm($('#u-email').value), nome = $('#u-nome').value.trim().slice(0, 120), t = tipo.value;
      const { perfil, escopo } = t === 'admin' ? { perfil: 'todos', escopo: '' } : escDe($('#u-escopo').value);
      if (!emailOk(em)) { $('#u-err').textContent = 'Informe um e-mail válido.'; return; }
      $('#u-err').textContent = '';
      const antigo = ADM.lista.find(x => x.email === em);
      if (antigo) Object.assign(antigo, { nome: nome || antigo.nome, tipo: t, perfil, escopo, pend: true });
      else ADM.lista.push({ email: em, nome, tipo: t, perfil, escopo, codigo: novoCodigo(), criadoEm: new Date().toISOString(), pend: true });
      toast(antigo ? `${em} atualizado. Publique para valer.` : `${em} cadastrado. Publique para valer.`);
      $('#u-form').reset(); escopoL.hidden = false; marcar();
    });
    $('#p-arquivo').addEventListener('change', e => lerPlanilha(e.target));
    $('#u-copiar-todos').addEventListener('click', () => copiarTabela(ADM.lista));
    $('#u-baixar').addEventListener('click', () => baixarPlanilha(ADM.lista, 'Acessos - Painel Indicadores Ambientais.xlsx'));
    $('#u-publicar').addEventListener('click', publicar);
    $('#d-enviar').addEventListener('click', enviarPlanilhas);
    /* seleção em massa */
    let tBusca; $('#u-busca').addEventListener('input', e => { clearTimeout(tBusca); tBusca = setTimeout(() => { ADM.busca = e.target.value; listarUsuarios(); }, 200); });
    $('#u-todos').addEventListener('change', e => { visiveis().forEach(u => e.target.checked ? ADM.sel.add(u.email) : ADM.sel.delete(u.email)); listarUsuarios(); });
    const selecionados = () => ADM.lista.filter(u => ADM.sel.has(u.email));
    $('#u-sel-copiar').addEventListener('click', () => copiarTabela(selecionados()));
    $('#u-sel-baixar').addEventListener('click', () => baixarPlanilha(selecionados(), 'Acessos selecionados - Painel Indicadores Ambientais.xlsx'));
    $('#u-sel-rm').addEventListener('click', e => {
      const b = e.currentTarget, alvo = selecionados().filter(u => u.email !== ADM.eu), pulouEu = ADM.sel.has(ADM.eu);
      if (!alvo.length) { toast('Você não pode remover o próprio acesso por aqui.'); return; }
      if (b.dataset.ok !== '1') {
        b.dataset.ok = '1'; b.textContent = `Confirmar remoção de ${alvo.length}`; b.classList.add('ac-conf');
        clearTimeout(b._t); b._t = setTimeout(() => { b.dataset.ok = ''; b.classList.remove('ac-conf'); atualizarSel(); }, 5000); return;
      }
      b.dataset.ok = ''; b.classList.remove('ac-conf'); clearTimeout(b._t);
      const fora = new Set(alvo.map(u => u.email));
      ADM.lista = ADM.lista.filter(u => !fora.has(u.email)); fora.forEach(em => ADM.sel.delete(em));
      toast(`${alvo.length} ${alvo.length === 1 ? 'acesso removido' : 'acessos removidos'}${pulouEu ? ' (o seu foi mantido)' : ''}. Publique para valer.`);
      marcar(alvo.length);
    });
    $('#g-form').addEventListener('submit', e => {
      e.preventDefault(); const v = $('#g-token').value.trim();
      if (!/^(github_pat_|ghp_)\w+/.test(v)) { $('#g-msg').className = 'ac-err'; $('#g-msg').textContent = 'Cole a chave completa, que começa com "github_pat_".'; return; }
      lsSet({ token: v }, LS_TOKEN); $('#g-token').value = ''; $('#g-token').placeholder = 'Chave salva neste navegador';
      $('#g-msg').className = 'ac-ok'; $('#g-msg').textContent = 'Chave salva neste navegador.'; $('#g-apagar').hidden = false;
    });
    $('#g-apagar').addEventListener('click', () => { lsSet(null, LS_TOKEN); $('#g-apagar').hidden = true; $('#g-token').placeholder = 'github_pat_…'; $('#g-msg').className = 'ac-err'; $('#g-msg').textContent = 'Chave apagada deste navegador.'; });
    desenharPendentes(); listarUsuarios();
  }
  function desenharPendentes() {
    const b = $('#u-pend'); if (!b) return;
    b.hidden = !ADM.pendentes;
    $('#u-pend-t').textContent = `${ADM.pendentes} ${ADM.pendentes === 1 ? 'alteração não publicada' : 'alterações não publicadas'}`;
  }

  /* lista visível = filtro da busca aplicado; "Selecionar todos" age só sobre ela */
  function visiveis() {
    const q = semAcento(ADM.busca || '').trim();
    const L = [...ADM.lista].sort((a, b) => (a.tipo === 'admin' ? 0 : 1) - (b.tipo === 'admin' ? 0 : 1) || rotUsuario(a).localeCompare(rotUsuario(b), 'pt') || a.email.localeCompare(b.email));
    return q ? L.filter(u => semAcento([u.nome, u.email, u.geo, u.unidade, rotUsuario(u)].join(' ')).includes(q)) : L;
  }
  function atualizarSel() {
    const V = visiveis(), n = ADM.lista.filter(u => ADM.sel.has(u.email)).length, nv = V.filter(u => ADM.sel.has(u.email)).length;
    const t = $('#u-todos'); if (!t) return;
    t.checked = V.length > 0 && nv === V.length; t.indeterminate = nv > 0 && nv < V.length;
    $('#u-sel-n').textContent = n ? `${n} ${n === 1 ? 'selecionado' : 'selecionados'}` : '';
    ['#u-sel-copiar', '#u-sel-baixar', '#u-sel-rm'].forEach(s => { $(s).disabled = !n; });
    const rm = $('#u-sel-rm'); if (rm.dataset.ok !== '1') rm.textContent = n ? `Remover selecionados (${n})` : 'Remover selecionados';
  }
  function listarUsuarios() {
    const box = $('#u-list'); if (!box) return;
    const todos = ADM.lista, L = visiveis();
    const nAdm = todos.filter(u => u.tipo === 'admin').length;
    $('#u-count').textContent = `${todos.length} ${todos.length === 1 ? 'cadastrado' : 'cadastrados'} · ${nAdm} ${nAdm === 1 ? 'administrador' : 'administradores'}${L.length !== todos.length ? ` · ${L.length} no filtro` : ''}`;
    atualizarSel();
    if (!todos.length) { box.innerHTML = '<div class="ac-vazio"><b>Nenhum usuário cadastrado</b><span>Cadastre uma pessoa pelo formulário ou várias pela planilha.</span></div>'; return; }
    if (!L.length) { box.innerHTML = '<div class="ac-vazio"><b>Ninguém encontrado</b><span>Ajuste o filtro acima.</span></div>'; return; }
    box.innerHTML = '';
    L.forEach(u => {
      const row = document.createElement('div'); row.className = 'ac-linha ac-com-sel' + (ADM.sel.has(u.email) ? ' ac-marcada' : '');
      const chk = document.createElement('input'); chk.type = 'checkbox'; chk.className = 'ac-sel'; chk.checked = ADM.sel.has(u.email); chk.setAttribute('aria-label', 'Selecionar ' + (u.nome || u.email));
      chk.addEventListener('change', () => { chk.checked ? ADM.sel.add(u.email) : ADM.sel.delete(u.email); row.classList.toggle('ac-marcada', chk.checked); atualizarSel(); });
      row.appendChild(chk);
      row.insertAdjacentHTML('beforeend', `<div class="ac-pessoa"><b></b><span></span></div><div class="ac-escopo"><span class="ac-tag"></span><span class="ac-esc"></span></div>
        <div class="ac-cod"><code></code>${u.pend ? '<span class="ac-pend-tag">Não publicado</span>' : ''}</div>
        <div class="ac-acoes"><button class="ac-mini" type="button" data-a="copiar">Copiar acesso</button><button class="ac-mini" type="button" data-a="tipo"></button><button class="ac-mini" type="button" data-a="novo">Novo código</button><button class="ac-mini ac-rm" type="button" data-a="rm">Remover</button></div>`);
      row.querySelector('.ac-pessoa b').textContent = u.nome || u.email; row.querySelector('.ac-pessoa span').textContent = u.email;
      const tg = row.querySelector('.ac-tag'); tg.textContent = TIPOS[u.tipo] || 'Usuário'; tg.dataset.t = u.tipo === 'admin' ? 'admin' : 'usuario';
      row.querySelector('.ac-esc').textContent = rotUsuario(u);
      row.querySelector('code').textContent = u.codigo;
      row.querySelector('[data-a="tipo"]').textContent = u.tipo === 'admin' ? 'Tornar usuário' : 'Tornar administrador';
      row.addEventListener('click', ev => {
        const b = ev.target.closest('button'); if (!b) return;
        const a = b.dataset.a;
        if (a === 'copiar') return copiar(textoAcesso(u), 'Acesso');
        if (a === 'novo') { u.codigo = novoCodigo(); u.pend = true; toast(`Novo código para ${u.email}. Publique para valer.`); return marcar(); }
        if (a === 'tipo') {
          if (u.email === ADM.eu && u.tipo === 'admin' && ADM.lista.filter(x => x.tipo === 'admin').length === 1) { toast('Você é o único administrador: cadastre outro antes de deixar de ser.'); return; }
          u.tipo = u.tipo === 'admin' ? 'usuario' : 'admin'; if (u.tipo === 'admin') { u.perfil = 'todos'; u.escopo = ''; } u.pend = true; return marcar();
        }
        if (u.email === ADM.eu) { toast('Você não pode remover o próprio acesso por aqui.'); return; }
        if (b.dataset.ok !== '1') { b.dataset.ok = '1'; b.textContent = 'Confirmar remoção'; b.classList.add('ac-conf'); setTimeout(() => { b.dataset.ok = ''; b.textContent = 'Remover'; b.classList.remove('ac-conf'); }, 4000); return; }
        ADM.lista = ADM.lista.filter(x => x !== u); ADM.sel.delete(u.email); toast(`${u.email} removido. Publique para valer.`); marcar();
      });
      box.appendChild(row);
    });
  }

  /* ---------- publicar no GitHub ---------- */
  function repo() {
    const m = location.hostname.match(/^([^.]+)\.github\.io$/i), seg = location.pathname.split('/').filter(Boolean)[0];
    return m && seg ? { dono: m[1], repo: decodeURIComponent(seg), arquivo: 'index.html', ramo: 'main' } : REPO_PADRAO;
  }
  async function gh(caminho, opcoes = {}) {
    const tok = (lsGet(LS_TOKEN) || {}).token;
    const r = await fetch('https://api.github.com' + caminho, Object.assign({}, opcoes, { headers: Object.assign({ Authorization: 'Bearer ' + tok, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, opcoes.headers || {}) }));
    if (!r.ok) { const e = new Error('github'); e.status = r.status; throw e; }
    return r;
  }
  async function publicar() {
    const msg = $('#u-pub-msg'), b = $('#u-publicar'); msg.className = 'ac-ok';
    if (!(lsGet(LS_TOKEN) || {}).token) { msg.className = 'ac-err'; msg.textContent = 'Falta a chave do GitHub: preencha o card “Chave para publicar no site” abaixo.'; $('#g-card').scrollIntoView({ behavior: 'smooth' }); return; }
    if (!ADM.lista.some(u => u.tipo === 'admin')) { msg.className = 'ac-err'; msg.textContent = 'Deixe pelo menos um administrador antes de publicar.'; return; }
    b.disabled = true;
    try {
      const R = repo(), alvo = `/repos/${R.dono}/${R.repo}/contents/${R.arquivo}`;
      msg.textContent = 'Lendo o site atual no GitHub…';
      const info = await (await gh(alvo + '?ref=' + R.ramo)).json();
      /* o arquivo vem em base64 no próprio JSON; acima de 1 MB o GitHub omite e manda o link de download */
      const html = info.content && info.encoding === 'base64'
        ? dec.decode(de64(info.content.replace(/\s/g, '')))
        : await (await fetch(info.download_url + (info.download_url.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' })).text();
      const i = html.indexOf('window.__COFRE__='), j = html.indexOf(';<\/script>', i); /* "<\/" evita fechar este próprio <script> */
      if (i < 0 || j < 0) throw Object.assign(new Error('formato'), { status: 0 });
      const cofre = await montarCofre(ADM.dados, ADM.lista, (n, t) => { msg.textContent = `Protegendo os acessos… ${n} de ${t}`; });
      const novo = html.slice(0, i) + 'window.__COFRE__=' + JSON.stringify(cofre) + html.slice(j);
      msg.textContent = 'Enviando para o GitHub…';
      await gh(alvo, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: `Acessos atualizados pelo site (${ADM.eu})`, content: para64(enc.encode(novo)), sha: info.sha, branch: R.ramo }) });
      ADM.lista.forEach(u => delete u.pend); ADM.pendentes = 0; lsSet(null, LS_RASCUNHO); desenharPendentes(); listarUsuarios();
      const eu = ADM.lista.find(u => u.email === ADM.eu), salvo = lsGet();
      if (eu && salvo && salvo.codigo && salvo.codigo !== normCod(eu.codigo)) lsSet({ email: eu.email, codigo: normCod(eu.codigo) });
      toast('Publicado! O site atualiza em 1 a 2 minutos.');
      msg.textContent = '';
    } catch (e) {
      msg.className = 'ac-err';
      msg.textContent = e.status === 401 ? 'A chave do GitHub é inválida ou expirou. Gere outra e salve no card abaixo.'
        : e.status === 403 || e.status === 404 ? 'A chave não tem permissão de gravar neste repositório. Confira “Contents: Read and write” e o repositório escolhido.'
        : e.status === 409 || e.status === 422 ? 'O site mudou enquanto você editava (outra publicação). Recarregue a página e refaça as alterações.'
        : e.message === 'formato' ? 'Não reconheci o arquivo do site no GitHub. Publique uma vez pelo .bat e tente de novo.'
        : 'Não foi possível publicar agora. Confira a internet e tente de novo.';
    } finally { b.disabled = false; }
  }

  /* ---------- atualizar dados: planilhas criptografadas para o robô do GitHub ---------- */
  const PLANILHAS = [
    { id: 'base', campo: '#d-base', aba: 'Aplicabilidade', rotulo: 'Base de conhecimento' },
    { id: 'principal', campo: '#d-principal', aba: 'Controle - Licenças e Condic.', rotulo: 'Planilha de condicionantes' },
  ];
  async function chaveRobo() {
    const pem = (C.chaveRobo || '').replace(/-----[^-]+-----|\s/g, '');
    if (!pem) throw Object.assign(new Error('semchave'), {});
    return crypto.subtle.importKey('spki', de64(pem), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  }
  async function cifrarParaRobo(bytes, nome) {
    const k = crypto.getRandomValues(new Uint8Array(32)), iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await importar(k, ['encrypt']), bytes));
    const wk = new Uint8Array(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, await chaveRobo(), k));
    return { v: 1, nome, hash: hex(await crypto.subtle.digest('SHA-256', bytes)), por: ADM.eu, enviadoEm: new Date().toLocaleString('pt-BR').slice(0, 17).replace(',', ''), wk: para64(wk), iv: para64(iv), ct: para64(ct) };
  }
  function etapa(txt, estado = 'on') {
    const ol = $('#d-etapas'); ol.hidden = false;
    const li = document.createElement('li'); li.className = 'ac-etapa-' + estado; li.textContent = txt; ol.appendChild(li); return li;
  }
  async function enviarPlanilhas() {
    const msg = $('#d-msg'), b = $('#d-enviar'); msg.className = 'ac-err'; msg.textContent = '';
    if (!(lsGet(LS_TOKEN) || {}).token) { msg.textContent = 'Falta a chave do GitHub: preencha o card “Chave para publicar no site” abaixo.'; $('#g-card').scrollIntoView({ behavior: 'smooth' }); return; }
    const escolhidas = PLANILHAS.map(p => Object.assign({}, p, { arquivo: ($(p.campo).files || [])[0] })).filter(p => p.arquivo);
    if (!escolhidas.length) { msg.textContent = 'Escolha pelo menos uma das planilhas.'; return; }
    b.disabled = true; $('#d-etapas').innerHTML = '';
    try {
      const X = await carregarXLSX();
      const R = repo(); let ultimoCommit = '';
      for (const p of escolhidas) {
        const li = etapa(`${p.rotulo}: conferindo a planilha…`);
        const bytes = new Uint8Array(await p.arquivo.arrayBuffer());
        let wb; try { wb = X.read(bytes, { type: 'array', bookSheets: true }); } catch (e) { wb = null; }
        if (!wb || !wb.SheetNames.includes(p.aba)) throw Object.assign(new Error('aba'), { detalhe: `${p.rotulo}: o arquivo “${p.arquivo.name}” não tem a aba “${p.aba}”. Confira se é a planilha certa.` });
        li.textContent = `${p.rotulo}: criptografando…`;
        const pacote = await cifrarParaRobo(bytes, p.arquivo.name);
        li.textContent = `${p.rotulo}: enviando ao GitHub…`;
        const alvo = `/repos/${R.dono}/${R.repo}/contents/entradas/${p.id}.json`;
        let sha; try { sha = (await (await gh(alvo + '?ref=' + R.ramo)).json()).sha; } catch (e) { if (e.status !== 404) throw e; }
        const r = await (await gh(alvo, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ message: `Planilha enviada pelo portal: ${p.rotulo} (${ADM.eu})`, content: para64(enc.encode(JSON.stringify(pacote))), branch: R.ramo }, sha ? { sha } : {})) })).json();
        ultimoCommit = r.commit && r.commit.sha;
        li.className = 'ac-etapa-ok'; li.textContent = `${p.rotulo}: enviada (${p.arquivo.name}).`;
      }
      PLANILHAS.forEach(p => { $(p.campo).value = ''; });
      await acompanharRobo(R, ultimoCommit);
    } catch (e) {
      msg.textContent = e.detalhe || (e.status === 401 ? 'A chave do GitHub é inválida ou expirou. Gere outra e salve no card abaixo.'
        : e.status === 403 || e.status === 404 ? 'A chave do GitHub não tem permissão de gravar neste repositório (Contents: Read and write).'
        : e.message === 'semchave' ? 'Este site ainda não tem a chave do robô. Publique uma vez pelo .bat.'
        : 'Não foi possível enviar agora. Confira a internet e tente de novo.');
    } finally { b.disabled = false; }
  }
  async function acompanharRobo(R, sha) {
    const li = etapa('Robô do GitHub: aguardando começar…');
    const fim = Date.now() + 12 * 60000;
    while (Date.now() < fim) {
      await new Promise(r => setTimeout(r, 8000));
      let run;
      try { run = ((await (await gh(`/repos/${R.dono}/${R.repo}/actions/runs?branch=${R.ramo}&per_page=10`)).json()).workflow_runs || []).find(x => x.head_sha === sha); }
      catch (e) {
        if (e.status === 403 || e.status === 404) { li.className = 'ac-etapa-ok'; li.textContent = 'Planilhas enviadas. O robô atualiza o painel em 2 a 4 minutos (para acompanhar aqui, dê à chave do GitHub a permissão “Actions: Read”).'; return; }
        continue;
      }
      if (!run) continue;
      if (run.status !== 'completed') { li.textContent = `Robô do GitHub: ${run.status === 'in_progress' ? 'gerando o painel…' : 'na fila…'}`; continue; }
      if (run.conclusion === 'success') { li.className = 'ac-etapa-ok'; li.textContent = 'Robô do GitHub: painel gerado e publicado.'; etapa('Pronto! Recarregue o site (F5) em 1 a 2 minutos para ver os dados novos.', 'ok'); return; }
      if (run.conclusion === 'cancelled') { li.textContent = 'Robô do GitHub: uma atualização mais nova assumiu, aguardando…'; continue; }
      li.className = 'ac-etapa-erro'; li.innerHTML = `Robô do GitHub: a atualização falhou. <a href="${esc(run.html_url)}" target="_blank" rel="noopener">Ver o que aconteceu</a> e avise o responsável pelo painel.`; return;
    }
    li.textContent = 'O robô ainda não terminou. Recarregue o site daqui a alguns minutos.';
  }

  /* ---------- importação pela planilha de cadastro ---------- */
  let XLSX_P = null;
  const carregarXLSX = () => XLSX_P || (XLSX_P = new Promise((ok, falha) => {
    if (window.XLSX) return ok(window.XLSX);
    const s = document.createElement('script'); s.src = XLSX_URL; s.onload = () => ok(window.XLSX); s.onerror = () => { XLSX_P = null; falha(new Error('xlsx')); };
    document.head.appendChild(s);
  }));
  const chaveCol = h => semAcento(h).replace(/[^a-z]/g, '');
  const COLS = { geo: ['geo', 'regional'], unidade: ['unidade', 'cdd', 'localidade'], nome: ['nome', 'god', 'responsavel', 'gestor'], email: ['email', 'emails'], tipo: ['tipo', 'perfil'] };
  const nucleoUn = n => semAcento(curtoUn(n)).replace(/\[[^\]]*\]/g, ' ').replace(/\b(cdd|cdl|cdc|cds|cd|as|revenda|unidade|filial)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  function achaGeo(txt) {
    const k = semAcento(txt).replace(/^geo\s*/, '').replace(/[^a-z0-9]/g, '');
    return k ? geos().find(g => semAcento(g).replace(/^geo\s*/, '').replace(/[^a-z0-9]/g, '') === k) || '' : '';
  }
  function achaUnidade(txt, geo) {
    const k = nucleoUn(txt); if (!k) return { un: '', duvida: false };
    let c = ADM.dados.unidades.filter(u => { const n = nucleoUn(u.nome); return n === k || (' ' + n + ' ').includes(' ' + k + ' '); });
    if (geo && c.some(u => u.geo === geo)) c = c.filter(u => u.geo === geo);
    if (c.length > 1) { const ex = c.filter(u => nucleoUn(u.nome) === k && !/\[/.test(u.nome)); if (ex.length === 1) c = ex; }
    return c.length === 1 ? { un: c[0].nome, duvida: false } : { un: '', duvida: c.length > 1 };
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
        else if (geo) { escopo = 'geo:' + geo; if (unTxt) aviso = achou.duvida ? 'Unidade com mais de uma opção: escolha ao lado' : 'Unidade não encontrada: liberada a GEO'; }
        else if (geoTxt || unTxt) aviso = 'GEO e unidade não encontradas: confira';
        let status = 'ok';
        if (!emailOk(em)) { status = 'erro'; aviso = 'E-mail inválido'; }
        else if (vistos.has(em)) { status = 'erro'; aviso = 'E-mail repetido na planilha'; }
        vistos.add(em);
        return { n: iCab + n + 2, email: em, nome: val('nome'), geoTxt, unTxt, tipo, escopo, aviso, status, existe: ADM.lista.some(u => u.email === em) };
      });
      if (!PREVIA.length) { err.className = 'ac-err'; err.textContent = 'A planilha não tem linhas de cadastro abaixo do cabeçalho.'; return; }
      err.textContent = ''; desenharPrevia();
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
      <div class="ac-previa-acoes"><button class="ac-btn" type="button" id="p-gerar"${ok.length ? '' : ' disabled'}>Gerar acessos para ${ok.length} ${ok.length === 1 ? 'pessoa' : 'pessoas'}</button><button class="ac-btn ac-sec" type="button" id="p-cancelar">Cancelar</button></div>
      <div id="p-result"></div>`;
    $('#p-previa').querySelectorAll('[data-pe]').forEach(s => s.addEventListener('change', () => { PREVIA[+s.dataset.pe].escopo = s.value; PREVIA[+s.dataset.pe].aviso = ''; }));
    $('#p-previa').querySelectorAll('[data-pt]').forEach(s => s.addEventListener('change', () => { PREVIA[+s.dataset.pt].tipo = s.value; desenharPrevia(); }));
    $('#p-cancelar').addEventListener('click', () => { PREVIA = []; $('#p-previa').innerHTML = ''; });
    $('#p-gerar').addEventListener('click', gerarLote);
  }
  function gerarLote() {
    const feitos = [];
    PREVIA.filter(p => p.status === 'ok').forEach(p => {
      const { perfil, escopo } = p.tipo === 'admin' ? { perfil: 'todos', escopo: '' } : escDe(p.escopo);
      let u = ADM.lista.find(x => x.email === p.email);
      if (u) Object.assign(u, { nome: p.nome || u.nome, tipo: p.tipo, perfil, escopo, geo: p.geoTxt || u.geo, unidade: p.unTxt || u.unidade, pend: true });
      else { u = { email: p.email, nome: p.nome, tipo: p.tipo, perfil, escopo, codigo: novoCodigo(), geo: p.geoTxt, unidade: p.unTxt, criadoEm: new Date().toISOString(), pend: true }; ADM.lista.push(u); }
      feitos.push(u);
    });
    PREVIA = [];
    marcar(feitos.length);
    $('#p-previa').innerHTML = `<div class="ac-previa-h"><b>${feitos.length} acessos gerados</b><span>Clique em <b>Publicar no site</b> (no topo) para valer. Depois envie os acessos:</span></div>
      <div class="ac-previa-acoes"><button class="ac-btn" type="button" id="p-baixar">Baixar planilha com os acessos</button><button class="ac-btn ac-sec" type="button" id="p-copiar">Copiar tabela</button></div>`;
    $('#p-baixar').addEventListener('click', () => baixarPlanilha(feitos, 'Acessos gerados - Painel Indicadores Ambientais.xlsx'));
    $('#p-copiar').addEventListener('click', () => copiarTabela(feitos));
    $('#u-pend').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  /* tabela de acessos: mesma estrutura no download e na cópia */
  const CAB = ['GEO', 'Unidade', 'Nome', 'E-mail', 'Tipo', 'Pode ver', 'Código de acesso', 'Link do painel'];
  const linhaAcesso = u => [u.geo || (u.perfil === 'geo' ? u.escopo : u.perfil === 'unidade' ? ((ADM.dados.unidades.find(x => x.nome === u.escopo) || {}).geo || '') : ''),
    u.unidade || (u.perfil === 'unidade' ? curtoUn(u.escopo) : ''), u.nome || '', u.email, TIPOS[u.tipo] || 'Usuário', u.tipo === 'admin' ? 'Tudo (administrador)' : rotEscopo(u.perfil, u.escopo), u.codigo, linkSite()];
  const ordenar = L => [...L].sort((a, b) => String(linhaAcesso(a)[0]).localeCompare(String(linhaAcesso(b)[0]), 'pt') || a.email.localeCompare(b.email));
  function copiarTabela(L) {
    if (!L.length) { toast('Nenhum acesso para copiar'); return; }
    copiar([CAB, ...ordenar(L).map(linhaAcesso)].map(l => l.map(c => String(c).replace(/[\t\n]/g, ' ')).join('\t')).join('\n'), 'Tabela (cole no Excel)');
  }
  async function baixarPlanilha(L, nome) {
    if (!L.length) { toast('Nenhum acesso para baixar'); return; }
    try {
      const X = await carregarXLSX();
      const ws = X.utils.aoa_to_sheet([CAB, ...ordenar(L).map(linhaAcesso)]);
      ws['!cols'] = [{ wch: 10 }, { wch: 26 }, { wch: 26 }, { wch: 34 }, { wch: 14 }, { wch: 28 }, { wch: 16 }, { wch: 52 }];
      const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, 'Acessos');
      const blob = new Blob([X.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    } catch (e) { toast('Não foi possível gerar a planilha agora. Use “Copiar” e cole no Excel.'); }
  }

  /* ---------- início ---------- */
  (async function iniciar() {
    if (!C || !window.crypto || !crypto.subtle || typeof DecompressionStream === 'undefined') {
      gate.hidden = false; gate.innerHTML = `<div class="ac-card">${marca}<p class="ac-lead">Este navegador não consegue abrir o painel protegido. Use uma versão atual do Chrome, Edge, Firefox ou Safari.</p></div>`; return;
    }
    const salvo = lsGet();
    if (salvo && salvo.email && salvo.codigo) {
      telaCarregando('Abrindo o painel…');
      const r = await entrar(salvo.email, salvo.codigo);
      if (r) return abrirPainel(salvo.email, r);
      lsSet({ email: salvo.email });
      return telaLogin('Seu código mudou ou o acesso foi removido. Entre de novo.');
    }
    telaLogin('');
  })();
})();

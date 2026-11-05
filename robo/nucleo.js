/* Núcleo dos painéis: regras de status, filtros, navegação cruzada e componentes.
   Os layouts só posicionam os slots (data-slot / data-kpi) e definem o visual em CSS.

   Interação (vale para todo o painel):
   - data-set="campo" data-v="valor"  -> clique filtra a tela atual (clicar de novo remove)
   - data-go="aba" data-gf='{json}'    -> clique aplica os filtros do json e abre a aba (ex.: lista de condicionantes)
   - data-cond="i"                     -> abre o detalhe da condicionante */
(function () {
  'use strict';
  const RAW = window.__DADOS__;
  const DIC = RAW.dic;
  const JANELA = 30; // dias para destacar "a vencer"
  const hoje = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); })();
  const DIA = 86400000;

  /* ---------- status ----------
     Reproduz a fórmula da coluna "Status da condicionante" da planilha:
     =SE(Data de conclusão preenchida;"OK";SE(Vencimento="[REVISÃO MANUAL]";"[REVISÃO MANUAL]";SE(Vencimento<HOJE();"NOK";"A VENCER")))
     crit = valor da planilha; st = mesmo valor, com A VENCER separado em até/após 30 dias para leitura. */
  const ST = {
    ok:      { label: 'OK',                      crit: 'ok' },
    em30:    { label: 'A vencer · até 30 dias',  crit: 'avencer' },
    avlonge: { label: 'A vencer · após 30 dias', crit: 'avencer' },
    vencida: { label: 'NOK · vencida',           crit: 'vencida' },
    revisao: { label: '[REVISÃO MANUAL]',        crit: 'revisao' },
  };
  const ST_ORDEM = ['ok', 'avlonge', 'em30', 'vencida', 'revisao'];
  const CRIT = { ok: 'OK', avencer: 'A vencer', vencida: 'NOK', revisao: '[REVISÃO MANUAL]' };
  const CRIT_ORDEM = ['ok', 'avencer', 'vencida', 'revisao'];
  const ST_FILTRO = { ok: 'ok', avlonge: 'avencer', em30: 'em30', vencida: 'vencida', revisao: 'revisao' }; // segmento -> filtro
  const ST_FILTRO_ROT = { ok: 'OK', avencer: 'A vencer', em30: 'A vencer · até 30 dias', vencida: 'NOK', revisao: '[REVISÃO MANUAL]' };
  const LIC_CRIT = { 'Ativa': 'ok', 'Em prazo de renovação': 'avencer', 'Vencida': 'vencida' };
  const LIC_CRIT_ROT = { ok: 'OK', avencer: 'A vencer', vencida: 'Vencido', revisao: 'Revisão manual' };

  const LIC_CURTO = {
    LA0010: 'Licença de Operação', LA0042: 'Tanque de Combustível', LA0081: 'PGRS',
    LA0082: 'ETA', LA0083: 'ETE', LA0084: 'TCA', LA0086: 'Outorga de Poço', LA0087: 'LAS',
  };
  const LIC_ORDEM = ['LA0010', 'LA0042', 'LA0081', 'LA0082', 'LA0083', 'LA0086', 'LA0087'];
  /* nomes completos da aba "Licenças" da base de conhecimento (linhas dos quadros gerenciais) */
  const LIC_NOME = {
    LA0010: 'LA0010 - Licença de Operação da Unidade - "Licença Mãe"',
    LA0042: 'LA0042 - Licença de Instalação e Funcionamento de Tanque de Combustível',
    LA0081: 'LA0081 - PGRS',
    LA0082: 'LA0082 - Licença Ambiental - ETA',
    LA0083: 'LA0083 - Licença Ambiental - ETE',
    LA0084: 'LA0084 - TCA - Termo de Compromisso Ambiental',
    LA0086: 'LA0086 - Outorga de Poço',
    LA0087: 'LA0087 - Licença Ambiental - Simplificada (LAS)',
  };
  /* cor de identidade de cada tipo de licença (fora das cores de status verde/âmbar/vermelho) */
  const COR_TIPO = { LA0010: '#2563eb', LA0042: '#7c3aed', LA0081: '#0d9488', LA0082: '#0ea5e9', LA0083: '#c026d3', LA0084: '#475569', LA0086: '#0891b2', LA0087: '#4f46e5' };
  const LIC_DASH = ['LA0010', 'LA0042', 'LA0081', 'LA0082', 'LA0083', 'LA0084', 'LA0086', 'LA0087'];
  const MESES = ['jan', 'fev', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  const parse = iso => { if (!iso) return null; const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
  const ehISO = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  const fmtD = iso => !iso ? '—' : ehISO(iso) ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : iso;
  const nf = new Intl.NumberFormat('pt-BR');
  const fmt = n => nf.format(n);
  const pct = (a, b) => b ? Math.round((a / b) * 1000) / 10 : 0;
  const fmtP = v => (Math.round(v * 10) / 10).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const codUn = nome => (String(nome).match(/^\s*(BR[0-9A-Z]{2})/) || [])[1] || '';
  const nomeCurtoUn = nome => String(nome).replace(/^\s*BR[0-9A-Z]{2}\s*-\s*/, '');

  const UN_INFO = {};
  RAW.unidades.forEach(u => { UN_INFO[u.nome] = u; });
  const UN_POR_COD = {};
  RAW.unidades.forEach(u => { if (u.cod) UN_POR_COD[u.cod] = u.nome; });

  const ROWS = RAW.regs.map((a, i) => {
    const lic = DIC.lic[a[2]];
    const r = {
      i, un: DIC.un[a[0]], geo: DIC.geo[a[1]], lic, licCod: lic.slice(0, 6), nome: DIC.nome[a[3]],
      num: DIC.num[a[4]], stLic: DIC.stlic[a[5]], emi: a[6], vlic: a[7], desc: a[8], venc: a[9],
      setor: DIC.setor[a[10]] || '—', exig: DIC.exig[a[11]] || '—', tip: DIC.tip[a[12]], conc: a[13],
      acao: DIC.acao[a[14]], and: a[15], orgao: DIC.orgao[a[16]], ambito: DIC.ambito[a[17]], cidade: DIC.cid[a[19]],
    };
    r.cod = codUn(r.un);
    r.ano = ehISO(r.venc) ? r.venc.slice(0, 4) : 'Sem data';
    r.mes = ehISO(r.venc) ? r.venc.slice(0, 7) : '';
    const dv = ehISO(r.venc) ? parse(r.venc) : null;
    r.dias = dv ? Math.round((dv - hoje) / DIA) : null;
    if (String(r.conc).trim()) r.st = 'ok';
    else if (r.dias === null) r.st = 'revisao';
    else if (r.dias < 0) r.st = 'vencida';
    else if (r.dias <= JANELA) r.st = 'em30';
    else r.st = 'avlonge';
    r.crit = ST[r.st].crit;
    r.licKey = r.un + '|' + r.lic + '|' + r.num;
    return r;
  });
  const LIC_POR_COD = {};
  ROWS.forEach(r => { LIC_POR_COD[r.licCod] = r.lic; });

  /* ---------- filtros ---------- */
  const F = { geo: '', un: '', lic: '', exig: '', ano: '', mes: '', st: '', setor: '', stlic: '', q: '' };
  const FILTROS = [
    { k: 'geo', label: 'GEO', todos: 'Todas as GEOs', val: r => r.geo },
    { k: 'un', label: 'Unidade', todos: 'Todas as unidades', val: r => r.un, rot: v => (codUn(v) ? codUn(v) + ' · ' : '') + nomeCurtoUn(v) },
    { k: 'lic', label: 'Licença', todos: 'Todas as licenças', val: r => r.lic, rot: v => v.slice(0, 6) + ' · ' + (LIC_CURTO[v.slice(0, 6)] || v) },
    { k: 'exig', label: 'Condicionante', todos: 'Todas as condicionantes', val: r => r.exig },
    { k: 'ano', label: 'Vencimento (ano)', todos: 'Todos os anos', val: r => r.ano },
    { k: 'st', label: 'Status', todos: 'Todos os status', val: r => r.crit, rot: v => ST_FILTRO_ROT[v] || v,
      ordem: ['ok', 'avencer', 'em30', 'vencida', 'revisao'] },
    { k: 'setor', label: 'Setor responsável', todos: 'Todos os setores', val: r => r.setor },
    { k: 'stlic', label: 'Status da licença', todos: 'Todos', val: r => r.stLic },
    { k: 'mes', label: 'Mês de vencimento', oculto: true, val: r => r.mes, rot: v => MES_CURTO[+v.slice(5, 7) - 1] + '/' + v.slice(0, 4) },
  ];
  const FILTRO = Object.fromEntries(FILTROS.map(f => [f.k, f]));
  const rotulo = (k, v) => k === 'q' ? '“' + v + '”' : (FILTRO[k] && FILTRO[k].rot ? FILTRO[k].rot(v) : v);
  const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function passa(r, ignorar) {
    const ign = [].concat(ignorar || []);
    for (const f of FILTROS) {
      if (!F[f.k] || ign.includes(f.k)) continue;
      if (f.k === 'st') { if (F.st === 'em30' ? r.st !== 'em30' : r.crit !== F.st) return false; continue; }
      if (f.val(r) !== F[f.k]) return false;
    }
    if (F.q && !ign.includes('q')) {
      const q = norm(F.q);
      if (!norm(r.desc + ' ' + r.un + ' ' + r.exig + ' ' + r.acao + ' ' + r.num + ' ' + r.nome).includes(q)) return false;
    }
    return true;
  }
  const filtrar = ignorar => ROWS.filter(r => passa(r, ignorar));

  /* ---------- agregações ---------- */
  function contar(rows) {
    const c = { n: rows.length };
    ST_ORDEM.forEach(s => c[s] = 0); CRIT_ORDEM.forEach(s => c['c_' + s] = 0);
    rows.forEach(r => { c[r.st]++; c['c_' + r.crit]++; });
    return c;
  }
  function agrupar(rows, keyFn) {
    const m = new Map();
    rows.forEach(r => { const k = keyFn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
    return [...m.entries()].map(([k, rs]) => ({ k, rows: rs, c: contar(rs) }));
  }
  function licencas(rows) {
    const m = new Map();
    rows.forEach(r => {
      if (!m.has(r.licKey)) m.set(r.licKey, {
        key: r.licKey, un: r.un, cod: r.cod, geo: r.geo, lic: r.lic, licCod: r.licCod, nome: r.nome, num: r.num,
        orgao: r.orgao, ambito: r.ambito, emi: r.emi, vlic: r.vlic, st: r.stLic, crit: LIC_CRIT[r.stLic] || 'revisao', rows: [],
      });
      m.get(r.licKey).rows.push(r);
    });
    return [...m.values()].map(l => (l.c = contar(l.rows), l));
  }

  /* aplicabilidade x planilha principal (presença independe dos filtros de ano/condicionante) */
  const PRESENTE = new Set(ROWS.map(r => r.cod + '|' + r.licCod));
  const APLIC = RAW.aplic.map(a => {
    const tem = PRESENTE.has(a.cod + '|' + a.lic);
    const sit = a.situacao;
    let res;
    if (/obrigat/i.test(sit)) {
      if (tem) res = 'atendido';
      else if (/LA0010/.test(a.obs) && PRESENTE.has(a.cod + '|LA0010')) res = 'via10';
      else res = 'faltando';
    } else if (/dispensad/i.test(sit)) res = tem ? 'dispdoc' : 'dispensado';
    else res = tem ? 'semdefdoc' : 'semdef';
    return Object.assign({}, a, { tem, res, semDocs: !ROWS.some(r => r.cod === a.cod), unMain: UN_POR_COD[a.cod] || '' });
  });
  const APLIC_RES = {
    atendido:   { label: 'Obrigatório · documento na planilha', glyph: '✓', cls: 'ok' },
    via10:      { label: 'Obrigatório · tratado via LA0010 (conforme observação)', glyph: '↳', cls: 'via' },
    faltando:   { label: 'Obrigatório · documento faltando', glyph: '!', cls: 'falta' },
    dispensado: { label: 'Dispensado', glyph: '–', cls: 'disp' },
    dispdoc:    { label: 'Dispensado · mas há documento na planilha', glyph: '✓', cls: 'dispdoc' },
    semdef:     { label: 'Situação não definida na aplicabilidade', glyph: '?', cls: 'semdef' },
    semdefdoc:  { label: 'Situação não definida · há documento na planilha', glyph: '✓', cls: 'dispdoc' },
  };
  const APLIC_CODS = new Set(APLIC.map(a => a.cod));
  const FORA_APLIC = RAW.unidades.filter(u => !APLIC_CODS.has(u.cod)).map(u => u.nome);

  /* ---------- atributos de interação ---------- */
  const goA = (aba, f) => `data-go="${aba}" data-gf="${esc(JSON.stringify(f))}" role="button" tabindex="0"`;
  const setA = (k, v) => `data-set="${k}" data-v="${esc(v)}" role="button" tabindex="0"`;
  const DICA = '<div class="tt-dica">Clique para listar as condicionantes</div>';

  /* ---------- tooltip e modal ---------- */
  const tt = document.createElement('div'); tt.className = 'tt'; document.body.appendChild(tt);
  document.addEventListener('mousemove', e => {
    const t = e.target.closest('[data-tt]');
    if (!t) { tt.classList.remove('on'); return; }
    tt.innerHTML = t.getAttribute('data-tt'); tt.classList.add('on');
    const w = tt.offsetWidth, h = tt.offsetHeight;
    let x = e.clientX + 16, y = e.clientY + 16;
    if (x + w > innerWidth - 8) x = e.clientX - w - 16;
    if (y + h > innerHeight - 8) y = e.clientY - h - 16;
    tt.style.transform = `translate(${Math.max(8, x)}px,${Math.max(8, y)}px)`;
  });
  const modal = document.createElement('div'); modal.className = 'modal';
  modal.innerHTML = '<div class="modal-box" role="dialog" aria-modal="true"><button class="modal-x" aria-label="Fechar">×</button><div class="modal-c"></div></div>';
  document.body.appendChild(modal);
  const fecharModal = () => modal.classList.remove('on');
  modal.addEventListener('click', e => { if (e.target === modal || e.target.closest('.modal-x')) fecharModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharModal(); });
  function abrirCond(i) {
    const r = ROWS[i];
    const campo = (k, v) => `<div class="mf"><span>${k}</span><b>${v || '—'}</b></div>`;
    const doLic = ROWS.filter(x => x.licKey === r.licKey).length;
    const doUn = ROWS.filter(x => x.un === r.un).length;
    const mesmaExig = ROWS.filter(x => x.exig === r.exig).length;
    modal.querySelector('.modal-c').innerHTML = `
      <div class="m-top">${pill(r.st)}<span class="m-geo">${esc(r.geo)}</span></div>
      <h3>${esc(r.exig)}</h3>
      <p class="m-un">${esc(r.un)} · ${esc(r.cidade)}</p>
      <div class="m-desc">${esc(r.desc)}</div>
      <div class="m-grid">
        ${campo('Licença PIQL', esc(r.lic))}${campo('Documento', esc(r.nome) + ' · nº ' + esc(r.num))}
        ${campo('Órgão emissor', esc(r.orgao))}${campo('Status da licença', esc(r.stLic) + ' · vence ' + fmtD(r.vlic))}
        ${campo('Vencimento da condicionante', fmtD(r.venc) + (r.dias !== null && r.st !== 'ok' ? ` <small>(${r.dias >= 0 ? 'em ' + r.dias : 'há ' + (-r.dias)} dias)</small>` : ''))}
        ${campo('Data de conclusão', fmtD(r.conc))}
        ${campo('Setor responsável', esc(r.setor))}${campo('Tipologia da evidência', esc(r.tip))}
      </div>
      ${r.acao ? `<div class="m-blk"><span>Ação</span><p>${esc(r.acao)}</p></div>` : ''}
      ${r.and ? `<div class="m-blk"><span>Andamento manual</span><p>${esc(r.and).replace(/\n/g, '<br>')}</p></div>` : ''}
      <div class="m-acoes"><span>Ver também · abre sem os filtros atuais</span>
        <button ${goA('condicionantes', { _novo: 1, un: r.un, lic: r.lic })}>Esta licença <b>${fmt(doLic)}</b></button>
        <button ${goA('condicionantes', { _novo: 1, un: r.un })}>Toda a unidade <b>${fmt(doUn)}</b></button>
        <button ${goA('condicionantes', { _novo: 1, exig: r.exig })}>“${esc(r.exig)}” em todas as unidades <b>${fmt(mesmaExig)}</b></button>
        <button ${goA('licencas', { _novo: 1, un: r.un })}>Licenças da unidade</button>
      </div>`;
    modal.classList.add('on');
  }

  /* ---------- peças visuais ---------- */
  const pill = st => `<span class="pill st-${st}"><i></i>${ST[st].label}</span>`;
  const pillCrit = cr => `<span class="pill cr-${cr}"><i></i>${LIC_CRIT_ROT[cr]}</span>`;
  function ttStatus(titulo, c, dica = true) {
    return esc(`<b>${titulo}</b><br>${fmt(c.n)} condicionantes`) + ST_ORDEM.filter(s => c[s]).map(s =>
      esc(`<div class="tt-l"><i class="dot st-${s}"></i>${ST[s].label}<b>${fmt(c[s])} · ${fmtP(pct(c[s], c.n))}</b></div>`)).join('') + (dica ? esc(DICA) : '');
  }
  /* barra empilhada; com "base", cada cor leva à lista daquele status */
  function barra(c, titulo, base) {
    if (!c.n) return '<div class="bar vazia"></div>';
    return '<div class="bar">' + ST_ORDEM.filter(s => c[s]).map(s => {
      const tip = esc(`<b>${titulo}</b><div class="tt-l"><i class="dot st-${s}"></i>${ST[s].label}<b>${fmt(c[s])} · ${fmtP(pct(c[s], c.n))}</b></div>`) + (base ? esc(DICA) : '');
      return `<span class="seg st-${s}" style="flex:${c[s]}" data-tt="${tip}" ${base ? goA('condicionantes', Object.assign({}, base, { st: ST_FILTRO[s] })) : ''}></span>`;
    }).join('') + '</div>';
  }
  function barraCrit(c) {
    if (!c.n) return '<div class="bar fina vazia"></div>';
    return '<div class="bar fina">' + CRIT_ORDEM.filter(s => c['c_' + s]).map(s =>
      `<span class="seg cr-${s}" style="flex:${c['c_' + s]}"></span>`).join('') + '</div>';
  }
  function legenda(tipo) {
    if (tipo === 'crit') return '<div class="leg">' + CRIT_ORDEM.filter(s => s !== 'revisao').map(s => `<span><i class="dot cr-${s}"></i>${CRIT[s]}</span>`).join('') + '</div>';
    return '<div class="leg">' + ST_ORDEM.filter(s => s !== 'revisao').map(s => `<span><i class="dot st-${s}"></i>${ST[s].label}</span>`).join('') + '<span class="leg-dica">Clique nas cores para listar</span></div>';
  }
  const vazio = (msg = 'Nenhum registro para os filtros selecionados.') => `<div class="vazio">${msg}</div>`;
  /* número de status clicável (ex.: "12 NOK") */
  const numSt = (n, st, base, txt) => n ? `<em class="t-${st === 'vencida' ? 'venc' : 'av'} lk" ${goA('condicionantes', Object.assign({}, base, { st }))}>${fmt(n)} ${txt}</em>` : '';

  function donut(c, { size = 200, stroke = 18, centro = '', sub = '', modo = 'crit' } = {}) {
    const r = (size - stroke) / 2, C = 2 * Math.PI * r, gap = c.n ? 3 : 0;
    const chaves = modo === 'crit' ? CRIT_ORDEM.map(s => ['c_' + s, 'cr-' + s, CRIT[s], s]) : ST_ORDEM.map(s => [s, 'st-' + s, ST[s].label, ST_FILTRO[s]]);
    let off = 0, arcs = '';
    chaves.forEach(([k, cls, lab, f]) => {
      const v = c[k]; if (!v) return;
      const len = Math.max(0, (v / c.n) * C - gap);
      arcs += `<circle class="arc ${cls}" r="${r}" cx="${size / 2}" cy="${size / 2}" fill="none" stroke-width="${stroke}" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" data-tt="${esc(`<b>${lab}</b><br>${fmt(v)} · ${fmtP(pct(v, c.n))}`) + esc(DICA)}" ${goA('condicionantes', { st: f })}/>`;
      off += (v / c.n) * C;
    });
    return `<div class="donut" style="width:${size}px;height:${size}px"><svg viewBox="0 0 ${size} ${size}"><circle class="arc-bg" r="${r}" cx="${size / 2}" cy="${size / 2}" fill="none" stroke-width="${stroke}"/><g transform="rotate(-90 ${size / 2} ${size / 2})">${arcs}</g></svg><div class="donut-c"><b>${centro}</b><span>${sub}</span></div></div>`;
  }
  function anel(p, { size = 92, stroke = 8, cls = 'cr-ok' } = {}) {
    const r = (size - stroke) / 2, C = 2 * Math.PI * r, len = (p / 100) * C;
    return `<svg class="anel" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><circle class="arc-bg" r="${r}" cx="${size / 2}" cy="${size / 2}" fill="none" stroke-width="${stroke}"/><circle class="arc ${cls}" r="${r}" cx="${size / 2}" cy="${size / 2}" fill="none" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${len} ${C}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>`;
  }

  /* ícones de linha (inspirados na referência) */
  const ICO = {
    LA0010: '<path d="M14 4h14l8 8v28H14z"/><path d="M28 4v8h8"/><path d="M19 17h12M19 22h12M19 27h7"/><circle cx="30" cy="31" r="4"/><path d="M28 35l-1 6 3-2 3 2-1-6"/>',
    LA0042: '<rect x="6" y="14" width="30" height="16" rx="8"/><path d="M12 30v5M30 30v5M36 22h4v-6M40 16v16h-4"/><path d="M16 22h10"/>',
    LA0081: '<path d="M10 14h28l-3 24H13z"/><path d="M8 14h32M19 14v-4h10v4"/><path d="M18 20l2 12M24 20v12M30 20l-2 12"/>',
    LA0082: '<path d="M8 18v18c0 2 7 4 16 4s16-2 16-4V18"/><ellipse cx="24" cy="18" rx="16" ry="4"/><path d="M24 4c-3 4-4 6-4 8a4 4 0 0 0 8 0c0-2-1-4-4-8z"/>',
    LA0083: '<ellipse cx="24" cy="20" rx="18" ry="6"/><path d="M6 20v8c0 3 8 6 18 6s18-3 18-6v-8"/><path d="M12 26c3 2 6-2 9 0s6-2 9 0 6-2 9 0"/><path d="M24 20l10-8h6"/>',
    LA0086: '<path d="M4 24h40M4 30h40" stroke-dasharray="2 3"/><rect x="20" y="10" width="8" height="30" rx="4"/><path d="M24 4v12M20 8l4-4 4 4"/>',
    LA0087: '<path d="M10 6h22l6 6v30H10z"/><path d="M16 20l5 5 10-10"/><path d="M16 32h16"/>',
  };
  const icone = (cod, size = 44) => `<svg class="ico" viewBox="0 0 48 48" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICO[cod] || ICO.LA0087}</svg>`;

  /* ---------- componentes (data-slot) ---------- */
  const COMP = {};

  function linhasStack(grupos, { filtro, rotulo: rot, sub, valor }) {
    return grupos.map(g => {
      const nome = esc(rot ? rot(g) : g.k);
      return `
      <div class="sb-row${filtro && F[filtro] === g.k ? ' ativo' : ''}">
        <div class="sb-lab" ${filtro ? setA(filtro, g.k) : ''} title="Clique para filtrar"><b>${nome}</b><small>${sub ? sub(g) : fmt(g.c.n) + ' condicionantes'}</small></div>
        ${barra(g.c, nome, filtro ? { [filtro]: g.k } : {})}
        <div class="sb-val">${valor ? valor(g) : `<b>${fmtP(pct(g.c.c_ok, g.c.n))}</b><small>OK</small>`}</div>
      </div>`;
    }).join('');
  }

  COMP.statusGeo = el => {
    const g = agrupar(filtrar('geo'), r => r.geo).sort((a, b) => a.k.localeCompare(b.k));
    el.innerHTML = g.length ? `<div class="sb">${linhasStack(g, {
      filtro: 'geo', valor: x => `<b class="lk" ${goA('condicionantes', { geo: x.k, st: 'vencida' })}>${fmtP(pct(x.c.c_vencida, x.c.n))}</b><small>NOK · ${fmt(x.c.c_vencida)}</small>`,
    })}</div>` + legenda() : vazio();
  };
  COMP.statusUnidade = el => {
    const g = agrupar(filtrar('un'), r => r.un).sort((a, b) => pct(b.c.c_vencida, b.c.n) - pct(a.c.c_vencida, a.c.n) || b.c.n - a.c.n);
    el.innerHTML = g.length ? `<div class="sb rolagem">${linhasStack(g, {
      filtro: 'un', rotulo: x => nomeCurtoUn(x.k), sub: x => `${codUn(x.k) ? codUn(x.k) + ' · ' : ''}${(UN_INFO[x.k] || {}).geo || ''} · ${fmt(x.c.n)} cond.`,
      valor: x => `<b class="lk" ${goA('condicionantes', { un: x.k, st: 'vencida' })}>${fmtP(pct(x.c.c_vencida, x.c.n))}</b><small>NOK · ${fmt(x.c.c_vencida)}</small>`,
    })}</div>` + legenda() : vazio();
  };
  COMP.statusAno = el => {
    const g = agrupar(filtrar('ano'), r => r.ano).sort((a, b) => a.k.localeCompare(b.k));
    if (!g.length) { el.innerHTML = vazio(); return; }
    el.innerHTML = `<div class="cols">` + g.map(x => `
      <div class="col${F.ano === x.k ? ' ativo' : ''}">
        <span class="col-n lk" ${goA('condicionantes', { ano: x.k })} data-tt="${ttStatus('Vencimento em ' + x.k, x.c)}">${fmt(x.c.n)}</span>
        <div class="col-bar">${ST_ORDEM.filter(s => x.c[s]).map(s => `<span class="seg st-${s}" style="flex:${x.c[s]}" data-tt="${esc(`<b>${x.k} · ${ST[s].label}</b><br>${fmt(x.c[s])} · ${fmtP(pct(x.c[s], x.c.n))}`) + esc(DICA)}" ${goA('condicionantes', { ano: x.k, st: ST_FILTRO[s] })}></span>`).join('')}</div>
        <span class="col-k" ${setA('ano', x.k)} title="Filtrar ${esc(x.k)}">${esc(x.k)}</span>
      </div>`).join('') + '</div>' + legenda();
  };
  COMP.donutCrit = el => {
    const c = contar(filtrar());
    const size = +el.dataset.size || 210;
    el.innerHTML = c.n ? `<div class="donut-wrap">${donut(c, { size, stroke: +el.dataset.stroke || 16, centro: fmtP(pct(c.c_ok, c.n)), sub: 'condicionantes OK' })}
      <div class="donut-leg">${CRIT_ORDEM.filter(s => s !== 'revisao' || c.c_revisao).map(s => `<div class="dl cr-${s}" ${goA('condicionantes', { st: s })}><i class="dot cr-${s}"></i><span>${CRIT[s]}</span><b>${fmt(c['c_' + s])}</b><small>${fmtP(pct(c['c_' + s], c.n))}</small></div>`).join('')}</div></div>` : vazio();
  };
  COMP.donutStatus = el => {
    const c = contar(filtrar());
    el.innerHTML = c.n ? `<div class="donut-wrap">${donut(c, { size: +el.dataset.size || 200, stroke: 16, modo: 'st', centro: fmt(c.n), sub: 'condicionantes' })}
      <div class="donut-leg">${ST_ORDEM.filter(s => s !== 'revisao' || c.revisao).map(s => `<div class="dl" ${goA('condicionantes', { st: ST_FILTRO[s] })}><i class="dot st-${s}"></i><span>${ST[s].label}</span><b>${fmt(c[s])}</b><small>${fmtP(pct(c[s], c.n))}</small></div>`).join('')}</div></div>` : vazio();
  };

  COMP.consolidado = el => {
    const rows = filtrar();
    if (!rows.length) { el.innerHTML = vazio(); return; }
    const geos = [...new Set(rows.map(r => r.geo))].sort();
    const lics = [...new Set(rows.map(r => r.lic))].sort();
    const cel = {}; let max = 0;
    rows.forEach(r => { const k = r.lic + '|' + r.geo; (cel[k] = cel[k] || []).push(r); });
    Object.values(cel).forEach(v => max = Math.max(max, v.length));
    const td = (rs, titulo, base, tot) => {
      if (!rs || !rs.length) return '<td class="mx-0">·</td>';
      const c = contar(rs), a = tot ? 0 : 0.08 + 0.5 * Math.sqrt(rs.length / max);
      return `<td${tot ? ' class="mx-tot"' : ''} style="--a:${a.toFixed(3)}"><b class="lk" ${goA('condicionantes', base)} data-tt="${ttStatus(titulo, c)}">${fmt(c.n)}</b>${barraCrit(c)}<small>${numSt(c.c_vencida, 'vencida', base, 'NOK')} ${numSt(c.c_avencer, 'avencer', base, 'a vencer')}</small></td>`;
    };
    el.innerHTML = `<div class="mx-wrap"><table class="mx"><thead><tr><th>Licença PIQL</th>${geos.map(g => `<th><span class="lk" ${setA('geo', g)}>${esc(g.replace('GEO ', ''))}</span></th>`).join('')}<th>Total</th></tr></thead><tbody>
      ${lics.map(l => `<tr><th><span class="mx-lic lk" ${setA('lic', l)}>${icone(l.slice(0, 6), 26)}<span><b>${l.slice(0, 6)}</b><small>${LIC_CURTO[l.slice(0, 6)] || ''}</small></span></span></th>
        ${geos.map(g => td(cel[l + '|' + g], `${l.slice(0, 6)} · ${g}`, { lic: l, geo: g })).join('')}${td(rows.filter(r => r.lic === l), l.slice(0, 6) + ' · Total', { lic: l }, true)}</tr>`).join('')}
      <tr class="mx-total"><th>Total</th>${geos.map(g => td(rows.filter(r => r.geo === g), g + ' · Total', { geo: g }, true)).join('')}${td(rows, 'Total geral', {}, true)}</tr>
      </tbody></table></div>` + legenda('crit') + '<p class="nota">Clique no número para listar as condicionantes do cruzamento; em “NOK” ou “a vencer” para listar só esse status. Clique no nome da GEO ou da licença para filtrar.</p>';
  };

  /* licenças */
  const licBase = () => licencas(ROWS.filter(r => (!F.geo || r.geo === F.geo) && (!F.un || r.un === F.un) && (!F.lic || r.lic === F.lic) && (!F.stlic || r.stLic === F.stlic)));
  const ORD_CRIT = { vencida: 0, avencer: 1, revisao: 2, ok: 3 };
  COMP.licCrit = el => {
    const ls = licencas(ROWS.filter(r => (!F.geo || r.geo === F.geo) && (!F.un || r.un === F.un) && (!F.lic || r.lic === F.lic)));
    const n = s => ls.filter(l => l.crit === s).length;
    const blocos = [['ok', 'OK', 'Ativa'], ['avencer', 'A vencer', 'Em prazo de renovação'], ['vencida', 'Vencido', 'Vencida']];
    const rev = n('revisao');
    el.innerHTML = `<div class="lc">${blocos.map(([s, t, orig]) => `
      <div class="lc-b cr-${s}${F.stlic === orig ? ' ativo' : ''}" ${setA('stlic', orig)} title="Filtrar licenças “${orig}”"><i class="dot cr-${s}"></i><span class="lc-t">${t}</span><b>${fmt(n(s))}</b><small>status “${orig}” · ${fmtP(pct(n(s), ls.length))}</small></div>`).join('')}
      </div>${rev ? `<p class="nota">${rev} licença(s) com status “[REVISÃO MANUAL]” na planilha.</p>` : ''}<p class="nota">Clique em um bloco para filtrar o painel pelas licenças nesse status.</p>`;
  };
  COMP.licAtencao = el => {
    const ls = licBase().filter(l => l.crit !== 'ok').sort((a, b) => ORD_CRIT[a.crit] - ORD_CRIT[b.crit] || (a.vlic || '9').localeCompare(b.vlic || '9'));
    el.innerHTML = ls.length ? `<div class="lista">${ls.map(l => `
      <div class="li" ${goA('condicionantes', { un: l.un, lic: l.lic })} data-tt="${esc('<b>' + esc(l.un) + '</b><br>' + l.c.n + ' condicionantes nesta licença') + esc(DICA)}">
        ${pillCrit(l.crit)}
        <div class="li-m"><b>${esc(l.un)}</b><small>${esc(l.licCod)} · ${esc(l.nome)} · nº ${esc(l.num)}</small></div>
        <div class="li-d"><small>Vencimento</small><b>${fmtD(l.vlic)}</b></div>
      </div>`).join('')}</div>` : vazio('Nenhuma licença vencida ou em prazo de renovação para os filtros.');
  };
  COMP.licIcones = el => {
    const ls = licBase();
    const cods = LIC_ORDEM.filter(c => ls.some(l => l.licCod === c));
    el.innerHTML = `<div class="icos">${cods.map(c => {
      const g = ls.filter(l => l.licCod === c);
      const pior = g.some(l => l.crit === 'vencida') ? 'vencida' : g.some(l => l.crit === 'avencer') ? 'avencer' : g.some(l => l.crit === 'revisao') ? 'revisao' : 'ok';
      const cnt = s => g.filter(l => l.crit === s).length;
      const stTxt = cnt('vencida') ? `${cnt('vencida')} vencida${cnt('vencida') > 1 ? 's' : ''}` : cnt('avencer') ? `${cnt('avencer')} em renovação` : cnt('revisao') ? 'Revisão manual' : 'Todas ativas';
      return `<div class="ico-it${F.lic && F.lic.startsWith(c) ? ' ativo' : ''}" style="--tipo:${COR_TIPO[c] || 'var(--accent)'}" ${setA('lic', g[0].lic)}
        data-tt="${esc(`<b>${c} · ${LIC_CURTO[c]}</b><br>${g.length} licenças<div class="tt-l"><i class="dot cr-ok"></i>Ativa<b>${cnt('ok')}</b></div><div class="tt-l"><i class="dot cr-avencer"></i>Em renovação<b>${cnt('avencer')}</b></div><div class="tt-l"><i class="dot cr-vencida"></i>Vencida<b>${cnt('vencida')}</b></div><div class="tt-dica">Clique para filtrar este tipo</div>`)}">
        <div class="ico-c">${icone(c)}<span class="ico-n">${g.length}</span></div><i class="dot cr-${pior}"></i>
        <b>${LIC_CURTO[c]}</b><small>${c} · ${g.length} lic.</small>
        <span class="ico-st cr-${pior}"><i class="dot cr-${pior}"></i>${stTxt}</span><span class="ico-cta" data-n="${g.length}">Filtrar ›</span>
        <span class="ico-bar">${['ok', 'avencer', 'vencida', 'revisao'].filter(s => cnt(s)).map(s => `<i class="cr-${s}" style="flex:${cnt(s)}"></i>`).join('')}</span></div>`;
    }).join('')}</div>`;
  };
  let licOrdem = 'crit';
  COMP.licTabela = el => {
    const ls = licBase();
    const rowsF = filtrar();
    const porLic = new Map(); rowsF.forEach(r => { (porLic.get(r.licKey) || porLic.set(r.licKey, []).get(r.licKey)).push(r); });
    const ord = {
      crit: (a, b) => ORD_CRIT[a.crit] - ORD_CRIT[b.crit] || a.un.localeCompare(b.un),
      un: (a, b) => a.un.localeCompare(b.un) || a.lic.localeCompare(b.lic),
      venc: (a, b) => (a.vlic || '9').localeCompare(b.vlic || '9'),
    }[licOrdem];
    ls.sort(ord);
    el.innerHTML = ls.length ? `<div class="tb-tools"><span>${fmt(ls.length)} licenças · clique na unidade, na licença ou no status para filtrar; nos números para listar as condicionantes</span><div class="seg-ctl">${[['crit', 'Criticidade'], ['un', 'Unidade'], ['venc', 'Vencimento']].map(([k, t]) => `<button data-licord="${k}" class="${licOrdem === k ? 'on' : ''}">${t}</button>`).join('')}</div></div>
      <div class="tb-wrap"><table class="tb"><thead><tr><th>Unidade</th><th>GEO</th><th>Licença PIQL</th><th>Documento</th><th>Órgão</th><th>Emissão</th><th>Vencimento</th><th>Status</th><th>Condicionantes</th></tr></thead><tbody>
      ${ls.map(l => { const c = contar(porLic.get(l.key) || []); const base = { un: l.un, lic: l.lic }; return `<tr>
        <td><b class="lk" ${setA('un', l.un)}>${esc(nomeCurtoUn(l.un))}</b><small>${esc(l.cod)}</small></td><td><span class="lk" ${setA('geo', l.geo)}>${esc(l.geo.replace('GEO ', ''))}</span></td>
        <td><b class="lk" ${setA('lic', l.lic)}>${esc(l.licCod)}</b><small class="nw">${esc(LIC_CURTO[l.licCod] || '')}</small></td>
        <td class="td-wrap"><span class="clamp">${esc(l.nome)}</span><small>nº ${esc(l.num)} · ${esc(l.ambito)}</small></td>
        <td class="td-sm"><span class="clamp" data-tt="${esc(esc(l.orgao))}">${esc(l.orgao)}</span></td><td class="num">${fmtD(l.emi)}</td><td class="num">${fmtD(l.vlic)}</td>
        <td><span ${setA('stlic', l.st)} title="Filtrar licenças “${esc(l.st)}”">${pillCrit(l.crit)}</span>${l.crit === 'revisao' ? `<small>${esc(l.st)}</small>` : ''}</td>
        <td class="td-bar">${c.n ? barra(c, esc(l.un + ' · ' + l.licCod), base) + `<small><span class="lk" ${goA('condicionantes', base)}>${fmt(c.n)} cond.</span> ${numSt(c.c_vencida, 'vencida', base, 'NOK')} ${numSt(c.c_avencer, 'avencer', base, 'a vencer')}</small>` : '<small>—</small>'}</td></tr>`; }).join('')}
      </tbody></table></div>` : vazio();
  };

  /* unidades */
  COMP.unidades = el => {
    const rows = filtrar('un');
    const g = agrupar(rows, r => r.un);
    const ls = licencas(ROWS.filter(r => (!F.geo || r.geo === F.geo) && (!F.lic || r.lic === F.lic)));
    g.sort((a, b) => b.c.c_vencida - a.c.c_vencida || b.c.c_avencer - a.c.c_avencer || a.k.localeCompare(b.k));
    el.innerHTML = g.length ? `<div class="uc-grid">${g.map(x => {
      const lu = ls.filter(l => l.un === x.k);
      const b = { un: x.k };
      return `<div class="uc${F.un === x.k ? ' ativo' : ''}">
        <div class="uc-h"><span class="uc-cod lk" ${setA('un', x.k)} title="Filtrar esta unidade">${esc(codUn(x.k) || '—')} · filtrar</span><span class="uc-geo lk" ${setA('geo', (UN_INFO[x.k] || {}).geo || '')}>${esc(((UN_INFO[x.k] || {}).geo || '').replace('GEO ', ''))}</span></div>
        <b class="uc-n lk" ${goA('condicionantes', b)}>${esc(nomeCurtoUn(x.k))}</b>
        <div class="uc-k">
          <div class="cr-ok" ${goA('condicionantes', Object.assign({ st: 'ok' }, b))}><b>${fmt(x.c.c_ok)}</b><small>OK</small></div>
          <div class="cr-avencer" ${goA('condicionantes', Object.assign({ st: 'avencer' }, b))}><b>${fmt(x.c.c_avencer)}</b><small>A vencer</small></div>
          <div class="cr-vencida" ${goA('condicionantes', Object.assign({ st: 'vencida' }, b))}><b>${fmt(x.c.c_vencida)}</b><small>NOK</small></div>
        </div>
        ${barraCrit(x.c)}
        <div class="uc-f"><span class="lk" ${goA('condicionantes', b)}>${fmt(x.c.n)} condicionantes</span><span class="uc-lic lk" ${goA('licencas', b)} title="Ver licenças da unidade">${lu.map(l => `<i class="dot cr-${l.crit}" data-tt="${esc(`<b>${l.licCod} · ${LIC_CURTO[l.licCod] || ''}</b><br>${l.st} · vence ${fmtD(l.vlic)}`)}"></i>`).join('')} ${lu.length} lic.</span></div>
      </div>`;
    }).join('')}</div>` : vazio();
  };

  /* próximos 30 dias */
  COMP.vencer30 = el => {
    const rs = filtrar('st').filter(r => r.st === 'em30').sort((a, b) => a.dias - b.dias || a.un.localeCompare(b.un));
    el.innerHTML = rs.length ? `<div class="dl30">${rs.map(r => `
      <article class="d30" data-cond="${r.i}" role="button" tabindex="0">
        <div class="d30-q"><b>${r.dias}</b><small>${r.dias === 1 ? 'dia' : 'dias'}</small><span>${fmtD(r.venc)}</span></div>
        <div class="d30-m">
          <div class="d30-t"><b>${esc(r.exig)}</b><span class="tag lk" ${setA('lic', r.lic)}>${esc(r.licCod)} · ${esc(LIC_CURTO[r.licCod] || '')}</span><span class="tag lk" ${setA('setor', r.setor)}>${esc(r.setor)}</span></div>
          <p>${esc(r.desc)}</p>
          <small><span class="lk" ${setA('un', r.un)}>${esc(r.un)}</span> · <span class="lk" ${setA('geo', r.geo)}>${esc(r.geo)}</span>${r.acao ? ' · <em>Ação:</em> ' + esc(r.acao) : ''}</small>
        </div>
      </article>`).join('')}</div>` : vazio(`Nenhuma condicionante vence nos próximos ${JANELA} dias para os filtros selecionados.`);
  };

  /* atalhos de status acima da lista */
  COMP.statusAbas = el => {
    const c = contar(filtrar('st'));
    const op = [['', 'Todas', c.n], ['ok', 'OK', c.c_ok], ['avencer', 'A vencer', c.c_avencer], ['em30', 'Até 30 dias', c.em30], ['vencida', 'NOK', c.c_vencida]];
    if (c.c_revisao) op.push(['revisao', 'Revisão manual', c.c_revisao]);
    el.innerHTML = `<div class="st-abas">${op.map(([k, t, n]) => `<button class="${F.st === k ? 'on' : ''} ${k ? 'cr-' + (k === 'em30' ? 'avencer' : k) : ''}" data-stab="${k}">${k ? '<i class="dot"></i>' : ''}${t}<b>${fmt(n)}</b></button>`).join('')}</div>`;
  };

  /* lista completa de condicionantes */
  let pag = 0; const POR_PAG = 40;
  COMP.condTabela = el => {
    const rs = filtrar().sort((a, b) => (a.venc || '9').localeCompare(b.venc || '9'));
    const tot = Math.max(1, Math.ceil(rs.length / POR_PAG)); pag = Math.min(pag, tot - 1);
    const sl = rs.slice(pag * POR_PAG, pag * POR_PAG + POR_PAG);
    el.innerHTML = rs.length ? `<div class="tb-tools"><span>${fmt(rs.length)} condicionantes · clique na linha para o detalhe; em unidade, licença, condicionante ou setor para filtrar</span>
      <div class="pg"><button data-pag="-1" ${pag ? '' : 'disabled'} aria-label="Página anterior">‹</button><span>${pag + 1} / ${tot}</span><button data-pag="1" ${pag < tot - 1 ? '' : 'disabled'} aria-label="Próxima página">›</button></div></div>
      <div class="tb-wrap"><table class="tb tb-cond"><thead><tr><th>Vencimento</th><th>Status</th><th>Unidade</th><th>Licença</th><th>Condicionante</th><th>Descrição</th><th>Setor</th></tr></thead><tbody>
      ${sl.map(r => `<tr data-cond="${r.i}" class="clic"><td class="num">${fmtD(r.venc)}</td><td>${pill(r.st)}</td><td><b class="lk" ${setA('un', r.un)}>${esc(nomeCurtoUn(r.un))}</b><small>${esc(r.cod)} · ${esc(r.geo.replace('GEO ', ''))}</small></td>
        <td><b class="lk" ${setA('lic', r.lic)}>${esc(r.licCod)}</b></td><td><span class="lk" ${setA('exig', r.exig)}>${esc(r.exig)}</span></td><td class="td-desc">${esc(r.desc)}</td><td><span class="lk" ${setA('setor', r.setor)}>${esc(r.setor)}</span></td></tr>`).join('')}
      </tbody></table></div>` : vazio();
  };

  /* gerencial · quadros no formato das planilhas de acompanhamento (ano de vencimento selecionável) */
  let anoGer = '';
  const anosDisp = () => [...new Set(ROWS.map(r => r.ano))].filter(a => a !== 'Sem data').sort();
  function anoAtivo() {
    if (F.ano) return F.ano;
    if (anoGer) return anoGer === 'todos' ? '' : anoGer;
    const a = String(hoje.getFullYear());
    return anosDisp().includes(a) ? a : '';
  }
  const rotAno = a => a || 'Todos os anos';
  const GEOS_DASH = () => [...new Set(ROWS.map(r => r.geo))].sort();
  const geoCurto = g => g.replace('GEO ', '').replace('RJ-ES', 'RJ / ES').replace('SUL', 'Sul');

  COMP.anoGer = el => {
    const at = anoAtivo();
    el.innerHTML = `<div class="ano-ger"><span>Ano de vencimento</span><div class="seg-ctl">
      <button data-anoger="todos" class="${!at ? 'on' : ''}">Todos</button>${anosDisp().map(a => `<button data-anoger="${a}" class="${at === a ? 'on' : ''}">${a}</button>`).join('')}</div>
      ${F.ano ? '<small>Ano definido pelo filtro do topo</small>' : ''}</div>`;
  };
  COMP.mensal = el => {
    const ano = anoAtivo();
    if (!ano) { el.innerHTML = vazio('Escolha um ano acima para ver o quadro mês a mês.'); return; }
    const rows = filtrar(['ano', 'mes']).filter(r => r.ano === ano);
    const mesAtual = hoje.getFullYear() + '-' + String(hoje.getMonth() + 1).padStart(2, '0');
    const tot = contar(rows);
    const cel = (n, base, st, cls) => n ? `<td class="num ${cls} lk" ${goA('condicionantes', Object.assign({ ano }, base, st ? { st } : {}))}>${fmt(n)}</td>` : `<td class="num ${cls} zero">0</td>`;
    el.innerHTML = `<div class="tb-wrap xl-wrap"><table class="xl"><thead><tr><th>${ano} Mês</th><th>Total de condicionantes</th><th>OK</th><th>Vencido (NOK)</th><th>A vencer</th><th>% OK</th><th class="xl-bar-h">Composição</th></tr></thead><tbody>
      ${MESES.map((m, i) => {
        const mes = ano + '-' + String(i + 1).padStart(2, '0');
        const c = contar(rows.filter(r => r.mes === mes)); const b = { mes };
        return `<tr class="${mes === mesAtual ? 'atual' : ''}${F.mes === mes ? ' ativo' : ''}"><th><span class="lk" ${setA('mes', mes)} title="Filtrar ${m}">${m}</span>${mes === mesAtual ? '<em>mês atual</em>' : ''}</th>
          ${cel(c.n, b, '', 'tot')}${cel(c.c_ok, b, 'ok', 'ok')}${cel(c.c_vencida, b, 'vencida', 'nok')}${cel(c.c_avencer, b, 'avencer', 'av')}
          <td class="num">${c.n ? fmtP(pct(c.c_ok, c.n)) : '—'}</td><td class="xl-bar">${c.n ? barra(c, m + '/' + ano, Object.assign({ ano }, b)) : ''}</td></tr>`;
      }).join('')}</tbody>
      <tfoot><tr><th>${ano}</th>${cel(tot.n, {}, '', 'tot')}${cel(tot.c_ok, {}, 'ok', 'ok')}${cel(tot.c_vencida, {}, 'vencida', 'nok')}${cel(tot.c_avencer, {}, 'avencer', 'av')}<td class="num">${fmtP(pct(tot.c_ok, tot.n))}</td><td class="xl-bar">${barra(tot, 'Total ' + ano, { ano })}</td></tr></tfoot></table></div>
      <div class="xl-total"><span>Total anual</span><b class="lk" ${goA('condicionantes', { ano })}>${fmt(tot.n)}</b></div>
      <p class="nota">Mês e ano pelo “Vencimento da condicionante”; status pela fórmula da coluna R. Clique no mês para filtrar o painel; nos números para listar as condicionantes.</p>`;
  };
  /* quadros DASH: contam licenças (documentos), não condicionantes; ano não se aplica */
  const IGN_LIC = ['ano', 'mes', 'st', 'exig', 'setor', 'q'];
  const licDash = () => licencas(filtrar(IGN_LIC));
  const baseLic = (c, g) => Object.assign({ _novo: 1 }, LIC_POR_COD[c] ? { lic: LIC_POR_COD[c] } : {}, g ? { geo: g } : {});
  COMP.dashQtd = el => {
    const ls = licDash();
    const geos = GEOS_DASH();
    const n = (c, g) => ls.filter(l => (!c || l.licCod === c) && (!g || l.geo === g)).length;
    const td = (v, c, g, pos) => v ? `<td class="num ${pos ? 'xl-pos ' : ''}lk" ${goA('licencas', baseLic(c, g))} data-tt="${esc(`<b>${c || 'Todas'} · ${g ? geoCurto(g) : 'Total'}</b><br>${v} licença(s)<div class="tt-dica">Clique para ver as licenças</div>`)}">${fmt(v)}</td>` : '<td class="num zero">0</td>';
    el.innerHTML = `<div class="tb-wrap xl-wrap"><table class="xl xl-dash"><thead><tr><th>Nome licença</th>${geos.map(g => `<th><span class="lk" ${setA('geo', g)}>${esc(geoCurto(g))}</span></th>`).join('')}<th>Total</th></tr></thead><tbody>
      ${LIC_DASH.map(c => `<tr><th>${LIC_POR_COD[c] ? `<span class="lk" ${setA('lic', LIC_POR_COD[c])}>${esc(LIC_NOME[c])}</span>` : esc(LIC_NOME[c])}</th>${geos.map(g => td(n(c, g), c, g, true)).join('')}${td(n(c), c, '', true)}</tr>`).join('')}</tbody>
      <tfoot><tr><th>TT de documentos</th>${geos.map(g => td(n('', g), '', g)).join('')}${td(n(''), '', '')}</tr></tfoot></table></div>
      <p class="nota">Quantidade de licenças (documentos) da planilha principal por licença PIQL e GEO. Uma licença = unidade + licença PIQL + número. Células com valor ficam destacadas; clique para ver as licenças.</p>`;
  };
  COMP.dashPct = el => {
    const ls = licDash();
    const geos = GEOS_DASH();
    const LIMITE = 60;
    const td = (g2, c, g) => {
      if (!g2.length) return '<td class="num zero"><i class="ap-c ap-disp" title="Nenhuma licença desse tipo na GEO">–</i></td>';
      const k = s => g2.filter(l => l.crit === s).length;
      const p = pct(k('ok'), g2.length), ruins = g2.length - k('ok');
      const base = Object.assign(baseLic(c, g), ruins && k('vencida') ? { stlic: 'Vencida' } : {});
      return `<td class="num lk ${p < LIMITE ? 'xl-ruim' : ''}" ${goA('licencas', base)} data-tt="${esc(`<b>${c || 'Todas'} · ${g ? geoCurto(g) : 'Total'}</b><br>${g2.length} licença(s)<div class="tt-l"><i class="dot cr-ok"></i>Ativa<b>${k('ok')}</b></div><div class="tt-l"><i class="dot cr-avencer"></i>Em prazo de renovação<b>${k('avencer')}</b></div><div class="tt-l"><i class="dot cr-vencida"></i>Vencida<b>${k('vencida')}</b></div>${k('revisao') ? `<div class="tt-l"><i class="dot cr-revisao"></i>Revisão manual<b>${k('revisao')}</b></div>` : ''}<div class="tt-dica">Clique para ver ${k('vencida') ? 'as vencidas' : 'as licenças'}</div>`)}">${fmtP(p)}</td>`;
    };
    el.innerHTML = `<div class="tb-wrap xl-wrap"><table class="xl xl-dash"><thead><tr><th>Nome licença</th>${geos.map(g => `<th><span class="lk" ${setA('geo', g)}>${esc(geoCurto(g))}</span></th>`).join('')}<th>Total</th></tr></thead><tbody>
      ${LIC_DASH.map(c => { const lc = ls.filter(l => l.licCod === c); return `<tr><th>${LIC_POR_COD[c] ? `<span class="lk" ${setA('lic', LIC_POR_COD[c])}>${esc(LIC_NOME[c])}</span>` : esc(LIC_NOME[c])}</th>${geos.map(g => td(lc.filter(l => l.geo === g), c, g)).join('')}${td(lc, c)}</tr>`; }).join('')}</tbody>
      <tfoot><tr><th>TT de documentos</th>${geos.map(g => td(ls.filter(l => l.geo === g), '', g)).join('')}${td(ls, '')}</tr></tfoot></table></div>
      <p class="nota">% de licenças com “Status da licença” = Ativa sobre o total de licenças do cruzamento. Em vermelho: abaixo de ${LIMITE}%. <i class="ap-c ap-disp">–</i> = nenhuma licença desse tipo na GEO. Passe o mouse para ver ativas, em renovação e vencidas.</p>`;
  };
  /* gerencial · setor */
  COMP.setor = el => {
    const rows = filtrar('setor');
    const g = agrupar(rows, r => r.setor).sort((a, b) => b.c.n - a.c.n);
    const max = Math.max(1, ...g.map(x => x.c.n));
    el.innerHTML = g.length ? `<div class="st-list">${g.map(x => `
      <div class="st-row${F.setor === x.k ? ' ativo' : ''}">
        <div class="st-h"><b class="lk" ${setA('setor', x.k)} title="Filtrar este setor">${esc(x.k)}</b><span class="lk" ${goA('condicionantes', { setor: x.k })}><b>${fmtP(pct(x.c.n, rows.length))}</b> do total · ${fmt(x.c.n)} cond.</span></div>
        <div class="st-share"><span style="width:${(x.c.n / max) * 100}%"></span></div>
        ${barra(x.c, esc(x.k), { setor: x.k })}
        <div class="st-k">${CRIT_ORDEM.filter(s => s !== 'revisao' || x.c.c_revisao).map(s => `<span class="cr-${s} lk" ${goA('condicionantes', { setor: x.k, st: s })}><i class="dot cr-${s}"></i>${CRIT[s]} <b>${fmtP(pct(x.c['c_' + s], x.c.n))}</b> <small>${fmt(x.c['c_' + s])}</small></span>`).join('')}</div>
      </div>`).join('')}</div>` + legenda() : vazio();
  };
  COMP.setorGeo = el => {
    const rows = filtrar();
    if (!rows.length) { el.innerHTML = vazio(); return; }
    const geos = [...new Set(rows.map(r => r.geo))].sort();
    const setores = agrupar(rows, r => r.setor).sort((a, b) => b.c.n - a.c.n).map(x => x.k);
    const totG = {}; geos.forEach(g => totG[g] = rows.filter(r => r.geo === g).length);
    el.innerHTML = `<div class="mx-wrap"><table class="mx mx-pct"><thead><tr><th>Setor responsável</th>${geos.map(g => `<th><span class="lk" ${setA('geo', g)}>${esc(g.replace('GEO ', ''))}</span></th>`).join('')}</tr></thead><tbody>
      ${setores.map(s => `<tr><th><span class="lk" ${setA('setor', s)}>${esc(s)}</span></th>${geos.map(g => {
        const rs = rows.filter(r => r.geo === g && r.setor === s); const p = pct(rs.length, totG[g]);
        return rs.length ? `<td style="--a:${(0.06 + p / 100 * 1.4).toFixed(3)}" class="lk" ${goA('condicionantes', { setor: s, geo: g })} data-tt="${ttStatus(s + ' · ' + g, contar(rs))}"><b>${fmtP(p)}</b><small>${fmt(rs.length)}</small></td>` : '<td class="mx-0">·</td>';
      }).join('')}</tr>`).join('')}
      </tbody></table></div><p class="nota">Percentual sobre o total de condicionantes de cada GEO · clique na célula para listar.</p>`;
  };

  /* aplicabilidade */
  const aplicF = () => APLIC.filter(a => (!F.geo || a.geo === F.geo) && (!F.un || a.cod === codUn(F.un)) && (!F.lic || a.lic === F.lic.slice(0, 6)));
  COMP.aplicResumo = el => {
    const as = aplicF();
    const n = k => as.filter(a => a.res === k).length;
    const unsPend = new Set(as.filter(a => a.res === 'faltando').map(a => a.cod));
    const unsTot = new Set(as.map(a => a.cod));
    const obrig = as.filter(a => /obrigat/i.test(a.situacao)).length;
    el.innerHTML = `<div class="ap-k">
      <div><b>${fmt(unsTot.size)}</b><small>unidades na aplicabilidade</small></div>
      <div><b>${fmt(obrig)}</b><small>itens obrigatórios</small></div>
      <div class="cr-ok"><b>${fmt(n('atendido') + n('via10'))}</b><small>obrigatórios com documento</small></div>
      <div class="cr-vencida lk" data-rolar="aplicPendencias"><b>${fmt(n('faltando'))}</b><small>documentos faltando · ver lista ↓</small></div>
      <div class="cr-vencida lk" data-rolar="aplicPendencias"><b>${fmt(unsPend.size)}</b><small>unidades com pendência · ver lista ↓</small></div>
      <div><b>${fmt(n('semdef') + n('semdefdoc'))}</b><small>itens sem situação definida</small></div>
    </div>`;
  };
  let docsLic = null;
  COMP.aplicMatriz = el => {
    const as = aplicF();
    if (!as.length) { el.innerHTML = vazio(); return; }
    if (!docsLic) { docsLic = {}; licencas(ROWS).forEach(l => { (docsLic[l.cod + '|' + l.licCod] = docsLic[l.cod + '|' + l.licCod] || []).push(l); }); }
    const lics = LIC_ORDEM.filter(c => as.some(a => a.lic === c));
    const uns = new Map(); as.forEach(a => { if (!uns.has(a.cod)) uns.set(a.cod, { cod: a.cod, nome: a.unidade, main: a.unMain, geo: a.geo, semDocs: a.semDocs, it: {} }); uns.get(a.cod).it[a.lic] = a; });
    const lista = [...uns.values()].sort((a, b) => a.geo.localeCompare(b.geo) || a.nome.localeCompare(b.nome));
    let geoAtual = '';
    el.innerHTML = `<div class="ap-leg">${Object.entries(APLIC_RES).filter(([k]) => k !== 'semdefdoc').map(([k, v]) => `<span><i class="ap-c ap-${v.cls}">${v.glyph}</i>${v.label}</span>`).join('')}</div>
      <div class="mx-wrap"><table class="ap"><thead><tr><th>Unidade</th>${lics.map(c => `<th><span class="ap-th lk" ${setA('lic', LIC_POR_COD[c] || '')}>${icone(c, 22)}<b>${c}</b><small>${LIC_CURTO[c]}</small></span></th>`).join('')}<th>Pendências</th></tr></thead><tbody>
      ${lista.map(u => {
        const sep = u.geo !== geoAtual ? (geoAtual = u.geo, `<tr class="ap-geo"><td colspan="${lics.length + 2}"><span class="lk" ${setA('geo', u.geo)}>${esc(u.geo)}</span></td></tr>`) : '';
        const falt = Object.values(u.it).filter(a => a.res === 'faltando').length;
        return sep + `<tr><th><b ${u.main ? 'class="lk" ' + goA('licencas', { un: u.main }) + ' title="Ver licenças da unidade"' : ''}>${esc(nomeCurtoUn(u.nome))}</b><small>${esc(u.cod)}${u.semDocs ? ' · <em class="t-venc">sem nenhum documento na planilha principal</em>' : ''}</small></th>
          ${lics.map(c => { const a = u.it[c]; if (!a) return '<td><i class="ap-c ap-na">·</i></td>'; const v = APLIC_RES[a.res];
            const link = a.tem && u.main ? goA('condicionantes', { un: u.main, lic: LIC_POR_COD[c] }) : '';
            /* licenças da planilha principal para este documento: vencimento e status */
            const docs = (docsLic[u.cod + '|' + c] || []).map(l => `<div class="tt-l"><i class="dot cr-${l.crit}"></i>nº ${esc(l.num)} · vence <b style="margin-left:4px;padding:0">${fmtD(l.vlic)}</b><span style="margin-left:auto;padding-left:12px">${esc(l.st)}</span></div>`).join('');
            return `<td><i class="ap-c ap-${v.cls}${link ? ' lk' : ''}" ${link} data-tt="${esc(`<b>${u.cod} · ${c} ${LIC_CURTO[c]}</b><br>Situação: ${a.situacao || '(em branco)'}<br>${v.label}${docs ? '<div style="margin-top:6px"><b>Vencimento da licença</b></div>' + docs : ''}${a.obs ? '<br><em>Obs.: ' + esc(a.obs) + '</em>' : ''}${link ? '<div class="tt-dica">Clique para ver as condicionantes deste documento</div>' : ''}`)}">${v.glyph}</i></td>`; }).join('')}
          <td>${falt ? `<span class="pill cr-vencida lk" data-rolar="aplicPendencias"><i></i>${falt} faltando</span>` : '<span class="pill cr-ok"><i></i>Completo</span>'}</td></tr>`;
      }).join('')}</tbody></table></div>`;
  };
  COMP.aplicPendencias = el => {
    const as = aplicF().filter(a => a.res === 'faltando');
    const fora = FORA_APLIC.filter(n => (!F.un || n === F.un));
    const uns = agrupar(as, a => a.cod);
    el.innerHTML = (uns.length ? `<div class="pend">${uns.sort((a, b) => b.rows.length - a.rows.length || a.k.localeCompare(b.k)).map(u => {
      const m = u.rows[0].unMain;
      return `<div class="pend-u"><div class="pend-h"><b ${m ? 'class="lk" ' + goA('licencas', { un: m }) + ' title="Ver licenças da unidade"' : ''}>${esc(u.rows[0].unidade)}</b><span>${esc(u.rows[0].geo)} · ${u.rows.length} faltando${m ? ` · <span class="lk" ${goA('condicionantes', { un: m })}>ver condicionantes</span>` : ''}</span></div>
        ${u.rows.map(a => `<div class="pend-i"><span class="tag">${a.lic}</span><div><b>${esc(LIC_CURTO[a.lic] || a.licNome)}</b><small>${esc(a.obs || 'Sem observação na aba Aplicabilidade')}</small></div></div>`).join('')}
      </div>`; }).join('')}</div>` : vazio('Nenhum documento obrigatório faltando para os filtros.')) +
      (fora.length ? `<p class="nota">Unidade(s) na planilha principal sem cadastro na aba Aplicabilidade: ${fora.map(esc).join(', ')}.</p>` : '');
  };

  /* filtros */
  COMP.filtros = el => {
    el.innerHTML = `<div class="fl">${FILTROS.filter(f => !f.oculto).map(f => {
      let ops = [...new Set(filtrar(f.k).map(f.val))];
      if (f.k === 'st') { if (ops.includes('avencer')) ops.push('em30'); ops = f.ordem.filter(o => ops.includes(o)); }
      else ops.sort((a, b) => f.k === 'un' ? nomeCurtoUn(a).localeCompare(nomeCurtoUn(b)) : String(a).localeCompare(String(b)));
      if (F[f.k] && !ops.includes(F[f.k])) ops.unshift(F[f.k]);
      /* campo com busca ao digitar (combobox): a lista filtra conforme o texto */
      return `<div class="fl-i cb${F[f.k] ? ' on' : ''}" data-cbk="${f.k}"><span>${f.label}</span>
        <div class="cb-box"><input class="cb-in" data-cb="${f.k}" role="combobox" aria-expanded="false" autocomplete="off" spellcheck="false" placeholder="${esc(f.todos)}" value="${F[f.k] ? esc(rotulo(f.k, F[f.k])) : ''}" data-atual="${F[f.k] ? esc(rotulo(f.k, F[f.k])) : ''}">${F[f.k] ? `<button class="cb-x" data-cbclear="${f.k}" title="Limpar" aria-label="Limpar ${esc(f.label)}">×</button>` : ''}</div>
        <div class="cb-list" role="listbox" hidden><div class="cb-op${!F[f.k] ? ' sel' : ''}" data-cbv="">${esc(f.todos)}</div>${ops.map(o => `<div class="cb-op${F[f.k] === o ? ' sel' : ''}" data-cbv="${esc(o)}" data-txt="${esc(norm(rotulo(f.k, o)))}">${esc(rotulo(f.k, o))}</div>`).join('')}<div class="cb-nada" hidden>Nenhum resultado</div></div></div>`;
    }).join('')}
      <label class="fl-i fl-q${F.q ? ' on' : ''}"><span>Busca</span><input data-f="q" type="search" placeholder="Texto da condicionante…" value="${esc(F.q)}"></label>
      <button class="fl-x" data-limpar ${Object.values(F).some(Boolean) ? '' : 'disabled'}>Limpar filtros</button></div>`;
  };
  /* chips dos filtros ativos + voltar */
  const ROT_CHIP = { geo: 'GEO', un: 'Unidade', lic: 'Licença', exig: 'Condicionante', ano: 'Ano', mes: 'Mês', st: 'Status', setor: 'Setor', stlic: 'Status da licença', q: 'Busca' };
  COMP.chips = el => {
    const ativos = Object.entries(F).filter(([, v]) => v);
    el.innerHTML = `<div class="chips">${historico.length ? '<button class="ch-voltar" data-voltar>← Voltar</button>' : ''}${ativos.length ? ativos.map(([k, v]) =>
      `<span class="ch" ${setA(k, v)} title="Remover filtro"><small>${ROT_CHIP[k]}</small>${esc(rotulo(k, v))}<i>×</i></span>`).join('') + '<button class="ch-limpar" data-limpar>Limpar tudo</button>'
      : '<span class="ch-vazio">Sem filtros · clique em qualquer nome, número ou cor do painel para cruzar as informações</span>'}</div>`;
  };

  /* KPIs simples (data-kpi="...") */
  function kpis() {
    const rows = filtrar();
    const c = contar(rows);
    const ls = licBase();
    const as = aplicF();
    const v = {
      total: fmt(c.n), ok: fmt(c.c_ok), avencer: fmt(c.c_avencer), vencida: fmt(c.c_vencida),
      pctok: fmtP(pct(c.c_ok, c.n)), pctavencer: fmtP(pct(c.c_avencer, c.n)), pctvencida: fmtP(pct(c.c_vencida, c.n)),
      em30: fmt(c.em30), pctem30: fmtP(pct(c.em30, c.n)), avlonge: fmt(c.avlonge), revisao: fmt(c.c_revisao),
      lictotal: fmt(ls.length), licok: fmt(ls.filter(l => l.crit === 'ok').length),
      licavencer: fmt(ls.filter(l => l.crit === 'avencer').length), licvencida: fmt(ls.filter(l => l.crit === 'vencida').length),
      unidades: fmt(new Set(rows.map(r => r.un)).size), geos: fmt(new Set(rows.map(r => r.geo)).size),
      aplicfalta: fmt(as.filter(a => a.res === 'faltando').length),
      aplicunpend: fmt(new Set(as.filter(a => a.res === 'faltando').map(a => a.cod)).size),
      hoje: hoje.toLocaleDateString('pt-BR'), fonte: esc(RAW.fontes.principal), atualizado: esc(RAW.fontes.principalModificado), gerado: esc(/^\d{4}-\d{2}-\d{2}/.test(RAW.geradoEm || '') ? RAW.geradoEm.slice(8, 10) + '/' + RAW.geradoEm.slice(5, 7) + '/' + RAW.geradoEm.slice(0, 4) + RAW.geradoEm.slice(10) : (RAW.geradoEm || '')),
      janela: JANELA,
    };
    document.querySelectorAll('[data-kpi]').forEach(e => { e.innerHTML = v[e.dataset.kpi] ?? ''; });
    document.querySelectorAll('[data-kpi-w]').forEach(e => {
      const m = { ok: pct(c.c_ok, c.n), avencer: pct(c.c_avencer, c.n), vencida: pct(c.c_vencida, c.n) };
      e.style.setProperty('--p', (m[e.dataset.kpiW] || 0) + '%');
    });
    return c;
  }

  /* ---------- ciclo de render e navegação ---------- */
  const ganchos = [], ganchosAba = [];
  const historico = [];
  let abaAtual = '';
  function render() {
    const c = kpis();
    document.querySelectorAll('[data-slot]').forEach(el => {
      const panel = el.closest('[data-panel]');
      if (panel && panel.hidden) return;
      if (COMP[el.dataset.slot]) COMP[el.dataset.slot](el);
    });
    ganchos.forEach(fn => fn(c));
  }
  function guardar() { historico.push({ F: Object.assign({}, F), aba: abaAtual, pag }); if (historico.length > 60) historico.shift(); }
  function mostrarAba(aba, rolar) {
    if (!document.querySelector(`[data-panel="${aba}"]`)) return;
    abaAtual = aba;
    document.querySelectorAll('[data-tab]').forEach(t => t.classList.toggle('on', t.dataset.tab === aba));
    document.querySelectorAll('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== aba; });
    render();
    ganchosAba.forEach(fn => fn(aba));
    if (rolar) window.scrollTo({ top: 0, behavior: 'smooth' });
    try { localStorage.setItem('painel-aba-' + document.body.dataset.layout, aba); } catch (_) {}
  }
  function set(k, v) { guardar(); F[k] = F[k] === v ? '' : v; pag = 0; render(); }
  function ir(aba, filtros) {
    guardar();
    if (filtros._novo) Object.keys(F).forEach(k => F[k] = '');
    Object.keys(filtros).forEach(k => { if (k in F) F[k] = filtros[k]; }); pag = 0;
    fecharModal();
    if (aba !== abaAtual) mostrarAba(aba, true); else render();
  }
  function voltar() {
    const h = historico.pop(); if (!h) return;
    Object.keys(F).forEach(k => F[k] = h.F[k] || ''); pag = h.pag;
    if (h.aba !== abaAtual) mostrarAba(h.aba, true); else render();
  }

  document.addEventListener('change', e => { const f = e.target.dataset && e.target.dataset.f; if (f && f !== 'q') { guardar(); F[f] = e.target.value; pag = 0; render(); } });
  /* ---------- filtros com busca ao digitar ---------- */
  const cbCaixa = el => el.closest('.cb');
  /* destaca o trecho buscado ignorando acentos (cada letra acentuada vira uma letra sem acento) */
  function realce(txt, q) {
    if (!q) return esc(txt);
    const chars = [...txt], n = chars.map(c => norm(c).charAt(0) || c).join(''), i = n.indexOf(q);
    if (i < 0) return esc(txt);
    return esc(chars.slice(0, i).join('')) + '<mark>' + esc(chars.slice(i, i + q.length).join('')) + '</mark>' + esc(chars.slice(i + q.length).join(''));
  }
  function cbAbrir(cx) {
    document.querySelectorAll('.cb.aberto').forEach(o => { if (o !== cx) cbFechar(o); });
    cx.classList.add('aberto'); cx.querySelector('.cb-list').hidden = false; cx.querySelector('.cb-in').setAttribute('aria-expanded', 'true');
    cbFiltrar(cx, '');
  }
  function cbFechar(cx, restaurar = true) {
    cx.classList.remove('aberto'); cx.querySelector('.cb-list').hidden = true;
    const i = cx.querySelector('.cb-in'); i.setAttribute('aria-expanded', 'false'); if (restaurar) i.value = i.dataset.atual || '';
  }
  function cbFiltrar(cx, txt) {
    const q = norm(txt.trim()); let n = 0;
    cx.querySelectorAll('.cb-op').forEach(o => {
      const ok = !q || (o.dataset.cbv === '' ? false : o.dataset.txt.includes(q));
      o.hidden = !ok; o.classList.remove('ativo'); if (ok) n++;
      if (o.dataset.cbv !== '') o.innerHTML = realce(o.textContent, q && ok ? q : '');
    });
    const nada = cx.querySelector('.cb-nada'); nada.hidden = n > 0;
    const prim = [...cx.querySelectorAll('.cb-op')].find(o => !o.hidden); if (prim && q) prim.classList.add('ativo');
  }
  function cbEscolher(cx, v) { const k = cx.dataset.cbk; cbFechar(cx, false); if (F[k] === v) { render(); return; } guardar(); F[k] = v; pag = 0; render(); }
  document.addEventListener('focusin', e => { if (e.target.classList && e.target.classList.contains('cb-in')) { const cx = cbCaixa(e.target); if (!cx.classList.contains('aberto')) { cbAbrir(cx); e.target.select(); } } });
  document.addEventListener('focusout', e => { if (e.target.classList && e.target.classList.contains('cb-in')) { const cx = cbCaixa(e.target); setTimeout(() => { if (!cx.contains(document.activeElement)) cbFechar(cx); }, 120); } });
  document.addEventListener('mousedown', e => {
    const op = e.target.closest('.cb-op'); if (op) { e.preventDefault(); cbEscolher(cbCaixa(op), op.dataset.cbv); return; }
    const x = e.target.closest('[data-cbclear]'); if (x) { e.preventDefault(); cbEscolher(cbCaixa(x), ''); return; }
    const inp = e.target.closest('.cb-in'); if (inp && document.activeElement === inp) { const cx = cbCaixa(inp); cx.classList.contains('aberto') ? cbFechar(cx) : cbAbrir(cx); }
  });
  document.addEventListener('keydown', e => {
    if (!e.target.classList || !e.target.classList.contains('cb-in')) return;
    const cx = cbCaixa(e.target);
    if (!cx.classList.contains('aberto') && (e.key === 'ArrowDown' || e.key === 'Enter')) { cbAbrir(cx); e.preventDefault(); return; }
    const vis = [...cx.querySelectorAll('.cb-op')].filter(o => !o.hidden), at = vis.findIndex(o => o.classList.contains('ativo'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); if (!vis.length) return;
      const nx = vis[(at + (e.key === 'ArrowDown' ? 1 : -1) + vis.length) % vis.length];
      vis.forEach(o => o.classList.remove('ativo')); nx.classList.add('ativo'); nx.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') { e.preventDefault(); const esc_ = vis[at] || vis[0]; if (esc_) cbEscolher(cx, esc_.dataset.cbv); }
    else if (e.key === 'Escape') { e.stopPropagation(); cbFechar(cx); e.target.blur(); }
  });
  let tq; document.addEventListener('input', e => {
    if (e.target.classList && e.target.classList.contains('cb-in')) { cbFiltrar(cbCaixa(e.target), e.target.value); return; }
    if (e.target.dataset && e.target.dataset.f === 'q') {
      clearTimeout(tq); const pos = e.target.selectionStart;
      tq = setTimeout(() => { F.q = e.target.value; pag = 0; render(); const i = document.querySelector('[data-f="q"]'); if (i) { i.focus(); i.setSelectionRange(pos, pos); } }, 280);
    }
  });
  function acionar(t) {
    const alvo = t.closest('[data-go],[data-set],[data-cond]');
    if (!alvo) return false;
    if (alvo.dataset.go) { ir(alvo.dataset.go, JSON.parse(alvo.dataset.gf || '{}')); return true; }
    if (alvo.dataset.set) { set(alvo.dataset.set, alvo.dataset.v); return true; }
    abrirCond(+alvo.dataset.cond); return true;
  }
  document.addEventListener('click', e => {
    if (e.target.closest('[data-limpar]')) { guardar(); Object.keys(F).forEach(k => F[k] = ''); pag = 0; render(); return; }
    if (e.target.closest('[data-voltar]')) { voltar(); return; }
    const sa = e.target.closest('[data-stab]'); if (sa) { guardar(); F.st = sa.dataset.stab; pag = 0; render(); return; }
    const ro = e.target.closest('[data-rolar]'); if (ro) { const d = document.querySelector(`[data-slot="${ro.dataset.rolar}"]`); if (d) d.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    const ag = e.target.closest('[data-anoger]');
    if (ag) { if (F.ano) { guardar(); F.ano = ''; } anoGer = ag.dataset.anoger; render(); return; }
    const lo = e.target.closest('[data-licord]'); if (lo) { licOrdem = lo.dataset.licord; render(); return; }
    const p = e.target.closest('[data-pag]'); if (p) { pag += +p.dataset.pag; render(); return; }
    const tab = e.target.closest('[data-tab]'); if (tab) { mostrarAba(tab.dataset.tab, true); return; }
    acionar(e.target);
  });
  document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"]')) { e.preventDefault(); acionar(e.target); } });

  window.Painel = {
    F, ROWS, APLIC, ST, CRIT, LIC_CURTO, contar, filtrar, agrupar, licencas, fmt, fmtP, pct, esc, anel, icone, donut, barraCrit,
    nomeCurtoUn, codUn, set, ir, goA, setA, render, aoRenderizar: fn => ganchos.push(fn), aoMudarAba: fn => ganchosAba.push(fn),
    iniciar() {
      let aba = location.hash.slice(1) || null;
      if (!aba) try { aba = localStorage.getItem('painel-aba-' + document.body.dataset.layout); } catch (_) {}
      const t = (aba && document.querySelector(`[data-panel="${aba}"]`)) ? aba : (document.querySelector('[data-tab]') || {}).dataset.tab;
      mostrarAba(t);
    },
  };
})();

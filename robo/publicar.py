"""Gera a versão pública (GitHub Pages) do painel, protegida por e-mail + código.

Os dados vão criptografados (AES-GCM): sem um e-mail e código válidos, o site não mostra nada.
Cada escopo (tudo, uma GEO, uma unidade) tem a sua chave; o código de cada pessoa só abre a chave
do escopo dela. A lista de acessos (com os códigos) vai numa parte que só administradores abrem.

A lista de usuários é a planilha "Usuários do painel.xlsx" na pasta do painel:
  GEO | Unidade | Nome | E-mail | Tipo | Pode ver | Código | Situação
Quem não tem código ganha um; "Pode ver" é preenchido a partir da GEO e da unidade (pode ser
corrigido à mão: "Todas as GEOs", o nome da GEO ou o nome da unidade). Os códigos voltam para a planilha.

Uso: python publicar.py   (o .bat "Atualizar e publicar painel" roda isto e envia ao GitHub)
"""
import base64
import gzip
import hashlib
import json
import os
import re
import secrets
import sys
import unicodedata

import openpyxl
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from openpyxl.styles import Font, PatternFill

import montar

AQUI = os.path.dirname(os.path.abspath(__file__))
DESTINO = os.path.dirname(AQUI)
PLANILHA = os.path.join(DESTINO, "Usuários do painel.xlsx")
SITE = os.environ.get("PAINEL_SITE") or os.path.join(DESTINO, "_site", "index.html")
# site já publicado (de onde vem a lista oficial de usuários); o .bat atualiza a cópia local com git pull antes
SITE_PUBLICADO = os.environ.get("PAINEL_SITE_ORIGEM") or os.path.join(DESTINO, "_site", "index.html")
COLUNAS = ["GEO", "Unidade", "Nome", "E-mail", "Tipo", "Pode ver", "Código", "Situação"]
ITERACOES = int(os.environ.get("PAINEL_ITERACOES", 210_000))  # PBKDF2-SHA256; o navegador faz a mesma conta no login
ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def b64(b):
    return base64.b64encode(b).decode()


def sem_acento(s):
    return unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode().lower()


def chave_col(h):
    return re.sub(r"[^a-z]", "", sem_acento(h))


def cod_un(n):
    m = re.match(r"^\s*(BR[0-9A-Z]{2})", str(n))
    return m.group(1) if m else ""


def curto_un(n):
    return re.sub(r"^\s*BR[0-9A-Z]{2}\s*-\s*", "", str(n))


def nucleo_un(n):
    s = sem_acento(curto_un(n))
    s = re.sub(r"\[[^\]]*\]", " ", s)
    s = re.sub(r"\b(cdd|cdl|cdc|cds|cd|as|revenda|unidade|filial)\b", " ", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def novo_codigo():
    s = "".join(secrets.choice(ALFABETO) for _ in range(8))
    return s[:4] + "-" + s[4:]


def norm_cod(c):
    return re.sub(r"[^A-Z0-9]", "", str(c or "").upper())


class Escopos:
    """Resolve GEO/unidade da planilha para os nomes usados no painel (mesma regra do portal)."""

    def __init__(self, dados):
        self.geos = sorted({g for g in dados["dic"]["geo"] if g})
        self.unidades = dados["unidades"]

    def geo(self, txt):
        k = re.sub(r"[^a-z0-9]", "", re.sub(r"^geo\s*", "", sem_acento(txt)))
        return next((g for g in self.geos if re.sub(r"[^a-z0-9]", "", re.sub(r"^geo\s*", "", sem_acento(g))) == k), "") if k else ""

    def unidade(self, txt, geo=""):
        k = nucleo_un(txt)
        if not k:
            return "", False
        c = [u for u in self.unidades if nucleo_un(u["nome"]) == k or f" {k} " in f" {nucleo_un(u['nome'])} "]
        if geo and any(u["geo"] == geo for u in c):
            c = [u for u in c if u["geo"] == geo]
        if len(c) > 1:
            exato = [u for u in c if nucleo_un(u["nome"]) == k and "[" not in u["nome"]]
            if len(exato) == 1:
                c = exato
        return (c[0]["nome"], False) if len(c) == 1 else ("", len(c) > 1)

    def de_pode_ver(self, txt):
        """Lê a coluna "Pode ver" preenchida à mão ou por uma publicação anterior."""
        t = str(txt or "").strip()
        if not t:
            return None
        if sem_acento(t).startswith("todas"):
            return ("todos", "")
        g = self.geo(t)
        if g and sem_acento(t).replace(" ", "") in (sem_acento(g).replace(" ", ""), sem_acento(g).replace("geo ", "").replace(" ", "")):
            return ("geo", g)
        exato = next((u["nome"] for u in self.unidades if sem_acento(u["nome"]) == sem_acento(t) or cod_un(u["nome"]) == t.upper()), "")
        if exato:
            return ("unidade", exato)
        u, _ = self.unidade(t)
        return ("unidade", u) if u else None


def rotulo(perfil, escopo):
    return "Todas as GEOs" if perfil == "todos" else escopo


CREDENCIAL = os.path.join(AQUI, "credencial_admin.json")  # fica só neste computador (fora da pasta _site)


def abrir_cifra(chave, p):
    return AESGCM(chave).decrypt(base64.b64decode(p["iv"]), base64.b64decode(p["ct"]), None)


def credencial():
    """E-mail e código de um administrador, para ler a lista de usuários já publicada."""
    if os.path.exists(CREDENCIAL):
        with open(CREDENCIAL, encoding="utf-8") as f:
            c = json.load(f)
        return c["email"], c["codigo"]
    if not sys.stdin or not sys.stdin.isatty():
        raise SystemExit('ERRO: falta o acesso de administrador. Rode o .bat de novo e informe o e-mail e o código de um administrador.')
    print("\nPara ler a lista de usuários do site, informe o acesso de um ADMINISTRADOR (fica salvo só neste computador).")
    email = input("  E-mail: ").strip().lower()
    codigo = input("  Código de acesso: ").strip().upper()
    return email, codigo


def usuarios_publicados():
    """Lista de usuários que está no site publicado (é a lista oficial: o site cadastra e remove)."""
    if not os.path.exists(SITE_PUBLICADO):
        return None
    html = open(SITE_PUBLICADO, encoding="utf-8").read()
    i = html.find("window.__COFRE__=")
    if i < 0:
        return None
    j = html.find(";</script>", i)
    cofre = json.loads(html[i + len("window.__COFRE__="):j])
    email, codigo = credencial()
    sal_id = base64.b64decode(cofre["salId"])
    uid = hashlib.sha256(sal_id + email.encode()).hexdigest()[:32]
    e = next((u for u in cofre["usuarios"] if u["id"] == uid), None)
    if e and e.get("adm"):
        kek = hashlib.pbkdf2_hmac("sha256", (email + "|" + norm_cod(codigo)).encode(), base64.b64decode(e["sal"]), cofre["iter"], 32)
        try:
            k_adm = abrir_cifra(kek, e["adm"])
            lista = json.loads(gzip.decompress(abrir_cifra(k_adm, cofre["admin"])))
            with open(CREDENCIAL, "w", encoding="utf-8") as f:
                json.dump({"email": email, "codigo": codigo}, f)
            return lista
        except Exception:
            pass
    if os.path.exists(CREDENCIAL):
        os.remove(CREDENCIAL)
    raise SystemExit("ERRO: esse e-mail e código não são de um administrador do site (ou o código mudou). Rode de novo e informe um acesso de administrador válido.")


def resolver(esc, geo_txt, un_txt, pode_ver, tipo):
    """Escopo de uma linha da planilha: devolve (perfil, escopo, aviso)."""
    if tipo == "admin":
        return "todos", "", ""
    manual = esc.de_pode_ver(pode_ver)
    if manual:
        return manual[0], manual[1], ""
    g = esc.geo(geo_txt)
    u, duvida = esc.unidade(un_txt, g)
    if u:
        return "unidade", u, ""
    if g:
        return "geo", g, ("Confira: unidade com mais de uma opção, liberada a GEO" if duvida else "Confira: unidade não encontrada, liberada a GEO") if un_txt else ""
    return "todos", "", ("Confira: GEO e unidade não encontradas, liberado tudo" if geo_txt or un_txt else "")


def ler_usuarios(dados):
    """Lista final = usuários do site + pessoas novas da planilha (linhas sem código). A planilha volta como espelho."""
    publicados = usuarios_publicados()
    lista = publicados if publicados is not None else []
    por_email = {u["email"]: u for u in lista}
    avisos = {}
    novos = 0
    if os.path.exists(PLANILHA):
        wb = openpyxl.load_workbook(PLANILHA)
        linhas = [list(r) for r in wb.worksheets[0].iter_rows(values_only=True)]
        i_cab = next((i for i, l in enumerate(linhas) if any(chave_col(c) in ("email", "emails") for c in l if c)), None)
        if i_cab is None:
            raise SystemExit('ERRO: a planilha "Usuários do painel.xlsx" não tem a coluna "E-mail".')
        cab = [chave_col(c) for c in linhas[i_cab]]
        sinon = {"GEO": ["geo", "regional"], "Unidade": ["unidade", "cdd", "localidade"], "Nome": ["nome", "god", "responsavel", "gestor"],
                 "E-mail": ["email", "emails"], "Tipo": ["tipo", "perfil"], "Pode ver": ["podever", "escopo"], "Código": ["codigo", "senha", "codigodeacesso"]}
        idx = {k: next((j for j, c in enumerate(cab) if c in v), None) for k, v in sinon.items()}
        esc = Escopos(dados)
        for l in linhas[i_cab + 1:]:
            val = lambda k: str(l[idx[k]]).strip() if idx[k] is not None and idx[k] < len(l) and l[idx[k]] is not None else ""
            email = val("E-mail").lower()
            if not email or email in por_email:
                continue  # quem já está no site é alterado pelo site
            if val("Código"):
                continue  # tem código mas não está no site: foi removido pelo site
            if not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", email):
                print(f"  ignorado (e-mail inválido): {email}")
                continue
            tipo = "admin" if re.search(r"adm", val("Tipo"), re.I) else "usuario"
            perfil, escopo, aviso = resolver(esc, val("GEO"), val("Unidade"), val("Pode ver"), tipo)
            u = {"email": email, "nome": val("Nome"), "tipo": tipo, "perfil": perfil, "escopo": escopo, "codigo": novo_codigo(),
                 "geo": val("GEO"), "unidade": val("Unidade"), "criadoEm": dados.get("geradoEm", "")}
            lista.append(u); por_email[email] = u; novos += 1
            if aviso:
                avisos[email] = aviso
    escrever_espelho(lista, avisos)
    if novos:
        print(f"  {novos} pessoa(s) nova(s) da planilha incluída(s)")
    return lista


def escrever_espelho(lista, avisos):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Usuários"
    ws.append(COLUNAS)
    for u in sorted(lista, key=lambda u: (u["tipo"] != "admin", str(u.get("geo") or u.get("escopo") or ""), u["email"])):
        ws.append([u.get("geo", ""), u.get("unidade", ""), u.get("nome", ""), u["email"], "Administrador" if u["tipo"] == "admin" else "Usuário",
                   "Tudo (administrador)" if u["tipo"] == "admin" else rotulo(u["perfil"], u["escopo"]), u["codigo"], avisos.get(u["email"], "Liberado")])
    estilo_cabecalho(ws)
    try:
        wb.save(PLANILHA)
    except PermissionError:
        raise SystemExit('ERRO: feche a planilha "Usuários do painel.xlsx" no Excel e rode de novo (os códigos são gravados nela).')


def estilo_cabecalho(ws, linha=1):
    for c in ws[linha]:
        if c.value:
            c.font = Font(bold=True, color="FFFFFF")
            c.fill = PatternFill("solid", fgColor="1D4ED8")
    for col, w in zip("ABCDEFGH", [10, 24, 26, 34, 15, 30, 13, 46]):
        ws.column_dimensions[col].width = max(ws.column_dimensions[col].width or 0, w)


def recortar(dados, perfil, escopo):
    """Mesmo recorte do portal: só as linhas do escopo."""
    if perfil == "todos":
        return dados
    d = dict(dados)
    if escopo not in (dados["dic"]["geo"] if perfil == "geo" else dados["dic"]["un"]):
        d["regs"], d["unidades"], d["aplic"] = [], [], []  # escopo que sumiu das planilhas: abre vazio
        return d
    if perfil == "geo":
        g = dados["dic"]["geo"].index(escopo)
        d["regs"] = [r for r in dados["regs"] if r[1] == g]
        d["unidades"] = [u for u in dados["unidades"] if u["geo"] == escopo]
        d["aplic"] = [a for a in dados["aplic"] if a["geo"] == escopo]
    else:
        u, cod = dados["dic"]["un"].index(escopo), cod_un(escopo)
        d["regs"] = [r for r in dados["regs"] if r[0] == u]
        d["unidades"] = [x for x in dados["unidades"] if x["nome"] == escopo]
        d["aplic"] = [a for a in dados["aplic"] if cod and a["cod"] == cod]
    return d


def cifrar(chave, conteudo):
    iv = secrets.token_bytes(12)
    return {"iv": b64(iv), "ct": b64(AESGCM(chave).encrypt(iv, conteudo, None))}


def montar_cofre(dados, usuarios):
    pacotes, chaves = {}, {}
    def pacote(perfil, escopo):
        nome = perfil + ":" + escopo
        if nome not in chaves:
            pid = "p" + str(len(chaves))
            chaves[nome] = (pid, AESGCM.generate_key(256))
            corpo = gzip.compress(json.dumps(recortar(dados, perfil, escopo), ensure_ascii=False, separators=(",", ":")).encode())
            pacotes[pid] = cifrar(chaves[nome][1], corpo)
        return chaves[nome]
    k_adm = AESGCM.generate_key(256)
    lista = [{k: u.get(k, "") for k in ("email", "nome", "tipo", "perfil", "escopo", "codigo", "geo", "unidade", "criadoEm")} for u in usuarios]
    adm = cifrar(k_adm, gzip.compress(json.dumps(lista, ensure_ascii=False).encode()))
    sal_id = secrets.token_bytes(16)
    entradas = []
    for u in usuarios:
        pid, k = pacote(u["perfil"], u["escopo"])
        sal = secrets.token_bytes(16)
        kek = hashlib.pbkdf2_hmac("sha256", (u["email"] + "|" + norm_cod(u["codigo"])).encode(), sal, ITERACOES, 32)
        meta = {"nome": u["nome"], "tipo": u["tipo"], "perfil": u["perfil"], "escopo": u["escopo"], "pacote": pid}
        e = {"id": hashlib.sha256(sal_id + u["email"].encode()).hexdigest()[:32], "sal": b64(sal),
             "chave": cifrar(kek, k), "meta": cifrar(kek, json.dumps(meta, ensure_ascii=False).encode())}
        if u["tipo"] == "admin":
            e["adm"] = cifrar(kek, k_adm)
        entradas.append(e)
    secrets.SystemRandom().shuffle(entradas)
    pem = chave_publica_robo()
    return {"v": 1, "iter": ITERACOES, "salId": b64(sal_id), "pacotes": pacotes, "usuarios": entradas, "admin": adm,
            "geradoEm": dados.get("geradoEm", ""),
            # o robô do GitHub abre a lista de usuários com a chave privada dele (secret PAINEL_CHAVE_PRIVADA)
            "adminRobo": b64(para_robo(pem, k_adm)), "chaveRobo": pem}


# ---------- robô do GitHub: chave pública, planilhas criptografadas e código ----------
ARQ_CHAVE_ROBO = os.path.join(AQUI, "chave_publica_robo.pem")
CODIGO_ROBO = ["extrair_dados.py", "montar.py", "publicar.py", "robo.py", "nucleo.js", "base.css", "layout_b.html",
               "acesso.css", "acesso.js", "acesso_publico.js", "chave_publica_robo.pem", os.path.join("img", "copo_recorte.webp")]


def chave_publica_robo():
    with open(ARQ_CHAVE_ROBO, encoding="ascii") as f:
        return f.read()


def para_robo(pem, dados_bytes):
    """Cifra uma chave curta com a chave pública do robô (RSA-OAEP SHA-256, o mesmo do navegador)."""
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
    pub = serialization.load_pem_public_key(pem.encode())
    return pub.encrypt(dados_bytes, padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))


def planilha_para_robo(caminho, destino, por):
    """Guarda a planilha criptografada em _site/entradas (só o robô abre). Não regrava se não mudou."""
    with open(caminho, "rb") as f:
        conteudo = f.read()
    h = hashlib.sha256(conteudo).hexdigest()
    if os.path.exists(destino):
        try:
            with open(destino, encoding="utf-8") as f:
                if json.load(f).get("hash") == h:
                    return False
        except Exception:
            pass
    chave = AESGCM.generate_key(256)
    iv = secrets.token_bytes(12)
    pacote = {"v": 1, "nome": os.path.basename(caminho), "hash": h, "por": por,
              "enviadoEm": __import__("datetime").datetime.now().strftime("%d/%m/%Y %H:%M"),
              "wk": b64(para_robo(chave_publica_robo(), chave)), "iv": b64(iv), "ct": b64(AESGCM(chave).encrypt(iv, conteudo, None))}
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    with open(destino, "w", encoding="utf-8") as f:
        json.dump(pacote, f)
    return True


def preparar_repositorio():
    """Deixa no repositório do site tudo que o robô precisa: código, roteiro e as planilhas usadas (criptografadas)."""
    import shutil
    repo = os.path.dirname(SITE)
    for nome in CODIGO_ROBO:
        alvo = os.path.join(repo, "robo", nome)
        os.makedirs(os.path.dirname(alvo), exist_ok=True)
        shutil.copyfile(os.path.join(AQUI, nome), alvo)
    roteiro = os.path.join(repo, ".github", "workflows", "atualizar.yml")
    os.makedirs(os.path.dirname(roteiro), exist_ok=True)
    shutil.copyfile(os.path.join(AQUI, "robo_atualizar.yml"), roteiro)
    import extrair_dados
    novas = [n for n, c in (("principal", extrair_dados.PRINCIPAL), ("base", extrair_dados.BASE))
             if planilha_para_robo(c, os.path.join(repo, "entradas", n + ".json"), "computador " + os.environ.get("COMPUTERNAME", ""))]
    if novas:
        print("  planilhas guardadas (criptografadas) no repositório:", ", ".join(novas))


def main():
    montar.main()
    with open(os.path.join(AQUI, "dados.json"), encoding="utf-8") as f:
        dados = json.load(f)
    usuarios = ler_usuarios(dados)
    cofre = montar_cofre(dados, usuarios)
    html = montar.montar_html("window.__ACESSO__=true;window.__COFRE__=" + json.dumps(cofre, separators=(",", ":")) + ";")
    extra = "<style>\n" + montar.ler("acesso.css") + "\n</style>\n<script>\n" + montar.ler("acesso_publico.js") + "\n</script>\n"
    html = html.replace("</body>", extra + "</body>")
    os.makedirs(os.path.dirname(SITE), exist_ok=True)
    with open(SITE, "w", encoding="utf-8") as f:
        f.write(html)
    if not os.environ.get("PAINEL_ROBO") and not os.environ.get("PAINEL_SITE"):
        preparar_repositorio()  # no computador: mantém o robô e o backup das planilhas em dia
    n_adm = sum(u["tipo"] == "admin" for u in usuarios)
    print(f"site protegido gerado: {len(usuarios)} acessos ({n_adm} administradores), {len(cofre['pacotes'])} escopos criptografados")
    if not usuarios:
        print("ATENÇÃO: nenhum usuário válido na planilha; ninguém vai conseguir entrar no site.")
    return usuarios


if __name__ == "__main__":
    sys.exit(0 if main() is not None else 1)

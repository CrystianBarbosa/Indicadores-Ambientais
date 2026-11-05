"""Lê as duas planilhas e gera dados.json para os painéis.

Uso: python extrair_dados.py
Fontes:
  - 3. Análise de Condicionantes/Análise de condicionantes - Todas as GEOs - atualizada.xlsx
      aba "Controle - Licenças e Condic."
  - 4. Base de condicionantes/Base de conhecimento (condicionantes) - sem Nova Iguaçu.xlsx
      abas "Aplicabilidade" e "Base unidades"
Nenhum valor é inventado: o script só normaliza datas e códigos para cruzar as planilhas.
"""
import datetime
import json
import os
import re

import openpyxl

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(AQUI))
def pasta(numero):
    """Pasta do projeto pelo número ("3.", "4."), para não depender do nome completo."""
    for nome in sorted(os.listdir(RAIZ)):
        if nome.startswith(numero) and os.path.isdir(os.path.join(RAIZ, nome)):
            return os.path.join(RAIZ, nome)
    raise FileNotFoundError(f'Pasta "{numero}..." não encontrada em {RAIZ}')


# no robô do GitHub as planilhas chegam por variável de ambiente (enviadas pelo portal)
PRINCIPAL = os.environ.get("PAINEL_PRINCIPAL") or os.path.join(pasta("3."), "Análise de condicionantes - Todas as GEOs - atualizada.xlsx")
BASE = os.environ.get("PAINEL_BASE") or os.path.join(pasta("4."), "Base de conhecimento (condicionantes) - sem Nova Iguaçu.xlsx")
SAIDA = os.path.join(AQUI, "dados.json")

REGIONAL_PARA_GEO = {"RJ / ES": "GEO RJ-ES"}


def limpa(v):
    if v is None:
        return ""
    s = str(v).replace("\xa0", " ").strip()
    return s


def data_iso(v):
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.strftime("%Y-%m-%d")
    s = limpa(v)
    m = re.match(r"^(\d{2})/(\d{2})/(\d{4})$", s)
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    return ""


def cod_unidade(nome):
    m = re.match(r"^\s*(BR[0-9A-Z]{2})", limpa(nome))
    return m.group(1) if m else ""


def cod_licenca(nome):
    m = re.match(r"^\s*(LA\d{4})", limpa(nome))
    return m.group(1) if m else ""


class Dic:
    """Dicionário de valores repetidos, para o JSON ficar enxuto."""

    def __init__(self):
        self.lista, self.idx = [], {}

    def __call__(self, v):
        v = limpa(v)
        if v not in self.idx:
            self.idx[v] = len(self.lista)
            self.lista.append(v)
        return self.idx[v]


def abrir(caminho):
    """Abre a planilha mesmo se estiver aberta no Excel (lê uma cópia temporária)."""
    try:
        return openpyxl.load_workbook(caminho, read_only=True, data_only=True)
    except PermissionError:
        import subprocess, tempfile
        tmp = os.path.join(tempfile.mkdtemp(), "copia.xlsx")
        subprocess.run(["powershell", "-NoProfile", "-Command",
                        f"Copy-Item -LiteralPath '{caminho}' -Destination '{tmp}'"], check=True)
        return openpyxl.load_workbook(tmp, read_only=True, data_only=True)


def ler_principal():
    wb = abrir(PRINCIPAL)
    linhas = list(wb["Controle - Licenças e Condic."].iter_rows(values_only=True))
    cab = [limpa(c) for c in linhas[0]]
    col = {c: i for i, c in enumerate(cab)}
    d = {k: Dic() for k in ["un", "cid", "geo", "lic", "nome", "orgao", "ambito", "num",
                            "stlic", "setor", "exig", "tip", "acao"]}
    unidades = {}
    regs = []
    for r in linhas[1:]:
        if not any(r):
            continue
        g = lambda c: r[col[c]]
        un = limpa(g("Unidade"))
        unidades.setdefault(un, {"nome": un, "cod": cod_unidade(un), "geo": limpa(g("GEO")),
                                 "cidade": limpa(g("Cidade"))})
        regs.append([
            d["un"](un),                                   # 0 unidade
            d["geo"](g("GEO")),                            # 1 GEO
            d["lic"](g("Licença PIQL")),                   # 2 licença PIQL
            d["nome"](g("Nome na licença")),               # 3 nome na licença
            d["num"](g("Número da licença")),              # 4 número
            d["stlic"](g("Status da licença")),            # 5 status da licença
            data_iso(g("Data de emissão")),                # 6
            data_iso(g("Vencimento da licença")),          # 7
            limpa(g("Descrição da condicionante")),        # 8
            data_iso(g("Vencimento da condicionante")) or limpa(g("Vencimento da condicionante")),  # 9
            d["setor"](g("Setor responsável")),            # 10
            d["exig"](g("Exigência macro")),               # 11
            d["tip"](g("Tipologia da evidência")),         # 12
            data_iso(g("Data de conclusão")) or limpa(g("Data de conclusão")),  # 13
            d["acao"](g("Ação")),                          # 14
            limpa(g("Andamento manual")),                  # 15
            d["orgao"](g("Órgão emissor")),                # 16
            d["ambito"](g("Âmbito da licença")),           # 17
            "",                                            # 18 reservado (status é fórmula; ver nucleo.js)
            d["cid"](g("Cidade")),                         # 19
        ])
    return regs, {k: v.lista for k, v in d.items()}, unidades


def ler_base(unidades_principal):
    wb = abrir(BASE)
    nomes_base = {}
    for r in list(wb["Base unidades"].iter_rows(values_only=True))[1:]:
        if r and r[0]:
            nomes_base[cod_unidade(r[0])] = {"nome": limpa(r[0]), "regional": limpa(r[2])}
    por_cod = {u["cod"]: u for u in unidades_principal.values() if u["cod"]}
    linhas = list(wb["Aplicabilidade"].iter_rows(values_only=True))
    aplic = []
    for r in linhas[1:]:
        if not r or not limpa(r[0]):
            continue
        cod = cod_unidade(r[0])
        regional = limpa(r[1])
        nome = (por_cod.get(cod) or nomes_base.get(cod) or {}).get("nome") or limpa(r[0])
        geo = (por_cod.get(cod) or {}).get("geo") or REGIONAL_PARA_GEO.get(regional, "GEO " + regional)
        aplic.append({
            "cod": cod, "unidade": nome, "unidadeOrig": limpa(r[0]), "regional": regional, "geo": geo,
            "lic": cod_licenca(r[2]), "licNome": limpa(r[2]),
            "situacao": limpa(r[3]), "obs": limpa(r[4]),
        })
    return aplic


def main():
    regs, dic, unidades = ler_principal()
    aplic = ler_base(unidades)
    saida = {
        "geradoEm": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "fontes": {"principal": os.path.basename(PRINCIPAL), "base": os.path.basename(BASE),
                   "principalModificado": datetime.datetime.fromtimestamp(os.path.getmtime(PRINCIPAL)).strftime("%d/%m/%Y %H:%M")},
        "dic": dic,
        "unidades": list(unidades.values()),
        "regs": regs,
        "aplic": aplic,
    }
    with open(SAIDA, "w", encoding="utf-8") as f:
        json.dump(saida, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(regs)} condicionantes, {len(unidades)} unidades, {len(aplic)} linhas de aplicabilidade -> {SAIDA}")


if __name__ == "__main__":
    main()

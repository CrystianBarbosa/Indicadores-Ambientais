"""Atualiza os dados a partir das planilhas e gera os painéis HTML autônomos.

Uso: python montar.py
Saída: "Painel Indicadores Ambientais.html" na pasta "5. Painel Indicadores Ambientais" = atalho para o portal
(com login). A versão aberta (Modelo B, tema Claro, sem login) vai para _fonte/local/ só para conferência.
"""
import base64
import os
import re

import extrair_dados

AQUI = os.path.dirname(os.path.abspath(__file__))
DESTINO = os.path.dirname(AQUI)

# Cada tema só troca variáveis de cor; a estrutura vem de layout_b.html.
TEMAS = {
    "Painel B1 - Azul Noite.html": ("Azul Noite", """
:root {
  --fundo: radial-gradient(1100px 700px at 12% -10%, rgba(66, 120, 255, .42), transparent 60%), radial-gradient(700px 600px at 88% 14%, rgba(245, 165, 36, .12), transparent 60%), linear-gradient(180deg, #0a1d56 0%, #061235 45%, #040b24 100%);
  --surface: rgba(14, 34, 92, .5); --surface-solid: #0b1a46; --surface-2: rgba(36, 62, 140, .32); --card: rgba(18, 40, 104, .55);
  --hover: rgba(245, 165, 36, .08); --line: rgba(150, 180, 255, .13); --line-strong: rgba(150, 180, 255, .28);
  --text: #f3f6ff; --text-2: #bccaee; --muted: #7d8fbf; --accent: #f5a524; --accent-2: #ffd27a; --on-accent: #1a1200; --heat: #4d8dff;
  --side-bg: rgba(4, 12, 40, .6); --titulo-2: #a9c2ff; --marca: #fff;
  --nav-on-bg: linear-gradient(90deg, rgba(245, 165, 36, .22), rgba(245, 165, 36, .04)); --nav-on-borda: rgba(245, 165, 36, .4); --nav-on-brilho: rgba(245, 165, 36, .15);
  --chipbar-bg: rgba(6, 18, 53, .85); --titulo-grad: linear-gradient(90deg, #fff 30%, #c6d6ff);
  --ico-bg: radial-gradient(circle at 50% 30%, rgba(120, 160, 255, .25), rgba(10, 25, 70, .4) 70%); --ico-sombra: 0 0 28px rgba(90, 140, 255, .25), inset 0 0 22px rgba(120, 160, 255, .15);
  --copo-escala: #bccaee; --copo-traco: rgba(220, 235, 255, .6); --copo-vazio: rgba(160, 190, 255, .07);
}"""),
    "Painel B2 - Floresta.html": ("Floresta", """
:root {
  --fundo: radial-gradient(1000px 700px at 10% -10%, rgba(40, 160, 110, .32), transparent 60%), radial-gradient(700px 600px at 90% 12%, rgba(233, 196, 106, .12), transparent 60%), linear-gradient(180deg, #0a2a1e 0%, #061a12 45%, #03100b 100%);
  --surface: rgba(16, 58, 40, .5); --surface-solid: #0b2519; --surface-2: rgba(40, 110, 80, .26); --card: rgba(18, 66, 46, .55);
  --hover: rgba(233, 196, 106, .08); --line: rgba(150, 230, 190, .12); --line-strong: rgba(150, 230, 190, .26);
  --text: #effaf3; --text-2: #b8d8c6; --muted: #7aa08d; --accent: #e9c46a; --accent-2: #f4dc9a; --on-accent: #1f1600; --heat: #2bb38a;
  --side-bg: rgba(3, 18, 12, .6); --titulo-2: #9fe0bf; --marca: #fff;
  --nav-on-bg: linear-gradient(90deg, rgba(233, 196, 106, .22), rgba(233, 196, 106, .04)); --nav-on-borda: rgba(233, 196, 106, .4); --nav-on-brilho: rgba(233, 196, 106, .14);
  --chipbar-bg: rgba(5, 24, 16, .86); --titulo-grad: linear-gradient(90deg, #fff 30%, #bdf0d4);
  --ico-bg: radial-gradient(circle at 50% 30%, rgba(80, 200, 150, .24), rgba(5, 35, 22, .45) 70%); --ico-sombra: 0 0 28px rgba(60, 190, 130, .22), inset 0 0 22px rgba(90, 210, 160, .14);
  --copo-escala: #b8d8c6; --copo-traco: rgba(220, 255, 235, .55); --copo-vazio: rgba(160, 255, 210, .06);
}"""),
    "Painel B3 - Grafite Violeta.html": ("Grafite Violeta", """
:root {
  --fundo: radial-gradient(1000px 700px at 12% -10%, rgba(139, 92, 246, .28), transparent 60%), radial-gradient(700px 600px at 90% 14%, rgba(56, 189, 248, .08), transparent 60%), linear-gradient(180deg, #16131f 0%, #0d0b14 50%, #08070d 100%);
  --surface: rgba(38, 33, 58, .5); --surface-solid: #17142a; --surface-2: rgba(80, 70, 120, .25); --card: rgba(44, 38, 68, .55);
  --hover: rgba(167, 139, 250, .09); --line: rgba(196, 181, 253, .12); --line-strong: rgba(196, 181, 253, .26);
  --text: #f3f0ff; --text-2: #c7c0e4; --muted: #8a83a8; --accent: #a78bfa; --accent-2: #c4b5fd; --on-accent: #140a2e; --heat: #8b5cf6;
  --side-bg: rgba(10, 8, 18, .65); --titulo-2: #c4b5fd; --marca: #fff;
  --nav-on-bg: linear-gradient(90deg, rgba(167, 139, 250, .26), rgba(167, 139, 250, .05)); --nav-on-borda: rgba(167, 139, 250, .45); --nav-on-brilho: rgba(167, 139, 250, .18);
  --chipbar-bg: rgba(12, 10, 20, .86); --titulo-grad: linear-gradient(90deg, #fff 30%, #d8ccff);
  --ico-bg: radial-gradient(circle at 50% 30%, rgba(167, 139, 250, .26), rgba(20, 14, 40, .45) 70%); --ico-sombra: 0 0 28px rgba(139, 92, 246, .25), inset 0 0 22px rgba(167, 139, 250, .14);
  --copo-escala: #c7c0e4; --copo-traco: rgba(235, 228, 255, .55); --copo-vazio: rgba(200, 185, 255, .06);
}"""),
    "Painel B4 - Claro.html": ("Claro", """
:root {
  --esquema: light; --sombra: .12; --sombra-card: .05; --tt-bg: rgba(255, 255, 255, .98);
  --fundo: radial-gradient(1000px 600px at 10% -10%, rgba(37, 99, 235, .12), transparent 60%), radial-gradient(700px 500px at 90% 10%, rgba(245, 165, 36, .10), transparent 60%), linear-gradient(180deg, #f4f7fd 0%, #eef2f9 100%);
  --surface: rgba(255, 255, 255, .88); --surface-solid: #ffffff; --surface-2: #eef2f8; --card: #ffffff;
  --hover: rgba(37, 99, 235, .06); --line: rgba(20, 40, 90, .10); --line-strong: rgba(20, 40, 90, .2);
  --text: #0e1a3a; --text-2: #3f4c6b; --muted: #6b7896; --accent: #1d4ed8; --accent-2: #3b82f6; --on-accent: #fff; --heat: #2563eb;
  --cr-ok: #16a34a; --cr-avencer: #d98a06; --cr-vencida: #dc2626; --cr-revisao: #7a8399;
  --side-bg: #0f1d45; --titulo-2: #9db8ff; --marca: #fff;
  --nav-on-bg: rgba(255, 255, 255, .12); --nav-on-borda: rgba(255, 255, 255, .25); --nav-on-brilho: transparent;
  --chipbar-bg: rgba(244, 247, 253, .9); --titulo-grad: linear-gradient(90deg, #0e1a3a 30%, #1d4ed8);
  --ico-bg: radial-gradient(circle at 50% 30%, #ffffff, #e6edfb 75%); --ico-sombra: 0 6px 20px rgba(30, 60, 140, .12);
  --copo-escala: #3f4c6b; --copo-traco: rgba(40, 60, 110, .45); --copo-vazio: rgba(30, 60, 140, .05);
}
/* barra lateral escura no tema claro */
.side { color: #eef3ff; --text: #f3f6ff; --text-2: #bccaee; --muted: #8696c2; --line: rgba(255, 255, 255, .12); --accent: #ffb23f; --hover: rgba(255, 255, 255, .06); }
.st-avlonge { --c: #c08a2c; }
"""),
    "Painel B5 - Azul Royal.html": ("Azul Royal", """
:root {
  --fundo: radial-gradient(1100px 700px at 15% -10%, rgba(80, 140, 255, .55), transparent 60%), radial-gradient(800px 600px at 90% 10%, rgba(255, 180, 60, .14), transparent 60%), linear-gradient(180deg, #1640b8 0%, #0d2a85 40%, #081b5c 100%);
  --surface: rgba(20, 56, 160, .5); --surface-solid: #0f2b86; --surface-2: rgba(60, 110, 230, .3); --card: rgba(24, 64, 176, .55);
  --hover: rgba(255, 186, 60, .1); --line: rgba(170, 200, 255, .18); --line-strong: rgba(170, 200, 255, .34);
  --text: #ffffff; --text-2: #cddaff; --muted: #94a9e0; --accent: #ffb43c; --accent-2: #ffd88a; --on-accent: #1a1000; --heat: #6aa2ff;
  --side-bg: rgba(8, 26, 92, .65); --titulo-2: #b9cfff; --marca: #fff;
  --nav-on-bg: linear-gradient(90deg, rgba(255, 180, 60, .26), rgba(255, 180, 60, .05)); --nav-on-borda: rgba(255, 180, 60, .5); --nav-on-brilho: rgba(255, 180, 60, .18);
  --chipbar-bg: rgba(13, 42, 133, .88); --titulo-grad: linear-gradient(90deg, #fff 35%, #d3e0ff);
  --ico-bg: radial-gradient(circle at 50% 30%, rgba(150, 190, 255, .35), rgba(15, 45, 140, .45) 70%); --ico-sombra: 0 0 30px rgba(120, 170, 255, .35), inset 0 0 22px rgba(160, 200, 255, .2);
  --copo-escala: #cddaff; --copo-traco: rgba(230, 240, 255, .7); --copo-vazio: rgba(190, 215, 255, .1);
}"""),
    "Painel B6 - Azul Oceano.html": ("Azul Oceano", """
:root {
  --fundo: radial-gradient(1000px 700px at 12% -10%, rgba(30, 150, 200, .38), transparent 60%), radial-gradient(700px 600px at 90% 12%, rgba(56, 220, 230, .1), transparent 60%), linear-gradient(180deg, #0a3550 0%, #062438 45%, #03141f 100%);
  --surface: rgba(12, 62, 92, .5); --surface-solid: #082b42; --surface-2: rgba(30, 110, 150, .28); --card: rgba(14, 70, 104, .55);
  --hover: rgba(56, 220, 230, .08); --line: rgba(140, 220, 240, .13); --line-strong: rgba(140, 220, 240, .28);
  --text: #f0fbff; --text-2: #b6dbe8; --muted: #7aa6b8; --accent: #38dce6; --accent-2: #9cf0f5; --on-accent: #00202a; --heat: #1ea5d6;
  --side-bg: rgba(2, 20, 32, .62); --titulo-2: #8fe3f0; --marca: #fff;
  --nav-on-bg: linear-gradient(90deg, rgba(56, 220, 230, .2), rgba(56, 220, 230, .04)); --nav-on-borda: rgba(56, 220, 230, .42); --nav-on-brilho: rgba(56, 220, 230, .16);
  --chipbar-bg: rgba(5, 32, 50, .88); --titulo-grad: linear-gradient(90deg, #fff 30%, #b5f1f7);
  --ico-bg: radial-gradient(circle at 50% 30%, rgba(80, 200, 230, .25), rgba(4, 40, 62, .45) 70%); --ico-sombra: 0 0 28px rgba(40, 190, 220, .25), inset 0 0 22px rgba(90, 210, 235, .14);
  --copo-escala: #b6dbe8; --copo-traco: rgba(220, 250, 255, .6); --copo-vazio: rgba(150, 230, 255, .07);
}"""),
    "Painel B7 - Azul Meia-noite.html": ("Azul Meia-noite", """
:root {
  --fundo: radial-gradient(1000px 650px at 12% -10%, rgba(60, 100, 200, .22), transparent 60%), radial-gradient(600px 500px at 90% 14%, rgba(124, 196, 255, .07), transparent 60%), linear-gradient(180deg, #0a1124 0%, #060b18 50%, #03060e 100%);
  --surface: rgba(18, 28, 56, .55); --surface-solid: #0c1429; --surface-2: rgba(50, 70, 120, .24); --card: rgba(20, 32, 64, .6);
  --hover: rgba(124, 196, 255, .07); --line: rgba(150, 180, 230, .11); --line-strong: rgba(150, 180, 230, .24);
  --text: #eef4ff; --text-2: #b0bfdc; --muted: #7383a5; --accent: #7cc4ff; --accent-2: #b8e0ff; --on-accent: #001a33; --heat: #3b82f6;
  --side-bg: rgba(3, 6, 16, .7); --titulo-2: #9fc8ff; --marca: #fff;
  --nav-on-bg: linear-gradient(90deg, rgba(124, 196, 255, .18), rgba(124, 196, 255, .03)); --nav-on-borda: rgba(124, 196, 255, .38); --nav-on-brilho: rgba(124, 196, 255, .12);
  --chipbar-bg: rgba(6, 11, 24, .9); --titulo-grad: linear-gradient(90deg, #fff 30%, #a9cfff);
  --ico-bg: radial-gradient(circle at 50% 30%, rgba(110, 160, 255, .2), rgba(8, 14, 34, .5) 70%); --ico-sombra: 0 0 26px rgba(80, 140, 255, .2), inset 0 0 20px rgba(124, 196, 255, .12);
  --copo-escala: #b0bfdc; --copo-traco: rgba(210, 228, 255, .55); --copo-vazio: rgba(150, 190, 255, .06);
}"""),
}


def ler(nome):
    with open(os.path.join(AQUI, nome), encoding="utf-8") as f:
        return f.read()


# Tema escolhido em 29/10/2026. Os demais ficam em TEMAS para referência.
ESCOLHIDO = "Painel B4 - Claro.html"
SAIDA_FINAL = "Painel Indicadores Ambientais.html"
# Estilo dos ícones de licença no arquivo final (a = gradiente, b = anel, c = cartões).
ICONES = "e"  # pílulas, escolhido em 29/10/2026
# arquivo de dados que o administrador envia pela aba Usuários do portal
ARQ_DADOS = "Dados do painel.json"


def para_portal(html):
    """Versão para o claude.ai: sem a casca do documento (o claude.ai a coloca) e com o controle de acesso."""
    cab = re.search(r"<head>(.*?)</head>", html, re.S).group(1)
    cab = re.sub(r'<meta charset="utf-8">\s*|<meta name="viewport"[^>]*>\s*', "", cab)
    corpo_tag = re.search(r"<body([^>]*)>", html).group(1)
    corpo = re.search(r"<body[^>]*>(.*)</body>", html, re.S).group(1)
    attrs = dict(re.findall(r'data-([a-z]+)="([^"]*)"', corpo_tag))
    # o aviso de controle de acesso precisa existir antes do script final do layout, que senão abre o painel direto
    marcar = "<script>window.__ACESSO__=true;" + "".join(f"document.body.dataset.{k}={v!r};" for k, v in attrs.items()) + "</script>\n"
    acesso = "<style>\n" + ler("acesso.css") + "\n</style>\n"
    return cab.strip() + "\n" + acesso + marcar + corpo.strip() + "\n<script>\n" + ler("acesso.js") + "\n</script>\n"


def montar_html(script_dados):
    """Monta o painel completo; script_dados é o conteúdo do <script> de dados (abertos ou criptografados)."""
    base, nucleo, layout = ler("base.css"), ler("nucleo.js"), ler("layout_b.html")
    # foto do copo (limpa e recortada sem fundo por preparar_copo.py) embutida para o painel continuar sendo um arquivo único
    with open(os.path.join(AQUI, "img", "copo_recorte.webp"), "rb") as f:
        layout = layout.replace("__COPO_IMG__", "data:image/webp;base64," + base64.b64encode(f.read()).decode())
    nome, tema = TEMAS[ESCOLHIDO]
    nucleo_fn = "window.__NUCLEO__ = function () {\n" + nucleo + "\n};"
    return (layout.replace("/*__BASE__*/", base).replace("/*__TEMA__*/", tema).replace("/*__NOME__*/", nome)
            .replace('data-layout="b"', f'data-layout="b" data-icones="{ICONES}"')
            .replace("/*__DADOS__*/", script_dados).replace("/*__NUCLEO__*/", nucleo_fn))


SITE_URL = "https://crystianbarbosa.github.io/Indicadores-Ambientais/"
# versão aberta (sem login, com os dados legíveis) só para conferência local; fica dentro de _fonte
PASTA_LOCAL = os.path.join(AQUI, "local")
ATALHO = f"""<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Indicadores Ambientais</title><meta http-equiv="refresh" content="0;url={SITE_URL}">
<style>body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f7fc;color:#0d1b3d;font:16px system-ui,sans-serif}}a{{color:#1d4ed8}}</style>
</head><body><p>Abrindo o portal Indicadores Ambientais… <a href="{SITE_URL}">clique aqui se não abrir</a>.</p>
<script>location.replace({SITE_URL!r});</script></body></html>
"""


def main():
    extrair_dados.main()
    dados_json = ler("dados.json")
    html = montar_html("window.__DADOS__=" + dados_json.replace("</", "<\\/") + ";")
    # na pasta do painel fica só o atalho para o portal (com login)
    with open(os.path.join(DESTINO, SAIDA_FINAL), "w", encoding="utf-8") as f:
        f.write(ATALHO)
    print("gerado:", SAIDA_FINAL, "(atalho para o portal)")
    os.makedirs(PASTA_LOCAL, exist_ok=True)
    with open(os.path.join(PASTA_LOCAL, "Painel aberto (sem login).html"), "w", encoding="utf-8") as f:
        f.write(html)
    # versão do portal no claude.ai (com login) e o arquivo de dados para enviar pela aba Usuários
    os.makedirs(os.path.join(AQUI, "portal"), exist_ok=True)
    with open(os.path.join(AQUI, "portal", "painel.html"), "w", encoding="utf-8") as f:
        f.write(para_portal(html))
    with open(os.path.join(PASTA_LOCAL, ARQ_DADOS), "w", encoding="utf-8") as f:
        f.write(dados_json)
    print("gerado:", ARQ_DADOS)


if __name__ == "__main__":
    main()

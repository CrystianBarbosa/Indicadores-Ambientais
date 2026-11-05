"""Robô do GitHub: atualiza o painel a partir das planilhas enviadas pelo portal (pasta entradas/ do repositório).

Roda no GitHub Actions (.github/workflows/atualizar.yml). Precisa só do secret PAINEL_CHAVE_PRIVADA:
com ele abre as planilhas (criptografadas no navegador com a chave pública) e a lista de usuários do site.
Gera o index.html com o mesmo publicar.py usado no computador. Nada sem criptografia fica no repositório:
o trabalho é feito numa pasta temporária.
"""
import base64
import gzip
import json
import os
import shutil
import sys
import tempfile

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

AQUI = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(AQUI)
SITE = os.path.join(REPO, "index.html")
OAEP = padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None)


def chave_privada():
    pem = os.environ.get("PAINEL_CHAVE_PRIVADA", "").strip()
    if not pem:
        raise SystemExit("ERRO: falta o secret PAINEL_CHAVE_PRIVADA no repositório (Settings > Secrets and variables > Actions).")
    return serialization.load_pem_private_key(pem.encode(), password=None)


def abrir_planilha(priv, arquivo, pasta):
    with open(arquivo, encoding="utf-8") as f:
        p = json.load(f)
    chave = priv.decrypt(base64.b64decode(p["wk"]), OAEP)
    conteudo = AESGCM(chave).decrypt(base64.b64decode(p["iv"]), base64.b64decode(p["ct"]), None)
    destino = os.path.join(pasta, p["nome"])
    with open(destino, "wb") as f:
        f.write(conteudo)
    print(f"  {os.path.basename(arquivo)}: {p['nome']} (enviada em {p.get('enviadoEm', '?')} por {p.get('por', '?')})")
    return destino


def usuarios_do_site(priv):
    html = open(SITE, encoding="utf-8").read()
    i = html.find("window.__COFRE__=")
    j = html.find(";</script>", i)
    cofre = json.loads(html[i + len("window.__COFRE__="):j])
    if "adminRobo" not in cofre:
        raise SystemExit("ERRO: o site publicado ainda não tem a lista de usuários para o robô. Publique uma vez pelo .bat.")
    k_adm = priv.decrypt(base64.b64decode(cofre["adminRobo"]), OAEP)
    p = cofre["admin"]
    return json.loads(gzip.decompress(AESGCM(k_adm).decrypt(base64.b64decode(p["iv"]), base64.b64decode(p["ct"]), None)))


def main():
    priv = chave_privada()
    trabalho = tempfile.mkdtemp(prefix="painel-")
    fonte = os.path.join(trabalho, "_fonte")
    shutil.copytree(AQUI, fonte)
    planilhas = os.path.join(trabalho, "planilhas")
    os.makedirs(planilhas)
    print("Planilhas recebidas:")
    os.environ["PAINEL_PRINCIPAL"] = abrir_planilha(priv, os.path.join(REPO, "entradas", "principal.json"), planilhas)
    os.environ["PAINEL_BASE"] = abrir_planilha(priv, os.path.join(REPO, "entradas", "base.json"), planilhas)
    os.environ["PAINEL_SITE"] = SITE
    os.environ["PAINEL_SITE_ORIGEM"] = SITE
    os.environ["PAINEL_ROBO"] = "1"
    lista = usuarios_do_site(priv)
    print(f"Usuários mantidos do site: {len(lista)}")
    sys.path.insert(0, fonte)
    import publicar
    publicar.ler_usuarios = lambda dados: lista  # a lista oficial é a do site
    if publicar.main() is None:
        raise SystemExit("ERRO ao gerar o painel.")
    shutil.rmtree(trabalho, ignore_errors=True)


if __name__ == "__main__":
    main()

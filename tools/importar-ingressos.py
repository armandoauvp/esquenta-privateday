#!/usr/bin/env python3
"""
Importa a lista de ingressos (XLSX ou CSV exportado da plataforma de vendas, ex.: Guru)
para o Firestore.

O app confere o e-mail digitado contra `ingressos/{hash}`. Só o SHA-256 do e-mail
(com sal) é gravado: o e-mail em texto nunca sai deste computador.

Pré-requisitos (uma vez):
    pip install firebase-admin openpyxl     (openpyxl só para .xlsx)
    Console do Firebase → Configurações do projeto → Contas de serviço →
    "Gerar nova chave privada" → salve o JSON FORA do repositório.

Uso:
    python3 tools/importar-ingressos.py Guru-Vendas.xlsx --chave ~/auvp-privateday-chave.json
    python3 tools/importar-ingressos.py Guru-Vendas.xlsx --simular                # só mostra
    python3 tools/importar-ingressos.py Guru-Vendas.xlsx --chave ... --substituir # remove quem saiu (reembolso)

A coluna de e-mail é detectada pelo cabeçalho (algo com "mail", ex.: "email contato");
use --coluna para indicar outra. Se houver coluna "status", só entram vendas aprovadas
("Aprovada"/"Completa"); --todos-status desliga esse filtro. No CSV, separador (vírgula
ou ponto e vírgula) e codificação são detectados. Pode rodar quantas vezes quiser:
e-mails já importados são só regravados.
"""

import argparse
import csv
import hashlib
import io
import pathlib
import re
import sys

# precisam bater com o index.html (INGRESSO_SAL, APP_ID_FALLBACK e normalizarEmail)
SAL = "auvp-privateday:"
APP_ID = "auvp-privateday"
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def normalizar(email: str) -> str:
    return email.strip().lower()


def hash_email(email: str) -> str:
    return hashlib.sha256((SAL + normalizar(email)).encode("utf-8")).hexdigest()


# status de venda que dão direito a ingresso (Guru: "Aprovada"; outras plataformas variam)
STATUS_OK = {"aprovada", "aprovado", "completa", "completo", "paga", "pago", "approved", "paid", "complete"}


def ler_planilha(caminho: pathlib.Path) -> tuple[list[str], list[dict]]:
    """Cabeçalho + linhas (dicts) de um .xlsx (primeira aba) ou .csv."""
    if caminho.suffix.lower() in (".xlsx", ".xlsm"):
        from openpyxl import load_workbook
        aba = load_workbook(caminho, read_only=True, data_only=True).worksheets[0]
        linhas = aba.iter_rows(values_only=True)
        cabecalho = [str(c or "").strip() for c in next(linhas, ())]
        return cabecalho, [dict(zip(cabecalho, ("" if v is None else str(v) for v in l))) for l in linhas]
    bruto = caminho.read_bytes()
    for codificacao in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            texto = bruto.decode(codificacao)
            break
        except UnicodeDecodeError:
            continue
    dialeto = csv.Sniffer().sniff(texto[:4096], delimiters=",;\t")
    leitor = csv.DictReader(io.StringIO(texto), dialect=dialeto)
    return list(leitor.fieldnames or []), list(leitor)


def ler_emails(caminho: pathlib.Path, coluna: str | None, todos_status: bool) -> list[str]:
    cabecalho, linhas = ler_planilha(caminho)
    if coluna is None:
        candidatas = [c for c in cabecalho if c and "mail" in c.lower()]
        if not candidatas:
            sys.exit(f"ERRO: não achei coluna de e-mail no cabeçalho {cabecalho}. Use --coluna.")
        coluna = candidatas[0]
    elif coluna not in cabecalho:
        sys.exit(f"ERRO: coluna {coluna!r} não existe. Cabeçalho: {cabecalho}")
    print(f"Coluna de e-mail: {coluna!r}")
    col_status = next((c for c in cabecalho if c.lower() == "status"), None)
    if col_status and not todos_status:
        print(f"Filtrando pela coluna {col_status!r}: só vendas aprovadas/completas")

    emails, invalidos, fora_status = set(), 0, 0
    for linha in linhas:
        if col_status and not todos_status and (linha.get(col_status) or "").strip().lower() not in STATUS_OK:
            fora_status += 1
            continue
        valor = normalizar(linha.get(coluna) or "")
        if EMAIL_RE.match(valor):
            emails.add(valor)
        elif valor:
            invalidos += 1
    print(f"{len(linhas)} linha(s) lidas.")
    if fora_status:
        print(f"{fora_status} venda(s) ignorada(s) por status (cancelada, reembolsada, pendente...).")
    if invalidos:
        print(f"Aviso: {invalidos} linha(s) com e-mail inválido foram ignoradas.")
    return sorted(emails)


def main() -> None:
    # console do Windows: acentos legíveis mesmo fora de um terminal UTF-8
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="Importa a lista de ingressos para o Firestore.")
    ap.add_argument("planilha", type=pathlib.Path, help="XLSX ou CSV exportado da plataforma de vendas")
    ap.add_argument("--chave", type=pathlib.Path, help="JSON da conta de serviço do Firebase")
    ap.add_argument("--coluna", help="nome da coluna de e-mail (padrão: detecta pelo cabeçalho)")
    ap.add_argument("--todos-status", action="store_true", help="não filtra pela coluna status")
    ap.add_argument("--simular", action="store_true", help="só conta e mostra, sem gravar nada")
    ap.add_argument("--substituir", action="store_true",
                    help="apaga do Firestore os ingressos que não estão nesta planilha (reembolsos)")
    args = ap.parse_args()

    emails = ler_emails(args.planilha, args.coluna, args.todos_status)
    hashes = {hash_email(e) for e in emails}
    print(f"{len(emails)} e-mail(s) único(s) com ingresso.")
    if args.simular:
        print("Simulação: nada foi gravado.")
        return
    if not args.chave:
        sys.exit("ERRO: informe --chave com o JSON da conta de serviço (ou use --simular).")

    import firebase_admin
    from firebase_admin import credentials, firestore

    firebase_admin.initialize_app(credentials.Certificate(str(args.chave)))
    db = firestore.client()
    col = db.collection("artifacts").document(APP_ID).collection("public") \
            .document("data").collection("ingressos")

    existentes = {d.id for d in col.list_documents()}
    novos = hashes - existentes
    lote, n = db.batch(), 0
    for h in hashes:
        lote.set(col.document(h), {"importadoEm": firestore.SERVER_TIMESTAMP})
        n += 1
        if n % 450 == 0:
            lote.commit()
            lote = db.batch()
    lote.commit()
    print(f"Gravados: {len(hashes)} ({len(novos)} novo(s)).")

    if args.substituir:
        sobrando = existentes - hashes
        lote, n = db.batch(), 0
        for h in sobrando:
            lote.delete(col.document(h))
            n += 1
            if n % 450 == 0:
                lote.commit()
                lote = db.batch()
        lote.commit()
        print(f"Removidos (fora da planilha): {len(sobrando)}.")
        if sobrando:
            print("Quem já tinha confirmado continua VIP até o vínculo ser refeito "
                  "(apague a coleção `vip` no console para forçar todo mundo a confirmar de novo).")


if __name__ == "__main__":
    main()

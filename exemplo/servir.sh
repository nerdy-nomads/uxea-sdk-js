#!/usr/bin/env bash
# Serve a aplicação de ensaio com uma chave de ingestão a sério.
#
#   ./exemplo/servir.sh <chave> [porta] [servidor]
#
# A chave entra na página no arranque, e não fica escrita no repositório: uma
# chave de ingestão num ficheiro versionado é uma chave que se usa por engano.
#
# O terceiro argumento serve o ensaio em dispositivo: dentro de um emulador
# Android, `localhost` é o telemóvel, e o anfitrião é `10.0.2.2`.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
CHAVE="${1:?uso: ./exemplo/servir.sh <chave> [porta] [servidor]}"
PORTA="${2:-8091}"
SERVIDOR="${3:-http://localhost:8710}"
SAIDA="exemplo/.index.${PORTA}.html"
sed -e "s|CHAVE_AQUI|${CHAVE}|" -e "s|http://localhost:8710|${SERVIDOR}|g" exemplo/index.html > "$SAIDA"
echo "http://localhost:${PORTA}/${SAIDA}"
# **A raiz leva à loja.** O ficheiro gerado começa por ponto (fica fora do git), e
# quem abria http://localhost:8091/ via a listagem do repositório em vez da loja.
exec python3 - "$PORTA" "$SAIDA" <<'PY'
import http.server, sys
porta, pagina = int(sys.argv[1]), sys.argv[2]

class Loja(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path in ("/", "/index.html", "/exemplo", "/exemplo/"):
            self.send_response(302)
            self.send_header("Location", "/" + pagina)
            self.end_headers()
            return
        super().do_GET()

http.server.ThreadingHTTPServer(("", porta), Loja).serve_forever()
PY

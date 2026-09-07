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
exec python3 -m http.server "$PORTA"

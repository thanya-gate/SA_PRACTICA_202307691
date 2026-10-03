#!/usr/bin/env python
"""Genera los stubs Python a partir de los contratos .proto compartidos.

Los stubs se emiten en gen/ como un paquete de Python: protoc escribe
"import catalogo_pb2", que solo funciona si gen/ esta en el path. Este
script corrige esos imports a imports relativos para que el worker pueda
usar `from gen import catalogo_pb2` sin manipular sys.path.

Uso:  python generar_stubs.py
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
PROTO_DIR = RAIZ.parent.parent / "proto"
DESTINO = RAIZ / "gen"

CONTRATOS = [
    "eventos.proto",
    "catalogo.proto",
    "certificados.proto",
]

IMPORT_RELATIVO = re.compile(r"^import (\w+_pb2) as (\w+)$", re.MULTILINE)


def generar() -> None:
    DESTINO.mkdir(parents=True, exist_ok=True)

    comando = [
        sys.executable,
        "-m",
        "grpc_tools.protoc",
        f"-I{PROTO_DIR}",
        f"--python_out={DESTINO}",
        f"--pyi_out={DESTINO}",
        f"--grpc_python_out={DESTINO}",
        *[str(PROTO_DIR / contrato) for contrato in CONTRATOS],
    ]
    subprocess.run(comando, check=True)

    init = DESTINO / "__init__.py"
    init.write_text(
        '"""Stubs generados desde los contratos .proto.\n\n'
        "No editar a mano: ejecutar `python generar_stubs.py`.\n"
        '"""\n',
        encoding="utf-8",
    )

    corregidos = 0
    for archivo in sorted(DESTINO.glob("*_pb2*.py")):
        contenido = archivo.read_text(encoding="utf-8")
        nuevo = IMPORT_RELATIVO.sub(r"from . import \1 as \2", contenido)
        if nuevo != contenido:
            archivo.write_text(nuevo, encoding="utf-8")
            corregidos += 1

    print(f"Stubs generados en {DESTINO} ({corregidos} archivos con imports relativos)")


if __name__ == "__main__":
    generar()

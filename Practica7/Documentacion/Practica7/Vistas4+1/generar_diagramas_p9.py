"""Genera diagramas editables de Práctica 9 con el estilo de las vistas P8."""

from __future__ import annotations

from html import escape
from pathlib import Path
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parent
XML_DIR = ROOT / "XML"
WIDTH = 1980
HEIGHT = 1430
COLORS = {
    "canvas": "#121212",
    "panel": "#242032",
    "panel_stroke": "#3b587e",
    "group": "#17151f",
    "node": "#121212",
    "white": "#ffffff",
}


def rect(diagram, cell_id, x, y, w, h, lines=(), *, fill=None, stroke=None,
         radius=16, font_size=18, bold=True, kind="node"):
    diagram["shapes"].append({
        "id": cell_id, "x": x, "y": y, "w": w, "h": h,
        "lines": list(lines), "fill": fill or COLORS["node"],
        "stroke": stroke or COLORS["white"], "radius": radius,
        "font_size": font_size, "bold": bold, "kind": kind,
    })


def label(diagram, cell_id, x, y, w, h, lines, *, font_size=16,
          align="center", bold=True):
    diagram["labels"].append({
        "id": cell_id, "x": x, "y": y, "w": w, "h": h,
        "lines": list(lines), "font_size": font_size,
        "align": align, "bold": bold,
    })


def edge(diagram, cell_id, source, target, points, *, text="", label_x=0,
         label_y=0, dashed=False):
    diagram["edges"].append({
        "id": cell_id, "source": source, "target": target,
        "points": points, "text": text,
        "label_x": label_x, "label_y": label_y, "dashed": dashed,
    })


def new_diagram(name, title, subtitle):
    return {
        "name": name, "title": title, "subtitle": subtitle,
        "shapes": [], "labels": [], "edges": [],
    }


def add_frame(diagram):
    rect(diagram, "frame", 12, 16, WIDTH - 24, HEIGHT - 32,
         fill=COLORS["panel"], stroke=COLORS["panel_stroke"],
         radius=90, kind="frame")
    label(diagram, "title", 90, 42, WIDTH - 180, 54,
          [diagram["title"]], font_size=32)
    label(diagram, "subtitle", 90, 96, WIDTH - 180, 38,
          [diagram["subtitle"]], font_size=17)


def network_diagram():
    d = new_diagram(
        "Vista física - red en la nube",
        "VISTA FÍSICA · PRÁCTICA 9",
        "Arquitectura de red en Google Cloud · VPC, subredes, rutas y puertos",
    )
    add_frame(d)

    rect(d, "vpc", 300, 155, 1645, 1240,
         fill=COLORS["group"], stroke=COLORS["white"], radius=26,
         kind="container")
    label(d, "vpc-title", 330, 166, 1575, 48,
          ["VPC vpc-academix-pass · red global · routing_mode=REGIONAL"],
          font_size=22)

    rect(d, "routes", 350, 235, 1545, 145,
         lines=["TABLA DE RUTAS GCP",
                "10.10.1.0/24 y 10.10.2.0/24 → rutas locales",
                "0.0.0.0/0 → default-internet-gateway · salida a Internet"],
         fill=COLORS["node"], radius=12, font_size=18, kind="node")

    rect(d, "subnet-dev", 350, 410, 735, 285,
         fill=COLORS["panel"], stroke=COLORS["white"], radius=24,
         kind="container")
    label(d, "subnet-dev-title", 370, 420, 695, 43,
          ["subnet-development · us-central1 · 10.10.1.0/24"],
          font_size=19)
    rect(d, "vm-dev", 405, 480, 625, 160,
         lines=["vm-development",
                "10.10.1.10 · e2-micro · Ubuntu 24.04",
                "Docker Engine + Docker Compose",
                "IP pública efímera · salida Terraform"],
         radius=14, font_size=18)

    rect(d, "subnet-prod", 1125, 410, 770, 285,
         fill=COLORS["panel"], stroke=COLORS["white"], radius=24,
         kind="container")
    label(d, "subnet-prod-title", 1145, 420, 730, 43,
          ["subnet-production · us-central1 · 10.10.2.0/24"],
          font_size=19)
    rect(d, "vm-prod", 1180, 480, 660, 160,
         lines=["vm-production-k3s",
                "10.10.2.10 · e2-medium · Ubuntu 24.04",
                "K3s server / control-plane",
                "IP pública efímera · salida Terraform"],
         radius=14, font_size=18)

    rect(d, "firewall", 350, 730, 1545, 630,
         fill=COLORS["panel"], stroke=COLORS["white"], radius=24,
         kind="container")
    label(d, "firewall-title", 370, 742, 1505, 42,
          ["FIREWALL DE VPC · reglas por origen, protocolo y etiquetas de destino"],
          font_size=20)

    cards = [
        ("fw-public", 370, 800, 480, 160,
         ["SSH / WEB · ambas VMs",
          "TCP 22 (SSH), 80 (HTTP), 443 (HTTPS)",
          "origen permitido · actual: 0.0.0.0/0"]),
        ("fw-api", 875, 800, 480, 160,
         ["API K3s · solo producción",
          "TCP 6443 · allowed_k3s_api_cidr",
          "valor actual: 0.0.0.0/0"]),
        ("fw-k3s", 1380, 800, 485, 160,
         ["Telemetría K3s · producción",
          "TCP 2379-2380, 4443, 10250, 30000-32767",
          "UDP 8472, 10250, 30000-32767",
          "origen: VPC 10.10.0.0/16"]),
        ("fw-internal", 370, 985, 480, 150,
         ["Tráfico interno · ambas VMs",
          "todos los protocolos",
          "origen: 10.10.0.0/16"]),
        ("fw-health", 875, 985, 480, 150,
         ["Health checks de Google",
          "TCP desde 130.211.0.0/22",
          "y 35.191.0.0/16"]),
        ("fw-egress", 1380, 985, 485, 150,
         ["Egreso · ambas VMs",
          "todos los protocolos",
          "destino: 0.0.0.0/0"]),
    ]
    for cell_id, x, y, w, h, lines in cards:
        rect(d, cell_id, x, y, w, h, lines=lines, radius=12,
             font_size=16)

    label(d, "firewall-note", 380, 1160, 1485, 125,
          ["Las reglas públicas usan target_tags para limitar a qué VM aplican.",
           "Los CIDR 0.0.0.0/0 reflejan los valores actuales; restringirlos mejora la seguridad."],
          font_size=16)

    rect(d, "internet", 35, 270, 230, 110,
         lines=["INTERNET", "tráfico público"], radius=14, font_size=18)
    rect(d, "admin", 35, 445, 230, 125,
         lines=["Administración", "gcloud · Ansible", "kubectl"],
         radius=14, font_size=18)
    edge(d, "internet-in", "internet", "vpc", [(265, 325), (300, 325)])
    edge(d, "admin-in", "admin", "vpc", [(265, 507), (300, 507)])

    return d


def provisioning_diagram():
    d = new_diagram(
        "Vista de procesos - aprovisionamiento",
        "VISTA DE PROCESOS · PRÁCTICA 9",
        "Flujo automatizado de aprovisionamiento · Terraform → Ansible → Estado listo",
    )
    add_frame(d)

    rect(d, "operator", 80, 230, 365, 225,
         lines=["1 · ADMINISTRACIÓN",
                "gcloud ADC + variables Terraform",
                "clave pública SSH para GCP",
                "clave privada local para Ansible"],
         radius=16, font_size=18)
    rect(d, "terraform", 530, 210, 420, 265,
         lines=["2 · TERRAFORM",
                "init → plan → apply",
                "VPC · subredes · rutas · firewall",
                "crea las dos VMs",
                "tfstate local · no versionar"],
         radius=16, font_size=18)
    rect(d, "inventory", 1080, 230, 390, 225,
         lines=["3 · OUTPUTS + INVENTARIO",
                "outputs: IPs públicas",
                "Terraform genera inventory.ini",
                "grupos development / production"],
         radius=16, font_size=18)
    rect(d, "ansible-base", 890, 550, 420, 200,
         lines=["4 · ANSIBLE · site.yml",
                "espera SSH y cloud-init",
                "rol base: utilitarios y SSH seguro",
                "configuración idempotente"],
         radius=16, font_size=18)
    rect(d, "docker-role", 240, 820, 470, 180,
         lines=["5a · ROL DOCKER",
                "vm-development",
                "instala Docker Engine + Compose",
                "usuario en grupo docker"],
         radius=16, font_size=18)
    rect(d, "k3s-role", 810, 820, 470, 180,
         lines=["5b · ROL K3s",
                "vm-production-k3s",
                "instala K3s server/control-plane",
                "extrae kubeconfig a administración"],
         radius=16, font_size=18)
    rect(d, "ready", 680, 1080, 500, 145,
         lines=["6 · ESTADO LISTO",
                "desarrollo: Docker Compose disponible",
                "producción: nodo K3s Ready + kubeconfig"],
         fill=COLORS["node"], stroke=COLORS["white"],
         radius=16, font_size=18)

    edge(d, "operator-terraform", "operator", "terraform",
         [(445, 342), (530, 342)])
    edge(d, "terraform-inventory", "terraform", "inventory",
         [(950, 342), (1080, 342)])
    edge(d, "inventory-ansible", "inventory", "ansible-base",
         [(1275, 455), (1275, 505), (1100, 505), (1100, 550)])
    edge(d, "ansible-docker", "ansible-base", "docker-role",
         [(1100, 750), (1100, 780), (475, 780), (475, 820)])
    edge(d, "ansible-k3s", "ansible-base", "k3s-role",
         [(1100, 750), (1100, 780), (1045, 780), (1045, 820)])
    edge(d, "docker-ready", "docker-role", "ready",
         [(475, 1000), (475, 1040), (930, 1040), (930, 1080)])
    edge(d, "k3s-ready", "k3s-role", "ready",
         [(1045, 1000), (1045, 1040), (930, 1040), (930, 1080)])
    label(d, "rebuild-note", 90, 1250, 1800, 36,
          ["Reconstrucción en vivo: terraform destroy → terraform apply → ansible-playbook -i inventory.ini site.yml"],
          font_size=16)
    return d


def svg_text(x, y, w, h, lines, font_size, *, align="center", bold=True):
    anchor = {"center": "middle", "left": "start", "right": "end"}[align]
    tx = x + w / 2 if align == "center" else (x + 12 if align == "left" else x + w - 12)
    line_height = font_size * 1.28
    start_y = y + h / 2 - (len(lines) - 1) * line_height / 2
    tspans = []
    for i, line in enumerate(lines):
        dy = 0 if i == 0 else line_height
        tspans.append(f'<tspan x="{tx}" dy="{dy}">{escape(line)}</tspan>')
    weight = "700" if bold else "400"
    return (f'<text x="{tx}" y="{start_y}" text-anchor="{anchor}" '
            f'dominant-baseline="middle" font-family="Arial, Helvetica, sans-serif" '
            f'font-size="{font_size}px" font-weight="{weight}" fill="{COLORS["white"]}">'
            + "".join(tspans) + "</text>")


def render_svg(diagram):
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{HEIGHT}" viewBox="0 0 {WIDTH} {HEIGHT}">',
        '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#ffffff"/></marker></defs>',
        f'<rect width="{WIDTH}" height="{HEIGHT}" fill="{COLORS["canvas"]}"/>',
    ]
    # Draw the outer frame and grouping panels before connectors and nodes.
    for shape in diagram["shapes"]:
        if shape["kind"] in ("frame", "container"):
            parts.append(
                f'<rect id="{shape["id"]}" x="{shape["x"]}" y="{shape["y"]}" '
                f'width="{shape["w"]}" height="{shape["h"]}" rx="{shape["radius"]}" '
                f'fill="{shape["fill"]}" stroke="{shape["stroke"]}" stroke-width="1.5"/>'
            )
    for item in diagram["edges"]:
        pts = " ".join(f'{x},{y}' for x, y in item["points"])
        dash = ' stroke-dasharray="8 6"' if item["dashed"] else ""
        parts.append(
            f'<polyline id="{item["id"]}" points="{pts}" fill="none" '
            f'stroke="#ffffff" stroke-width="1.8"{dash} marker-end="url(#arrow)"/>'
        )
        if item["text"]:
            parts.append(svg_text(item["label_x"], item["label_y"], 210, 30,
                                  [item["text"]], 15))
    for shape in diagram["shapes"]:
        if shape["kind"] in ("frame", "container"):
            continue
        parts.append(
            f'<rect id="{shape["id"]}" x="{shape["x"]}" y="{shape["y"]}" '
            f'width="{shape["w"]}" height="{shape["h"]}" rx="{shape["radius"]}" '
            f'fill="{shape["fill"]}" stroke="{shape["stroke"]}" stroke-width="1.5"/>'
        )
        if shape["lines"]:
            parts.append(svg_text(shape["x"], shape["y"], shape["w"], shape["h"],
                                  shape["lines"], shape["font_size"], bold=shape["bold"]))
    for item in diagram["labels"]:
        parts.append(svg_text(item["x"], item["y"], item["w"], item["h"],
                              item["lines"], item["font_size"],
                              align=item["align"], bold=item["bold"]))
    parts.append("</svg>")
    return "\n".join(parts)


def drawio_style(shape):
    if shape["kind"] == "frame":
        return ("rounded=1;arcSize=12;whiteSpace=wrap;html=0;"
                f'fillColor={shape["fill"]};strokeColor={shape["stroke"]};strokeWidth=1.5;')
    return ("rounded=1;arcSize=12;whiteSpace=wrap;html=0;"
            f'fillColor={shape["fill"]};strokeColor={shape["stroke"]};strokeWidth=1.5;'
            f'fontColor=#ffffff;fontSize={shape["font_size"]};'
            f'fontStyle={1 if shape["bold"] else 0};align=center;verticalAlign=middle;spacing=8;')


def add_vertex(root, cell_id, value, style, x, y, w, h):
    cell = ET.SubElement(root, "mxCell", {
        "id": cell_id, "value": value, "style": style,
        "vertex": "1", "parent": "1",
    })
    ET.SubElement(cell, "mxGeometry", {
        "x": str(x), "y": str(y), "width": str(w),
        "height": str(h), "as": "geometry",
    })


def write_drawio(diagram, path):
    mxfile = ET.Element("mxfile", {
        "host": "app.diagrams.net", "modified": "2026-10-09T00:00:00.000Z",
        "agent": "Mozilla/5.0", "version": "24.7.17", "type": "device",
    })
    page = ET.SubElement(mxfile, "diagram", {
        "id": diagram["name"].replace(" ", "-"), "name": diagram["name"],
    })
    model = ET.SubElement(page, "mxGraphModel", {
        "dx": str(WIDTH), "dy": str(HEIGHT), "grid": "1", "gridSize": "10",
        "guides": "1", "tooltips": "1", "connect": "1", "arrows": "1",
        "fold": "1", "page": "1", "pageScale": "1",
        "pageWidth": str(WIDTH), "pageHeight": str(HEIGHT),
        "math": "0", "shadow": "0", "background": COLORS["canvas"],
    })
    root = ET.SubElement(model, "root")
    ET.SubElement(root, "mxCell", {"id": "0"})
    ET.SubElement(root, "mxCell", {"id": "1", "parent": "0"})

    for shape in diagram["shapes"]:
        add_vertex(root, shape["id"], "\n".join(shape["lines"]),
                   drawio_style(shape), shape["x"], shape["y"], shape["w"], shape["h"])
    for item in diagram["labels"]:
        style = ("text;html=0;align={};verticalAlign=middle;fillColor=none;"
                 "strokeColor=none;fontColor=#ffffff;fontSize={};fontStyle={};").format(
                     item["align"], item["font_size"], 1 if item["bold"] else 0)
        add_vertex(root, item["id"], "\n".join(item["lines"]), style,
                   item["x"], item["y"], item["w"], item["h"])
    for item in diagram["edges"]:
        style = ("edgeStyle=none;html=0;strokeColor=#ffffff;strokeWidth=1.5;"
                 "endArrow=block;endFill=1;fontColor=#ffffff;fontSize=15;"
                 "labelBackgroundColor=none;")
        if item["dashed"]:
            style += "dashed=1;"
        cell = ET.SubElement(root, "mxCell", {
            "id": item["id"], "value": item["text"], "style": style,
            "edge": "1", "parent": "1", "source": item["source"],
            "target": item["target"],
        })
        geom = ET.SubElement(cell, "mxGeometry", {"relative": "1", "as": "geometry"})
        waypoints = ET.SubElement(geom, "Array", {"as": "points"})
        for x, y in item["points"][1:-1]:
            ET.SubElement(waypoints, "mxPoint", {"x": str(x), "y": str(y)})

    ET.indent(mxfile, space="  ")
    path.write_text(ET.tostring(mxfile, encoding="unicode", xml_declaration=True),
                    encoding="utf-8")


def main():
    XML_DIR.mkdir(exist_ok=True)
    diagrams = [
        (network_diagram(), "VistaFisica_RedNube_P9_G4"),
        (provisioning_diagram(), "VistaProcesos_Aprovisionamiento_P9_G4"),
    ]
    for diagram, stem in diagrams:
        (ROOT / f"{stem}.drawio.svg").write_text(render_svg(diagram), encoding="utf-8")
        write_drawio(diagram, XML_DIR / f"{stem}.drawio")
        print(f"Generado: {stem}")


if __name__ == "__main__":
    main()

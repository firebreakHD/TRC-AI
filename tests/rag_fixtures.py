"""Create synthetic PDFs, Office documents, CSV and graphics inside the test image."""

import sys
from pathlib import Path

from docx import Document
from openpyxl import Workbook
from PIL import Image, ImageDraw, ImageFont

target = Path(sys.argv[1])
target.mkdir(exist_ok=True)
(target / "wissen.md").write_text(
    "# Messhalle\n\nDie Messhalle hat den Barcode KUPFERKOMET.\n", encoding="utf8"
)
(target / "notiz.txt").write_text(
    "Der Testtext enthaelt die Kennung POLARTEXT.\n", encoding="utf8"
)
(target / "liste.csv").write_text("Geraet;Wert\nNEBELCSV;91\n", encoding="utf8")

document = Document()
document.add_heading("Versuchsdokument", level=1)
document.add_paragraph("Die Kennung im Word-Dokument lautet KRISTALLWORT.")
table = document.add_table(rows=2, cols=2)
for index, value in enumerate(("Station", "Messwert", "DOKLINGTABELLE", "17")):
    table.cell(index // 2, index % 2).text = value
document.save(target / "word.docx")
book = Workbook()
sheet = book.active
sheet.title = "Synthetisch"
sheet.append(["Station", "Messwert"])
sheet.append(["KREISEXCEL", 23])
book.save(target / "excel.xlsx")


def graphic(text, name):
    image = Image.new("RGB", (1400, 500), "white")
    draw = ImageDraw.Draw(image)
    draw.text(
        (70, 120),
        f"Die Kennung lautet {text}.\n\nDies ist ein Testdokument.",
        font=ImageFont.load_default(size=55),
        fill="black",
    )
    image.save(target / name)


graphic("NEBELSCHACHT", "scan.pdf")
graphic("SONNENBILD", "bild.png")

stream = b"BT /F1 18 Tf 64 740 Td (Der Wartungspunkt lautet DELTAPRUEFUNG.) Tj ET\n"
objects = [
    b"<< /Type /Catalog /Pages 2 0 R >>",
    b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    b"<< /Length "
    + str(len(stream)).encode()
    + b" >>\nstream\n"
    + stream
    + b"endstream",
]
pdf = bytearray(b"%PDF-1.4\n")
offsets = []
for ordinal, obj in enumerate(objects, 1):
    offsets.append(len(pdf))
    pdf.extend(str(ordinal).encode() + b" 0 obj\n" + obj + b"\nendobj\n")
xref = len(pdf)
pdf.extend(b"xref\n0 6\n0000000000 65535 f \n")
for offset in offsets:
    pdf.extend(f"{offset:010d} 00000 n \n".encode())
pdf.extend(f"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
(target / "digital.pdf").write_bytes(pdf)

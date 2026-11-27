"""Bounded parsing and structural chunking of local document snapshots."""

import csv
import io
import re
import subprocess
import tempfile
import unicodedata
import zipfile
from dataclasses import dataclass
from pathlib import Path

import pdfplumber
from docx import Document
from docx.table import Table
from openpyxl import load_workbook
from PIL import Image, UnidentifiedImageError

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".tif", ".tiff"}
SUFFIXES = {".pdf", ".docx", ".xlsx", ".csv", ".tsv", ".md", ".txt"} | IMAGE_SUFFIXES
Image.MAX_IMAGE_PIXELS = 20_000_000
MAX_BYTES = 32 * 1024**2
MAX_EXPANDED = 128 * 1024**2
MAX_PAGES = 150
MAX_ROWS = 20_000
MAX_COLUMNS = 128
TOKEN = re.compile(r"\w+|[^\w\s]", re.UNICODE)
HEADING = re.compile(r"^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$")


class Rejected(ValueError):
    """A document requires operator attention before reprocessing."""


@dataclass
class Block:
    text: str
    location: str
    heading: str = ""
    kind: str = "text"
    header: str = ""


def words(text):
    return TOKEN.findall(text)


def normalized(text):
    text = unicodedata.normalize("NFC", str(text or ""))
    return text.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "").strip()


def markdown(text):
    heading, lines, start = "", [], 1
    for number, line in enumerate(text.splitlines(), 1):
        match = HEADING.match(line)
        if match:
            if lines:
                yield Block("\n".join(lines), f"Zeile {start}", heading)
            heading, lines, start = match[1], [], number
        elif line.strip() or lines:
            if not lines and not heading:
                start = number
            lines.append(line)
    if lines:
        yield Block("\n".join(lines), f"Zeile {start}", heading)


def table(rows, location, heading=""):
    header = ""
    emitted = False
    batch = []
    for number, row in enumerate(rows, 1):
        if number > MAX_ROWS or len(row) > MAX_COLUMNS:
            raise Rejected("table_size")
        line = " | ".join(normalized(cell).replace("\n", " ") for cell in row)
        if not any(normalized(cell) for cell in row):
            continue
        if not header:
            header = line
        else:
            batch.append(line)
            if len(batch) == 15:
                yield Block(
                    "\n".join(batch),
                    f"{location}, bis Zeile {number}",
                    heading,
                    "table",
                    header,
                )
                batch.clear()
                emitted = True
    if batch:
        yield Block("\n".join(batch), location, heading, "table", header)
    elif header and not emitted:
        yield Block(header, location, heading, "table")


def checked_office(data, marker):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        if (
            len(entries) > 3000
            or sum(entry.file_size for entry in entries) > MAX_EXPANDED
        ):
            raise Rejected("office_expansion")
        if marker not in archive.namelist() or any(
            item.flag_bits & 1 for item in entries
        ):
            raise Rejected("office_format")


def docx_native(data):
    checked_office(data, "word/document.xml")
    document = Document(io.BytesIO(data))
    heading = ""
    for number, item in enumerate(document.iter_inner_content(), 1):
        location = f"Abschnitt {number}"
        if isinstance(item, Table):
            yield from table(
                ([cell.text for cell in row.cells] for row in item.rows),
                location,
                heading,
            )
        elif item.style and re.match(r"^(Heading|Überschrift)\b", item.style.name):
            heading = item.text
        elif item.text.strip():
            yield Block(item.text, location, heading)


def docx_docling(data):
    checked_office(data, "word/document.xml")
    from docling.datamodel.base_models import DocumentStream, InputFormat
    from docling.document_converter import DocumentConverter
    from docling_core.types.doc import DocItemLabel, TableItem, TextItem

    conversion = DocumentConverter(allowed_formats=[InputFormat.DOCX]).convert(
        DocumentStream(name="document.docx", stream=io.BytesIO(data)),
        max_file_size=MAX_BYTES,
    )
    document = conversion.document
    heading = ""
    for index, (item, _) in enumerate(document.iterate_items(), 1):
        location = f"Abschnitt {index}"
        if isinstance(item, TableItem):
            frame = item.export_to_dataframe(doc=document)
            rows = (frame.columns.tolist(), *frame.itertuples(index=False, name=None))
            yield from table(rows, location, heading)
        elif isinstance(item, TextItem):
            if item.label in {DocItemLabel.TITLE, DocItemLabel.SECTION_HEADER}:
                heading = item.text
                yield Block(item.text, location, heading)
            elif item.text.strip():
                yield Block(item.text, location, heading)


def xlsx(data):
    checked_office(data, "xl/workbook.xml")
    workbook = load_workbook(
        io.BytesIO(data), read_only=True, data_only=True, keep_links=False
    )
    try:
        if len(workbook.worksheets) > 48:
            raise Rejected("sheet_count")
        for sheet in workbook.worksheets:
            if (sheet.max_row or 0) > MAX_ROWS or (sheet.max_column or 0) > MAX_COLUMNS:
                raise Rejected("sheet_dimensions")
            yield from table(sheet.values, f"Blatt {sheet.title}", sheet.title)
    finally:
        workbook.close()


def scan_pdf(source):
    with pdfplumber.open(source) as document:
        if len(document.pages) > MAX_PAGES:
            raise Rejected("pdf_pages")
        scanned = set()
        blocks = []
        for page in document.pages:
            location = f"Seite {page.page_number}"
            text = normalized(page.extract_text())
            if page.images and len(re.findall(r"\w", text)) < 16:
                scanned.add(page.page_number)
            if text:
                blocks.append(Block(text, location))
                for detected in page.extract_tables() or []:
                    blocks.extend(table(detected, location))
            page.close()
        return blocks, scanned


def ocr_image(path, language):
    try:
        result = subprocess.run(
            ["tesseract", str(path), "stdout", "-l", language, "--psm", "3"],
            check=True,
            timeout=25,
            capture_output=True,
        )
    except (OSError, subprocess.SubprocessError):
        raise Rejected("ocr_failed") from None
    text = normalized(result.stdout.decode("utf-8", errors="replace"))
    if not text:
        raise Rejected("ocr_no_text")
    return text


def pdf(data, language):
    if not data.startswith(b"%PDF-"):
        raise Rejected("pdf_signature")
    blocks, pages = scan_pdf(io.BytesIO(data))
    if not pages:
        return blocks
    if len(pages) > 12:
        raise Rejected("ocr_page_limit")
    with tempfile.TemporaryDirectory(prefix="trc-ocr-") as scratch:
        original = Path(scratch) / "input.pdf"
        original.write_bytes(data)
        for page in sorted(pages):
            target = Path(scratch) / "raster"
            try:
                subprocess.run(
                    [
                        "pdftoppm",
                        "-f",
                        str(page),
                        "-l",
                        str(page),
                        "-singlefile",
                        "-scale-to",
                        "2400",
                        "-png",
                        str(original),
                        str(target),
                    ],
                    check=True,
                    timeout=20,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
            except (OSError, subprocess.SubprocessError):
                raise Rejected("ocr_raster") from None
            location = f"Seite {page}"
            text = ocr_image(target.with_suffix(".png"), language)
            blocks = [block for block in blocks if block.location != location]
            blocks.append(Block(text, location, kind="ocr"))
        blocks.sort(key=lambda block: int(block.location.split()[1]))
    return blocks


def image_text(data, language):
    try:
        with Image.open(io.BytesIO(data), formats=["PNG", "JPEG", "TIFF"]) as image:
            if (
                image.width * image.height > Image.MAX_IMAGE_PIXELS
                or image.n_frames > 1
            ):
                raise Rejected("image_size_or_frames")
            image.thumbnail((2600, 2600))
            with tempfile.TemporaryDirectory(prefix="trc-ocr-") as scratch:
                target = Path(scratch) / "image.png"
                image.convert("L").save(target)
                return [Block(ocr_image(target, language), "Bild", kind="ocr")]
    except (Image.DecompressionBombError, UnidentifiedImageError):
        raise Rejected("image_format") from None


def extract(data, suffix, language="deu+eng", docling=True):
    if not data or len(data) > MAX_BYTES:
        raise Rejected("file_size")
    if suffix == ".pdf":
        return pdf(data, language)
    if suffix in IMAGE_SUFFIXES:
        return image_text(data, language)
    if suffix == ".docx":
        return list(docx_docling(data) if docling else docx_native(data))
    if suffix == ".xlsx":
        return list(xlsx(data))
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise Rejected("text_encoding") from None
    if "\x00" in text:
        raise Rejected("text_encoding")
    if suffix in {".csv", ".tsv"}:
        delimiter = "\t"
        if suffix == ".csv":
            try:
                delimiter = csv.Sniffer().sniff(text[:8192], delimiters=",;").delimiter
            except csv.Error:
                delimiter = ","
        return list(
            table(csv.reader(io.StringIO(text), delimiter=delimiter), "Tabelle")
        )
    if suffix in {".md", ".txt"}:
        return list(markdown(text))
    raise Rejected("unsupported_format")


def document_language(text):
    terms = set(words(text.casefold()))
    de = len(terms & {"der", "die", "das", "und", "ist", "für", "mit", "sind", "nicht"})
    en = len(terms & {"the", "and", "is", "for", "with", "are", "not", "this"})
    return "de" if de > en else "en" if en > de else "und"


def chunks(blocks, limit=210, overlap=32):
    for block in blocks:
        text = normalized(block.text)
        if not text:
            continue
        prefix = (
            normalized(block.header)[:350]
            if block.kind == "table" and block.header
            else ""
        )
        if prefix:
            prefix = " ".join(words(prefix)[:60]) + "\n"
        width = limit - len(words(prefix))
        # Keep newlines and punctuation by slicing the original token spans.
        spans = list(TOKEN.finditer(text))
        start = 0
        while start < len(spans):
            end = min(len(spans), start + width)
            body = text[spans[start].start() : spans[end - 1].end()]
            if len(body) > 4000:
                raise Rejected("chunk_characters")
            value = prefix + body
            numbers = re.findall(
                r"(?<!\w)\d+(?:[.,]\d+)?\s*(?:mm|cm|km|kg|mg|kWh|W|°C|%)(?!\w)", value
            )
            frequencies = {}
            for term in words(value.lower()):
                if len(term) >= 4 and term.isalpha():
                    frequencies[term] = frequencies.get(term, 0) + 1
            yield {
                "text": value,
                "location": block.location,
                "heading": block.heading[:300],
                "kind": block.kind,
                "language": document_language(value),
                "quantities": numbers[:12],
                "keywords": sorted(
                    frequencies, key=lambda term: (-frequencies[term], term)
                )[:10],
            }
            if end == len(spans):
                break
            start = end - overlap

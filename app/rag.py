import json
import math
from pathlib import Path

import ollama
from pypdf import PdfReader

from app.config import EMBED_MODEL, OLLAMA_HOST
from app.llm import ask

ROOT = Path(__file__).resolve().parent.parent
PDF_DIR = ROOT / "knowledge" / "pdfs"
INDEX_FILE = ROOT / "knowledge" / "index.json"
_client = ollama.Client(host=OLLAMA_HOST)


def _chunks(text: str, size: int = 1000, overlap: int = 150):
    step = size - overlap
    for i in range(0, len(text), step):
        piece = text[i:i + size].strip()
        if piece:
            yield piece


def _embed(texts: list[str]) -> list[list[float]]:
    return _client.embed(model=EMBED_MODEL, input=texts).embeddings


def build_index() -> None:
    """Read every PDF, split it into chunks, embed them, and save the index."""
    records = []
    for pdf in sorted(PDF_DIR.glob("*.pdf")):
        for page_no, page in enumerate(PdfReader(pdf).pages, start=1):
            text = page.extract_text() or ""
            pieces = list(_chunks(text))
            if not pieces:
                continue
            for piece, vec in zip(pieces, _embed(pieces)):
                records.append({"source": pdf.name, "page": page_no, "text": piece, "vec": vec})
        print(f"Indexed {pdf.name}")
    INDEX_FILE.write_text(json.dumps(records), encoding="utf-8")
    print(f"Saved {len(records)} chunks.")


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def search(question: str, per_file: int = 3) -> list[dict]:
    """Return the best chunks from EACH PDF, so every document is represented."""
    if not INDEX_FILE.exists():
        raise FileNotFoundError("No index found. Run: python -m app.rag index")
    records = json.loads(INDEX_FILE.read_text(encoding="utf-8"))
    q = _embed([question])[0]
    for r in records:
        r["score"] = _cosine(q, r["vec"])

    by_file: dict[str, list[dict]] = {}
    for r in records:
        by_file.setdefault(r["source"], []).append(r)

    hits = []
    for items in by_file.values():
        hits += sorted(items, key=lambda r: r["score"], reverse=True)[:per_file]
    return sorted(hits, key=lambda r: r["score"], reverse=True)


def answer(question: str) -> str:
    hits = search(question)
    context = "\n\n".join(f"[{h['source']} p.{h['page']}]\n{h['text']}" for h in hits)
    system = (
        "Answer using only the context below. The context comes from several documents. "
        "Say which document each point comes from, and mention if the documents differ. "
        "If the context does not contain the answer, say you could not find it."
    )
    reply = ask(f"Context:\n{context}\n\nQuestion: {question}", system=system)
    sources = ", ".join(f"{h['source']} p.{h['page']}" for h in hits)
    return f"{reply}\n\nSources used: {sources}"


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "index":
        build_index()
    else:
        print(answer(input("Question: ")))
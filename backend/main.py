from fastapi.responses import StreamingResponse
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.llms import Ollama
from sentence_transformers import SentenceTransformer
import numpy as np
import faiss
import json
import hashlib
import os

app = FastAPI(title="WebLens Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load embedding model once at startup
print("Loading embedding model...")
embedder = SentenceTransformer("BAAI/bge-small-en")
print("Model loaded.")

# Directory to persist FAISS indexes and chunks
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
os.makedirs(DATA_DIR, exist_ok=True)

# In-memory store
page_store = {}


# ── Helpers ───────────────────────────────────────────────────────────────────

def url_to_id(url: str) -> str:
    """Convert a URL to a short safe filename using MD5 hash."""
    return hashlib.md5(url.encode()).hexdigest()

def save_page(page_id: str, url: str, index, chunks: list, title: str):
    """Save FAISS index and chunks to disk."""
    file_id = url_to_id(url)
    faiss.write_index(index, os.path.join(DATA_DIR, f"{file_id}.index"))
    with open(os.path.join(DATA_DIR, f"{file_id}.json"), "w") as f:
        json.dump({"url": url, "title": title, "chunks": chunks}, f)

def load_all_pages():
    """On startup, load all saved indexes back into page_store."""
    loaded = 0
    for fname in os.listdir(DATA_DIR):
        if fname.endswith(".json"):
            file_id = fname.replace(".json", "")
            index_path = os.path.join(DATA_DIR, f"{file_id}.index")
            json_path = os.path.join(DATA_DIR, f"{file_id}.json")
            if os.path.exists(index_path):
                try:
                    index = faiss.read_index(index_path)
                    with open(json_path) as f:
                        data = json.load(f)
                    page_store[data["url"]] = {
                        "index": index,
                        "chunks": data["chunks"],
                        "title": data.get("title", ""),
                        "file_id": file_id
                    }
                    loaded += 1
                except Exception as e:
                    print(f"Failed to load {file_id}: {e}")
    print(f"Loaded {loaded} saved page(s) from disk.")


# ── Startup ───────────────────────────────────────────────────────────────────

@app.on_event("startup")
def startup():
    load_all_pages()


# ── Schemas ───────────────────────────────────────────────────────────────────

class IngestRequest(BaseModel):
    page_id: str
    page_text: str
    page_title: str = ""

class QueryRequest(BaseModel):
    page_id: str
    question: str


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "pages_loaded": len(page_store)}

@app.get("/pages")
def list_pages():
    """List all indexed pages."""
    return {
        "pages": [
            {"url": url, "title": data["title"], "chunks": len(data["chunks"])}
            for url, data in page_store.items()
        ]
    }

@app.post("/ingest")
def ingest(req: IngestRequest):
    # Step 1: Split text into overlapping chunks
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=500,
        chunk_overlap=100
    )
    chunks = splitter.split_text(req.page_text)

    if not chunks:
        raise HTTPException(status_code=400, detail="No content to index.")

    # Step 2: Embed chunks using BAAI/bge-small-en
    vectors = embedder.encode(chunks)

    # Step 3: Store in FAISS index
    index = faiss.IndexFlatL2(vectors.shape[1])
    index.add(np.array(vectors))

    # Step 4: Save to memory
    file_id = url_to_id(req.page_id)
    page_store[req.page_id] = {
        "index": index,
        "chunks": chunks,
        "title": req.page_title,
        "file_id": file_id
    }

    # Step 5: Save to disk
    save_page(req.page_id, req.page_id, index, chunks, req.page_title)

    return {"status": "indexed", "chunks": len(chunks)}

@app.post("/query")
def query(req: QueryRequest):
    if req.page_id not in page_store:
        raise HTTPException(status_code=404, detail="Page not indexed yet.")

    # Step 1: Embed the question
    q_vec = embedder.encode([req.question])

    # Step 2: Search FAISS for top 5 relevant chunks
    distances, indices = page_store[req.page_id]["index"].search(
        np.array(q_vec), k=5
    )
    chunks = page_store[req.page_id]["chunks"]

    # Step 3: Build context with confidence scores
    results = []
    for i, idx in enumerate(indices[0]):
        if idx < len(chunks):
            score = float(distances[0][i])
            results.append({"chunk": chunks[idx], "score": score})

    context = "\n\n".join([r["chunk"] for r in results])

    # Step 4: Build prompt
    prompt = f"""You are WebLens, an AI that answers questions strictly based on webpage content.

Context from the page:
{context}

Question: {req.question}

Answer concisely based only on the context above:"""

    # Step 5: Call Ollama LLaMA 3.2
    llm = Ollama(model="llama3.2")
    answer = llm.invoke(prompt)

    return {
        "answer": answer,
        "sources": results
    }

class ClearRequest(BaseModel):
    page_id: str

@app.post("/clear")
def clear_page(req: ClearRequest):
    if req.page_id not in page_store:
        raise HTTPException(status_code=404, detail="Page not found.")

    file_id = page_store[req.page_id]["file_id"]

    del page_store[req.page_id]

    index_path = os.path.join(DATA_DIR, f"{file_id}.index")
    json_path = os.path.join(DATA_DIR, f"{file_id}.json")
    if os.path.exists(index_path): os.remove(index_path)
    if os.path.exists(json_path): os.remove(json_path)

    return {"status": "cleared"}

@app.post("/query/stream")
def query_stream(req: QueryRequest):
    if req.page_id not in page_store:
        raise HTTPException(status_code=404, detail="Page not indexed yet.")

    # Embed question and retrieve chunks
    q_vec = embedder.encode([req.question])
    distances, indices = page_store[req.page_id]["index"].search(
        np.array(q_vec), k=5
    )
    chunks = page_store[req.page_id]["chunks"]

    results = []
    for i, idx in enumerate(indices[0]):
        if idx < len(chunks):
            score = float(distances[0][i])
            results.append({"chunk": chunks[idx], "score": score})

    context = "\n\n".join([r["chunk"] for r in results])

    prompt = f"""You are WebLens, an AI that answers questions strictly based on webpage content.

Context from the page:
{context}

Question: {req.question}

Answer concisely based only on the context above:"""

    # Stream the response token by token
    def generate():
        # First send sources as a JSON line
        yield f"SOURCES:{json.dumps(results)}\n"
        
        # Then stream the answer
        llm = Ollama(model="llama3.2")
        for chunk in llm.stream(prompt):
            yield chunk

    return StreamingResponse(generate(), media_type="text/plain")
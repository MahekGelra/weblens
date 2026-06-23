# WebLens 🔍

> Chat with any webpage using AI - powered by RAG, FAISS, and LLaMA 3.2.

WebLens is a Chrome Extension that lets you ask questions about any webpage and get accurate, context-aware answers, all running locally on your machine. 

---

## Features

- ⚡ **Index any webpage** — extracts and chunks visible text instantly
- 💬 **Chat with the page** — ask anything, get answers grounded in the content
- 📄 **Page summarizer** — one click to summarize the entire page
- 🌊 **Streaming responses** — answers appear word by word 
- 📎 **Source highlighting** — see which part of the page answered your question
- 📊 **Confidence score** — know how relevant the retrieved context was
- 📜 **Chat history** — conversations persist across sessions per page
- 💾 **Persistent memory** — indexed pages survive server restarts
- 📋 **Copy answers** — one click to copy any response
- 🗂️ **Clear index** — delete saved indexes to free disk space

---

## Tech Stack

| Component | Technology |
|---|---|
| Chrome Extension | Manifest V3 (HTML/CSS/JS) |
| Backend | FastAPI + Uvicorn |
| Text Splitting | LangChain RecursiveCharacterTextSplitter |
| Embeddings | BAAI/bge-small-en (Sentence Transformers) |
| Vector Store | FAISS (persisted to disk) |
| LLM | LLaMA 3.2 via Ollama (local) |

---

## Setup

### Prerequisites
- Python 3.10+
- [Ollama](https://ollama.com/download) installed
- Google Chrome

### 1. Clone the repo
```bash
git clone https://github.com/MahekGelra/weblens.git
cd weblens
```

### 2. Install Ollama and pull LLaMA 3.2
```bash
ollama pull llama3.2
```

### 3. Backend setup
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --port 8000
```

### 4. Load the Chrome Extension
1. Open Chrome → `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `extension/` folder

### 5. Use it
1. Navigate to any webpage
2. Click the WebLens icon in toolbar
3. Click **⚡ Index Page**
4. Ask anything!

---

## How RAG Works Here

1. Page text is extracted and split into 500-word overlapping chunks
2. Each chunk is embedded using `BAAI/bge-small-en`
3. Embeddings stored in a FAISS index (saved to disk)
4. Your question is embedded and compared against all chunks
5. Top 5 most similar chunks retrieved
6. Chunks + question sent to LLaMA 3.2
7. Answer streamed back word by word

---

## Privacy

Everything runs locally. Your page content, questions and answers never leave your machine.

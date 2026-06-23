const BACKEND = "http://localhost:8000";

// DOM elements
const statusBar     = document.getElementById("status-bar");
const indexBtn      = document.getElementById("index-btn");
const queryInput    = document.getElementById("query-input");
const askBtn        = document.getElementById("ask-btn");
const chatBox       = document.getElementById("chat-box");
const charCount     = document.getElementById("char-count");
const pageTitleEl   = document.getElementById("page-title");
const clearBtn      = document.getElementById("clear-btn");
const summaryBtn    = document.getElementById("summary-btn");
const clearIndexBtn = document.getElementById("clear-index-btn");

let currentPageId = null;
let isIndexed     = false;

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;

  currentPageId = tab.url;
  pageTitleEl.textContent = tab.title || tab.url;

  const cached = await chrome.storage.session.get(currentPageId);
  if (cached[currentPageId]) {
    setIndexed(true);
  }

  loadChatHistory(currentPageId);
}

// ── Status ────────────────────────────────────────────────────────────────────

function setStatus(type, msg) {
  statusBar.textContent = msg;
  statusBar.className = "status " + type;
  statusBar.id = "status-bar";
}

function setIndexed(val) {
  isIndexed = val;
  if (val) {
    setStatus("success", "✅ Page indexed — ask me anything!");
    askBtn.disabled = false;
    queryInput.disabled = false;
    queryInput.placeholder = "Ask anything about this page...";
    summaryBtn.disabled = false;
    clearIndexBtn.disabled = false;
  } else {
    setStatus("idle", "Click 'Index Page' to get started");
    askBtn.disabled = true;
    queryInput.disabled = true;
    summaryBtn.disabled = true;
    clearIndexBtn.disabled = true;
  }
}

// ── Index page ────────────────────────────────────────────────────────────────

indexBtn.addEventListener("click", async () => {
  setStatus("loading", "Extracting page content...");
  indexBtn.disabled = true;
  indexBtn.textContent = "Indexing...";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageContent,
    });

    const { text, title, url } = result.result;

    if (!text || text.length < 50) {
      setStatus("error", "Not enough text found on this page.");
      return;
    }

    setStatus("loading", `Indexing ${Math.round(text.length / 1000)}k chars...`);

    const res = await fetch(`${BACKEND}/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page_id: url, page_text: text, page_title: title }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Indexing failed");
    }

    const data = await res.json();
    currentPageId = url;

    await chrome.storage.session.set({ [url]: true });
    setIndexed(true);
    appendSystemMsg(`✅ Indexed ${data.chunks} chunks from "${title}"`);

  } catch (err) {
    setStatus("error", "Error: " + err.message);
  } finally {
    indexBtn.disabled = false;
    indexBtn.textContent = "⚡ Re-Index Page";
  }
});

function extractPageContent() {
  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "IFRAME",
    "HEADER", "FOOTER", "NAV"
  ]);

  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const el = node.parentElement;
        if (!el) return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS.has(el.tagName)) return NodeFilter.FILTER_REJECT;
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") {
          return NodeFilter.FILTER_REJECT;
        }
        if (node.textContent.trim().length < 2) return NodeFilter.FILTER_SKIP;
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  const parts = [];
  let n;
  while ((n = walker.nextNode())) parts.push(n.textContent.trim());

  return {
    text: parts.join(" ").replace(/\s+/g, " ").trim(),
    title: document.title,
    url: location.href
  };
}

// ── Ask question ──────────────────────────────────────────────────────────────

async function sendQuery() {
  const question = queryInput.value.trim();
  if (!question || !isIndexed) return;

  appendUserMsg(question);
  queryInput.value = "";
  updateCharCount();
  askBtn.disabled = true;
  askBtn.textContent = "Thinking...";

  const answerDiv = document.createElement("div");
  answerDiv.className = "msg assistant";
  answerDiv.textContent = "";
  chatBox.appendChild(answerDiv);

  try {
    const res = await fetch(`${BACKEND}/query/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page_id: currentPageId, question }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Query failed");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let sources = [];
    let firstChunk = true;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value);

      if (firstChunk && text.startsWith("SOURCES:")) {
        const lines = text.split("\n");
        sources = JSON.parse(lines[0].replace("SOURCES:", ""));
        const rest = lines.slice(1).join("\n");
        if (rest) answerDiv.textContent += rest;
        firstChunk = false;
      } else {
        answerDiv.textContent += text;
        firstChunk = false;
      }

      chatBox.scrollTop = chatBox.scrollHeight;
    }

    // Add copy button to streamed answer
    const copyBtn = document.createElement("button");
    copyBtn.className = "copy-btn";
    copyBtn.textContent = "📋 Copy";
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(answerDiv.textContent);
      copyBtn.textContent = "✅ Copied!";
      setTimeout(() => copyBtn.textContent = "📋 Copy", 2000);
    });
    chatBox.appendChild(copyBtn);

    // Save to chat history
    saveChatHistory(currentPageId, question, answerDiv.textContent);

    if (sources.length > 0) {
      appendSources(sources);
    }

  } catch (err) {
    answerDiv.textContent = "⚠️ Error: " + err.message;
  } finally {
    askBtn.disabled = false;
    askBtn.textContent = "Ask";
  }
}

askBtn.addEventListener("click", sendQuery);

queryInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendQuery();
  }
});

queryInput.addEventListener("input", updateCharCount);

function updateCharCount() {
  charCount.textContent = queryInput.value.length + " / 500";
}

// ── Page Summary ──────────────────────────────────────────────────────────────

summaryBtn.addEventListener("click", async () => {
  if (!isIndexed) return;

  summaryBtn.disabled = true;
  summaryBtn.textContent = "Summarizing...";

  const answerDiv = document.createElement("div");
  answerDiv.className = "msg assistant";
  answerDiv.textContent = "";
  chatBox.appendChild(answerDiv);

  try {
    const res = await fetch(`${BACKEND}/query/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        page_id: currentPageId,
        question: "Give a clear and concise summary of this entire webpage. Cover the main topics and key points."
      }),
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let firstChunk = true;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value);

      if (firstChunk && text.startsWith("SOURCES:")) {
        const lines = text.split("\n");
        const rest = lines.slice(1).join("\n");
        if (rest) answerDiv.textContent += rest;
        firstChunk = false;
      } else {
        answerDiv.textContent += text;
        firstChunk = false;
      }

      chatBox.scrollTop = chatBox.scrollHeight;
    }

    // Add copy button
    const copyBtn = document.createElement("button");
    copyBtn.className = "copy-btn";
    copyBtn.textContent = "📋 Copy";
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(answerDiv.textContent);
      copyBtn.textContent = "✅ Copied!";
      setTimeout(() => copyBtn.textContent = "📋 Copy", 2000);
    });
    chatBox.appendChild(copyBtn);

    saveChatHistory(currentPageId, "📄 Page Summary", answerDiv.textContent);

  } catch (err) {
    answerDiv.textContent = "⚠️ Error: " + err.message;
  } finally {
    summaryBtn.disabled = false;
    summaryBtn.textContent = "📄 Summarize";
  }
});

// ── Chat History ──────────────────────────────────────────────────────────────

async function saveChatHistory(pageId, question, answer) {
  const key = "history_" + btoa(pageId).slice(0, 20);
  const existing = await chrome.storage.local.get(key);
  const history = existing[key] || [];

  history.push({
    question,
    answer,
    timestamp: Date.now()
  });

  if (history.length > 20) history.shift();

  await chrome.storage.local.set({ [key]: history });
}

async function loadChatHistory(pageId) {
  const key = "history_" + btoa(pageId).slice(0, 20);
  const existing = await chrome.storage.local.get(key);
  const history = existing[key] || [];

  if (history.length === 0) return;

  appendSystemMsg(`📜 Previous ${history.length} conversation(s) restored`);

  history.forEach(({ question, answer }) => {
    appendUserMsg(question);
    const div = document.createElement("div");
    div.className = "msg assistant";
    div.textContent = answer;
    chatBox.appendChild(div);
  });

  chatBox.scrollTop = chatBox.scrollHeight;
}

// ── Chat rendering ────────────────────────────────────────────────────────────

function appendUserMsg(text) {
  const div = document.createElement("div");
  div.className = "msg user";
  div.textContent = text;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function appendAssistantMsg(text) {
  const wrapper = document.createElement("div");
  wrapper.style.alignSelf = "flex-start";
  wrapper.style.maxWidth = "95%";

  const div = document.createElement("div");
  div.className = "msg assistant";
  div.textContent = text;

  const copyBtn = document.createElement("button");
  copyBtn.className = "copy-btn";
  copyBtn.textContent = "📋 Copy";
  copyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(text);
    copyBtn.textContent = "✅ Copied!";
    setTimeout(() => copyBtn.textContent = "📋 Copy", 2000);
  });

  wrapper.appendChild(div);
  wrapper.appendChild(copyBtn);
  chatBox.appendChild(wrapper);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function appendSystemMsg(text) {
  const div = document.createElement("div");
  div.className = "msg system";
  div.textContent = text;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function appendSources(sources) {
  const div = document.createElement("div");
  div.className = "msg sources";

  const topSource = sources[0];
  const confidence = Math.max(0, Math.round((1 - topSource.score / 10) * 100));

  div.innerHTML = `
    <div class="source-header">📎 Sources (confidence: ${confidence}%)</div>
    ${sources.slice(0, 2).map((s, i) => `
      <div class="source-chunk">
        <span class="source-num">${i + 1}</span>
        ${s.chunk.slice(0, 150)}...
      </div>
    `).join("")}
  `;

  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

// ── Clear chat ────────────────────────────────────────────────────────────────

clearBtn.addEventListener("click", async () => {
  chatBox.innerHTML = "";
  const key = "history_" + btoa(currentPageId).slice(0, 20);
  await chrome.storage.local.remove(key);
});

// ── Clear Index ───────────────────────────────────────────────────────────────

clearIndexBtn.addEventListener("click", async () => {
  if (!currentPageId) return;

  const confirmed = confirm("Delete the saved index for this page? You'll need to re-index it next time.");
  if (!confirmed) return;

  try {
    const res = await fetch(`${BACKEND}/clear`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page_id: currentPageId }),
    });

    if (!res.ok) throw new Error("Failed to clear index");

    await chrome.storage.session.remove(currentPageId);

    setIndexed(false);
    chatBox.innerHTML = "";
    appendSystemMsg("🗂️ Page index cleared. Re-index to chat again.");

    console.log("Clearing page_id:", currentPageId);

  } catch (err) {
    appendSystemMsg("⚠️ Error: " + err.message);
  }
});

// ── Reset on page navigation ──────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "pageUpdated") {
    setIndexed(false);
    indexBtn.textContent = "⚡ Index Page";
    chatBox.innerHTML = "";
    init();
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────

init();
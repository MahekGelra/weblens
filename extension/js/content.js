// content.js — runs inside every webpage
// Its only job is to extract all visible text from the page

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
  let node;
  while ((node = walker.nextNode())) {
    parts.push(node.textContent.trim());
  }

  return {
    text: parts.join(" ").replace(/\s+/g, " ").trim(),
    title: document.title,
    url: window.location.href
  };
}
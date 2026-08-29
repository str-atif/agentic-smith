import { memo, useEffect, useMemo, useRef } from "react";
import { marked } from "marked";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

marked.use({
  renderer: {
    code({ text, lang }) {
      const language = lang && /^[\w-]+$/.test(lang) ? ` class="language-${lang}"` : "";
      const label = lang && /^[\w-]+$/.test(lang) ? escapeHtml(lang) : "code";
      return (
        `<div class="code-block">` +
        `<div class="code-block-head">` +
        `<span class="code-lang">${label}</span>` +
        `<button type="button" class="code-copy"><span class="material-symbols-outlined" style="font-size:12px;vertical-align:middle;margin-right:3px;">content_copy</span><span class="copy-text">Copy</span></button>` +
        `</div>` +
        `<pre><code${language}>${escapeHtml(text)}</code></pre>` +
        `</div>`
      );
    },
  },
});

const ALLOWED_TAGS = new Set([
  "p", "br", "hr", "strong", "b", "em", "i", "del", "s",
  "code", "pre", "blockquote", "a", "ul", "ol", "li",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "table", "thead", "tbody", "tr", "th", "td",
  "div", "span", "button",
]);

const ALLOWED_CLASSES = new Set([
  "code-block", "code-block-head", "code-copy", "code-lang",
]);

function safeHref(href: string): boolean {
  return /^(https?:|mailto:|#)/.test(href);
}

function sanitizeHtml(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  const sanitizeNode = (node: Node): void => {
    const children = [...node.childNodes];
    for (const rawChild of children) {
      if (rawChild.nodeType === Node.TEXT_NODE) {
        sanitizeNode(rawChild);
        continue;
      }
      if (rawChild.nodeType !== Node.ELEMENT_NODE) {
        rawChild.remove();
        continue;
      }
      const element = rawChild as HTMLElement;
      const tag = element.tagName.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) {
        const fragment = document.createDocumentFragment();
        while (element.firstChild) {
          fragment.appendChild(element.firstChild);
        }
        element.replaceWith(fragment);
        sanitizeNode(fragment);
        continue;
      }
      for (const attribute of [...element.attributes]) {
        const name = attribute.name.toLowerCase();
        if (name === "class" && ALLOWED_CLASSES.has(attribute.value)) continue;
        if (name === "href" && safeHref(attribute.value)) continue;
        if (name === "type" && attribute.value === "button") continue;
        element.removeAttribute(attribute.name);
      }
      sanitizeNode(element);
    }
  };
  sanitizeNode(template.content);
  return template.innerHTML;
}

function MarkdownBody({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const onClick = (event: Event): void => {
      const target = event.target as HTMLElement;
      const copyBtn = target.closest(".code-copy");
      if (!copyBtn) return;
      const block = copyBtn.closest(".code-block");
      const code = block?.querySelector("pre code");
      if (!code) return;
      const copyText = copyBtn.querySelector(".copy-text") as HTMLElement | null;
      const text = (code.textContent ?? "").replace(/\n$/, "");
      void navigator.clipboard.writeText(text).then(() => {
        if (copyText) copyText.textContent = "Copied";
        window.setTimeout(() => {
          if (copyText) copyText.textContent = "Copy";
        }, 1400);
      });
    };
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, []);

  return <div ref={ref} className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}

function Markdown({ source }: { source: string }) {
  const html = useMemo(() => {
    try {
      return sanitizeHtml(marked.parse(source, { breaks: true }) as string);
    } catch {
      return escapeHtml(source).replace(/\n/g, "<br>");
    }
  }, [source]);
  return <MarkdownBody html={html} />;
}

export default memo(Markdown);
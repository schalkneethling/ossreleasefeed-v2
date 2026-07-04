const ALLOWED_TAGS = new Set([
  "a",
  "blockquote",
  "br",
  "code",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "ul",
]);

const ALLOWED_ATTRIBUTES = new Map<string, Set<string>>([
  ["*", new Set(["title"])],
  ["a", new Set(["href", "title"])],
  ["img", new Set(["alt", "height", "src", "title", "width"])],
]);

const URL_ATTRIBUTES = new Set(["action", "formaction", "href", "poster", "src"]);
const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const DANGEROUS_TAGS = new Set(["embed", "form", "iframe", "object", "script", "style"]);

const isSafeUrl = (value: string): boolean => {
  if (
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith("#")
  ) {
    return true;
  }

  try {
    const url = new URL(value);

    return SAFE_PROTOCOLS.has(url.protocol);
  } catch {
    return false;
  }
};

export const sanitiseHtml = async (html: string): Promise<string> => {
  if (typeof HTMLRewriter === "undefined") {
    return html;
  }

  // Workers expose HTMLRewriter but not the browser DOM methods required by the
  // HTML Sanitizer API (`Element.setHTML()`, `Document.parseHTML()`, etc.).
  // Keep sanitization on the Worker-native path here.
  const response = new HTMLRewriter()
    .on("*", {
      element(element) {
        if (!ALLOWED_TAGS.has(element.tagName)) {
          if (DANGEROUS_TAGS.has(element.tagName)) {
            element.remove();
          } else {
            element.removeAndKeepContent();
          }
          return;
        }

        const allowed = new Set([
          ...(ALLOWED_ATTRIBUTES.get("*") ?? []),
          ...(ALLOWED_ATTRIBUTES.get(element.tagName) ?? []),
        ]);

        for (const [name] of element.attributes) {
          if (name.startsWith("on")) {
            element.removeAttribute(name);
            continue;
          }

          if (!allowed.has(name)) {
            element.removeAttribute(name);
            continue;
          }

          if (URL_ATTRIBUTES.has(name)) {
            const value = element.getAttribute(name);

            if (!value || !isSafeUrl(value)) {
              element.removeAttribute(name);
            }
          }
        }
      },
    })
    .transform(new Response(html));

  return response.text();
};

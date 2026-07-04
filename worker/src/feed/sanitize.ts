export const sanitiseHtml = async (html: string): Promise<string> => {
  if (typeof HTMLRewriter === "undefined") {
    return html;
  }

  const unsafeTags = ["script", "iframe", "object", "embed", "form"];

  const response = new HTMLRewriter()
    .on(unsafeTags.join(","), {
      element(element) {
        element.remove();
      },
    })
    .on("*", {
      element(element) {
        for (const [name] of element.attributes) {
          if (name.startsWith("on")) {
            element.removeAttribute(name);
          }
        }
      },
    })
    .transform(new Response(html));

  return response.text();
};

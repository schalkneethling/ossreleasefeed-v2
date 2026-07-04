declare module "sax" {
  type Attributes = Record<string, string>;

  type Parser = {
    onopentag: ((node: { name: string; attributes: Attributes }) => void) | null;
    ontext: ((text: string) => void) | null;
    oncdata: ((text: string) => void) | null;
    onclosetag: ((name: string) => void) | null;
    onerror: ((error: Error) => void) | null;
    write: (chunk: string) => Parser;
    close: () => Parser;
  };

  const sax: {
    parser: (strict: boolean, options?: Record<string, unknown>) => Parser;
  };

  export default sax;
}

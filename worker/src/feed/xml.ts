import { FeedParseError } from "../lib/errors";
import type { FeedEntry } from "../lib/schemas";
import { sanitiseHtml } from "./sanitize";
import sax from "sax";

type PartialEntry = {
  authorLogin?: string;
  date?: string;
  link?: string;
  summary?: string;
  title?: string;
};

const normalizeText = (value: string | undefined): string => value?.trim() ?? "";

const parseDate = (value: string, url: string): Date => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new FeedParseError({
      url,
      cause: new Error(`Invalid date: ${value}`),
    });
  }

  return date;
};

export const parseGitHubReleaseAtom = async (
  xml: string,
  repo: string,
  url: string,
): Promise<FeedEntry[]> => {
  const parser = sax.parser(true, { lowercase: true, trim: false });
  const entries: FeedEntry[] = [];
  let current: PartialEntry | null = null;
  let currentText = "";
  let insideAuthor = false;

  parser.onopentag = (node) => {
    currentText = "";

    if (node.name === "entry") {
      current = {};
      return;
    }

    if (!current) {
      return;
    }

    if (node.name === "author") {
      insideAuthor = true;
      return;
    }

    if (
      node.name === "link" &&
      node.attributes.rel === "alternate" &&
      typeof node.attributes.href === "string"
    ) {
      current.link = node.attributes.href;
    }
  };

  parser.ontext = (text) => {
    currentText += text;
  };

  parser.oncdata = (text) => {
    currentText += text;
  };

  parser.onclosetag = (name) => {
    if (!current) {
      return;
    }

    const value = normalizeText(currentText);

    if (name === "author") {
      insideAuthor = false;
    } else if (insideAuthor && name === "name") {
      current.authorLogin = value;
    } else if (name === "title") {
      current.title = value;
    } else if (name === "updated") {
      current.date = value;
    } else if (name === "content") {
      current.summary = value;
    } else if (name === "entry") {
      if (current.link && current.title && current.date && current.authorLogin) {
        entries.push({
          id: current.link,
          link: current.link,
          title: current.title,
          summary: current.summary ? current.summary : "",
          date: parseDate(current.date, url),
          authorLogin: current.authorLogin,
          repo,
          entryType: "release",
        });
      }

      current = null;
    }

    currentText = "";
  };

  parser.onerror = (error) => {
    throw new FeedParseError({ url, cause: error });
  };

  parser.write(xml).close();

  return Promise.all(
    entries.map(async (entry) => ({
      ...entry,
      summary: await sanitiseHtml(entry.summary),
    })),
  );
};

export const parseCachedFeed = (xml: string, url: string): FeedEntry[] => {
  const parser = sax.parser(true, { lowercase: true, trim: false });
  const entries: FeedEntry[] = [];
  let current: PartialEntry | null = null;
  let currentText = "";
  let insideAuthor = false;
  let entryType: FeedEntry["entryType"] = "release";

  parser.onopentag = (node) => {
    currentText = "";

    if (node.name === "entry") {
      current = {};
      entryType = "release";
      return;
    }

    if (!current) {
      return;
    }

    if (node.name === "author") {
      insideAuthor = true;
      return;
    }

    if (node.name === "link" && typeof node.attributes.href === "string") {
      current.link = node.attributes.href;
    }
  };

  parser.ontext = (text) => {
    currentText += text;
  };

  parser.oncdata = (text) => {
    currentText += text;
  };

  parser.onclosetag = (name) => {
    if (!current) {
      return;
    }

    const value = normalizeText(currentText);

    if (name === "author") {
      insideAuthor = false;
    } else if (insideAuthor && name === "name") {
      current.authorLogin = value;
    } else if (name === "title") {
      current.title = value;
      if (value.includes("PR:")) {
        entryType = "pull_request";
      } else if (value.includes("Issue:")) {
        entryType = "issue";
      }
    } else if (name === "updated") {
      current.date = value;
    } else if (name === "summary" || name === "content") {
      current.summary = value;
    } else if (name === "entry") {
      if (current.link && current.title && current.date && current.authorLogin) {
        const repoMatch = current.title.match(/^\[([^\]]+)\]/u);

        entries.push({
          id: current.link,
          link: current.link,
          title: current.title.replace(/^\[[^\]]+\]\s+(Release|PR|Issue):\s*/u, ""),
          summary: current.summary ? current.summary : "",
          date: parseDate(current.date, url),
          authorLogin: current.authorLogin,
          repo: repoMatch ? repoMatch[1] : "unknown/unknown",
          entryType,
        });
      }

      current = null;
    }

    currentText = "";
  };

  parser.onerror = (error) => {
    throw new FeedParseError({ url, cause: error });
  };

  parser.write(xml).close();

  return entries;
};

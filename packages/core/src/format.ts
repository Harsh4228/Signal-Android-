import { LINK_RE } from './client';

/**
 * WhatsApp-style text formatting, worked out once here so every app shows the same thing:
 *   *bold*  _italic_  ~strikethrough~  `inline code`  ```monospace block```
 *   "> " quote line, "- " / "* " bullet line, "1. " numbered line.
 * Links and @mentions are found first and never formatted inside.
 */
export interface TextSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  link?: boolean;
  mention?: boolean;
}

export interface TextLine {
  spans: TextSpan[];
  quote?: boolean;
  /** "•" for bullets, "3." for numbered lines. */
  bullet?: string;
  /** Inside a ``` block: shown as monospace, nothing else applies. */
  mono?: boolean;
}

type Style = Omit<TextSpan, 'text' | 'link' | 'mention'>;
const MARK: Record<string, keyof Style> = { '*': 'bold', _: 'italic', '~': 'strike', '`': 'code' };
// A marker opens after the start / a space / punctuation, closes before the end / a space / punctuation, and
// never touches a space on its inner side - so "2*3*4" or "snake_case_name" stay plain.
const EDGE = `\\s()\\[\\]{}"'.,!?:;\\-`;
const INLINE_RE = new RegExp(`(^|[${EDGE}])([*_~\`])(?![\\s])([^\\n]*?[^\\s])\\2(?=$|[${EDGE}])`);

function inline(text: string, style: Style, out: TextSpan[]) {
  let rest = text;
  while (rest) {
    const m = style.code ? null : INLINE_RE.exec(rest);
    if (!m) {
      out.push({ text: rest, ...style });
      return;
    }
    const start = m.index + m[1]!.length;
    if (start > 0) out.push({ text: rest.slice(0, start), ...style });
    const key = MARK[m[2]!]!;
    // Inline code is literal; the others may nest (*_bold italic_*).
    if (key === 'code') out.push({ text: m[3]!, ...style, code: true });
    else inline(m[3]!, { ...style, [key]: true }, out);
    rest = rest.slice(start + m[2]!.length * 2 + m[3]!.length);
  }
}

function spansOf(text: string, mention: RegExp | null): TextSpan[] {
  const out: TextSpan[] = [];
  let last = 0;
  const plain = (t: string) => {
    if (!t) return;
    if (!mention) return inline(t, {}, out);
    t.split(mention).forEach((piece, j) => {
      if (!piece) return;
      if (j % 2) out.push({ text: piece, mention: true });
      else inline(piece, {}, out);
    });
  };
  for (const match of text.matchAll(new RegExp(LINK_RE.source, LINK_RE.flags.includes('g') ? LINK_RE.flags : LINK_RE.flags + 'g'))) {
    plain(text.slice(last, match.index));
    out.push({ text: match[0], link: true });
    last = match.index! + match[0].length;
  }
  plain(text.slice(last));
  return out;
}

/** A regex that finds these @mention tokens (e.g. "@asha", "@Asha Patel"), or null. Its one group is the token. */
export function mentionPattern(tokens: string[]): RegExp | null {
  const t = tokens.filter(Boolean);
  return t.length ? new RegExp(`(${t.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi') : null;
}

/** Splits message text into lines of styled spans. */
export function formatText(text: string, mention: RegExp | null = null): TextLine[] {
  const lines: TextLine[] = [];
  // ``` blocks first: they may span lines and nothing inside them is formatted.
  const parts = text.split(/```([\s\S]+?)```/);
  parts.forEach((part, i) => {
    if (i % 2) {
      for (const l of part.replace(/^\n|\n$/g, '').split('\n')) lines.push({ spans: [{ text: l, code: true }], mono: true });
      return;
    }
    if (!part) return;
    const rows = part.split('\n');
    // The text around a ``` block continues the same line, as WhatsApp shows it.
    if (i > 0 && rows[0] === '') rows.shift();
    if (i < parts.length - 1 && rows[rows.length - 1] === '') rows.pop();
    for (const row of rows) {
      let body = row;
      const line: TextLine = { spans: [] };
      let m: RegExpMatchArray | null;
      if ((m = body.match(/^>\s?(.*)$/))) {
        line.quote = true;
        body = m[1]!;
      } else if ((m = body.match(/^[-*]\s+(.*)$/))) {
        line.bullet = '•';
        body = m[1]!;
      } else if ((m = body.match(/^(\d{1,3}\.)\s+(.*)$/))) {
        line.bullet = m[1]!;
        body = m[2]!;
      }
      line.spans = spansOf(body, mention);
      lines.push(line);
    }
  });
  return lines;
}

/** The text without formatting markers (for previews, notifications, search). */
export function plainText(text: string): string {
  return formatText(text)
    .map((l) => (l.bullet ? `${l.bullet} ` : '') + l.spans.map((s) => s.text).join(''))
    .join('\n');
}

/** Every link in a text, in order. */
export function linksIn(text: string): string[] {
  return [...text.matchAll(new RegExp(LINK_RE.source, LINK_RE.flags.includes('g') ? LINK_RE.flags : LINK_RE.flags + 'g'))].map((m) => m[0]);
}

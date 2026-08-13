import { Fragment, type ReactNode } from "react";

type Block =
  | { kind: "heading"; text: string }
  | { kind: "para"; text: string }
  | { kind: "list"; items: string[] };

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s)]+)/g;

function renderInline(text: string, keyBase: string): ReactNode[] {
  return text.split(INLINE).filter(Boolean).map((part, i) => {
    const key = `${keyBase}-${i}`;
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={key}>{part.slice(1, -1)}</code>;
    }
    if (/^https?:\/\//.test(part)) {
      let label = part.replace(/^https?:\/\//, "").replace(/\/$/, "");
      try {
        const u = new URL(part);
        const path =
          u.pathname.length > 28
            ? `${u.pathname.slice(0, 12)}…${u.pathname.slice(-10)}`
            : u.pathname;
        label = `${u.host}${path === "/" ? "" : path}`;
      } catch {
        if (label.length > 48) label = `${label.slice(0, 22)}…${label.slice(-14)}`;
      }
      return (
        <a key={key} href={part} target="_blank" rel="noreferrer" className="break-all">
          {label}
        </a>
      );
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

function toBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let list: string[] | null = null;

  const flush = () => {
    if (list?.length) blocks.push({ kind: "list", items: list });
    list = null;
  };

  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }

    const bullet = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (bullet) {
      list = list ?? [];
      list.push(bullet[1]);
      continue;
    }

    flush();

    const heading = line.match(/^#{1,4}\s+(.*)$/);
    if (heading) {
      blocks.push({ kind: "heading", text: heading[1] });
      continue;
    }

    // A short standalone "Label:" line reads as a section head, not a sentence.
    if (/^\*{0,2}[\w][\w \/+-]{0,32}\*{0,2}:$/.test(line)) {
      blocks.push({ kind: "heading", text: line.replace(/\*/g, "").replace(/:$/, "") });
      continue;
    }

    blocks.push({ kind: "para", text: line });
  }

  flush();
  return blocks;
}

/** Renders agent replies as typeset prose instead of a raw markdown wall. */
export function AgentText({ text, className }: { text: string; className?: string }) {
  const blocks = toBlocks(text);

  return (
    <div className={className ? `beacon-prose ${className}` : "beacon-prose"}>
      {blocks.map((block, i) => {
        if (block.kind === "heading") {
          return <h4 key={i}>{block.text}</h4>;
        }
        if (block.kind === "list") {
          return (
            <ul key={i}>
              {block.items.map((item, j) => (
                <li key={j}>
                  <span>{renderInline(item, `${i}-${j}`)}</span>
                </li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{renderInline(block.text, String(i))}</p>;
      })}
    </div>
  );
}

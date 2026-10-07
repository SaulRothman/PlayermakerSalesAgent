import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Render store-manager Markdown as real bold/tables — never raw ** or pipe rows. */
export function AgentMarkdown({ text }: { text: string }) {
  return (
    <div className="bubble-md">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h2>{children}</h2>,
          h2: ({ children }) => <h2>{children}</h2>,
          h3: ({ children }) => <h3>{children}</h3>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          details: ({ children }) => <div>{children}</div>,
          summary: ({ children }) => <strong>{children}</strong>,
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}

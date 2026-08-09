import {
  getTemplateBody,
  getTemplateButtons,
  getTemplateFooter,
  getTemplateHeader,
  renderTemplateBody,
} from "@/lib/templates/service";

/**
 * Renders a template as it will appear in WhatsApp.
 *
 * WhatsApp's formatting markers are converted to React elements through an
 * allowlist parser. Nothing is ever injected as raw HTML — template text
 * originates from Meta but passes through our database, and treating it as
 * markup would be an XSS route.
 */
function formatWhatsAppText(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // *bold*, _italic_, ~strike~, ```mono``` — WhatsApp's full set.
  const pattern = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|```[^`]+```)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const inner = token.startsWith("```")
      ? token.slice(3, -3)
      : token.slice(1, -1);

    if (token.startsWith("*")) {
      nodes.push(<strong key={key++}>{inner}</strong>);
    } else if (token.startsWith("_")) {
      nodes.push(<em key={key++}>{inner}</em>);
    } else if (token.startsWith("~")) {
      nodes.push(<s key={key++}>{inner}</s>);
    } else {
      nodes.push(
        <code key={key++} className="font-mono text-[0.9em]">
          {inner}
        </code>,
      );
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

export function TemplatePreview({
  components,
  variables = {},
  className,
}: {
  components: unknown;
  variables?: Record<string, string>;
  className?: string;
}) {
  const header = getTemplateHeader(components);
  const body = renderTemplateBody(getTemplateBody(components), variables);
  const footer = getTemplateFooter(components);
  const buttons = getTemplateButtons(components);

  return (
    <div
      className={`rounded-xl bg-slate-100 p-3 dark:bg-slate-950/50 ${className ?? ""}`}
    >
      <div className="ml-auto max-w-xs rounded-xl rounded-br-sm bg-emerald-100 px-3 py-2 text-sm shadow-sm dark:bg-emerald-900">
        {header?.format === "TEXT" && header.text && (
          <p className="mb-1 font-semibold text-slate-900 dark:text-emerald-50">
            {formatWhatsAppText(renderTemplateBody(header.text, variables))}
          </p>
        )}

        {header && header.format !== "TEXT" && (
          <div className="mb-1.5 flex h-20 items-center justify-center rounded-lg bg-slate-200 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            {header.format?.toLowerCase()} attachment
          </div>
        )}

        <p className="whitespace-pre-wrap text-slate-900 dark:text-emerald-50">
          {formatWhatsAppText(body)}
        </p>

        {footer && (
          <p className="mt-1.5 text-xs text-slate-500 dark:text-emerald-200/70">
            {footer}
          </p>
        )}
      </div>

      {buttons.length > 0 && (
        <div className="mt-1 ml-auto max-w-xs space-y-1">
          {buttons.map((b, i) => (
            <div
              key={i}
              className="rounded-lg bg-white px-3 py-1.5 text-center text-sm text-sky-600 shadow-sm dark:bg-slate-800 dark:text-sky-400"
            >
              {b.text ?? "Button"}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import * as React from 'react';
import { Check, Copy } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

function extractCodeLanguage(className?: string): string | null {
  if (!className) {
    return null;
  }

  const match = className.match(/language-([\w-]+)/);
  return match?.[1] || null;
}

function normalizeCodeContent(children: React.ReactNode): string {
  return React.Children.toArray(children)
    .map((child) => (typeof child === 'string' ? child : ''))
    .join('')
    .replace(/\n$/, '');
}

async function copyCodeToClipboard(code: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(code);
    return;
  }

  if (typeof document !== 'undefined') {
    const textarea = document.createElement('textarea');
    textarea.value = code;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    return;
  }

  throw new Error('Clipboard API unavailable');
}

function CodeBlock({
  code,
  language,
}: {
  code: string;
  language: string | null;
}) {
  const [copied, setCopied] = React.useState(false);
  const timeoutRef = React.useRef<number | null>(null);

  React.useEffect(() => (
    () => {
      if (timeoutRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(timeoutRef.current);
      }
    }
  ), []);

  const handleCopy = async () => {
    await copyCodeToClipboard(code);
    setCopied(true);

    if (typeof window !== 'undefined') {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = window.setTimeout(() => {
        setCopied(false);
      }, 1800);
    }
  };

  return (
    <div className="my-4 overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 shadow-sm">
      <div className="flex min-w-0 items-center justify-between gap-2 border-b border-white/10 bg-slate-900/90 px-3 py-2 sm:px-4">
        <span className="min-w-0 truncate font-mono text-[11px] uppercase tracking-[0.18em] text-slate-400">
          {language || 'text'}
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            void handleCopy();
          }}
          className="h-8 shrink-0 rounded-xl px-2 text-xs font-medium text-slate-200 hover:bg-white/10 hover:text-white sm:px-3"
        >
          {copied ? <Check className="h-3.5 w-3.5 sm:mr-1" /> : <Copy className="h-3.5 w-3.5 sm:mr-1" />}
          <span className="hidden sm:inline">{copied ? '已复制' : '复制代码'}</span>
        </Button>
      </div>
      <pre className="max-w-full overflow-x-auto p-3 sm:p-4">
        <code className="font-mono text-[13px] leading-6 text-slate-100">{code}</code>
      </pre>
    </div>
  );
}

const markdownComponents: Components = {
  h1: ({ children, ...props }) => (
    <h1 className="mb-4 mt-6 text-2xl font-semibold tracking-tight text-slate-950 first:mt-0" {...props}>
      {children}
    </h1>
  ),
  h2: ({ children, ...props }) => (
    <h2 className="mb-3 mt-5 text-xl font-semibold tracking-tight text-slate-950 first:mt-0" {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }) => (
    <h3 className="mb-2 mt-4 text-lg font-semibold tracking-tight text-slate-900 first:mt-0" {...props}>
      {children}
    </h3>
  ),
  p: ({ children, ...props }) => (
    <p className="mb-3 break-words [overflow-wrap:anywhere] text-[14px] leading-7 text-slate-700 last:mb-0" {...props}>
      {children}
    </p>
  ),
  strong: ({ children, ...props }) => (
    <strong className="font-semibold text-slate-950" {...props}>
      {children}
    </strong>
  ),
  em: ({ children, ...props }) => (
    <em className="italic text-slate-800" {...props}>
      {children}
    </em>
  ),
  ul: ({ children, ...props }) => (
    <ul className="my-3 list-disc space-y-2 pl-6 marker:text-slate-400" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol className="my-3 list-decimal space-y-2 pl-6 marker:font-medium marker:text-slate-500" {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    <li className="pl-1 text-[14px] leading-7 text-slate-700" {...props}>
      {children}
    </li>
  ),
  blockquote: ({ children, ...props }) => (
    <blockquote
      className="my-4 break-words [overflow-wrap:anywhere] rounded-r-2xl border-l-4 border-slate-300 bg-slate-50 px-4 py-3 text-[14px] leading-7 text-slate-600"
      {...props}
    >
      {children}
    </blockquote>
  ),
  a: ({ children, ...props }) => (
    <a className="break-all font-medium text-blue-600 underline decoration-blue-200 underline-offset-4 hover:text-blue-700" {...props}>
      {children}
    </a>
  ),
  hr: (props) => <hr className="my-5 border-slate-200" {...props} />,
  table: ({ children, ...props }) => (
    <div className="my-4 overflow-x-auto">
      <table className="min-w-full border-collapse overflow-hidden rounded-2xl border border-slate-200 text-left text-sm" {...props}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...props }) => <thead className="bg-slate-50" {...props}>{children}</thead>,
  th: ({ children, ...props }) => <th className="border-b border-slate-200 px-4 py-2 font-semibold text-slate-800" {...props}>{children}</th>,
  td: ({ children, ...props }) => <td className="border-b border-slate-100 px-4 py-2 text-slate-700" {...props}>{children}</td>,
  pre: ({ children }) => {
    const child = React.Children.only(children) as React.ReactElement<{
      children?: React.ReactNode;
      className?: string;
    }>;

    if (!React.isValidElement(child)) {
      return <pre>{children}</pre>;
    }

    return (
      <CodeBlock
        code={normalizeCodeContent(child.props.children)}
        language={extractCodeLanguage(child.props.className)}
      />
    );
  },
  code: ({ children, className, ...props }) => (
    <code
      className={cn(
        'break-all whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-[0.92em] text-slate-900',
        className,
      )}
      {...props}
    >
      {children}
    </code>
  ),
};

export function AssistantMarkdown({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  if (!content) {
    return null;
  }

  return (
    <div className={cn('min-w-0 space-y-1 break-words [overflow-wrap:anywhere] text-[14px] leading-7 text-slate-700', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

export { extractCodeLanguage, normalizeCodeContent };

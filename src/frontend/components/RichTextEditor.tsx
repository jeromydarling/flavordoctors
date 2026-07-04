import { useEffect, useRef, useState } from 'react';

const BLOCKS = [
  { label: 'Heading', title: 'Section heading', cmd: 'formatBlock', arg: 'h2' },
  { label: 'Sub', title: 'Subheading', cmd: 'formatBlock', arg: 'h3' },
  { label: '¶', title: 'Paragraph', cmd: 'formatBlock', arg: 'p' },
];
const INLINE = [
  { label: 'B', title: 'Bold', cmd: 'bold', className: 'font-black' },
  { label: 'I', title: 'Italic', cmd: 'italic', className: 'italic' },
  { label: '• List', title: 'Bulleted list', cmd: 'insertUnorderedList' },
  { label: '1. List', title: 'Numbered list', cmd: 'insertOrderedList' },
];

/**
 * Small dependency-free rich text editor for recipe bodies. Emits the same
 * whitelist of tags the server sanitizer accepts (h2/h3/p/ul/ol/li/strong/em);
 * browser-flavored <b>/<i>/<div> output is normalized server-side.
 */
export function RichTextEditor({ value, onChange, label }: { value: string; onChange: (html: string) => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [showHtml, setShowHtml] = useState(false);

  useEffect(() => {
    document.execCommand('defaultParagraphSeparator', false, 'p');
  }, []);

  // Sync external value in without stomping the cursor mid-edit.
  useEffect(() => {
    if (!showHtml && ref.current && ref.current.innerHTML !== value && document.activeElement !== ref.current) {
      ref.current.innerHTML = value;
    }
  }, [value, showHtml]);

  const exec = (cmd: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    if (ref.current) onChange(ref.current.innerHTML);
  };

  return (
    <div className="rounded-lg border-2 border-navy-lighter">
      <div className="flex flex-wrap items-center gap-1 border-b border-navy-lighter bg-navy p-1.5">
        {[...BLOCKS, ...INLINE].map((b) => (
          <button
            key={b.label}
            type="button"
            title={b.title}
            className={`rounded px-2.5 py-1 text-xs font-bold text-medical/80 hover:bg-navy-lighter hover:text-rx ${'className' in b ? (b.className as string) : ''}`}
            // mousedown + preventDefault keeps the text selection alive
            onMouseDown={(e) => {
              e.preventDefault();
              if (!showHtml) exec(b.cmd, 'arg' in b ? (b.arg as string) : undefined);
            }}
          >
            {b.label}
          </button>
        ))}
        <span className="flex-1" />
        <button
          type="button"
          className={`rounded px-2.5 py-1 text-xs font-bold ${showHtml ? 'bg-rx text-navy' : 'text-medical/60 hover:text-rx'}`}
          onClick={() => setShowHtml((v) => !v)}
        >
          {'</>'} HTML
        </button>
      </div>
      {showHtml ? (
        <textarea
          aria-label={`${label} (HTML)`}
          className="block w-full bg-navy-light p-3 font-mono text-xs text-medical outline-none"
          rows={12}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <div
          ref={ref}
          role="textbox"
          aria-multiline="true"
          aria-label={label}
          contentEditable
          suppressContentEditableWarning
          className="min-h-48 max-h-96 overflow-y-auto bg-navy-light p-4 text-sm leading-relaxed outline-none
            [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-black [&_h2]:text-gold
            [&_h3]:mt-3 [&_h3]:font-bold [&_h3]:text-rx
            [&_p]:mt-2 [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:mt-2 [&_ol]:list-decimal [&_ol]:pl-6
            [&_li]:mt-1"
          onInput={() => ref.current && onChange(ref.current.innerHTML)}
        />
      )}
    </div>
  );
}

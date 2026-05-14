import { useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Copy } from "lucide-react";
import type { JsonValue } from "../engine/types";
import {
  CODEGEN_OPTIONS,
  generate,
  type CodegenTarget,
} from "../codegen";
import { usePortalDropdown } from "../hooks/usePortalDropdown";

interface Props {
  // Plain-text payload copied by the main button half.
  text: string;
  // Parsed payload for codegen targets in the dropdown half. XML payloads
  // pass null and the dropdown half is disabled.
  codegenSample: JsonValue | null;
}

export function SplitCopyButton({ text, codegenSample }: Props) {
  const [copied, setCopied] = useState(false);
  const [justCopied, setJustCopied] = useState<CodegenTarget | null>(null);
  const { open, setOpen, toggle, anchorRef, panelRef, coords } =
    usePortalDropdown<HTMLDivElement, HTMLDivElement>();

  const codegenDisabled = codegenSample === null;
  const copyDisabled = !text;

  const handleCopy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked; ignore */
    }
  };

  const handlePick = async (target: CodegenTarget) => {
    if (codegenSample === null) return;
    try {
      const code = generate(target, codegenSample);
      await navigator.clipboard.writeText(code);
      setJustCopied(target);
      window.setTimeout(() => setJustCopied(null), 1400);
      setOpen(false);
    } catch {
      /* clipboard blocked; ignore */
    }
  };

  return (
    <div className="split-copy" ref={anchorRef}>
      <button
        className="split-copy-main"
        onClick={handleCopy}
        disabled={copyDisabled}
        title="Copy obfuscated output"
      >
        <Copy size={14} />
        <span className="btn-label">{copied ? "Copied" : "Copy"}</span>
      </button>
      <button
        className="split-copy-caret"
        onClick={toggle}
        disabled={codegenDisabled}
        title={
          codegenDisabled
            ? "Codegen targets only available for JSON payloads"
            : "Copy as a typed schema"
        }
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Copy as…"
      >
        <ChevronDown size={12} />
      </button>
      {open && coords &&
        createPortal(
          <div
            ref={panelRef}
            className="copyas-panel"
            role="menu"
            style={{ position: "fixed", top: coords.top, right: coords.right }}
          >
            {CODEGEN_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                className="copyas-item"
                onClick={() => handlePick(opt.id)}
                role="menuitem"
              >
                <span>{opt.label}</span>
                {justCopied === opt.id ? (
                  <Check size={12} className="copyas-check" />
                ) : (
                  <span className="copyas-ext">.{opt.filenameExt}</span>
                )}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

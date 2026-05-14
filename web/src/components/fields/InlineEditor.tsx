import { useState } from "react";
import { Check, X } from "lucide-react";

interface Props {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}

export function InlineEditor({ initial, onCommit, onCancel }: Props) {
  const [value, setValue] = useState(initial);
  return (
    <div className="field-editor">
      <input
        autoFocus
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit(value);
          else if (e.key === "Escape") onCancel();
        }}
        placeholder="Empty = clear override"
      />
      <button onClick={() => onCommit(value)} title="Save (Enter)" aria-label="Save">
        <Check size={12} />
      </button>
      <button onClick={onCancel} title="Cancel (Esc)" aria-label="Cancel">
        <X size={12} />
      </button>
    </div>
  );
}

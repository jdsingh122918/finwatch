import { useState } from "react";

type Props = { config: string; onSave: (config: string) => void };

export function Settings({ config, onSave }: Props) {
  const [value, setValue] = useState(config);
  return (
    <div>
      <h2 className="text-text-muted text-xs uppercase tracking-widest mb-4">Settings</h2>
      <div className="bg-bg-surface border border-border rounded-sm p-1">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={20}
          className="w-full bg-bg-primary text-text-primary text-xs p-3 rounded-sm border-none outline-none resize-y font-mono"
        />
      </div>
      <button
        onClick={() => onSave(value)}
        className="mt-3 px-3 py-1.5 text-xs border border-border rounded-sm text-accent hover:bg-bg-elevated cursor-pointer bg-transparent font-mono"
      >
        SAVE
      </button>
    </div>
  );
}

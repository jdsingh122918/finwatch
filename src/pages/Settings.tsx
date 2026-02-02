import { useState } from "react";

type Props = { config: string; onSave: (config: string) => void };

export function Settings({ config, onSave }: Props) {
  const [value, setValue] = useState(config);
  return (
    <div>
      <h1>Settings</h1>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={20}
        style={{ width: "100%", fontFamily: "monospace", fontSize: 13 }}
      />
      <button onClick={() => onSave(value)} style={{ marginTop: 8 }}>
        Save
      </button>
    </div>
  );
}

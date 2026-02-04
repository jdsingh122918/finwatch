import { useState } from "react";
import { SymbolChips } from "../components/SymbolChips.js";

type Props = {
  onCredentialsSave: (keyId: string, secretKey: string) => void;
  onConfigSave: (config: { anthropicApiKey: string; openrouterApiKey: string; model: string }) => void;
  onAgentStart: () => void;
  onAgentStop: () => void;
  agentRunning: boolean;
  watchlist: string[];
  pendingChanges: boolean;
  onRemoveSymbol: (symbol: string) => void;
  onNavigateWatchlist: () => void;
  onApplyChanges: () => void;
};

export function Settings({
  onCredentialsSave,
  onConfigSave,
  onAgentStart,
  onAgentStop,
  agentRunning,
  watchlist,
  pendingChanges,
  onRemoveSymbol,
  onNavigateWatchlist,
  onApplyChanges,
}: Props) {
  const [keyId, setKeyId] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [model, setModel] = useState("claude-3-5-haiku-20241022");

  return (
    <div>
      <h2 className="text-text-muted text-xs uppercase tracking-widest mb-6">Settings</h2>

      {/* Alpaca Credentials */}
      <section className="mb-6">
        <h3 className="text-accent text-xs uppercase tracking-widest mb-3">Alpaca Credentials</h3>
        <div className="bg-bg-surface border border-border rounded-sm p-4 space-y-3">
          <div>
            <label htmlFor="alpaca-key" className="block text-text-muted text-xs mb-1">
              API Key
            </label>
            <input
              id="alpaca-key"
              type="text"
              value={keyId}
              onChange={(e) => setKeyId(e.target.value)}
              placeholder="PK..."
              className="w-full bg-bg-primary text-text-primary text-xs p-2 rounded-sm border border-border outline-none font-mono focus:border-accent"
            />
          </div>
          <div>
            <label htmlFor="alpaca-secret" className="block text-text-muted text-xs mb-1">
              API Secret
            </label>
            <input
              id="alpaca-secret"
              type="password"
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-bg-primary text-text-primary text-xs p-2 rounded-sm border border-border outline-none font-mono focus:border-accent"
            />
          </div>
          <button
            onClick={() => onCredentialsSave(keyId, secretKey)}
            className="px-3 py-1.5 text-xs border border-border rounded-sm text-accent hover:bg-bg-elevated cursor-pointer bg-transparent font-mono"
          >
            SAVE CREDENTIALS
          </button>
        </div>
      </section>

      {/* LLM Providers */}
      <section className="mb-6">
        <h3 className="text-accent text-xs uppercase tracking-widest mb-3">LLM Providers</h3>
        <div className="bg-bg-surface border border-border rounded-sm p-4 space-y-3">
          <div>
            <label htmlFor="anthropic-key" className="block text-text-muted text-xs mb-1">
              Anthropic API Key
            </label>
            <input
              id="anthropic-key"
              type="password"
              value={anthropicKey}
              onChange={(e) => setAnthropicKey(e.target.value)}
              placeholder="sk-ant-..."
              className="w-full bg-bg-primary text-text-primary text-xs p-2 rounded-sm border border-border outline-none font-mono focus:border-accent"
            />
          </div>
          <div>
            <label htmlFor="openrouter-key" className="block text-text-muted text-xs mb-1">
              OpenRouter API Key
            </label>
            <input
              id="openrouter-key"
              type="password"
              value={openrouterKey}
              onChange={(e) => setOpenrouterKey(e.target.value)}
              placeholder="sk-or-..."
              className="w-full bg-bg-primary text-text-primary text-xs p-2 rounded-sm border border-border outline-none font-mono focus:border-accent"
            />
          </div>
        </div>
      </section>

      {/* Symbols & Model */}
      <section className="mb-6">
        <h3 className="text-accent text-xs uppercase tracking-widest mb-3">Monitoring</h3>
        <div className="bg-bg-surface border border-border rounded-sm p-4 space-y-3">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-text-muted text-xs">Symbols</label>
              <button
                onClick={onNavigateWatchlist}
                className="text-accent text-xs hover:underline cursor-pointer bg-transparent border-none font-mono"
              >
                Manage Watchlist →
              </button>
            </div>
            <SymbolChips symbols={watchlist} onRemove={onRemoveSymbol} softLimit={20} />
            {pendingChanges && (
              <button
                onClick={onApplyChanges}
                className="mt-2 px-3 py-1 text-xs bg-accent text-bg-primary rounded-sm cursor-pointer border-none font-mono font-bold hover:opacity-90"
              >
                APPLY CHANGES
              </button>
            )}
          </div>
          <div>
            <label htmlFor="model" className="block text-text-muted text-xs mb-1">
              Model
            </label>
            <select
              id="model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full bg-bg-primary text-text-primary text-xs p-2 rounded-sm border border-border outline-none font-mono focus:border-accent"
            >
              <option value="claude-3-5-haiku-20241022">claude-haiku-3.5</option>
              <option value="claude-sonnet-4-5-20241022">claude-sonnet-4.5</option>
              <option value="claude-opus-4-5-20251101">claude-opus-4.5</option>
            </select>
          </div>
          <button
            onClick={() => onConfigSave({ anthropicApiKey: anthropicKey, openrouterApiKey: openrouterKey, model })}
            className="px-3 py-1.5 text-xs border border-border rounded-sm text-accent hover:bg-bg-elevated cursor-pointer bg-transparent font-mono"
          >
            SAVE CONFIG
          </button>
        </div>
      </section>

      {/* Agent Controls */}
      <section className="mb-6">
        <h3 className="text-accent text-xs uppercase tracking-widest mb-3">Agent Controls</h3>
        <div className="bg-bg-surface border border-border rounded-sm p-4 flex gap-3">
          {!agentRunning ? (
            <button
              onClick={onAgentStart}
              className="px-4 py-1.5 text-xs border border-state-running rounded-sm text-state-running hover:bg-bg-elevated cursor-pointer bg-transparent font-mono"
            >
              START AGENT
            </button>
          ) : (
            <button
              onClick={onAgentStop}
              className="px-4 py-1.5 text-xs border border-severity-critical rounded-sm text-severity-critical hover:bg-bg-elevated cursor-pointer bg-transparent font-mono"
            >
              STOP AGENT
            </button>
          )}
          <span className="text-text-muted text-xs self-center">
            Status: {agentRunning ? "RUNNING" : "IDLE"}
          </span>
        </div>
      </section>
    </div>
  );
}

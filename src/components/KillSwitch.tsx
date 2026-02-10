type Props = {
  active: boolean;
  onToggle: () => void;
};

export function KillSwitch({ active, onToggle }: Props) {
  return (
    <button
      onClick={onToggle}
      className={`px-3 py-1 text-xs font-mono font-bold rounded-sm cursor-pointer bg-transparent border ${
        active
          ? "border-severity-critical text-severity-critical"
          : "border-border text-text-muted hover:text-text-primary hover:border-text-muted"
      }`}
    >
      KILL SWITCH
    </button>
  );
}

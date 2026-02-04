type Tab = "Dashboard" | "Anomalies" | "Agent" | "Sources" | "Backtest" | "Settings";

type Props = {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
};

const navItems: { tab: Tab; icon: string }[] = [
  { tab: "Dashboard", icon: "\u25EB" },
  { tab: "Anomalies", icon: "\u26A0" },
  { tab: "Agent", icon: "\u2B21" },
  { tab: "Sources", icon: "\u25C9" },
  { tab: "Backtest", icon: "\u23F1" },
  { tab: "Settings", icon: "\u2699" },
];

export function Sidebar({ activeTab, onTabChange }: Props) {
  return (
    <nav className="fixed left-0 top-0 bottom-7 w-12 bg-bg-primary border-r border-border flex flex-col items-center pt-3 gap-1 z-10">
      {navItems.map(({ tab, icon }) => (
        <button
          key={tab}
          title={tab}
          onClick={() => onTabChange(tab)}
          className={`w-10 h-10 flex items-center justify-center text-lg rounded-sm transition-opacity duration-150 cursor-pointer border-l-2 ${
            activeTab === tab
              ? "text-accent border-accent bg-bg-elevated"
              : "text-text-muted border-transparent hover:text-text-primary hover:bg-bg-elevated"
          }`}
        >
          {icon}
        </button>
      ))}
    </nav>
  );
}

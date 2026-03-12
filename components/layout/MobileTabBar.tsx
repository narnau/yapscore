"use client";

export type MobileTab = "score" | "chat";

type Props = {
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
};

export default function MobileTabBar({ activeTab, onTabChange }: Props) {
  return (
    <div className="flex md:hidden border-b border-gray-200 bg-white shrink-0">
      <button
        onClick={() => onTabChange("score")}
        className={`flex-1 py-2 text-sm font-medium text-center transition ${
          activeTab === "score"
            ? "text-brand-primary border-b-2 border-brand-primary"
            : "text-brand-secondary hover:text-gray-900"
        }`}
      >
        Score
      </button>
      <button
        onClick={() => onTabChange("chat")}
        className={`flex-1 py-2 text-sm font-medium text-center transition ${
          activeTab === "chat"
            ? "text-brand-primary border-b-2 border-brand-primary"
            : "text-brand-secondary hover:text-gray-900"
        }`}
      >
        Chat
      </button>
    </div>
  );
}

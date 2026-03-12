import React from "react";

export default function ToolBtn({
  onClick,
  title,
  danger,
  disabled,
  children,
}: {
  onClick: () => void;
  title?: string;
  danger?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`text-[11px] px-1.5 py-0.5 rounded transition shrink-0 ${
        danger
          ? "bg-red-50 hover:bg-red-100 text-red-600 disabled:opacity-30"
          : "bg-gray-100 hover:bg-gray-200 text-gray-700 disabled:opacity-30"
      }`}
    >
      {children}
    </button>
  );
}

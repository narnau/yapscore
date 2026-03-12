import React from "react";

export default function NoteSymbol({ dur }: { dur: 1 | 2 | 3 | 4 | 5 | 6 | 7 }) {
  const numFlags = [4, 3, 2, 1, 0, 0, 0][dur - 1];
  const filled = dur <= 5;
  const hasStem = dur <= 6;
  return (
    <svg viewBox="0 0 9 16" width="9" height="16" style={{ display: "inline-block", verticalAlign: "middle" }}>
      <ellipse
        cx="3"
        cy="13"
        rx="2.8"
        ry="1.8"
        fill={filled ? "currentColor" : "none"}
        stroke={filled ? "none" : "currentColor"}
        strokeWidth="1.1"
        transform="rotate(-20 3 13)"
      />
      {hasStem && <line x1="5.5" y1="12" x2="5.5" y2="1" stroke="currentColor" strokeWidth="1" />}
      {numFlags >= 1 && <path d="M5.5 1 C8.5 2.5 8 5 6.5 6" stroke="currentColor" strokeWidth="1" fill="none" />}
      {numFlags >= 2 && <path d="M5.5 3.5 C8.5 5 8 7.5 6.5 8.5" stroke="currentColor" strokeWidth="1" fill="none" />}
      {numFlags >= 3 && <path d="M5.5 6 C8.5 7.5 8 10 6.5 11" stroke="currentColor" strokeWidth="1" fill="none" />}
      {numFlags >= 4 && <path d="M5.5 8.5 C8.5 9.5 8 11.5 6.5 12" stroke="currentColor" strokeWidth="1" fill="none" />}
    </svg>
  );
}

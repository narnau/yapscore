type Props = {
  size?: number;
  animated?: boolean;
  className?: string;
};

export default function Logo({ size = 24, animated = false, className }: Props) {
  const h = size * (68 / 52);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 52 68"
      fill="none"
      width={size}
      height={h}
      className={className}
      aria-label="YapScore logo"
    >
      {/* Bubble */}
      <rect x="2" y="2" width="48" height="52" rx="8" fill="currentColor" />
      {/* Tail (bottom-left) */}
      <path d="M32 50 L50 68 L46 50" fill="currentColor" />

      {/* Left prong */}
      <path d="M20 10 L20 30 Q20 38 24 40" stroke="white" strokeWidth="2.5" strokeLinecap="round" fill="none">
        {animated && (
          <animateTransform
            attributeName="transform"
            type="translate"
            values="0,0;-0.5,0;0,0;0.3,0;0,0"
            dur="0.4s"
            begin="0s"
            repeatCount="4"
          />
        )}
      </path>

      {/* Right prong */}
      <path d="M32 10 L32 30 Q32 38 28 40" stroke="white" strokeWidth="2.5" strokeLinecap="round" fill="none">
        {animated && (
          <animateTransform
            attributeName="transform"
            type="translate"
            values="0,0;0.5,0;0,0;-0.3,0;0,0"
            dur="0.4s"
            begin="0s"
            repeatCount="4"
          />
        )}
      </path>

      {/* Handle (longer) */}
      <line x1="26" y1="40" x2="26" y2="51" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

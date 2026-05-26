'use client';

import { motion, useReducedMotion } from 'framer-motion';
import type { ActiveSection } from '@/types';

interface GoldenCircleProps {
  activeSection: ActiveSection;
  onSectionClick: (section: NonNullable<ActiveSection>) => void;
  animate?: boolean;
}

function circlePath(cx: number, cy: number, r: number, cw = true): string {
  const sw = cw ? 1 : 0;
  return `M ${cx + r} ${cy} A ${r} ${r} 0 1 ${sw} ${cx - r} ${cy} A ${r} ${r} 0 1 ${sw} ${cx + r} ${cy} Z`;
}

function annulusPath(cx: number, cy: number, r1: number, r2: number): string {
  return `${circlePath(cx, cy, r2, true)} ${circlePath(cx, cy, r1, false)}`;
}

const ringVariants = {
  hidden: { opacity: 0, scale: 0.6 },
  visible: (delay: number) => ({
    opacity: 1,
    scale: 1,
    transition: { duration: 0.9, delay, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
  }),
};

export default function GoldenCircle({
  activeSection,
  onSectionClick,
  animate = false,
}: GoldenCircleProps) {
  const reduceMotion = useReducedMotion();
  const shouldAnimate = animate && !reduceMotion;
  const cx = 160, cy = 160;
  const WHY_R = 52;
  const HOW_R = 100;
  const WHAT_R = 148;

  const getFill = (section: NonNullable<ActiveSection>, baseOpacity: number) => {
    if (activeSection === null) return `rgba(245,158,11,${baseOpacity})`;
    if (activeSection === section) return `rgba(245,158,11,${Math.min(baseOpacity + 0.3, 1)})`;
    return `rgba(245,158,11,${baseOpacity * 0.35})`;
  };

  const getFilter = (section: NonNullable<ActiveSection>, glowStrength: number) => {
    if (activeSection === section || (activeSection === null && section === 'why')) {
      return `drop-shadow(0 0 ${glowStrength}px rgba(245,158,11,0.7))`;
    }
    return 'none';
  };

  const sharedMotionProps = (section: NonNullable<ActiveSection>, delay: number) => ({
    variants: shouldAnimate ? ringVariants : undefined,
    initial: shouldAnimate ? ('hidden' as const) : undefined,
    animate: shouldAnimate ? ('visible' as const) : undefined,
    custom: delay,
    onClick: () => onSectionClick(section),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSectionClick(section);
      }
    },
    tabIndex: 0,
    role: 'button' as const,
    className: 'gc-ring',
    'aria-label': `${section.toUpperCase()} section`,
    'aria-pressed': activeSection === section,
  });

  return (
    <svg width="320" height="320" viewBox="0 0 320 320" className="w-full max-w-[320px]" role="img" aria-label="Golden Circle diagram with WHY, HOW, and WHAT rings">
      {/* WHAT ring */}
      <motion.path
        d={annulusPath(cx, cy, HOW_R, WHAT_R)}
        fillRule="evenodd"
        fill={getFill('what', 0.15)}
        stroke="rgba(245,158,11,0.35)"
        strokeWidth="0.5"
        style={{
          transformOrigin: `${cx}px ${cy}px`,
          cursor: 'pointer',
          filter: getFilter('what', 8),
        }}
        {...sharedMotionProps('what', 0.8)}
        whileHover={{ filter: 'drop-shadow(0 0 10px rgba(245,158,11,0.5))' }}
        transition={{ type: 'tween', duration: 0.2 }}
      />

      {/* HOW ring */}
      <motion.path
        d={annulusPath(cx, cy, WHY_R, HOW_R)}
        fillRule="evenodd"
        fill={getFill('how', 0.35)}
        stroke="rgba(245,158,11,0.5)"
        strokeWidth="0.5"
        style={{
          transformOrigin: `${cx}px ${cy}px`,
          cursor: 'pointer',
          filter: getFilter('how', 10),
        }}
        {...sharedMotionProps('how', 0.4)}
        whileHover={{ filter: 'drop-shadow(0 0 12px rgba(245,158,11,0.6))' }}
        transition={{ type: 'tween', duration: 0.2 }}
      />

      {/* WHY circle */}
      <motion.circle
        cx={cx}
        cy={cy}
        r={WHY_R}
        fill={getFill('why', 0.8)}
        stroke="rgba(245,158,11,0.8)"
        strokeWidth="0.5"
        style={{
          transformOrigin: `${cx}px ${cy}px`,
          cursor: 'pointer',
          filter: getFilter('why', 14),
        }}
        {...sharedMotionProps('why', 0)}
        whileHover={{ filter: 'drop-shadow(0 0 18px rgba(245,158,11,0.9))' }}
        transition={{ type: 'tween', duration: 0.2 }}
      />

      {/* WHY label in center */}
      <text
        x={cx}
        y={cy + 5}
        textAnchor="middle"
        fontSize="14"
        fontWeight="700"
        fill="#04091a"
        letterSpacing="2"
        style={{ userSelect: 'none', pointerEvents: 'none' }}
      >
        WHY
      </text>

      {/* HOW label — middle of HOW ring at top (midpoint r=76 → y=160-76=84) */}
      <text
        x={cx}
        y={cy - 71}
        textAnchor="middle"
        fontSize="10"
        fontWeight="600"
        fill="rgba(245,158,11,0.85)"
        letterSpacing="1.5"
        style={{ userSelect: 'none', pointerEvents: 'none' }}
      >
        HOW
      </text>

      {/* WHAT label — middle of WHAT ring at top (midpoint r=124 → y=160-124=36) */}
      <text
        x={cx}
        y={cy - 119}
        textAnchor="middle"
        fontSize="10"
        fontWeight="600"
        fill="rgba(245,158,11,0.6)"
        letterSpacing="1.5"
        style={{ userSelect: 'none', pointerEvents: 'none' }}
      >
        WHAT
      </text>
    </svg>
  );
}

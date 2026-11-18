import { motion } from 'motion/react';
import type { ReactNode } from 'react';

interface SectionRevealProps {
  children: ReactNode;
  className?: string;
  delay?: number;
}

/** The page's shared entrance: a small lift and fade, staggered by section. */
export function SectionReveal({ children, className, delay = 0 }: SectionRevealProps) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay }}
    >
      {children}
    </motion.div>
  );
}

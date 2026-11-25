import { motion, useReducedMotion, type HTMLMotionProps } from 'motion/react';
import { staggerDelay } from '@/lib/motion';

// EnterItem is a row of a list that arrives with a short rise in a capped
// cascade (staggerDelay: DESIGN §6) and, inside an AnimatePresence, leaves
// with a quick fade. With `layout` the rows after it close the gap by
// moving (transform), not by animating height. It animates on mount only,
// so a refetch that keeps the row keeps it still. With reduced motion a row
// simply appears and goes: no cascade, fade or move.
type Props = { index: number; layout?: boolean } & (
  ({ as?: 'li' } & HTMLMotionProps<'li'>) | ({ as: 'div' } & HTMLMotionProps<'div'>)
);

const motionProps = (index: number, layout?: boolean, reduce?: boolean | null) =>
  reduce
    ? {}
    : {
        initial: { opacity: 0, y: 6 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, scale: 0.98, transition: { duration: 0.18, ease: 'easeIn' as const } },
        transition: {
          duration: 0.25,
          ease: 'easeOut' as const,
          delay: staggerDelay(index),
          layout: { duration: 0.25, ease: 'easeOut' as const }
        },
        layout: layout ? ('position' as const) : undefined
      };

export function EnterItem({ index, layout, ...props }: Props) {
  const reduce = useReducedMotion();
  if (props.as === 'div') {
    const { as: _, ...rest } = props;
    return <motion.div {...motionProps(index, layout, reduce)} {...rest} />;
  }
  const { as: _, ...rest } = props;
  return <motion.li {...motionProps(index, layout, reduce)} {...rest} />;
}

import React from 'react';
import { motion } from 'framer-motion'; // eslint-disable-line no-unused-vars

// Wrap a conditionally-rendered overlay (inside an <AnimatePresence>) so it
// fades out when unmounted instead of vanishing. Entrance animation stays
// CSS-driven — initial={false} keeps this wrapper exit-only.
export default function FadeOut({ children }) {
  return (
    <motion.div initial={false} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
      {children}
    </motion.div>
  );
}

import { motion } from "motion/react"
import { cn } from "../utils/cn"

interface MorphingSquareProps {
  className?: string
}

export function MorphingSquare({ className }: MorphingSquareProps) {
  return (
    <motion.div
      className={cn("w-16 h-16 bg-blue-500", className)}
      animate={{
        borderRadius: ["6%", "50%", "6%"],
        rotate: [0, 180, 360],
      }}
      transition={{
        duration: 2,
        repeat: Number.POSITIVE_INFINITY,
        ease: "easeInOut",
      }}
    />
  )
}

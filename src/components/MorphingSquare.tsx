import { cn } from "../utils/cn"

interface MorphingSquareProps {
  className?: string
}

export function MorphingSquare({ className }: MorphingSquareProps) {
  return <div className={cn("morph-loader", className)} aria-hidden="true" />
}

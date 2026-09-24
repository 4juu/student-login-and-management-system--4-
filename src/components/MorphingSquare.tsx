import { cn } from "../lib/utils"

export type MorphingSquareSize = 'xs' | 'sm' | 'md' | 'lg'

interface MorphingSquareProps {
  className?: string
  size?: MorphingSquareSize
}

export function MorphingSquare({ className, size = 'lg' }: MorphingSquareProps) {
  return (
    <div
      className={cn('morph-loader', size !== 'lg' && `morph-loader-${size}`, className)}
      role="status"
      aria-label="جارٍ التحميل"
    />
  )
}

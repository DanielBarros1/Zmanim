/**
 * Spinner — loading indicator.
 * Size: sm (16px) | md (24px) | lg (40px)
 */

type Size = 'sm' | 'md' | 'lg'

const sizes: Record<Size, string> = {
  sm: 'w-4 h-4 border-2',
  md: 'w-6 h-6 border-2',
  lg: 'w-10 h-10 border-[3px]',
}

export function Spinner({ size = 'md' }: { size?: Size }) {
  return (
    <span
      className={[
        'inline-block rounded-full border-[var(--accent)] border-t-transparent animate-spin',
        sizes[size],
      ].join(' ')}
      aria-label="Loading"
    />
  )
}

export function CenteredSpinner() {
  return (
    <div className="flex items-center justify-center w-full h-full min-h-[200px]">
      <Spinner size="lg" />
    </div>
  )
}

import { Glyph, icons } from "./icons.tsx"

/** Every icon a flow can use, as a grid of tiles. */
export function IconPicker({ value, color, onChange, label }: { value: string; color: string; onChange: (name: string) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-[repeat(auto-fill,minmax(40px,1fr))] gap-1.5">
      {icons.map((i) => (
        <button
          key={i.name}
          type="button"
          role="radio"
          aria-checked={value === i.name}
          aria-label={i.label}
          title={i.label}
          onClick={() => onChange(i.name)}
          className="grid aspect-square place-items-center rounded-control border border-line bg-field transition-colors hover:border-white/20 hover:bg-raised aria-checked:border-white/50 aria-checked:bg-hover"
        >
          <Glyph name={i.name} color={value === i.name ? color : "var(--color-muted)"} size={18} />
        </button>
      ))}
    </div>
  )
}

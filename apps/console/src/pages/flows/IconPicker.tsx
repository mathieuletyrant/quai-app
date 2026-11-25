import { Glyph, icons } from "./icons.tsx"

/** Every icon a flow can use, as a grid of tiles. */
export function IconPicker(
  { value, color, onChange, label }: { value: string; color: string; onChange: (name: string) => void; label: string }
) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-[repeat(auto-fill,minmax(40px,1fr))] gap-1.5">
      {icons.map((icon) => (
        <button
          key={icon.name}
          type="button"
          role="radio"
          aria-checked={value === icon.name}
          aria-label={icon.label}
          title={icon.label}
          onClick={() => onChange(icon.name)}
          className="grid aspect-square place-items-center rounded-control border border-line bg-field transition-colors hover:border-white/20 hover:bg-raised aria-checked:border-white/50 aria-checked:bg-hover"
        >
          <Glyph name={icon.name} color={value === icon.name ? color : "var(--color-muted)"} size={18} />
        </button>
      ))}
    </div>
  )
}

import { Glyph, icons } from "./icons.tsx"

/** Every icon a flow can use, as a grid of tiles. */
export function IconPicker({ value, color, onChange, label }: { value: string; color: string; onChange: (name: string) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-1.5">
      {icons.map((i) => (
        <button
          key={i.name}
          type="button"
          role="radio"
          aria-checked={value === i.name}
          aria-label={i.label}
          title={i.label}
          onClick={() => onChange(i.name)}
          className="grid aspect-square place-items-center rounded-xl border border-transparent bg-field transition hover:border-white/20 aria-checked:border-white/60 aria-checked:bg-raised"
        >
          <Glyph name={i.name} color={value === i.name ? color : "#a1a1a6"} size={18} />
        </button>
      ))}
    </div>
  )
}

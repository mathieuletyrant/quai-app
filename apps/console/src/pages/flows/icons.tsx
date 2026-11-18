/**
 * The SF Symbols a flow can use, with a web stand-in for the console's preview (the iPhone draws
 * the real symbol).
 */
export const icons: ReadonlyArray<{ readonly name: string; readonly label: string; readonly path: string }> = [
  { name: "arrow.down", label: "Download", path: "M12 4v12m0 0l-5-5m5 5l5-5" },
  { name: "magnifyingglass", label: "Search", path: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5L20 20" },
  { name: "tray.and.arrow.down.fill", label: "Import", path: "M12 3v9m0 0l-4-4m4 4l4-4M4 14h4l1.5 3h5L16 14h4v6H4z" },
  { name: "checkmark", label: "Done", path: "M5 12.5l4.5 4.5L19 7" },
  { name: "play.fill", label: "Play", path: "M7 5l12 7-12 7z" },
  { name: "pause.fill", label: "Pause", path: "M7 5h3v14H7zM14 5h3v14h-3z" },
  { name: "stop.fill", label: "Stop", path: "M6 6h12v12H6z" },
  { name: "exclamationmark.triangle.fill", label: "Alert", path: "M12 4l9 16H3zM12 10v4M12 17v.5" },
  { name: "captions.bubble.fill", label: "Subtitles", path: "M4 5h16v11H9l-4 4v-4H4zM8 10h3M13 10h3M8 13h8" },
  { name: "film", label: "Movie", path: "M4 4h16v16H4zM8 4v16M16 4v16M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4" },
  { name: "tv", label: "TV", path: "M3 6h18v11H3zM8 21h8" },
  { name: "sparkles", label: "Sparkles", path: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" },
  { name: "bell.fill", label: "Bell", path: "M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0" },
  { name: "clock.fill", label: "Clock", path: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2" },
  { name: "star.fill", label: "Star", path: "M12 3l2.8 5.8 6.2.9-4.5 4.4 1 6.2L12 17.4 6.5 20.3l1-6.2L3 9.7l6.2-.9z" },
  { name: "server.rack", label: "Server", path: "M4 4h16v6H4zM4 14h16v6H4zM7 7h.01M7 17h.01" }
]

export function Glyph({ name, color, size = 18 }: { name: string; color: string; size?: number }) {
  const icon = icons.find((i) => i.name === name) ?? icons[0]!
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={icon.path} />
    </svg>
  )
}

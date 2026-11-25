import { Schema } from "effect"

/** What a title is: a movie (Radarr's) or a series (Sonarr's). */
export const TitleKind = Schema.Literals(["movie", "series"]).annotate({ identifier: "TitleKind" })
export type TitleKind = typeof TitleKind.Type

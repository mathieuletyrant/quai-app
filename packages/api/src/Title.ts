import { Schema } from "effect"

/**
 * What a title is: a movie (Radarr's) or a series (Sonarr's). The one literal behind each schema
 * that names it; each keeps its own identifier, so the contract and the iOS types stay as they are.
 */
export const TitleKind = Schema.Literals(["movie", "series"])
export type TitleKind = typeof TitleKind.Type

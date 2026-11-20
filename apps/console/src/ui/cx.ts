/** Joins the class names that apply. */
export const cx = (...classes: ReadonlyArray<string | false | null | undefined>) => classes.filter(Boolean).join(" ")

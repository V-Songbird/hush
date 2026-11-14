export type FoldState = {
  /** First words of the folded text that draws the line. */
  head: string
  /** First words of the reply's final message, which never folds. */
  final: string
  /** First words of each folded text, the head first. */
  texts: string[]
  errors: number
  warnings: number
}

export type FoldsState = {
  /** Each finished reply's fold, oldest first. */
  folds: FoldState[]
  /** First words of the texts no fold hides: each final, and every text of a reply that made no fold. */
  loose: string[]
}

declare module 'claude-code' {
  interface PluginState {
    hush: {
      /** The session's folds and the texts they must not take. */
      folds: Shaped<FoldsState>
      /** The heads of the folds the person opened. */
      open: Shaped<string[]>
    }
  }
}

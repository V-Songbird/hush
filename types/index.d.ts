export type FoldState = {
  /** First words of the folded text that draws the line. */
  head: string
  /** First words of the reply's final message, which never folds. */
  final: string
  /** First words of each folded text, the head first; each appears once in its reply. */
  texts: string[]
  /** The folded texts that name a failure or a blocker. */
  risky: string[]
  errors: number
}

export type FoldsState = {
  /** Each finished reply's fold, oldest first. */
  folds: FoldState[]
  /**
   * First words of the texts no fold may take, as a fixed-size bit set (`fold.ts`): each final,
   * every text of a reply that made no fold, a subagent's texts and the texts of dropped folds.
   */
  loose: string
}

export type LiveState = {
  /** The reply still being written: every text but the newest, or null. */
  fold: FoldState | null
  /** The fold of the reply it continues, which `fold` replaces while it is drawn. */
  old: FoldState | null
}

declare module 'claude-code' {
  interface PluginState {
    hush: {
      /** The session's folds and the texts they must not take. */
      folds: Shaped<FoldsState>
      /** The fold of the reply being written, kept only in this session's state. */
      live: Shaped<LiveState>
      /** The heads of the folds the person opened. */
      open: Shaped<string[]>
    }
  }
}

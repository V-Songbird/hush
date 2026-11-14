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

declare module 'claude-code' {
  interface PluginState {
    hush: {
      /** The session's folds and the texts they must not take. */
      folds: Shaped<FoldsState>
      /** The heads of the folds the person opened. */
      open: Shaped<string[]>
      /**
       * The settings key (`lint.ts` settingsKey) the model was sent at the session's start or
       * its last compaction, which the silent check counts under; `''` when it could not be read.
       */
      inForce: string
    }
  }
}

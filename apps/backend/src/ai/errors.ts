export class AIError extends Error {}

/** 画面からのキャンセルで止めた。ほかの AI の失敗と分けて扱う */
export class CancelledError extends AIError {
  constructor() {
    super("AI の生成をキャンセルしました");
  }
}

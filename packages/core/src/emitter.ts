/** Tiny typed event emitter that works on every platform. */
export class Emitter<E extends Record<string, unknown[]>> {
  private handlers: { [K in keyof E]?: Set<(...args: E[K]) => void> } = {};

  on<K extends keyof E>(event: K, fn: (...args: E[K]) => void): () => void {
    (this.handlers[event] ??= new Set()).add(fn);
    return () => this.handlers[event]?.delete(fn);
  }

  protected emit<K extends keyof E>(event: K, ...args: E[K]): void {
    this.handlers[event]?.forEach((fn) => {
      try {
        fn(...args);
      } catch (e) {
        console.error(e);
      }
    });
  }
}

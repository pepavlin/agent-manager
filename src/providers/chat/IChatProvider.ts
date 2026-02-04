/**
 * Interface for chat/completion providers.
 * All providers must implement this interface to be interchangeable.
 */
export interface IChatProvider {
  /**
   * Generate a JSON response from the model.
   * @param input - System and user prompts
   * @returns Raw string output (should be valid JSON)
   */
  generateJSON(input: { system: string; user: string }): Promise<string>;

  /**
   * Provider name for logging/debugging
   */
  readonly name: string;
}

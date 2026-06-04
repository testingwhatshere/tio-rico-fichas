/**
 * DTO for selector health check reports from the Chrome Extension.
 */
export class SelectorCheckDto {
  /** Total selectors checked */
  total: number;

  /** Selectors that matched at least one element */
  matched: number;

  /** Selectors that failed to match */
  failed: string[];

  /** Timestamp of the check */
  checkedAt: string;
}

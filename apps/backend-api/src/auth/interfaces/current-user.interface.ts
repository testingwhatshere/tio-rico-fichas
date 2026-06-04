/**
 * Current User Interface
 *
 * This interface defines the structure of the user object
 * returned by the JWT strategy and available via @CurrentUser() decorator.
 *
 * IMPORTANT: All controllers must use this type for consistency.
 *
 * Fields:
 * - sub: User ID (JWT standard field name)
 * - id: User ID (duplicate for convenience, same as sub)
 * - email: Email (for OPERATOR/ADMIN users)
 * - username: Username (for CLIENT users)
 * - role: User role (CLIENT, OPERATOR, SENIOR_OPERATOR, ADMIN)
 */
export interface CurrentUserPayload {
  sub: string; // User ID (JWT standard)
  id: string; // User ID (duplicate)
  email?: string; // For OPERATOR/ADMIN
  username?: string; // For CLIENT
  role: string;
}

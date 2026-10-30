/**
 * The CellMate server this app uses. People never type it: they sign in with company code, ID and password.
 * If the server's domain ever changes, installed apps follow it automatically (the server announces its new
 * address); only new installs need an app update with the new address here.
 */
export const DEFAULT_SERVER = 'https://chat.gosite.lol';

/** Privacy policy and terms of use (also linked from the App Store listing). */
export const LEGAL_BASE = DEFAULT_SERVER;

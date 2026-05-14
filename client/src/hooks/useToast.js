/**
 * Re-export the toast hook from the UI library so callers under hooks/ can
 * import it without reaching into ui/. Matches the project structure spec.
 */
export { useToast } from '../components/ui/Toast.jsx';

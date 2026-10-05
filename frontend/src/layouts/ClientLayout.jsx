import AppShell from './AppShell.jsx';
import { NAVIGATION } from '../permissions/navigation.js';

export default function ClientLayout() { return <AppShell nav={NAVIGATION.client} brandNote="Business workspace" />; }

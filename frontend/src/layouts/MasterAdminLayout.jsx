import AppShell from './AppShell.jsx';
import { NAVIGATION } from '../permissions/navigation.js';

export default function MasterAdminLayout() { return <AppShell nav={NAVIGATION.master} brandNote="Master console" />; }

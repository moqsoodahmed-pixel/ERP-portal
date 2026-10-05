import AppShell from './AppShell.jsx';
import { NAVIGATION } from '../permissions/navigation.js';

export default function VendorLayout() { return <AppShell nav={NAVIGATION.vendor} brandNote="GST filing desk" />; }

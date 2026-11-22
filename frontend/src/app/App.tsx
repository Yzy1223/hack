import { useState } from 'react';
import { WorkspaceProvider, useWorkspace } from './WorkspaceContext';
import { AgentChat } from '../pages/agent/AgentChat';
import { Shell } from './Shell';
import { DashboardPage } from '../pages/dashboard/DashboardPage';
import { InquiriesPage } from '../pages/inquiries/InquiriesPage';
import { FacebookPage } from '../pages/facebook/FacebookPage';
import { ConnectionDialog } from '../pages/inquiries/ConnectionDialog';
import type { View } from '../../../shared/contracts';

function Workbench() {
  const [view, setView] = useState<View>('dashboard'),
    [selected, setSelected] = useState<string | null>(null),
    [connect, setConnect] = useState(false);
  const { toast, demo } = useWorkspace();
  const openInquiry = (id: string) => {
    setSelected(id);
    setView('inquiries');
  };
  return (
    <Shell view={view} navigate={setView} onConnect={() => setConnect(true)}>
      <div key={view + '-' + demo} className="page-enter">
        {view === 'dashboard' && (
          <DashboardPage openInquiry={openInquiry} openFacebook={() => setView('facebook')} />
        )}
        {view === 'inquiries' && (
          <InquiriesPage initialSelected={selected} onConnect={() => setConnect(true)} />
        )}
        {view === 'facebook' && <FacebookPage />}
        {view === 'agent' && <AgentChat />}
      </div>
      {connect && <ConnectionDialog onClose={() => setConnect(false)} />}
      <div className={'toast ' + (toast ? 'visible' : '')} role="status" aria-live="polite">
        {toast}
      </div>
    </Shell>
  );
}
export function App() {
  return (
    <WorkspaceProvider>
      <Workbench />
    </WorkspaceProvider>
  );
}

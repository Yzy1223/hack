import { Inbox, X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import type { Priority } from '../../../shared/contracts';
export function Badge({ priority }: { priority: Priority }) {
  return (
    <span className={'badge ' + priority}>
      {{ urgent: '紧急', followup: '待跟进', low: '低优先' }[priority]}
    </span>
  );
}
export function EmptyState({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <Inbox size={32} strokeWidth={1.3} />
      <p>{title}</p>
      {action}
    </div>
  );
}
export function Modal({
  title,
  onClose,
  children,
  drawer = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  drawer?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={drawer ? 'modal comment-drawer' : 'modal'}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-content">
        <header>
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
export function StatusDot({ online = false }: { online?: boolean }) {
  return <span className={'status-dot ' + (online ? 'online' : '')} />;
}

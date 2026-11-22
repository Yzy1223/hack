import { Modal } from '../../components/Primitives';
import type { CatalogItem } from '../../../../shared/contracts';
export function CatalogDialog({ item, onClose }: { item: CatalogItem; onClose: () => void }) {
  return (
    <Modal title={'型号 ' + item.model} onClose={onClose}>
      <div className="catalog-detail">
        <span className="connection-label">{item.reviewed ? '已人工校验' : '特征待人工校验'}</span>
        <p>{item.summary}</p>
      </div>
    </Modal>
  );
}

import { useEffect, useState } from 'react';
import { api } from '../utils/api';
import AlertBadge from './AlertBadge';

function parseOwnershipChain(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export default function LandTab({ customerId }) {
  const [record, setRecord] = useState(null);

  useEffect(() => {
    if (!customerId) return;
    api.get(`/api/customers/${customerId}/land-record`)
      .then((data) => setRecord(data.record || null))
      .catch(() => setRecord(null));
  }, [customerId]);

  const ownershipChain = parseOwnershipChain(record?.ownership_chain_json);
  const issues = Array.isArray(record?.issues) ? record.issues : [];

  return (
    <div className="flex-col gap-4 w-full">
      <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1fr' }}>

        {/* Record Details */}
        <div className="panel flex-col gap-3">
          <div className="font-bold text-sm uppercase tracking-wide text-secondary mb-2">Land Record Details</div>
          {record ? (
            <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div><p className="text-xs text-secondary">Survey No.</p><strong className="text-sm">{record.survey_number}</strong></div>
              <div><p className="text-xs text-secondary">Owner</p><strong className="text-sm">{record.registered_owner}</strong></div>
              <div><p className="text-xs text-secondary">Area</p><strong className="text-sm">{record.total_area} {record.area_unit}</strong></div>
              <div><p className="text-xs text-secondary">Encumbrance</p><strong className="text-sm">{record.has_encumbrance ? 'Yes' : 'No'}</strong></div>
            </div>
          ) : <p className="text-sm text-secondary">No land data linked to this applicant.</p>}
        </div>

        {/* Discrepancy Highlights */}
        <div className="panel flex-col gap-3">
          <div className="font-bold text-sm uppercase tracking-wide text-secondary mb-2">Discrepancy Highlights</div>
          {record ? (
            <div className="flex-col gap-2">
              {issues.length > 0 ? (
                issues.map((issue, index) => (
                  <div className="flex items-center gap-3 p-2 border border-subtle rounded-md" key={index}>
                    <AlertBadge severity={issue.severity || 'medium'}>{issue.type || 'discrepancy'}</AlertBadge>
                    <p className="text-sm">{issue.message || issue}</p>
                  </div>
                ))
              ) : (
                <div className="flex items-center gap-3 p-2 border border-subtle rounded-md">
                  <AlertBadge severity="low">clear</AlertBadge>
                  <p className="text-sm">No survey discrepancies detected.</p>
                </div>
              )}
            </div>
          ) : <p className="text-sm text-secondary">Awaiting record load.</p>}
        </div>
      </div>

      {/* Ownership Chain */}
      <div className="panel">
        <div className="font-bold text-sm uppercase tracking-wide text-secondary mb-4">Ownership Chain</div>
        <div className="flex-col gap-2">
          {ownershipChain.length ? ownershipChain.map((node, index) => (
            <div key={`${node.owner}-${index}`} className="flex justify-between items-center py-2 border-b border-subtle">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-xs text-secondary tabular-nums shrink-0">#{index + 1}</span>
                <strong className="text-sm truncate">{node.owner || 'Unknown'}</strong>
                {node.deed_number && (
                  <code className="text-xs text-tertiary truncate">{node.deed_number}</code>
                )}
              </div>
              <span className="text-xs text-secondary shrink-0">
                {node.from && node.to
                  ? `${node.from} → ${node.to}`
                  : node.from
                  ? `from ${node.from}`
                  : node.to
                  ? `until ${node.to}`
                  : 'Current owner'}
              </span>
            </div>
          )) : <p className="text-sm text-secondary">No ownership chain data available.</p>}
        </div>
      </div>
    </div>
  );
}
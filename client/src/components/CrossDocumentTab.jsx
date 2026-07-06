import { useEffect, useState } from 'react';
import { api } from '../utils/api';
import AlertBadge from './AlertBadge';
import { ShieldCheck, AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * CrossDocumentTab
 * ----------------
 * Surfaces inconsistencies that only become visible when documents are
 * reviewed together: PAN/Aadhaar mismatches across docs, customer-record
 * field mismatches, salary-slip-vs-ITR income contradictions, and
 * survey-number inconsistencies across property docs.
 *
 * Calls POST /api/verify/cross-document on mount and whenever the
 * customer changes.
 */
export default function CrossDocumentTab({ customerId }) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function runAnalysis() {
    if (!customerId) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.post('/api/verify/cross-document', { customerId });
      setResult(res.result || null);
    } catch (err) {
      setError(err.message || 'Cross-document analysis failed.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    runAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  const findings = result?.findings || [];
  const summary = result?.summary || {};
  const status = result?.status || 'pending';

  return (
    <div className="flex-col gap-4 w-full">
      {/* Summary banner */}
      <div className="panel flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          {status === 'pass' ? (
            <ShieldCheck size={24} className="text-success" />
          ) : (
            <AlertTriangle size={24} className={status === 'fail' ? 'text-danger' : 'text-warning'} />
          )}
          <div>
            <h3 className="font-bold text-base">
              {loading ? 'Analyzing documents…' : status === 'pass'
                ? 'No cross-document inconsistencies detected'
                : `${findings.length} cross-document finding${findings.length === 1 ? '' : 's'}`}
            </h3>
            <p className="text-xs text-secondary">
              {summary.documentsAnalyzed || 0} document(s) analyzed
              {summary.criticalCount ? ` • ${summary.criticalCount} critical` : ''}
              {summary.highCount ? ` • ${summary.highCount} high` : ''}
            </p>
          </div>
        </div>
        <button
          className="btn-secondary text-sm flex items-center gap-2"
          onClick={runAnalysis}
          disabled={loading}
          title="Re-run cross-document analysis"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Re-run
        </button>
      </div>

      {error && (
        <div className="panel" style={{ borderLeft: '3px solid var(--color-danger)' }}>
          <p className="text-sm text-danger">{error}</p>
        </div>
      )}

      {/* Findings list */}
      {loading ? (
        <div className="panel p-8 text-center text-secondary text-sm">
          Correlating extracted fields across documents…
        </div>
      ) : findings.length ? (
        <div className="flex-col gap-3">
          {findings.map((finding, index) => (
            <div
              key={`${finding.code}-${index}`}
              className="panel"
              style={{ borderLeft: `3px solid var(--color-${finding.severity === 'critical' ? 'danger' : finding.severity === 'high' ? 'warning' : 'border-strong'})` }}
            >
              <div className="flex items-center gap-3 mb-2">
                <AlertBadge severity={finding.severity}>{finding.severity}</AlertBadge>
                <code className="text-xs text-secondary">{finding.code}</code>
              </div>
              <p className="text-sm text-primary mb-2">{finding.message}</p>
              {finding.evidence && (
                <details className="text-xs text-secondary">
                  <summary className="cursor-pointer hover:text-primary">Evidence</summary>
                  <pre className="mt-2 p-2 rounded bg-muted overflow-x-auto">{JSON.stringify(finding.evidence, null, 2)}</pre>
                </details>
              )}
            </div>
          ))}
        </div>
      ) : (
        !error && (
          <div className="panel p-6 text-center text-secondary text-sm">
            All extracted fields are consistent across documents. No coordinated multi-document fraud pattern detected.
          </div>
        )
      )}

      {/* Entity graph summary (text-only for now; visualize in future iteration) */}
      {result?.entityGraph && result.entityGraph.nodes.length > 0 && (
        <div className="panel">
          <h3 className="font-bold text-sm mb-3">Entity graph</h3>
          <p className="text-xs text-secondary mb-3">
            Documents and the entities (PAN, Aadhaar) they reference. Multiple documents pointing to the same entity node
            should agree on the value — any disagreement shows up as a finding above.
          </p>
          <div className="flex-col gap-2">
            {result.entityGraph.nodes.map((node) => (
              <div key={node.id} className="flex items-center gap-3 py-1.5 border-b border-subtle text-sm">
                <AlertBadge severity={
                  node.type === 'customer' ? 'medium'
                  : node.type === 'document' ? 'low'
                  : 'low'
                }>{node.type}</AlertBadge>
                <span className="font-bold">{node.label}</span>
                {node.name && <span className="text-xs text-secondary">({node.name})</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

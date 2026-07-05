import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileSearch, Eye, ShieldAlert, CheckCircle } from 'lucide-react';
import { api } from '../utils/api';

export default function UploadVerify() {
  const navigate = useNavigate();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/documents')
      .then((data) => {
        setDocuments(data.documents || []);
      })
      .catch(() => null)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="page-stack">
      <section className="hero-panel text-center-balance">
        <div>
          <p className="eyebrow">Document Pipeline Entrypoint</p>
          <h1>Verification Queue Registry</h1>
          <p>
            The underlying optical extraction engine handles multi-format classification and ingestion profiles natively inside the secure workbench.
          </p>
        </div>
        <button 
          className="primary-button hero-cta-btn" 
          type="button" 
          onClick={() => navigate('/results')}
        >
          <FileSearch size={18} />
          Launch Verification Workbench
        </button>
      </section>

      <section className="panel">
        <div className="panel-title">Recent Ingestion Queue Audit</div>
        {loading ? (
          <p className="muted">Synchronizing system logs...</p>
        ) : documents.length > 0 ? (
          <div className="table-responsive-wrapper">
            <table className="compact-table alternate-rows">
              <thead>
                <tr>
                  <th>Document Handle</th>
                  <th>Customer Profile</th>
                  <th>Ingestion Class</th>
                  <th>System Status</th>
                  <th>Anomalies</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {documents.slice(0, 10).map((doc) => {
                  const status = doc.verification?.status || doc.status || 'pending';
                  const hasFindings = status === 'flagged' || status === 'rejected';

                  return (
                    <tr key={doc.id}>
                      <td><strong>{doc.original_name}</strong></td>
                      <td>{doc.customer_name || 'System Link'}</td>
                      <td><code className="text-lowercase">{doc.doc_type}</code></td>
                      <td>
                        <span className={`status-pill pill-${status}`}>
                          {status}
                        </span>
                      </td>
                      <td>
                        {hasFindings ? (
                          <span className="text-danger-flex"><ShieldAlert size={14} /> Flagged</span>
                        ) : (
                          <span className="text-success-flex"><CheckCircle size={14} /> Clear</span>
                        )}
                      </td>
                      <td>
                        <button
                          className="icon-button text-accent"
                          type="button"
                          title="Open in workbench"
                          onClick={() => navigate(`/results/${doc.id}`)}
                        >
                          <Eye size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No historical document records detected in the persistent data layer.</p>
        )}
      </section>
    </div>
  );
}
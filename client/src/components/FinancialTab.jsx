import { useEffect, useState, useMemo } from 'react';
import { api } from '../utils/api';
import BenfordChart from './BenfordChart'
import AlertBadge from './AlertBadge'

function benfordDistribution(records = []) {
  const expected = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => Math.log10(1 + 1 / digit));
  const actualCounts = Array(9).fill(0);
  let total = 0;
  records.forEach((record) => {
    const digit = String(Math.abs(Number(record.amount) || 0)).replace(/[^0-9]/g, '').replace(/^0+/, '')[0];
    if (digit) {
      actualCounts[Number(digit) - 1] += 1;
      total += 1;
    }
  });
  return actualCounts.map((count, index) => ({ 
    digit: String(index + 1), 
    actual: total ? +(count / total).toFixed(2) : 0, 
    expected: +expected[index].toFixed(2) 
  }));
}

export default function FinancialTab({ customerId }) {
  const [records, setRecords] = useState([]);

  useEffect(() => {
    if (!customerId) return;
    api.get(`/api/customers/${customerId}/financial-records`)
      .then((data) => setRecords(data.records || []))
      .catch(() => setRecords([]));
  }, [customerId]);

  const benford = useMemo(() => benfordDistribution(records), [records]);
  const suspicious = records.filter((record) => Number(record.amount) > 0 && Number(record.amount) < 1000);

  return (
    <div className="flex-col gap-4 w-full">
      {/* Transaction Timeline & Salami Detection */}
      <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="panel p-0 overflow-hidden">
          <div className="p-4 border-b border-subtle bg-surface-base font-bold text-sm uppercase text-secondary">Transaction Timeline</div>
          <div className="overflow-y-auto p-2" style={{ height: '320px' }}>
            {records.length ? records.map((record) => (
              <div className="flex items-center gap-4 py-3 px-2 border-b border-subtle" key={record.id}>
                <span className="text-xs text-secondary tabular-nums min-w-[70px]">{record.transaction_date}</span>
                <strong className="text-sm">₹{Number(record.amount).toLocaleString('en-IN')}</strong>
                <p className="text-xs text-secondary truncate">{record.description}</p>
              </div>
            )) : <p className="p-4 text-sm text-secondary">No transaction records found.</p>}
          </div>
        </div>

        <div className="panel p-0 overflow-hidden">
          <div className="p-4 border-b border-subtle bg-surface-base font-bold text-sm uppercase text-secondary">Salami Attack Detection</div>
          <div className="overflow-y-auto p-2" style={{ height: '320px' }}>
            {suspicious.length ? suspicious.map((record) => (
              <div key={record.id} className="flex gap-3 p-3 border border-default rounded-md mb-2">
                <AlertBadge severity="high">flag</AlertBadge>
                <div>
                  <strong className="text-sm">₹{Number(record.amount).toLocaleString('en-IN')}</strong>
                  <p className="text-xs text-secondary">{record.description}</p>
                </div>
              </div>
            )) : <p className="p-4 text-sm text-secondary">No suspicious micro-transactions detected.</p>}
          </div>
        </div>
      </div>

      {/* Benford Law Analysis */}
      <div className="panel">
        <h3 className="font-bold text-sm mb-4">Benford's Law Distribution</h3>
        <div className="h-[250px]">
          <BenfordChart data={benford} />
        </div>
      </div>
    </div>
  );
}